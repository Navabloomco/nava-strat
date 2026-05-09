Good.

Now we build the first thing that makes Nava Eye feel intelligent instead of “just telemetry.”

Next Step

Create:

app/api/nava-eye/truck-report/route.ts

This becomes:

“Ask Nava Eye”

Example request:

{
  "truck_id": "KBJ123A",
  "hours": 24
}

And Nava Eye should answer:

* where the truck is
* where it stopped
* how long
* important events
* operational concerns
* driver assignment
* journey summary

⸻

FULL CODE

import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const truckId = body.truck_id;
    const hours = body.hours || 24;
    if (!truckId) {
      return NextResponse.json(
        {
          success: false,
          message: "truck_id required",
        },
        { status: 400 }
      );
    }
    const since = new Date();
    since.setHours(since.getHours() - hours);
    // CURRENT STATUS
    const { data: asset } = await supabaseAdmin
      .from("fleet_assets")
      .select("*")
      .eq("truck_id", truckId)
      .single();
    // TELEMETRY
    const { data: telemetry } = await supabaseAdmin
      .from("telemetry_logs")
      .select("*")
      .eq("truck_id", truckId)
      .gte("recorded_at", since.toISOString())
      .order("recorded_at", { ascending: true });
    // EVENTS
    const { data: events } = await supabaseAdmin
      .from("telemetry_events")
      .select("*")
      .eq("truck_id", truckId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false });
    // DRIVER ASSIGNMENT
    const { data: assignment } = await supabaseAdmin
      .from("asset_driver_assignments")
      .select("*")
      .eq("truck_id", truckId)
      .is("assigned_to", null)
      .order("assigned_from", { ascending: false })
      .limit(1)
      .single();
    const telemetryCount = telemetry?.length || 0;
    // MOVEMENT ANALYSIS
    const movingLogs =
      telemetry?.filter(
        (t) =>
          t.speed !== null &&
          t.speed !== undefined &&
          Number(t.speed) > 3
      ) || [];
    const idleLogs =
      telemetry?.filter(
        (t) =>
          t.speed !== null &&
          t.speed !== undefined &&
          Number(t.speed) <= 1
      ) || [];
    // SPEED ANALYSIS
    const maxSpeed =
      telemetry && telemetry.length > 0
        ? Math.max(
            ...telemetry.map((t) =>
              t.speed !== null && t.speed !== undefined
                ? Number(t.speed)
                : 0
            )
          )
        : 0;
    // LAST LOCATION
    const lastTelemetry =
      telemetry && telemetry.length > 0
        ? telemetry[telemetry.length - 1]
        : null;
    // BUILD NARRATIVE
    const narrative: string[] = [];
    narrative.push(
      `${truckId} generated ${telemetryCount} telemetry updates in the last ${hours} hours.`
    );
    if (assignment?.driver_name) {
      narrative.push(
        `Current assigned driver is ${assignment.driver_name}.`
      );
    }
    if (movingLogs.length > 0) {
      narrative.push(
        `Vehicle was active and moving during this period.`
      );
    }
    if (idleLogs.length > movingLogs.length) {
      narrative.push(
        `Vehicle spent significant time stationary.`
      );
    }
    if (maxSpeed > 120) {
      narrative.push(
        `Overspeed behavior detected with peak speed of ${maxSpeed} km/h.`
      );
    }
    const offlineEvents =
      events?.filter((e) => e.event_type === "offline") || [];
    if (offlineEvents.length > 0) {
      narrative.push(
        `${offlineEvents.length} offline telemetry incidents detected.`
      );
    }
    const fuelEvents =
      events?.filter((e) =>
        [
          "low_fuel",
          "fuel_drop_stationary",
        ].includes(e.event_type)
      ) || [];
    if (fuelEvents.length > 0) {
      narrative.push(
        `Fuel-related operational alerts detected.`
      );
    }
    return NextResponse.json({
      success: true,
      truck: {
        truck_id: truckId,
        current_latitude: asset?.latitude || null,
        current_longitude: asset?.longitude || null,
        last_seen_at: asset?.last_seen_at || null,
      },
      driver: assignment || null,
      statistics: {
        telemetry_points: telemetryCount,
        movement_points: movingLogs.length,
        idle_points: idleLogs.length,
        max_speed: maxSpeed,
        event_count: events?.length || 0,
      },
      recent_events: events || [],
      summary: narrative.join(" "),
      generated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        message:
          err.message || "Truck report generation failed",
      },
      { status: 500 }
    );
  }
}

Why this matters

This is the first endpoint where Nava Eye:

* reasons
* summarizes
* interprets
* explains

instead of dumping rows.

That is the transition into AI operations software.
