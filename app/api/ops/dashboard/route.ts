import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ResolvedCompany = {
  id: string;
  name: string;
  slug: string;
};

type ResolveCompanyResult =
  | {
      company: ResolvedCompany;
      isPlatformOwner: boolean;
      roles: string[];
      capabilities: { can_apply_alert_context: boolean };
      error?: never;
    }
  | {
      error: NextResponse;
      company?: never;
      isPlatformOwner?: never;
      roles?: never;
      capabilities?: never;
    };

const SHARED_DISRUPTION_REASONS = [
  "Road disruption",
  "Traffic congestion",
  "Police checkpoint",
  "Port delay",
  "Border delay",
  "Loading queue",
  "Weather delay",
  "Dispatch hold",
  "Client delay",
  "Security disruption",
  "Other",
];

function noStoreJson(body: any, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Cache-Control": "no-store",
    },
  });
}

function buildCapabilities(roles: string[], isPlatformOwner: boolean) {
  const normalizedRoles = new Set(roles.map((role) => role.toLowerCase()));

  return {
    can_apply_alert_context:
      isPlatformOwner ||
      normalizedRoles.has("platform_owner") ||
      normalizedRoles.has("owner") ||
      normalizedRoles.has("admin") ||
      normalizedRoles.has("ops"),
  };
}

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

function buildSharedDisruptionCandidate(
  alerts: any[],
  enabledAssetsCount: number
) {
  const windowMinutes = 90;
  const emptyCandidate = {
    detected: false,
    event_type: "excessive_idle",
    affected_count: 0,
    enabled_assets: enabledAssetsCount,
    affected_percentage: 0,
    window_minutes: windowMinutes,
    affected_truck_ids: [],
    event_ids: [],
    started_at: null,
    latest_event_at: null,
    suggested_reasons: SHARED_DISRUPTION_REASONS,
  };

  if (enabledAssetsCount < 3) return emptyCandidate;

  const since = Date.now() - windowMinutes * 60 * 1000;
  const recentIdleAlerts = alerts.filter((alert) => {
    const timestamp = new Date(alert.created_at || alert.started_at || 0).getTime();
    return (
      alert.event_type === "excessive_idle" &&
      !alert.context_applied_at &&
      alert.truck_id &&
      Number.isFinite(timestamp) &&
      timestamp >= since
    );
  });

  const affectedTruckIds = Array.from(
    new Set(recentIdleAlerts.map((alert) => alert.truck_id).filter(Boolean))
  );
  const affectedCount = affectedTruckIds.length;
  const affectedPercentage =
    enabledAssetsCount > 0
      ? Math.round((affectedCount / enabledAssetsCount) * 100)
      : 0;
  const detected = affectedCount >= 3 && affectedPercentage >= 60;

  if (!detected) {
    return {
      ...emptyCandidate,
      affected_count: affectedCount,
      affected_percentage: affectedPercentage,
      affected_truck_ids: affectedTruckIds,
      event_ids: recentIdleAlerts.map((alert) => alert.id).filter(Boolean),
    };
  }

  const times = recentIdleAlerts
    .map((alert) => alert.created_at || alert.started_at)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);

  return {
    detected: true,
    event_type: "excessive_idle",
    affected_count: affectedCount,
    enabled_assets: enabledAssetsCount,
    affected_percentage: affectedPercentage,
    window_minutes: windowMinutes,
    affected_truck_ids: affectedTruckIds,
    event_ids: recentIdleAlerts.map((alert) => alert.id).filter(Boolean),
    started_at: times.length ? new Date(Math.min(...times)).toISOString() : null,
    latest_event_at: times.length ? new Date(Math.max(...times)).toISOString() : null,
    suggested_reasons: SHARED_DISRUPTION_REASONS,
  };
}

