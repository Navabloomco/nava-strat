import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UNAVAILABLE_MESSAGE = "This tracking link is unavailable or has expired.";
const HIDDEN_STATUSES = new Set(["cancelled", "archived", "draft"]);

function noStoreJson(body: any, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Cache-Control": "no-store",
    },
  });
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeText(value: any) {
  return String(value || "").trim().toUpperCase();
}

function normalizeKey(value: any) {
  return normalizeText(value).replace(/\s+/g, "");
}

function isLinkUsable(link: any) {
  if (!link || link.revoked_at) return false;
  if (link.active_until_revoked) return true;
  if (!link.expires_at) return false;
  return new Date(link.expires_at).getTime() >= Date.now();
}

function roundedCoordinateKey(latitude: any, longitude: any) {
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // Match the live tracking cache precision without triggering external geocoding.
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
    console.warn("Client tracking location cache lookup skipped:", err);
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

function toNumberOrNull(value: any) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function buildAssetMap(assets: any[]) {
  const map = new Map<string, any>();

  for (const asset of assets || []) {
    for (const key of [asset.truck_id, asset.registration]) {
      const normalized = normalizeKey(key);
      if (normalized && !map.has(normalized)) {
        map.set(normalized, asset);
      }
    }
  }

  return map;
}

async function recordAccess(linkId: string) {
  try {
    const { error } = await supabaseAdmin.rpc(
      "record_client_visibility_link_access",
      { link_id: linkId }
    );

    if (error) throw error;
  } catch (err) {
    console.warn("Client visibility access tracking skipped:", err);
  }
}

export async function GET(
  _req: Request,
  { params }: { params: { token: string } }
) {
  try {
    const token = params.token ? decodeURIComponent(params.token) : "";
    if (!token) {
      return noStoreJson(
        { success: false, error: UNAVAILABLE_MESSAGE },
        { status: 404 }
      );
    }

    const { data: link, error: linkError } = await supabaseAdmin
      .from("client_visibility_links")
      .select(
        "id, company_id, client_name, display_name, expires_at, active_until_revoked, revoked_at"
      )
      .eq("token_hash", hashToken(token))
      .maybeSingle();

    if (linkError) throw linkError;

    if (!link || !isLinkUsable(link)) {
      return noStoreJson(
        { success: false, error: UNAVAILABLE_MESSAGE },
        { status: 404 }
      );
    }

    await recordAccess(link.id);

    const normalizedClientName = normalizeText(link.client_name);

    const [companyResult, journeysResult, assetsResult] = await Promise.all([
      supabaseAdmin
        .from("companies")
        .select("name, slug")
        .eq("id", link.company_id)
        .maybeSingle(),
      supabaseAdmin
        .from("journeys")
        .select(
          "id, internal_trip_id, status, from_location, to_location, truck, loaded_quantity, offloaded_quantity, billing_quantity, billing_unit, updated_at"
        )
        .eq("company_id", link.company_id)
        .eq("is_demo", false)
        .eq("client_name", normalizedClientName)
        .order("updated_at", { ascending: false }),
      supabaseAdmin
        .from("fleet_assets")
        .select("truck_id, registration, latitude, longitude, last_seen_at, provider_location_label")
        .eq("company_id", link.company_id)
        .eq("status", "active"),
    ]);

    if (companyResult.error) throw companyResult.error;
    if (journeysResult.error) throw journeysResult.error;
    if (assetsResult.error) throw assetsResult.error;

    const company = companyResult.data;
    if (!company) {
      return noStoreJson(
        { success: false, error: UNAVAILABLE_MESSAGE },
        { status: 404 }
      );
    }

    const journeys = (journeysResult.data || []).filter((journey) => {
      const status = String(journey.status || "").trim().toLowerCase();
      return normalizeText((journey as any).client_name || normalizedClientName) ===
        normalizedClientName && !HIDDEN_STATUSES.has(status);
    });
    const assets = assetsResult.data || [];
    const assetByTruck = buildAssetMap(assets);
    const matchedAssets = journeys
      .map((journey) => assetByTruck.get(normalizeKey(journey.truck)))
      .filter(Boolean);
    const locationLabels = await fetchCachedLocationLabels(matchedAssets);

    const visibleJourneys = journeys.map((journey) => {
      const asset = assetByTruck.get(normalizeKey(journey.truck));
      const providerLabel = asset?.provider_location_label
        ? String(asset.provider_location_label).trim()
        : "";
      const cachedLabel = asset
        ? getCachedLocationLabel(locationLabels, asset.latitude, asset.longitude)
        : null;
      const locationLabel = providerLabel || cachedLabel || null;
      const loaded = toNumberOrNull(journey.loaded_quantity);
      const offloaded = toNumberOrNull(journey.offloaded_quantity);
      const latitude = toNumberOrNull(asset?.latitude);
      const longitude = toNumberOrNull(asset?.longitude);
      const remaining =
        loaded === null || offloaded === null ? null : Math.max(loaded - offloaded, 0);

      return {
        id: journey.id,
        reference: journey.internal_trip_id || journey.id,
        status: journey.status || null,
        route: {
          from: journey.from_location || null,
          to: journey.to_location || null,
        },
        truck: {
          registration: asset?.registration || journey.truck || null,
        },
        quantity: {
          loaded,
          offloaded,
          remaining,
          billing_quantity: toNumberOrNull(journey.billing_quantity),
          billing_unit: journey.billing_unit || null,
        },
        location: {
          label: locationLabel,
          coordinates:
            !locationLabel && latitude !== null && longitude !== null
              ? {
                  latitude,
                  longitude,
                }
              : null,
          last_seen_at: asset?.last_seen_at || null,
        },
        updated_at: journey.updated_at || null,
      };
    });

    return noStoreJson({
      success: true,
      company: {
        name: company.name,
        slug: company.slug,
      },
      client: {
        name: link.display_name || link.client_name,
      },
      link: {
        expires_at: link.expires_at || null,
        active_until_revoked: Boolean(link.active_until_revoked),
      },
      generated_at: new Date().toISOString(),
      journeys: visibleJourneys,
    });
  } catch (err: any) {
    console.error("Client tracking portal error:", err);
    return noStoreJson(
      { success: false, error: UNAVAILABLE_MESSAGE },
      { status: 500 }
    );
  }
}
