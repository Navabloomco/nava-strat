import { supabaseAdmin } from "../supabaseAdmin";

export type OperationalLocationSource =
  | "geofence"
  | "reverse_geocode_cache"
  | "provider_label"
  | "coordinates_only";

type ResolverClient = {
  from: (table: string) => any;
};

type GeofenceLike = {
  id?: string | null;
  name?: string | null;
  type?: string | null;
  latitude?: any;
  longitude?: any;
  radius_meters?: any;
};

type ResolveOperationalLocationInput = {
  company_id: string;
  latitude: any;
  longitude: any;
  provider_location_label?: string | null;
  truck_id?: string | null;
  supabase?: ResolverClient;
  geofences?: GeofenceLike[];
};

export type ResolvedOperationalLocation = {
  display_label: string;
  confidence_source: OperationalLocationSource;
  map_url: string;
  note?: string;
  geofence?: {
    id: string;
    name: string;
    type: string | null;
    relation: "inside" | "near";
    distance_meters: number;
  } | null;
};

const NEAR_GEOFENCE_BUFFER_METERS = 200;

export async function resolveOperationalLocation(
  input: ResolveOperationalLocationInput
): Promise<ResolvedOperationalLocation | null> {
  const coordinates = numericCoordinate(input.latitude, input.longitude);
  const providerLabel = normalizeProviderLocationLabel(input.provider_location_label);

  if (!coordinates) {
    if (providerLabel) {
      return {
        display_label: providerLabel,
        confidence_source: "provider_label",
        map_url: "",
        note: "Provider supplied a readable location label, but Nava did not receive a valid GPS point for map context.",
      };
    }

    return null;
  }

  const mapUrl = buildMapUrl(coordinates.latitude, coordinates.longitude);
  const geofences =
    input.geofences ||
    (await fetchCompanyGeofences(input.supabase || supabaseAdmin, input.company_id));
  const geofenceMatch = findGeofenceMatch(coordinates, geofences);

  if (geofenceMatch) {
    return {
      display_label:
        geofenceMatch.relation === "inside"
          ? `inside ${geofenceMatch.name}`
          : `near ${geofenceMatch.name}`,
      confidence_source: "geofence",
      map_url: mapUrl,
      geofence: geofenceMatch,
    };
  }

  const cachedLabel = await fetchCachedLocationLabel(
    input.supabase || supabaseAdmin,
    coordinates.latitude,
    coordinates.longitude
  );

  if (cachedLabel) {
    return {
      display_label: cachedLabel,
      confidence_source: "reverse_geocode_cache",
      map_url: mapUrl,
    };
  }

  if (providerLabel) {
    return {
      display_label: providerLabel,
      confidence_source: "provider_label",
      map_url: mapUrl,
    };
  }

  return {
    display_label: "Nava only has a GPS point for this truck right now.",
    confidence_source: "coordinates_only",
    map_url: mapUrl,
    note: "No company geofence, cached place label, or provider label was available for this point.",
  };
}

export function normalizeProviderLocationLabel(value: any) {
  const label = String(value || "").trim().replace(/\s+/g, " ");
  if (!label) return null;
  if (/^[-–—]+$/.test(label) || /^(n\/a|na|null|none|unknown)$/i.test(label)) {
    return null;
  }

  const distanceMatch = label.match(
    /^([0-9]+(?:\.[0-9]+)?)\s*(km|kilometres|kilometers|kms?)\s+([a-z -]+?)\s+of\s+(.+)$/i
  );
  if (distanceMatch) {
    const [, distance, , directionRaw, placeRaw] = distanceMatch;
    const direction = directionRaw.trim().toLowerCase();
    const place = toTitleCase(placeRaw.trim());
    return `near ${place}, about ${Number(distance).toLocaleString()} km ${direction} of town`;
  }

  if (/^(at|near|inside)\b/i.test(label)) {
    return label;
  }

  return `near ${label}`;
}

async function fetchCompanyGeofences(client: ResolverClient, companyId: string) {
  if (!companyId) return [];

  const { data, error } = await client
    .from("geofences")
    .select("id, name, type, latitude, longitude, radius_meters, is_active")
    .eq("company_id", companyId)
    .eq("is_active", true);

  if (error) {
    console.warn("Operational location geofence lookup skipped:", error.message || error);
    return [];
  }

  return data || [];
}

async function fetchCachedLocationLabel(client: ResolverClient, latitude: number, longitude: number) {
  const roundedLat = Number(latitude.toFixed(5));
  const roundedLng = Number(longitude.toFixed(5));

  try {
    const { data, error } = await client
      .from("location_cache")
      .select("town, county, country, display_name, expires_at")
      .eq("rounded_lat", roundedLat)
      .eq("rounded_lng", roundedLng)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (error) throw error;
    return cleanCachedLocationLabel(data);
  } catch (err: any) {
    console.warn("Operational location cache lookup skipped:", err.message || err);
    return null;
  }
}

function cleanCachedLocationLabel(row: any) {
  if (!row) return null;
  const town = cleanPlacePart(row.town);
  const county = cleanPlacePart(row.county);

  if (town && county && town.toLowerCase() !== county.toLowerCase()) {
    return `near ${town}, ${county}`;
  }
  if (town) return `near ${town}`;
  if (county) return `near ${county}`;

  const display = String(row.display_name || "")
    .split(",")
    .map(cleanPlacePart)
    .filter(Boolean)
    .slice(0, 2)
    .join(", ");

  return display ? `near ${display}` : null;
}

function findGeofenceMatch(point: { latitude: number; longitude: number }, geofences: GeofenceLike[]) {
  let best: ResolvedOperationalLocation["geofence"] = null;

  for (const geofence of geofences || []) {
    const geofencePoint = numericCoordinate(geofence.latitude, geofence.longitude);
    const radius = numericRadius(geofence.radius_meters);
    const name = String(geofence.name || "").trim();
    const id = String(geofence.id || "").trim();
    if (!geofencePoint || radius === null || !name || !id) continue;

    const distance = Math.round(distanceMeters(point, geofencePoint));
    const relation: "inside" | "near" | null =
      distance <= radius
        ? "inside"
        : distance <= radius + NEAR_GEOFENCE_BUFFER_METERS
          ? "near"
          : null;
    if (!relation) continue;

    const match = {
      id,
      name,
      type: geofence.type ? String(geofence.type) : null,
      relation,
      distance_meters: distance,
    };

    if (!best || match.distance_meters < best.distance_meters) {
      best = match;
    }
  }

  return best;
}

function numericCoordinate(latitude: any, longitude: any) {
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  return { latitude: lat, longitude: lng };
}

function numericRadius(value: any) {
  const radius = Number(value);
  if (!Number.isFinite(radius) || radius <= 0) return null;
  return radius;
}

function distanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
) {
  const earthRadiusMeters = 6371000;
  const fromLat = toRadians(from.latitude);
  const toLat = toRadians(to.latitude);
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLng = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(fromLat) *
      Math.cos(toLat) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildMapUrl(latitude: number, longitude: number) {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

function cleanPlacePart(value: any) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text || text.toLowerCase() === "unknown location") return null;
  return toTitleCase(text);
}

function toTitleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}