async function resolveCompany(
  req: Request,
  requestedCompanyId?: string | null
): Promise<ResolveCompanyResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return {
      error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("company_users")
    .select("company_id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (membershipError) throw membershipError;

  const activeMemberships = memberships || [];
  const roles = Array.from(
    new Set(
      activeMemberships
        .map((membership) => String(membership.role || "").toLowerCase())
        .filter(Boolean)
    )
  );
  const isPlatformOwner = roles.includes("platform_owner");
  const capabilities = buildCapabilities(roles, isPlatformOwner);

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
        error: noStoreJson(
          { success: false, error: "Company not found" },
          { status: 404 }
        ),
      };
    }

    return { company: company as ResolvedCompany, isPlatformOwner, roles, capabilities };
  }

  const companyId = activeMemberships
    .map((membership) => membership.company_id)
    .filter(Boolean)[0];

  if (!companyId) {
    return {
      error: noStoreJson(
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
      error: noStoreJson(
        { success: false, error: "Unable to resolve company access" },
        { status: 403 }
      ),
    };
  }

  return { company: company as ResolvedCompany, isPlatformOwner, roles, capabilities };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveCompany(req, searchParams.get("companyId"));
    if (resolved.error) return resolved.error;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      journeysResult,
      importedAssetsResult,
      enabledAssetsResult,
      providersResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("journeys")
        .select("*")
        .eq("company_id", resolved.company.id)
        .eq("is_demo", false)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("fleet_assets")
        .select("truck_id, registration, status")
        .eq("company_id", resolved.company.id)
        .eq("status", "active")
        .order("last_seen_at", { ascending: false }),
      supabaseAdmin
        .from("fleet_assets")
        .select("*")
        .eq("company_id", resolved.company.id)
        .eq("status", "active")
        .eq("intelligence_enabled", true)
        .order("last_seen_at", { ascending: false }),
      supabaseAdmin
        .from("tracking_providers")
        .select("*")
        .eq("company_id", resolved.company.id)
        .order("created_at", { ascending: false }),
    ]);

    if (journeysResult.error) throw journeysResult.error;
    if (importedAssetsResult.error) throw importedAssetsResult.error;
    if (enabledAssetsResult.error) throw enabledAssetsResult.error;
    if (providersResult.error) throw providersResult.error;

    const journeys = journeysResult.data || [];
    const importedAssets = importedAssetsResult.data || [];
    const fleetAssets = enabledAssetsResult.data || [];
    const enabledTruckIds = fleetAssets
      .map((asset) => asset.truck_id)
      .filter(Boolean);
    let alerts: any[] = [];
    let telemetryPoints24h = 0;

    if (enabledTruckIds.length > 0) {
      const [alertsResult, telemetryResult] = await Promise.all([
        supabaseAdmin
          .from("telemetry_events")
          .select(
            "id, company_id, truck_id, event_type, severity, location_name, created_at, started_at, context_type, context_label, context_note, context_applied_by, context_applied_at"
          )
          .eq("company_id", resolved.company.id)
          .in("truck_id", enabledTruckIds)
          .order("created_at", { ascending: false })
          .limit(20),
        supabaseAdmin
          .from("telemetry_logs")
          .select("id")
          .eq("company_id", resolved.company.id)
          .in("truck_id", enabledTruckIds)
          .gte("recorded_at", since),
      ]);

      if (alertsResult.error) throw alertsResult.error;
      if (telemetryResult.error) throw telemetryResult.error;

      alerts = alertsResult.data || [];
      telemetryPoints24h = telemetryResult.data?.length || 0;
    }
    const sharedDisruptionCandidate = buildSharedDisruptionCandidate(
      alerts,
      fleetAssets.length
    );

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

    return noStoreJson({
      success: true,
      company: resolved.company,
      is_platform_owner: resolved.isPlatformOwner,
      roles: resolved.roles,
      capabilities: resolved.capabilities,
      journeys,
      fleet_assets: fleetAssets,
      provider_statuses: providers.map(sanitizeProvider),
      alerts,
      shared_disruption_candidate: sharedDisruptionCandidate,
      summary: {
        total_journeys: journeys.length,
        active_journeys: activeJourneys.length,
        imported_assets: importedAssets.length,
        enabled_assets: fleetAssets.length,
        active_assets: fleetAssets.length,
        online_assets: onlineAssets.length,
        offline_assets: fleetAssets.length - onlineAssets.length,
        provider_count: providers.length,
        active_provider_count: providers.filter((provider) => provider.is_active).length,
        alert_count: alerts.length,
        high_alert_count: alerts.filter((alert) => alert.severity === "high").length,
        telemetry_points_24h: telemetryPoints24h,
      },
    });
  } catch (err: any) {
    console.error("Ops dashboard error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load ops dashboard" },
      { status: 500 }
    );
  }
}
