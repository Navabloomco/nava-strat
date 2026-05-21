import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { runProviderSync, ProviderRecord } from "../../../../lib/providers/engine";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(body: any, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return noStoreJson(
      { success: false, error: "Provider sync is not configured" },
      { status: 503 }
    );
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const startedAt = Date.now();

    // ✅ Only sync providers that are linked to a company (company_id IS NOT NULL)
    const { data: providers, error } = await supabaseAdmin
      .from("tracking_providers")
      .select("*")
      .eq("is_active", true)
      .not("company_id", "is", null);

    if (error) {
      return noStoreJson(
        { success: false, message: "Failed to load active providers", debug: error },
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
        skipped_missing_identifier: result.skipped_missing_identifier || 0,
        capability_summary: result.capability_summary || null,
        latency_ms: Date.now() - providerStartedAt,
      });
    }

    return noStoreJson({
      success: true,
      provider_count: providers?.length || 0,
      latency_ms: Date.now() - startedAt,
      summary,
    });
  } catch (err: any) {
    return noStoreJson(
      { success: false, message: err.message || "Unknown sync error" },
      { status: 500 }
    );
  }
}
