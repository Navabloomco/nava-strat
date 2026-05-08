import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { runProviderSync, ProviderRecord } from "../../../../lib/providers/engine";

/**
 * Test Route: Manual trigger to verify provider credentials 
 * and perform an immediate sync of fleet assets and telemetry.
 */
export async function POST(req: Request) {
  try {
    const { providerId } = await req.json();

    if (!providerId) {
      return NextResponse.json(
        { success: false, message: "providerId is required" },
        { status: 400 }
      );
    }

    // 1. Retrieve the provider configuration from the database
    const { data: provider, error: dbError } = await supabaseAdmin
      .from("tracking_providers")
      .select("*")
      .eq("id", providerId)
      .single();

    if (dbError || !provider) {
      return NextResponse.json(
        {
          success: false,
          stage: "DATABASE",
          message: "Provider not found in database",
          debug: dbError,
        },
        { status: 404 }
      );
    }

    const startedAt = Date.now();

    // 2. Execute the production-grade Sync Engine
    // This handles Auth, Fetching, Normalization, and DB Persistence
    const result = await runProviderSync(provider as ProviderRecord);
    
    const latencyMs = Date.now() - startedAt;

    // 3. Update the provider's test status for the Dashboard UI
    await supabaseAdmin.from("tracking_providers").update({
      last_test_status: result.success ? "success" : "failure",
      last_test_message: result.message,
      last_test_at: new Date().toISOString(),
    }).eq("id", provider.id);

    // 4. Return integrated response
    return NextResponse.json({
      ...result,
      provider: provider.provider_name,
      latency_ms: latencyMs,
    });

  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        stage: "SYSTEM",
        message: err.message || "Unknown system error during provider test",
      },
      { status: 500 }
    );
  }
}
