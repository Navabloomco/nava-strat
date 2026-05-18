type GeofenceRecord = {
  id: string;
  name: string | null;
  type: string | null;
  latitude: any;
  longitude: any;
  radius_meters: any;
  is_active?: boolean | null;
};

type Point = {
  latitude: any;
  longitude: any;
};

type SanitizedGeofence = {
  id: string;
  name: string;
  type: string | null;
  latitude: number;
  longitude: number;
  radius_meters: number;
};

export type GeofenceMatch = {
  id: string;
  name: string;
  type: string | null;
  radius_meters: number;
  distance_meters: number;
};

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

function distanceMeters(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const earthRadiusMeters = 6371000;
  const fromLat = (from.latitude * Math.PI) / 180;
  const toLat = (to.latitude * Math.PI) / 180;
  const deltaLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const deltaLng = ((to.longitude - from.longitude) * Math.PI) / 180;
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(fromLat) *
      Math.cos(toLat) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

function sanitizeGeofence(row: GeofenceRecord): SanitizedGeofence | null {
  const coordinates = numericCoordinate(row.latitude, row.longitude);
  const radius = numericRadius(row.radius_meters);

  if (!coordinates || radius === null || !row.id || !row.name) return null;

  return {
    id: row.id,
    name: String(row.name),
    type: row.type ? String(row.type) : null,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    radius_meters: radius,
  };
}

export async function fetchActiveGeofences(supabase: any, companyId: string) {
  const { data, error } = await supabase
    .from("geofences")
    .select("id, name, type, latitude, longitude, radius_meters, is_active")
    .eq("company_id", companyId)
    .eq("is_active", true);

  if (error) throw error;

  return (data || [])
    .map(sanitizeGeofence)
    .filter(Boolean) as SanitizedGeofence[];
}

export function matchPointToGeofence(
  point: Point,
  geofences: SanitizedGeofence[]
): GeofenceMatch | null {
  const coordinates = numericCoordinate(point.latitude, point.longitude);
  if (!coordinates || geofences.length === 0) return null;

  let nearest: GeofenceMatch | null = null;

  for (const geofence of geofences) {
    if (!geofence) continue;
    const distance = distanceMeters(coordinates, {
      latitude: geofence.latitude,
      longitude: geofence.longitude,
    });

    if (distance > geofence.radius_meters) continue;

    const match = {
      id: geofence.id,
      name: geofence.name,
      type: geofence.type,
      radius_meters: Math.round(geofence.radius_meters),
      distance_meters: Math.round(distance),
    };

    if (!nearest || match.distance_meters < nearest.distance_meters) {
      nearest = match;
    }
  }

  return nearest;
}
