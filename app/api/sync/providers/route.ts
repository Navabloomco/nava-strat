import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import {
  runProviderSync,
  ProviderRecord,
} from "../../../../lib/providers/engine";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const startedAt = Date.now();

    const { data: providers, error } = await supabaseAdmin
      .from("tracking_providers")
      .select("*")
      .eq("is_active", true);

    if (error) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to load active providers",
          debug: error,
        },
        { status: 500 }
      );
    }

    const summary = [];

    for (const provider of providers || []) {
      const providerStartedAt = Date.now();

      const result = await runProviderSync(provider as ProviderRecord);

      await supabaseAdmin
        .from("tracking_providers")
        .update({
          last_test_status: result.success ? "success" : "failure",
          last_test_message: result.message,
          last_test_at: new Date().toISOString(),
        })
        .eq("id", provider.id);

      summary.push({
        provider_id: provider.id,
        provider_name: provider.provider_name,
        success: result.success,
        message: result.message,
        vehicle_count: result.vehicleCount,
        latency_ms: Date.now() - providerStartedAt,
      });
    }

    return NextResponse.json({
      success: true,
      provider_count: providers?.length || 0,
      latency_ms: Date.now() - startedAt,
      summary,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        message: err.message || "Unknown sync error",
      },
      { status: 500 }
    );
  }
}
