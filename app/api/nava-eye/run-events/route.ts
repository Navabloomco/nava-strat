import { NextResponse } from "next/server";
import { runNavaEyeEventEngine } from "../../../../lib/intelligence/eventEngine";

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");

    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    const result = await runNavaEyeEventEngine();

    return NextResponse.json({
      ...result,
      generated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        message: err.message || "Event processing failed",
      },
      { status: 500 }
    );
  }
}
