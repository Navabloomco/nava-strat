import { NextResponse } from "next/server";
import {
  runUniversalFuelRiskEngine,
  getUniversalDriverFuelRisk,
  analyzeTruckFuelRisk
} from "../../../../lib/intelligence/fuelRiskEngine.universal";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const driverName = url.searchParams.get("driver");
    const truckId = url.searchParams.get("truck");
    const lookback = url.searchParams.get("lookback");
    const days = url.searchParams.get("days");

    // Default lookback: 7 days (168 hours)
    let lookbackHours = 168;
    if (lookback === "day") lookbackHours = 24;
    else if (lookback === "week") lookbackHours = 168;
    else if (lookback === "month") lookbackHours = 720;
    else if (lookback && !isNaN(parseInt(lookback))) lookbackHours = parseInt(lookback);

    let daysNum = days ? parseInt(days) : (lookbackHours === 24 ? 1 : lookbackHours === 168 ? 7 : 30);

    // TRUCK-ONLY ANALYSIS (yard theft, no driver needed)
    if (truckId) {
      const result = await analyzeTruckFuelRisk(truckId, daysNum);
      return NextResponse.json({
        success: true,
        truck_id: truckId,
        days: daysNum,
        ...result
      });
    }

    // DRIVER-BASED ANALYSIS (shift windows)
    if (driverName) {
      const summary = await getUniversalDriverFuelRisk(driverName, daysNum);
      return NextResponse.json({
        success: true,
        lookback_hours: lookbackHours,
        ...summary
      });
    }

    // DEFAULT: analyze all shifts in the lookback period
    const result = await runUniversalFuelRiskEngine(undefined, lookbackHours);
    return NextResponse.json({
      success: true,
      lookback_hours: lookbackHours,
      scores_analyzed: result.scores?.length || 0,
      scores: result.scores
    });
  } catch (err: any) {
    console.error("Fuel risk API error:", err);
    return NextResponse.json(
      {
        success: false,
        message: err.message || "Fuel risk analysis failed"
      },
      { status: 500 }
    );
  }
}
