import { NextResponse } from "next/server";
import { supabase } from "../../../../../lib/supabase";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import {
  ProviderRecord,
  runProviderSync,
} from "../../../../../lib/providers/engine";

export const dynamic = "force-dynamic";

type ResolvedCompany = {
  id: string;
  name: string;
  slug: string;
};

type ResolveCompanyResult =
  | { company: ResolvedCompany; isPlatformOwner: boolean; error?: never }
  | { error: NextResponse; company?: never; isPlatformOwner?: never };

async function resolveCompany(
  req: Request,
  requestedCompanyId?: string | null
): Promise<ResolveCompanyResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("company_users")
    .select("company_id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (membershipError) throw membershipError;

  const activeMemberships = memberships || [];
  const isPlatformOwner = activeMemberships.some(
    (membership) => membership.role === "platform_owner"
  );

  if (isPlatformOwner) {
    const companyQuery = supabaseAdmin
      .from("companies")
      .select("id, name, slug");

    const { data: company, error: companyError } = requestedCompanyId
      ? await companyQuery.eq("id", requestedCompanyId).maybeSingle()
      : await companyQuery.order("name", { ascending: true }).limit(1).maybeSingle();

    if (companyError) throw companyError;
    if (!company) {
      return {
        error: NextResponse.json(
          { success: false, error: "Company not found" },
          { status: 404 }
        ),
      };
    }

    return { company: company as ResolvedCompany, isPlatformOwner };
  }

  const companyId = activeMemberships
    .map((membership) => membership.company_id)
    .filter(Boolean)[0];

  if (!companyId) {
    return {
      error: NextResponse.json(
        { success: false, error: "Unable to resolve company access" },
        { status: 403 }
      ),
    };
  }

  const { data: company, error: companyError } = await supabaseAdmin
    .from("companies")
    .select("id, name, slug")
    .eq("id", companyId)
    .maybeSingle();

  if (companyError) throw companyError;
  if (!company) {
    return {
      error: NextResponse.json(
        { success: false, error: "Unable to resolve company access" },
        { status: 403 }
      ),
    };
  }

  return { company: company as ResolvedCompany, isPlatformOwner };
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json().catch(() => ({}));
    const resolved = await resolveCompany(req, body.companyId);
    if (resolved.error) return resolved.error;

    const { data: provider, error: providerError } = await supabaseAdmin
      .from("tracking_providers")
      .select("*")
      .eq("id", params.id)
      .eq("company_id", resolved.company.id)
      .maybeSingle();

    if (providerError) throw providerError;
    if (!provider) {
      return NextResponse.json(
        { success: false, error: "Provider not found" },
        { status: 404 }
      );
    }

    const result = await runProviderSync(provider as ProviderRecord);

    await supabaseAdmin
      .from("tracking_providers")
      .update({
        last_test_status: result.success ? "success" : "failure",
        last_test_message: result.message,
        last_test_at: new Date().toISOString(),
      })
      .eq("id", provider.id)
      .eq("company_id", resolved.company.id);

    const [
      { count: assetsCount },
      { count: telemetryCount },
      telemetryResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("fleet_assets")
        .select("truck_id", { count: "exact", head: true })
        .eq("company_id", resolved.company.id)
        .eq("provider_id", provider.id),
      supabaseAdmin
        .from("telemetry_logs")
        .select("recorded_at", { count: "exact", head: true })
        .eq("company_id", resolved.company.id)
        .eq("provider_id", provider.id),
      supabaseAdmin
        .from("telemetry_logs")
        .select("recorded_at")
        .eq("company_id", resolved.company.id)
        .eq("provider_id", provider.id)
        .order("recorded_at", { ascending: false })
        .limit(1),
    ]);

    if (telemetryResult.error) throw telemetryResult.error;

    const latestTelemetryAt =
      telemetryResult.data?.[0]?.recorded_at || null;

    return NextResponse.json({
      success: result.success,
      message: result.message,
      provider_id: provider.id,
      provider_name: provider.provider_name,
      vehicles_found: result.vehicleCount,
      assets_count: assetsCount || 0,
      telemetry_count: telemetryCount || 0,
      latest_telemetry_at: latestTelemetryAt,
      sample_normalized: result.sample_normalized || null,
    });
  } catch (err: any) {
    console.error("Provider test error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Provider test failed" },
      { status: 500 }
    );
  }
}
