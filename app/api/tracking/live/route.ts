import { NextResponse } from "next/server";
import {
  fetchActiveGeofences,
  matchPointToGeofence,
} from "../../../../lib/intelligence/geofenceMatcher";
import { getCurrentFleetLocations } from "../../../../lib/intelligence/fleetLocationService";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import {
  canViewOps,
  normalizeRole,
  rolesForCompany,
} from "../../../../lib/api/roleAccess";
import {
  normalizeProviderLocationLabel,
  resolveOperationalLocation,
} from "../../../../lib/location/resolveOperationalLocation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FRESHNESS_MINUTES = 30;

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
      error?: never;
    }
  | {
      error: NextResponse;
      company?: never;
      isPlatformOwner?: never;
      roles?: never;
    };

function noStoreJson(body: any, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Cache-Control": "no-store",
    },
  });
}

function sanitizeProvider(provider: any) {
  return {
    id: provider.id,
    provider_name: provider.provider_name,
    status: provider.last_test_status || (provider.is_active ? "active" : "inactive"),
    last_sync_at: provider.last_sync_at || provider.last_test_at || null,
    last_test_status: provider.last_test_status || null,
  };
}

async function resolveCompany(
  req: Request,
  requestedCompanyId?: string | null
): Promise<ResolveCompanyResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return { error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }) };
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
    const companyQuery = supabaseAdmin.from("companies").select("id, name, slug");
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

    return {
      company: company as ResolvedCompany,
      isPlatformOwner,
      roles: rolesForCompany(activeMemberships, company.id, true),
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

  return {
    company: company as ResolvedCompany,
    isPlatformOwner,
    roles: rolesForCompany(activeMemberships, company.id),
  };
}

function buildLatestTelemetryByTruck(logs: any[]) {
  const latest: Record<string, any> = {};

  for (const log of logs || []) {
    if (!log.truck_id || latest[log.truck_id]) continue;
    latest[log.truck_id] = log;
  }

  return latest;
}

function roundedCoordinateKey(latitude: any, longitude: any) {
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // Match lib/location/reverseGeocode.ts cache precision without triggering external geocoding.
  const roundedLat = Number(lat.toFixed(5));
  const roundedLng = Number(lng.toFixed(5));

  return {
    key: `${roundedLat}:${roundedLng}`,
    roundedLat,
    roundedLng,
  };
}

function locationLabelFromCache(row: any) {
  return row?.town || row?.county || row?.display_name || null;
}

async function fetchCachedLocationLabels(points: Array<{ latitude: any; longitude: any }>) {
  const uniquePoints = new Map<string, { roundedLat: number; roundedLng: number }>();

  for (const point of points) {
    const rounded = roundedCoordinateKey(point.latitude, point.longitude);
    if (!rounded) continue;
    uniquePoints.set(rounded.key, {
      roundedLat: rounded.roundedLat,
      roundedLng: rounded.roundedLng,
    });
  }

  if (uniquePoints.size === 0) return new Map<string, string | null>();

  const labels = new Map<string, string | null>();
  const roundedPoints = Array.from(uniquePoints.values());
  const roundedLats = Array.from(new Set(roundedPoints.map((point) => point.roundedLat)));
  const roundedLngs = Array.from(new Set(roundedPoints.map((point) => point.roundedLng)));

  try {
    const { data, error } = await supabaseAdmin
      .from("location_cache")
      .select("rounded_lat, rounded_lng, town, county, display_name")
      .in("rounded_lat", roundedLats)
      .in("rounded_lng", roundedLngs)
      .gt("expires_at", new Date().toISOString());

    if (error) throw error;

    for (const row of data || []) {
      const key = `${Number(row.rounded_lat)}:${Number(row.rounded_lng)}`;
      if (!uniquePoints.has(key)) continue;
      labels.set(key, locationLabelFromCache(row));
    }
  } catch (err) {
    console.warn("Location cache lookup skipped:", err);
  }

  return labels;
}

