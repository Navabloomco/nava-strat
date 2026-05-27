import { NextResponse } from "next/server";
import {
  fetchActiveGeofences,
  matchPointToGeofence,
} from "../../../../lib/intelligence/geofenceMatcher";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import {
  canViewOps,
  normalizeRole,
  rolesForCompany,
} from "../../../../lib/api/roleAccess";

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
const OPS_JOURNEY_FIELDS =
  "id, internal_trip_id, client_name, truck, driver, from_location, to_location, status, start_time, end_time, created_at";
const OPS_ENABLED_ASSET_FIELDS =
  "id, truck_id, registration, status, asset_category, provider_name, latitude, longitude, last_seen_at";
const OPS_PROVIDER_FIELDS =
  "id, provider_name, provider_slug, is_active, last_test_status, last_test_message, last_test_at, last_sync_at, created_at";
const OPS_ALERT_FIELDS =
  "id, truck_id, event_type, severity, location_name, latitude, longitude, created_at, started_at, context_label, context_note, context_applied_at";

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
  const normalizedRoles = new Set(roles.map(normalizeRole));

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
    provider_name: provider.provider_name,
    provider_slug: provider.provider_slug || null,
    provider_type: provider.provider_slug || null,
    is_active: Boolean(provider.is_active),
    status: provider.last_test_status || (provider.is_active ? "active" : "inactive"),
    last_test_status: provider.last_test_status || null,
    last_test_message: provider.last_test_message || null,
    last_test_at: provider.last_test_at || null,
    last_sync_at: provider.last_sync_at || provider.last_test_at || null,
  };
}

