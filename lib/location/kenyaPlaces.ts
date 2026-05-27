export type KenyaLocationEvidence = "nearest-known-place" | "corridor-estimate";

export type KenyaOperationalLocation = {
  display_label: string;
  evidence_label: KenyaLocationEvidence;
  confidence: "medium" | "low";
  note: string;
  distance_meters?: number;
};

type KenyaPlace = {
  name: string;
  latitude: number;
  longitude: number;
};

const CLOSE_PLACE_METERS = 12000;
const NEAR_PLACE_METERS = 35000;
const FAR_PLACE_METERS = 80000;
const CORRIDOR_MAX_OFFSET_METERS = 22000;
const CORRIDOR_AREA_OFFSET_METERS = 40000;
const CORRIDOR_MIN_ENDPOINT_METERS = 12000;

const KENYA_PLACES: KenyaPlace[] = [
  { name: "Nairobi", latitude: -1.286389, longitude: 36.817223 },
  { name: "Mlolongo", latitude: -1.3972, longitude: 36.9397 },
  { name: "Athi River", latitude: -1.4563, longitude: 36.9783 },
  { name: "Kitengela", latitude: -1.473, longitude: 36.959 },
  { name: "Machakos", latitude: -1.5177, longitude: 37.2634 },
  { name: "Sultan Hamud", latitude: -2.0167, longitude: 37.3667 },
  { name: "Emali", latitude: -2.0833, longitude: 37.4667 },
  { name: "Kiboko", latitude: -2.217, longitude: 37.733 },
  { name: "Makindu", latitude: -2.2833, longitude: 37.8167 },
  { name: "Kibwezi", latitude: -2.4167, longitude: 37.9667 },
  { name: "Mtito Andei", latitude: -2.6899, longitude: 38.1667 },
  { name: "Voi", latitude: -3.396, longitude: 38.556 },
  { name: "Mariakani", latitude: -3.862, longitude: 39.475 },
  { name: "Mazeras", latitude: -3.9706, longitude: 39.545 },
  { name: "Mombasa", latitude: -4.0435, longitude: 39.6682 },
  { name: "Nakuru", latitude: -0.3031, longitude: 36.08 },
  { name: "Naivasha", latitude: -0.7167, longitude: 36.4333 },
  { name: "Longonot", latitude: -0.914, longitude: 36.452 },
  { name: "Gilgil", latitude: -0.5, longitude: 36.3167 },
  { name: "Eldoret", latitude: 0.5143, longitude: 35.2698 },
  { name: "Malaba", latitude: 0.635, longitude: 34.281 },
  { name: "Kisumu", latitude: -0.0917, longitude: 34.768 },
  { name: "Thika", latitude: -1.0332, longitude: 37.0693 },
  { name: "Ruiru", latitude: -1.145, longitude: 36.96 },
  { name: "Limuru", latitude: -1.107, longitude: 36.642 },
  { name: "Narok", latitude: -1.078, longitude: 35.871 },
];

const CORRIDORS: string[][] = [
  [
    "Nairobi",
    "Mlolongo",
    "Athi River",
    "Sultan Hamud",
    "Emali",
    "Kiboko",
    "Makindu",
    "Kibwezi",
    "Mtito Andei",
    "Voi",
    "Mariakani",
    "Mazeras",
    "Mombasa",
  ],
  ["Nairobi", "Limuru", "Naivasha", "Gilgil", "Nakuru", "Eldoret", "Malaba"],
  ["Nairobi", "Ruiru", "Thika"],
  ["Nairobi", "Naivasha", "Narok"],
  ["Nakuru", "Kisumu"],
];

const PLACES_BY_NAME = new Map(KENYA_PLACES.map((place) => [place.name, place]));

