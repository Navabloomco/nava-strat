import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type ResolvedCompany = {
  id: string;
  name: string;
  slug: string;
};

type ResolveCompanyResult =
  | { company: ResolvedCompany; isPlatformOwner: boolean; error?: never }
  | { error: NextResponse; company?: never; isPlatformOwner?: never };

function sanitizeProvider(provider: any) {
  return {
    id: provider.id,
    company_id: provider.company_id,
    provider_name: provider.provider_name,
    provider_slug: provider.provider_slug || null,
    provider_type: provider.provider_slug || null,
    is_active: Boolean(provider.is_active),
    status: provider.last_test_status || (provider.is_active ? "active" : "inactive"),
    last_test_status: provider.last_test_status || null,
    last_test_message: provider.last_test_message || null,
    last_test_at: provider.last_test_at || null,
    last_sync_at: provider.last_sync_at || provider.last_test_at || null,
    has_api_key: Boolean(provider.api_key),
    has_password: Boolean(provider.password),
    has_bearer_token: Boolean(provider.bearer_token),
  };
}

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

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveCompany(req, searchParams.get("companyId"));
    if (resolved.error) return resolved.error;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      journeysResult,
      assetsResult,
      providersResult,
      alertsResult,
      telemetryResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("journeys")
        .select("*")
        .eq("company_id", resolved.company.id)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("fleet_assets")
        .select("*")
        .eq("company_id", resolved.company.id)
        .eq("status", "active")
        .order("last_seen_at", { ascending: false }),
      supabaseAdmin
        .from("tracking_providers")
        .select("*")
        .eq("company_id", resolved.company.id)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("telemetry_events")
        .select("*")
        .eq("company_id", resolved.company.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("telemetry_logs")
        .select("id")
        .eq("company_id", resolved.company.id)
        .gte("recorded_at", since),
    ]);

    if (journeysResult.error) throw journeysResult.error;
    if (assetsResult.error) throw assetsResult.error;
    if (providersResult.error) throw providersResult.error;
    if (alertsResult.error) throw alertsResult.error;
    if (telemetryResult.error) throw telemetryResult.error;

    const journeys = journeysResult.data || [];
    const fleetAssets = assetsResult.data || [];
    const alerts = alertsResult.data || [];
    const providers = providersResult.data || [];
    const activeJourneys = journeys.filter(
      (journey) => String(journey.status || "").toLowerCase() === "active"
    );
    const now = Date.now();
    const onlineAssets = fleetAssets.filter((asset) => {
      if (!asset.last_seen_at) return false;
      const minutes = (now - new Date(asset.last_seen_at).getTime()) / 60000;
      return minutes <= 30;
    });

    return NextResponse.json({
      success: true,
      company: resolved.company,
      is_platform_owner: resolved.isPlatformOwner,
      journeys,
      fleet_assets: fleetAssets,
      provider_statuses: providers.map(sanitizeProvider),
      alerts,
      summary: {
        total_journeys: journeys.length,
        active_journeys: activeJourneys.length,
        active_assets: fleetAssets.length,
        online_assets: onlineAssets.length,
        offline_assets: fleetAssets.length - onlineAssets.length,
        provider_count: providers.length,
        active_provider_count: providers.filter((provider) => provider.is_active).length,
        alert_count: alerts.length,
        high_alert_count: alerts.filter((alert) => alert.severity === "high").length,
        telemetry_points_24h: telemetryResult.data?.length || 0,
      },
    });
  } catch (err: any) {
    console.error("Ops dashboard error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load ops dashboard" },
      { status: 500 }
    );
  }
}