function getCachedLocationLabel(
  labels: Map<string, string | null>,
  latitude: any,
  longitude: any
) {
  const rounded = roundedCoordinateKey(latitude, longitude);
  if (!rounded) return null;
  return labels.get(rounded.key) || null;
}

async function resolveLiveLocationLabel(input: {
  companyId: string;
  latitude: any;
  longitude: any;
  providerLocationLabel?: string | null;
  cachedLabel?: string | null;
  geofences: any[];
}) {
  const providerLabel = normalizeProviderLocationLabel(input.providerLocationLabel);
  const cachedLabel = normalizeProviderLocationLabel(input.cachedLabel);
  const resolved = await resolveOperationalLocation({
    company_id: input.companyId,
    latitude: input.latitude,
    longitude: input.longitude,
    provider_location_label: providerLabel,
    supabase: supabaseAdmin,
    geofences: input.geofences,
  });

  if (providerLabel) {
    return {
      location_label: providerLabel,
      location_source: "provider_label",
      location_note: null,
      geofence_match: resolved?.geofence || null,
    };
  }

  if (!resolved) {
    return {
      location_label: cachedLabel || "Readable place name unavailable",
      location_source: cachedLabel ? "reverse_geocode_cache" : "unavailable",
      location_note:
        cachedLabel ? null : "Nava has no readable place label for this asset yet.",
      geofence_match: null,
    };
  }

  const coordinatesOnly = resolved.confidence_source === "coordinates_only";
  return {
    location_label: coordinatesOnly
      ? "Readable place name unavailable"
      : resolved.display_label,
    location_source: resolved.confidence_source,
    location_note: coordinatesOnly
      ? "Latest GPS is available, but Nava does not yet have a readable place name for this point."
      : resolved.note || null,
    geofence_match: resolved.geofence || null,
  };
}

async function fetchRecentTelemetryLogs(
  companyId: string,
  truckIds: string[],
  since: string
) {
  const withUnit = await supabaseAdmin
    .from("telemetry_logs")
    .select("truck_id, recorded_at, speed, fuel_level, fuel_unit")
    .eq("company_id", companyId)
    .in("truck_id", truckIds)
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: false });

  if (!withUnit.error) return withUnit.data || [];

  if (!isMissingFuelUnitColumn(withUnit.error)) {
    throw withUnit.error;
  }

  const fallback = await supabaseAdmin
    .from("telemetry_logs")
    .select("truck_id, recorded_at, speed, fuel_level")
    .eq("company_id", companyId)
    .in("truck_id", truckIds)
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: false });

  if (fallback.error) throw fallback.error;
  return fallback.data || [];
}

