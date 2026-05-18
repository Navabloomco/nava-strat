import { NextResponse } from "next/server";
import { runNavaEyeEventEngine } from "../../../../lib/intelligence/eventEngine";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonResponse(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init?.headers || {}),
    },
  });
}

export async function GET(req: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return jsonResponse(
        {
          success: false,
          message: "Event processing unavailable",
        },
        { status: 503 }
      );
    }

    const authHeader = req.headers.get("authorization");

    if (authHeader !== `Bearer ${cronSecret}`) {
      return jsonResponse(
        {
          success: false,
          message: "Unauthorized",
        },
        { status: 401 }
      );
    }

    const result = await runNavaEyeEventEngine();

    return jsonResponse({
      ...result,
      generated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    return jsonResponse(
      {
        success: false,
        message: err.message || "Event processing failed",
      },
      { status: 500 }
    );
  }
}
