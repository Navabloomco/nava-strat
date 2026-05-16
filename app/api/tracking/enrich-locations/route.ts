import { NextResponse } from "next/server";
import { reverseGeocode } from "../../../../lib/location/reverseGeocode";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_MAX_ITEMS = 10;
const HARD_MAX_ITEMS = 25;
const ATTEMPT_COOLDOWN_HOURS = 24;

type ResolvedCompany = {
  id: string;
  name: string;
  slug: string;
};

type ResolveCompanyResult =
  | { company: ResolvedCompany; roles: string[]; error?: never }
  | { error: NextResponse; company?: never; roles?: never };

function noStoreJson(body: any, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Cache-Control": "no-store",
    },
  });
}

function roundedCoordinateKey(latitude: any, longitude: any) {
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const roundedLat = Number(lat.toFixed(5));
  const roundedLng = Number(lng.toFixed(5));

  return {
    key: `${roundedLat}:${roundedLng}`,
    latitude: lat,
    longitude: lng,
    roundedLat,
    roundedLng,
  };
}

function hasUsableCache(row: any, nowIso: string) {
  if (!row) return false;
  const hasLabel = Boolean(row.town || row.county || row.display_name);
  return hasLabel && row.expires_at && row.expires_at > nowIso;
}

function attemptedRecently(row: any, cutoffMs: number) {
  if (!row?.attempted_at) return false;
  const attemptedAt = new Date(row.attempted_at).getTime();
  return Number.isFinite(attemptedAt) && attemptedAt > cutoffMs;
}

function canEnrich(roles: string[]) {
  const normalized = new Set(roles.map((role) => role.toLowerCase()));
  return (
    normalized.has("platform_owner") ||
    normalized.has("owner") ||
    normalized.has("admin")
  );
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
  const roles = Array.from(
    new Set(
      activeMemberships
        .map((membership) => String(membership.role || "").toLowerCase())
        .filter(Boolean)
    )
  );
  const isPlatformOwner = roles.includes("platform_owner");

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

    return { company: company as ResolvedCompany, roles };
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

  return { company: company as ResolvedCompany, roles };
}

async function fetchExistingCache(
  coordinates: Map<string, ReturnType<typeof roundedCoordinateKey>>
) {
  const usableCoordinates = Array.from(coordinates.values()).filter(Boolean) as Array<{
    roundedLat: number;
    roundedLng: number;
  }>;

  if (usableCoordinates.length === 0) return new Map<string, any>();

  const roundedLats = Array.from(
    new Set(usableCoordinates.map((coordinate) => coordinate.roundedLat))
  );
  const roundedLngs = Array.from(
    new Set(usableCoordinates.map((coordinate) => coordinate.roundedLng))
  );
  const cacheRows = new Map<string, any>();

  const { data, error } = await supabaseAdmin
    .from("location_cache")
    .select(
      "rounded_lat, rounded_lng, town, county, display_name, expires_at, attempted_at, attempt_count"
    )
    .in("rounded_lat", roundedLats)
    .in("rounded_lng", roundedLngs);

  if (error) throw error;

  for (const row of data || []) {
    const key = `${Number(row.rounded_lat)}:${Number(row.rounded_lng)}`;
    if (coordinates.has(key)) {
      cacheRows.set(key, row);
    }
  }

  return cacheRows;
}

async function recordFailedAttempt(
  coordinate: NonNullable<ReturnType<typeof roundedCoordinateKey>>,
  existingCache: any,
  errorMessage: string
) {
  const attemptCount = Number(existingCache?.attempt_count || 0) + 1;

  const { error } = await supabaseAdmin
    .from("location_cache")
    .upsert(
      {
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        rounded_lat: coordinate.roundedLat,
        rounded_lng: coordinate.roundedLng,
        attempted_at: new Date().toISOString(),
        last_error: errorMessage,
        attempt_count: attemptCount,
        expires_at: new Date().toISOString(),
      },
      { onConflict: "rounded_lat,rounded_lng" }
    );

  if (error) throw error;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const resolved = await resolveCompany(req, body.companyId || null);
    if (resolved.error) return resolved.error;

    if (!canEnrich(resolved.roles)) {
      return noStoreJson(
        { success: false, error: "Location enrichment access required" },
        { status: 403 }
      );
    }

    const maxItems = Math.min(
      HARD_MAX_ITEMS,
      Math.max(1, Number(body.maxItems || DEFAULT_MAX_ITEMS))
    );

    const { data: assets, error: assetsError } = await supabaseAdmin
      .from("fleet_assets")
      .select("truck_id, latitude, longitude")
      .eq("company_id", resolved.company.id)
      .eq("status", "active")
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .order("last_seen_at", { ascending: false });

    if (assetsError) throw assetsError;

    const coordinates = new Map<string, NonNullable<ReturnType<typeof roundedCoordinateKey>>>();

    for (const asset of assets || []) {
      const coordinate = roundedCoordinateKey(asset.latitude, asset.longitude);
      if (!coordinate) continue;
      coordinates.set(coordinate.key, coordinate);
    }

    const existingCache = await fetchExistingCache(coordinates);
    const nowIso = new Date().toISOString();
    const recentAttemptCutoff =
      Date.now() - ATTEMPT_COOLDOWN_HOURS * 60 * 60 * 1000;
    let alreadyCached = 0;
    let skippedRecentAttempt = 0;
    let enriched = 0;
    let failed = 0;
    const candidates: Array<NonNullable<ReturnType<typeof roundedCoordinateKey>>> = [];

    for (const [key, coordinate] of Array.from(coordinates.entries())) {
      const cacheRow = existingCache.get(key);

      if (hasUsableCache(cacheRow, nowIso)) {
        alreadyCached += 1;
        continue;
      }

      if (attemptedRecently(cacheRow, recentAttemptCutoff)) {
        skippedRecentAttempt += 1;
        continue;
      }

      candidates.push(coordinate);
    }

    for (const coordinate of candidates.slice(0, maxItems)) {
      const cacheRow = existingCache.get(coordinate.key);
      const result = await reverseGeocode(coordinate.latitude, coordinate.longitude);

      if (result) {
        enriched += 1;
        continue;
      }

      failed += 1;
      try {
        await recordFailedAttempt(
          coordinate,
          cacheRow,
          "Reverse geocode returned no location"
        );
      } catch (err) {
        console.warn("Failed to record location enrichment attempt:", err);
      }
    }

    return noStoreJson({
      success: true,
      checked: coordinates.size,
      already_cached: alreadyCached,
      enriched,
      failed,
      skipped_recent_attempt: skippedRecentAttempt,
      remaining_uncached: Math.max(
        0,
        coordinates.size - alreadyCached - enriched
      ),
    });
  } catch (err: any) {
    console.error("Location enrichment error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to enrich locations" },
      { status: 500 }
    );
  }
}
