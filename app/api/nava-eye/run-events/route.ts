import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { processTelemetryEvents } from "../../../../lib/intelligence/eventEngine";

export async function GET(req: Request) {
  try {
    const authHeader =
      req.headers.get("authorization");

    if (
      authHeader !==
      `Bearer ${process.env.CRON_SECRET}`
    ) {
      return new Response(
        "Unauthorized",
        { status: 401 }
      );
    }

    // LAST 24 HOURS
    const since = new Date(
      Date.now() -
        1000 * 60 * 60 * 24
    ).toISOString();

    const { data: telemetry, error } =
      await supabaseAdmin
        .from("telemetry_logs")
        .select("*")
        .gte("recorded_at", since)
        .order("recorded_at", {
          ascending: true,
        });

    if (error) {
      throw error;
    }

    const result =
      await processTelemetryEvents(
        telemetry || []
      );

    return NextResponse.json({
      success: true,
      processed:
        telemetry?.length || 0,
      generated_events:
        result.generated_events,
      summary: result.summary,
      generated_at:
        new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        message:
          err.message ||
          "Event processing failed",
      },
      { status: 500 }
    );
  }
}