function normalizeTruckKey(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function sanitizeAssignedDriver(assignment: any) {
  if (!assignment) return null;

  return {
    id: assignment.id,
    driver_id: assignment.driver_id || null,
    driver_name: assignment.driver_name || null,
    assigned_from: assignment.assigned_from || null,
  };
}

function buildAssignedDriverLookup(assignments: any[], assets: any[]) {
  const assetIds = new Set(assets.map((asset) => asset.id).filter(Boolean));
  const enabledTruckKeys = new Set(
    assets
      .flatMap((asset) => [asset.truck_id, asset.registration])
      .map(normalizeTruckKey)
      .filter(Boolean)
  );
  const byAssetId = new Map<string, any>();
  const byTruckKey = new Map<string, any>();
  const now = Date.now();

  for (const assignment of assignments) {
    const assignedTo = assignment.assigned_to
      ? new Date(assignment.assigned_to).getTime()
      : null;
    const isCurrent =
      assignment.assignment_status === "active" &&
      (!assignedTo || assignedTo > now);

    if (!isCurrent) continue;

    const assetId = assignment.asset_id || "";
    const truckKey = normalizeTruckKey(assignment.truck_id);
    const belongsToEnabledAsset =
      (assetId && assetIds.has(assetId)) ||
      (truckKey && enabledTruckKeys.has(truckKey));

    if (!belongsToEnabledAsset) continue;

    if (assetId && !byAssetId.has(assetId)) {
      byAssetId.set(assetId, assignment);
    }
    if (truckKey && !byTruckKey.has(truckKey)) {
      byTruckKey.set(truckKey, assignment);
    }
  }

  return { byAssetId, byTruckKey };
}

function findAssignedDriverForAsset(asset: any, lookup: ReturnType<typeof buildAssignedDriverLookup>) {
  const assignment =
    (asset?.id && lookup.byAssetId.get(asset.id)) ||
    lookup.byTruckKey.get(normalizeTruckKey(asset?.truck_id)) ||
    lookup.byTruckKey.get(normalizeTruckKey(asset?.registration));

  return sanitizeAssignedDriver(assignment);
}

function findAssignedDriverForTruck(
  truckValue: string | null | undefined,
  lookup: ReturnType<typeof buildAssignedDriverLookup>,
  assetsByTruckKey: Map<string, any>
) {
  const truckKey = normalizeTruckKey(truckValue);
  const asset = assetsByTruckKey.get(truckKey);

  return (
    (asset && findAssignedDriverForAsset(asset, lookup)) ||
    sanitizeAssignedDriver(lookup.byTruckKey.get(truckKey))
  );
}

function sanitizeAlert(alert: any) {
  return {
    id: alert.id,
    truck_id: alert.truck_id || null,
    event_type: alert.event_type || null,
    severity: alert.severity || null,
    location_name: alert.location_name || null,
    created_at: alert.created_at || null,
    started_at: alert.started_at || null,
    context_label: alert.context_label || null,
    context_note: alert.context_note || null,
    geofence_match: alert.geofence_match || null,
    assigned_driver: alert.assigned_driver || null,
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
  const isPlatformOwner = activeMemberships.some(
    (membership) => normalizeRole(membership.role) === "platform_owner"
  );
  const normalizedRequestedCompanyId = requestedCompanyId?.trim() || null;

  if (isPlatformOwner) {
    const companyQuery = supabaseAdmin
      .from("companies")
      .select("id, name, slug");

    const { data: company, error: companyError } = normalizedRequestedCompanyId
      ? await companyQuery.eq("id", normalizedRequestedCompanyId).maybeSingle()
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

    const roles = rolesForCompany(activeMemberships, company.id, true);
    return {
      company: company as ResolvedCompany,
      isPlatformOwner,
      roles,
      capabilities: buildCapabilities(roles, isPlatformOwner),
    };
  }

  const companyId =
    normalizedRequestedCompanyId ||
    activeMemberships.map((membership) => membership.company_id).filter(Boolean)[0];

  if (
    !companyId ||
    !activeMemberships.some((membership) => membership.company_id === companyId)
  ) {
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

  const roles = rolesForCompany(activeMemberships, company.id);
  return {
    company: company as ResolvedCompany,
    isPlatformOwner,
    roles,
    capabilities: buildCapabilities(roles, isPlatformOwner),
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveCompany(req, searchParams.get("companyId"));
    if (resolved.error) return resolved.error;
    if (!canViewOps(resolved.roles)) {
      return noStoreJson(
        { success: false, error: "Operations dashboard access required" },
        { status: 403 }
      );
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      journeysResult,
      importedAssetsResult,
      enabledAssetsResult,
      providersResult,
      assignmentsResult,
      geofences,
    ] = await Promise.all([
      supabaseAdmin
        .from("journeys")
        .select(OPS_JOURNEY_FIELDS)
        .eq("company_id", resolved.company.id)
        .eq("is_demo", false)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("fleet_assets")
        .select("id")
        .eq("company_id", resolved.company.id)
        .eq("status", "active")
        .order("last_seen_at", { ascending: false }),
      supabaseAdmin
        .from("fleet_assets")
        .select(OPS_ENABLED_ASSET_FIELDS)
        .eq("company_id", resolved.company.id)
        .eq("status", "active")
        .eq("intelligence_enabled", true)
        .order("last_seen_at", { ascending: false }),
      supabaseAdmin
        .from("tracking_providers")
        .select(OPS_PROVIDER_FIELDS)
        .eq("company_id", resolved.company.id)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("asset_driver_assignments")
        .select(
          "id, asset_id, truck_id, driver_id, driver_name, assigned_from, assigned_to, assignment_status"
        )
        .eq("company_id", resolved.company.id)
        .eq("assignment_status", "active"),
      fetchActiveGeofences(supabaseAdmin, resolved.company.id),
    ]);

    if (journeysResult.error) throw journeysResult.error;
    if (importedAssetsResult.error) throw importedAssetsResult.error;
    if (enabledAssetsResult.error) throw enabledAssetsResult.error;
    if (providersResult.error) throw providersResult.error;
    if (assignmentsResult.error) throw assignmentsResult.error;

    const journeys = journeysResult.data || [];
    const importedAssets = importedAssetsResult.data || [];
    const fleetAssets = enabledAssetsResult.data || [];
    const activeAssignments = assignmentsResult.data || [];
    const assetsByTruckKey = new Map<string, any>();
    for (const asset of fleetAssets) {
      for (const key of [
        normalizeTruckKey(asset.truck_id),
        normalizeTruckKey(asset.registration),
      ].filter(Boolean)) {
        assetsByTruckKey.set(key, asset);
      }
    }
    const assignedDriverLookup = buildAssignedDriverLookup(
      activeAssignments,
      fleetAssets
    );
    const fleetAssetsWithDrivers = fleetAssets.map((asset) => ({
      ...asset,
      assigned_driver: findAssignedDriverForAsset(asset, assignedDriverLookup),
    }));
    const enabledTruckIds = fleetAssets
      .map((asset) => asset.truck_id)
      .filter(Boolean);
    let alerts: any[] = [];
    let telemetryPoints24h = 0;

    if (enabledTruckIds.length > 0) {
      const [alertsResult, telemetryResult] = await Promise.all([
        supabaseAdmin
          .from("telemetry_events")
          .select(OPS_ALERT_FIELDS)
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
    const alertsWithGeofences = alerts.map((alert) => ({
      ...alert,
      geofence_match: matchPointToGeofence(alert, geofences),
      assigned_driver: findAssignedDriverForTruck(
        alert.truck_id,
        assignedDriverLookup,
        assetsByTruckKey
      ),
    }));
    const sharedDisruptionCandidate = buildSharedDisruptionCandidate(
      alerts,
      fleetAssets.length
    );

    const providers = providersResult.data || [];
    const activeJourneys = journeys.filter(
      (journey) => String(journey.status || "").toLowerCase() === "active"
    );
    const journeysWithDrivers = journeys.map((journey) => ({
      ...journey,
      assigned_driver: findAssignedDriverForTruck(
        journey.truck,
        assignedDriverLookup,
        assetsByTruckKey
      ),
    }));
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
      capabilities: resolved.capabilities,
      journeys: journeysWithDrivers,
      fleet_assets: fleetAssetsWithDrivers,
      provider_statuses: providers.map(sanitizeProvider),
      alerts: alertsWithGeofences.map(sanitizeAlert),
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
