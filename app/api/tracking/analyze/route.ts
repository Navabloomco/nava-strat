import { supabase } from "../../../../lib/supabase";
import { NextResponse } from "next/server";
import { detectFuelDrops } from "../../../lib/fuel/detection";
import { smoothFuelReadings } from "../../../lib/fuel/smoothing";

export async function GET() {
  // 1. Get last 2 hours of logs
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: logs, error } = await supabase
    .from("tracking_logs")
    .select("*")
    .gt("recorded_at", twoHoursAgo)
    .order("recorded_at", { ascending: true });

  if (error) {
    console.error("Log fetch error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 2. Group logs by truck
  const logsByTruck: Record<string, any[]> = {};

  for (const log of logs || []) {
    if (!logsByTruck[log.truck_id]) {
      logsByTruck[log.truck_id] = [];
    }
    logsByTruck[log.truck_id].push(log);
  }

  const allAlerts: any[] = [];

  // 3. Process each truck
  for (const truckId in logsByTruck) {
    const truckLogs = logsByTruck[truckId];

    // ✅ APPLY SMOOTHING FIRST (CRITICAL)
    const smoothed = smoothFuelReadings(truckLogs);

    // ✅ THEN DETECT
    const detected = detectFuelDrops(smoothed);

    if (detected.length > 0) {
      allAlerts.push(...detected);
    }
  }

  // 4. Save alerts (safe insert)
  if (allAlerts.length > 0) {
    const { error: insertError } = await supabase
      .from("alerts")
      .insert(
        allAlerts.map((a) => ({
          ...a,
          status: "new",
          acknowledged: false,
        }))
      );

    if (insertError) {
      console.error("Alert insert error:", insertError);
    }
  }

  return NextResponse.json({
    success: true,
    alerts_found: allAlerts.length,
    processed_trucks: Object.keys(logsByTruck).length,
  });
}