export function resolveKenyaOperationalLocation(input: {
  latitude: number;
  longitude: number;
}): KenyaOperationalLocation | null {
  const point = numericPoint(input.latitude, input.longitude);
  if (!point) return null;

  const nearest = findNearestPlace(point);
  const corridor = findNearestCorridor(point);

  if (nearest && nearest.distance_meters <= CLOSE_PLACE_METERS) {
    return formatNearestPlace(nearest.place, nearest.distance_meters, "close");
  }

  if (
    corridor &&
    corridor.offset_meters <= CORRIDOR_MAX_OFFSET_METERS &&
    nearest &&
    nearest.distance_meters > CORRIDOR_MIN_ENDPOINT_METERS
  ) {
    return {
      display_label: `between ${corridor.from.name} and ${corridor.to.name}`,
      evidence_label: "corridor-estimate",
      confidence: "medium",
      note:
        "Approximate operational location, not an exact address.",
    };
  }

  if (nearest && nearest.distance_meters <= NEAR_PLACE_METERS) {
    return formatNearestPlace(nearest.place, nearest.distance_meters, "near");
  }

  if (corridor && corridor.offset_meters <= CORRIDOR_AREA_OFFSET_METERS) {
    return {
      display_label: `around the ${corridor.from.name}-${corridor.to.name} corridor`,
      evidence_label: "corridor-estimate",
      confidence: "low",
      note: "Approximate operational location, not an exact address.",
    };
  }

  if (nearest && nearest.distance_meters <= FAR_PLACE_METERS) {
    return formatNearestPlace(nearest.place, nearest.distance_meters, "far");
  }

  return null;
}

function formatNearestPlace(
  place: KenyaPlace,
  distanceMeters: number,
  proximity: "close" | "near" | "far"
): KenyaOperationalLocation {
  if (proximity === "far") {
    return {
      display_label: `near ${place.name} area`,
      evidence_label: "nearest-known-place",
      confidence: "low",
      distance_meters: distanceMeters,
      note: "Approximate operational location, not an exact address.",
    };
  }

  if (proximity === "near") {
    return {
      display_label: `around ${place.name} area`,
      evidence_label: "nearest-known-place",
      confidence: "medium",
      distance_meters: distanceMeters,
      note: "Approximate operational location, not an exact address.",
    };
  }

  return {
    display_label: `near ${place.name}`,
    evidence_label: "nearest-known-place",
    confidence: "medium",
    distance_meters: distanceMeters,
    note: "Approximate operational location, not an exact address.",
  };
}

function findNearestPlace(point: { latitude: number; longitude: number }) {
  let best: { place: KenyaPlace; distance_meters: number } | null = null;
  for (const place of KENYA_PLACES) {
    const distance = distanceMeters(point, place);
    if (!best || distance < best.distance_meters) {
      best = { place, distance_meters: distance };
    }
  }
  return best;
}

function findNearestCorridor(point: { latitude: number; longitude: number }) {
  let best:
    | {
        from: KenyaPlace;
        to: KenyaPlace;
        offset_meters: number;
      }
    | null = null;

  for (const corridor of CORRIDORS) {
    for (let index = 0; index < corridor.length - 1; index += 1) {
      const from = PLACES_BY_NAME.get(corridor[index]);
      const to = PLACES_BY_NAME.get(corridor[index + 1]);
      if (!from || !to) continue;

      const segment = distanceToSegmentMeters(point, from, to);
      if (!segment || segment.t <= 0.08 || segment.t >= 0.92) continue;
      if (!best || segment.offset_meters < best.offset_meters) {
        best = { from, to, offset_meters: segment.offset_meters };
      }
    }
  }

  return best;
}

function distanceToSegmentMeters(
  point: { latitude: number; longitude: number },
  from: KenyaPlace,
  to: KenyaPlace
) {
  const origin = point;
  const p = projectMeters(point, origin);
  const a = projectMeters(from, origin);
  const b = projectMeters(to, origin);
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const lengthSquared = abX * abX + abY * abY;
  if (lengthSquared <= 0) return null;

  const t = ((p.x - a.x) * abX + (p.y - a.y) * abY) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, t));
  const closest = {
    x: a.x + clamped * abX,
    y: a.y + clamped * abY,
  };
  const offset = Math.sqrt(
    Math.pow(p.x - closest.x, 2) + Math.pow(p.y - closest.y, 2)
  );

  return { offset_meters: offset, t: clamped };
}

function projectMeters(
  point: { latitude: number; longitude: number },
  origin: { latitude: number; longitude: number }
) {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = metersPerDegreeLat * Math.cos(toRadians(origin.latitude));
  return {
    x: (point.longitude - origin.longitude) * metersPerDegreeLng,
    y: (point.latitude - origin.latitude) * metersPerDegreeLat,
  };
}

function numericPoint(latitude: any, longitude: any) {
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

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}
