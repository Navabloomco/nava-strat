import { NextResponse } from "next/server";
import { getCurrentFleetLocations } from "../../../../lib/intelligence/fleetLocationService";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FRESHNESS_MINUTES = 30;

type ResolvedCompany = {
  id: string;
  name: string;
  slug: string;
};

type ResolveCompanyResult =
  | { company: ResolvedCompany; isPlatformOwner: boolean; error?: never }
  | { error: NextResponse; company?: never; isPlatformOwner?: never };

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
    (membership) => membership.role === "platform_owner"
  );

  if (isPlatformOwner) {
    const companyQuery = supabaseAdmin.from("companies").select("id, name, slug");
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

    return { company: company as ResolvedCompany, isPlatformOwner };
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

  return { company: company as ResolvedCompany, isPlatformOwner };
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

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveCompany(req, searchParams.get("companyId"));
    if (resolved.error) return resolved.error;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [liveTrucks, assetsResult, telemetryResult, providersResult] =
      await Promise.all([
        getCurrentFleetLocations(resolved.company.id, {
          maxAgeMinutes: FRESHNESS_MINUTES,
        }),
        supabaseAdmin
          .from("fleet_assets")
          .select(
            "truck_id, registration, status, latitude, longitude, last_seen_at, provider_name"
          )
          .eq("company_id", resolved.company.id)
          .eq("status", "active")
          .order("last_seen_at", { ascending: false }),
        supabaseAdmin
          .from("telemetry_logs")
          .select("truck_id, recorded_at, speed, fuel_level")
          .eq("company_id", resolved.company.id)
          .gte("recorded_at", since)
          .order("recorded_at", { ascending: false }),
        supabaseAdmin
          .from("tracking_providers")
          .select(
            "id, provider_name, is_active, last_sync_at, last_test_at, last_test_status"
          )
          .eq("company_id", resolved.company.id)
          .order("created_at", { ascending: false }),
      ]);

    if (assetsResult.error) throw assetsResult.error;
    if (telemetryResult.error) throw telemetryResult.error;
    if (providersResult.error) throw providersResult.error;

    const activeAssets = assetsResult.data || [];
    const telemetryLogs = telemetryResult.data || [];
    const providers = providersResult.data || [];
    const telemetryByTruck = buildLatestTelemetryByTruck(telemetryLogs);
    const liveTruckIds = new Set(liveTrucks.map((truck) => truck.truck_id));
    const locationLabels = await fetchCachedLocationLabels([
      ...liveTrucks,
      ...activeAssets,
    ]);

    const trucks = liveTrucks.map((truck) => {
      const telemetry = telemetryByTruck[truck.truck_id] || null;
      const matchingAsset = activeAssets.find(
        (asset) => asset.truck_id === truck.truck_id
      );

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
        provider_name: matchingAsset?.provider_name || null,
        location_label: getCachedLocationLabel(
          locationLabels,
          truck.latitude,
          truck.longitude
        ),
      };
    });

    const staleAssets = activeAssets
      .filter((asset) => !liveTruckIds.has(asset.truck_id))
      .map((asset) => ({
        truck_id: asset.truck_id,
        registration: asset.registration || asset.truck_id,
        latitude: asset.latitude ?? null,
        longitude: asset.longitude ?? null,
        last_seen_at: asset.last_seen_at || null,
        status: asset.status || null,
        location_label: getCachedLocationLabel(
          locationLabels,
          asset.latitude,
          asset.longitude
        ),
      }));

    return noStoreJson({
      success: true,
      company: resolved.company,
      freshness_minutes: FRESHNESS_MINUTES,
      summary: {
        active_assets: activeAssets.length,
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