function isMissingFuelUnitColumn(error: any) {
  const message = String(error?.message || error?.details || "");
  return /fuel_unit|column .* does not exist/i.test(message);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveCompany(req, searchParams.get("companyId"));
    if (resolved.error) return resolved.error;
    if (!canViewOps(resolved.roles)) {
      return noStoreJson(
        { success: false, error: "Live tracking access required" },
        { status: 403 }
      );
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      liveTrucks,
      importedAssetsResult,
      enabledAssetsResult,
      providersResult,
      geofences,
    ] =
      await Promise.all([
        getCurrentFleetLocations(resolved.company.id, {
          maxAgeMinutes: FRESHNESS_MINUTES,
        }),
        supabaseAdmin
          .from("fleet_assets")
          .select("truck_id, registration, status")
          .eq("company_id", resolved.company.id)
          .eq("status", "active"),
        supabaseAdmin
          .from("fleet_assets")
          .select(
            "truck_id, registration, status, latitude, longitude, last_seen_at, provider_name, provider_location_label"
          )
          .eq("company_id", resolved.company.id)
          .eq("status", "active")
          .eq("intelligence_enabled", true)
          .order("last_seen_at", { ascending: false }),
        supabaseAdmin
          .from("tracking_providers")
          .select(
            "id, provider_name, is_active, last_sync_at, last_test_at, last_test_status"
          )
          .eq("company_id", resolved.company.id)
          .order("created_at", { ascending: false }),
        fetchActiveGeofences(supabaseAdmin, resolved.company.id),
      ]);

    if (importedAssetsResult.error) throw importedAssetsResult.error;
    if (enabledAssetsResult.error) throw enabledAssetsResult.error;
    if (providersResult.error) throw providersResult.error;

    const importedAssets = importedAssetsResult.data || [];
    const enabledAssets = enabledAssetsResult.data || [];
    const enabledTruckIds = enabledAssets
      .map((asset) => asset.truck_id)
      .filter(Boolean);
    let telemetryLogs: any[] = [];

    if (enabledTruckIds.length > 0) {
      telemetryLogs = await fetchRecentTelemetryLogs(
        resolved.company.id,
        enabledTruckIds,
        since
      );
    }

    const providers = providersResult.data || [];
    const telemetryByTruck = buildLatestTelemetryByTruck(telemetryLogs);
    const liveTruckIds = new Set(liveTrucks.map((truck) => truck.truck_id));
    const locationLabels = await fetchCachedLocationLabels([
      ...liveTrucks,
      ...enabledAssets,
    ]);

    const trucks = await Promise.all(liveTrucks.map(async (truck) => {
      const telemetry = telemetryByTruck[truck.truck_id] || null;
      const matchingAsset = enabledAssets.find(
        (asset) => asset.truck_id === truck.truck_id
      );
      const location = await resolveLiveLocationLabel({
        companyId: resolved.company.id,
        latitude: truck.latitude,
        longitude: truck.longitude,
        providerLocationLabel:
          matchingAsset?.provider_location_label || truck.provider_location_label || null,
        cachedLabel: getCachedLocationLabel(locationLabels, truck.latitude, truck.longitude),
        geofences,
      });

      return {
        truck_id: truck.truck_id,
        registration: truck.registration,
        latitude: truck.latitude,
        longitude: truck.longitude,
        last_seen_at: truck.last_seen_at,
        freshness_minutes: truck.freshness_minutes,
        status: truck.status,
        speed: telemetry?.speed ?? null,
        fuel_level: telemetry?.fuel_level ?? null,
        fuel_unit: telemetry?.fuel_unit || null,
        provider_name: matchingAsset?.provider_name || null,
        location_label: location.location_label,
        location_source: location.location_source,
        location_note: location.location_note,
        geofence_match: location.geofence_match || matchPointToGeofence(truck, geofences),
      };
    }));

    const staleAssets = await Promise.all(enabledAssets
      .filter((asset) => !liveTruckIds.has(asset.truck_id))
      .map(async (asset) => {
        const location = await resolveLiveLocationLabel({
          companyId: resolved.company.id,
          latitude: asset.latitude,
          longitude: asset.longitude,
          providerLocationLabel: asset.provider_location_label || null,
          cachedLabel: getCachedLocationLabel(locationLabels, asset.latitude, asset.longitude),
          geofences,
        });
        return {
          truck_id: asset.truck_id,
          registration: asset.registration || asset.truck_id,
          latitude: asset.latitude ?? null,
          longitude: asset.longitude ?? null,
          last_seen_at: asset.last_seen_at || null,
          status: asset.status || null,
          location_label: location.location_label,
          location_source: location.location_source,
          location_note: location.location_note,
          geofence_match: location.geofence_match || matchPointToGeofence(asset, geofences),
        };
      }));

    return noStoreJson({
      success: true,
      company: resolved.company,
      freshness_minutes: FRESHNESS_MINUTES,
      summary: {
        imported_assets: importedAssets.length,
        enabled_assets: enabledAssets.length,
        active_assets: enabledAssets.length,
        live_assets: trucks.length,
        stale_assets: staleAssets.length,
        telemetry_points_24h: telemetryLogs.length,
        provider_count: providers.length,
        active_provider_count: providers.filter((provider) => provider.is_active).length,
      },
      trucks,
      stale_assets: staleAssets,
      providers: providers.map(sanitizeProvider),
    });
  } catch (err: any) {
    console.error("Live tracking error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load live tracking" },
      { status: 500 }
    );
  }
}
