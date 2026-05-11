import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

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

    // SIMPLE TRUCK DETECTION
    const truckMatch =
      question.match(/[A-Z]{3}\s?\d{3}[A-Z]/i);

    const truckId = truckMatch
      ? truckMatch[0].toUpperCase()
      : null;

    let asset: any = null;
    let events: any[] = [];
    let telemetry: any[] = [];

    if (truckId) {
      const assetResult =
        await supabaseAdmin
          .from("fleet_assets")
          .select("*")
          .ilike("truck_id", `%${truckId}%`)
          .single();

      asset = assetResult.data;

      const eventsResult =
        await supabaseAdmin
          .from("telemetry_events")
          .select("*")
          .ilike("truck_id", `%${truckId}%`)
          .order("created_at", {
            ascending: false,
          })
          .limit(10);

      events = eventsResult.data || [];

      const telemetryResult =
        await supabaseAdmin
          .from("telemetry_logs")
          .select("*")
          .ilike("truck_id", `%${truckId}%`)
          .order("recorded_at", {
            ascending: false,
          })
          .limit(20);

      telemetry =
        telemetryResult.data || [];
    }

    // BUILD OPERATIONAL SUMMARY
    const narrative: string[] = [];

    if (!truckId) {
      narrative.push(
        "No truck identifier detected in question."
      );
    } else {
      narrative.push(
        `Truck ${truckId} analysis generated.`
      );

      if (asset?.last_seen_at) {
        narrative.push(
          `Last telemetry received at ${asset.last_seen_at}.`
        );
      }

      if (asset?.latitude && asset?.longitude) {
        narrative.push(
          `Current coordinates are ${asset.latitude}, ${asset.longitude}.`
        );
      }

      if (events.length > 0) {
        narrative.push(
          `${events.length} recent operational events detected.`
        );

        const eventTypes = [
          ...new Set(
            events.map(
              (e) => e.event_type
            )
          ),
        ];

        narrative.push(
          `Recent event types include: ${eventTypes.join(
            ", "
          )}.`
        );
      }

      const overspeedEvents =
        events.filter(
          (e) =>
            e.event_type ===
            "overspeed"
        );

      if (
        overspeedEvents.length > 0
      ) {
        narrative.push(
          "Overspeed behavior detected recently."
        );
      }

      const fuelEvents =
        events.filter((e) =>
          [
            "low_fuel",
            "fuel_drop_stationary",
          ].includes(
            e.event_type
          )
        );

      if (fuelEvents.length > 0) {
        narrative.push(
          "Fuel-related operational alerts detected."
        );
      }

      const locations = events
        .map(
          (e) => e.location_name
        )
        .filter(Boolean);

      if (locations.length > 0) {
        narrative.push(
          `Recent activity locations include ${[
            ...new Set(locations),
          ].join(", ")}.`
        );
      }
    }

    return NextResponse.json({
      success: true,
      truck_id: truckId,
      question,
      operational_summary:
        narrative.join(" "),
      asset,
      recent_events: events,
      telemetry_points:
        telemetry.length,
      generated_at:
        new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        message:
          err.message ||
          "Nava Eye analysis failed",
      },
      { status: 500 }
    );
  }
}
