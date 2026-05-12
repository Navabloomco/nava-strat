import { NextResponse } from "next/server";
import {
  runUniversalFuelRiskEngine,
  getUniversalDriverFuelRisk,
} from "../../../../lib/intelligence/fuelRiskEngine.universal";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const driverName = url.searchParams.get("driver");

    if (driverName) {
      const summary = await getUniversalDriverFuelRisk(driverName);

      return NextResponse.json({
        success: true,
        ...summary,
      });
    }

    const result = await runUniversalFuelRiskEngine();

    return NextResponse.json({
      success: true,
      scores_analyzed: result.scores?.length || 0,
      scores: result.scores,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        message: err.message || "Fuel risk analysis failed",
      },
      { status: 500 }
    );
  }
}
