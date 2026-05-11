import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { reverseGeocode } from "../../../../lib/location/reverseGeocode";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const question = body.question;

    if (!question) {
      return NextResponse.json(
        {
          success: false,
          message: "question required",
        },
        { status: 400 }
      );
    }

    // DETECT TIME RANGE FROM QUESTION
    let hoursBack = 24; // default
    const lowerQuestion = question.toLowerCase();
    
    if (lowerQuestion.includes("yesterday")) {
      hoursBack = 48;
    } else if (lowerQuestion.includes("last week")) {
      hoursBack = 168; // 7 days
    } else if (lowerQuestion.includes("last 3 days") || lowerQuestion.includes("last three days")) {
      hoursBack = 72;
    } else if (lowerQuestion.includes("today")) {
      hoursBack = 24;
    } else if (lowerQuestion.includes("past hour")) {
      hoursBack = 1;
    } else if (lowerQuestion.includes("past 6 hours")) {
      hoursBack = 6;
    } else if (lowerQuestion.includes("past 12 hours")) {
      hoursBack = 12;
    }

    const since = new Date();
    since.setHours(since.getHours() - hoursBack);

    // DETECT SPECIFIC EVENT TYPES FROM QUESTION
    const requestedEventTypes: string[] = [];
    
    if (lowerQuestion.includes("fuel") || lowerQuestion.includes("fuel issue") || lowerQuestion.includes("fuel theft")) {
      requestedEventTypes.push("fuel_drop_stationary", "low_fuel");
    }
    if (lowerQuestion.includes("speed") || lowerQuestion.includes("overspeed") || lowerQuestion.includes("speeding")) {
      requestedEventTypes.push("overspeed");
    }
    if (lowerQuestion.includes("idle") || lowerQuestion.includes("stationary") || lowerQuestion.includes("excessive idle")) {
      requestedEventTypes.push("excessive_idle");
    }
    if (lowerQuestion.includes("offline") || lowerQuestion.includes("disconnected")) {
      requestedEventTypes.push("offline");
    }

    // TRUCK DETECTION
    const truckMatch = question.match(/[A-Z]{3}\s?\d{3}[A-Z]/i);
    const truckId = truckMatch ? truckMatch[0].toUpperCase() : null;

    let asset: any = null;
    let events: any[] = [];
    let telemetry: any[] = [];

    if (truckId) {
      // FETCH ASSET
      const assetResult = await supabaseAdmin
        .from("fleet_assets")
        .select("*")
        .ilike("truck_id", `%${truckId}%`)
        .single();
      asset = assetResult.data;

      // FETCH EVENTS WITH TIME RANGE
      let eventsQuery = supabaseAdmin
        .from("telemetry_events")
        .select("*")
        .ilike("truck_id", `%${truckId}%`)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(20);

      if (requestedEventTypes.length > 0) {
        eventsQuery = eventsQuery.in("event_type", requestedEventTypes);
      }

      const eventsResult = await eventsQuery;
      events = eventsResult.data || [];

      // FETCH TELEMETRY WITH TIME RANGE
      const telemetryResult = await supabaseAdmin
        .from("telemetry_logs")
        .select("*")
        .ilike("truck_id", `%${truckId}%`)
        .gte("recorded_at", since.toISOString())
        .order("recorded_at", { ascending: false })
        .limit(20);
      telemetry = telemetryResult.data || [];

      // IF LOCATION ASKED BUT NO RECENT TELEMETRY, USE ASSET LOCATION
      if (lowerQuestion.includes("where") && telemetry.length === 0 && asset?.latitude && asset?.longitude) {
        const location = await reverseGeocode(
          Number(asset.latitude),
          Number(asset.longitude)
        );
        if (location) {
          asset.location_name = location.town || location.display_name;
          asset.country = location.country;
        }
      }
    }

    // BUILD OPERATIONAL SUMMARY
    const narrative: string[] = [];

    if (!truckId) {
      narrative.push("No truck identifier detected in question. Please include registration like KBJ 123A.");
    } else {
      const timeDescription = hoursBack === 1 ? "past hour" :
                              hoursBack === 6 ? "past 6 hours" :
                              hoursBack === 12 ? "past 12 hours" :
                              hoursBack === 24 ? "last 24 hours" :
                              hoursBack === 48 ? "yesterday" :
                              hoursBack === 72 ? "last 3 days" :
                              hoursBack === 168 ? "last week" :
                              `last ${hoursBack} hours`;

      narrative.push(`Analysis for ${truckId} over the ${timeDescription}.`);

      // CURRENT STATUS
      if (asset?.last_seen_at) {
        const lastSeen = new Date(asset.last_seen_at);
        const minutesSince = Math.floor((Date.now() - lastSeen.getTime()) / 60000);
        
        if (minutesSince < 5) {
          narrative.push(`Truck is active and reporting normally.`);
        } else if (minutesSince < 30) {
          narrative.push(`Last report received ${minutesSince} minutes ago.`);
        } else {
          narrative.push(`No recent telemetry for ${minutesSince} minutes. Possible offline.`);
        }
      }

      // LOCATION
      if (lowerQuestion.includes("where") && telemetry.length > 0) {
        const latestTelemetry = telemetry[0];
        if (latestTelemetry.latitude && latestTelemetry.longitude) {
          const location = await reverseGeocode(
            Number(latestTelemetry.latitude),
            Number(latestTelemetry.longitude)
          );
          if (location) {
            narrative.push(`Currently located in ${location.town || location.display_name}.`);
          } else {
            narrative.push(`Current coordinates: ${latestTelemetry.latitude}, ${latestTelemetry.longitude}.`);
          }
        }
      } else if (lowerQuestion.includes("where") && asset?.location_name) {
        narrative.push(`Last known location: ${asset.location_name}.`);
      }

      // EVENT SUMMARY - MOVED eventCounts OUTSIDE the if block
      const eventCounts: Record<string, number> = {};
      
      if (events.length === 0) {
        if (requestedEventTypes.length > 0) {
          const eventTypeNames = requestedEventTypes
            .map(t => t === "overspeed" ? "overspeed" : t === "excessive_idle" ? "excessive idle" : t === "fuel_drop_stationary" ? "fuel issues" : t)
            .join(" or ");
          narrative.push(`No ${eventTypeNames} events detected in the ${timeDescription}.`);
        } else {
          narrative.push(`No significant operational events detected.`);
        }
      } else {
        // Count events by type
        for (const event of events) {
          eventCounts[event.event_type] = (eventCounts[event.event_type] || 0) + 1;
        }
        
        narrative.push(`${events.length} operational events detected.`);
        
        const uniqueLocations = new Set<string>();
        for (const event of events) {
          if (event.location_name) {
            uniqueLocations.add(event.location_name);
          }
        }

        const eventDescriptions: string[] = [];
        if (eventCounts.overspeed) eventDescriptions.push(`${eventCounts.overspeed} overspeed incident${eventCounts.overspeed > 1 ? 's' : ''}`);
        if (eventCounts.excessive_idle) eventDescriptions.push(`${eventCounts.excessive_idle} excessive idle period${eventCounts.excessive_idle > 1 ? 's' : ''}`);
        if (eventCounts.fuel_drop_stationary) eventDescriptions.push(`${eventCounts.fuel_drop_stationary} stationary fuel drop${eventCounts.fuel_drop_stationary > 1 ? 's' : ''}`);
        if (eventCounts.low_fuel) eventDescriptions.push(`${eventCounts.low_fuel} low fuel warning${eventCounts.low_fuel > 1 ? 's' : ''}`);
        if (eventCounts.offline) eventDescriptions.push(`${eventCounts.offline} offline incident${eventCounts.offline > 1 ? 's' : ''}`);
        
        if (eventDescriptions.length > 0) {
          narrative.push(`Specific events: ${eventDescriptions.join(", ")}.`);
        }
        
        if (uniqueLocations.size > 0) {
          narrative.push(`Activity locations: ${Array.from(uniqueLocations).join(", ")}.`);
        }
      }

      // FOLLOW-UP SUGGESTION
      if (events.length > 0 && requestedEventTypes.length === 0 && eventCounts.fuel_drop_stationary) {
        narrative.push(`Suggest asking: "Has ${truckId} had fuel issues?" for more details.`);
      }
      if (events.length > 0 && requestedEventTypes.length === 0 && eventCounts.overspeed) {
        narrative.push(`Suggest asking: "Has ${truckId} been overspeeding?" for more details.`);
      }
      if (events.length > 0 && requestedEventTypes.length === 0 && eventCounts.excessive_idle) {
        narrative.push(`Suggest asking: "Has ${truckId} been idle excessively?" for more details.`);
      }
    }

    return NextResponse.json({
      success: true,
      truck_id: truckId,
      question,
      time_range_hours: hoursBack,
      operational_summary: narrative.join(" "),
      asset,
      recent_events: events,
      telemetry_points: telemetry.length,
      generated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        message: err.message || "Nava Eye analysis failed",
      },
      { status: 500 }
    );
  }
}
