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
  display_name?: string;
  latitude: number;
  longitude: number;
  kind?: "town" | "urban_area" | "landmark" | "industrial_area" | "transport_hub";
  label?: "near" | "around";
  specificity?: number;
};

const CLOSE_PLACE_METERS = 12000;
const NEAR_PLACE_METERS = 35000;
const FAR_PLACE_METERS = 80000;
const CORRIDOR_MAX_OFFSET_METERS = 22000;
const CORRIDOR_AREA_OFFSET_METERS = 40000;
const CORRIDOR_MIN_ENDPOINT_METERS = 12000;

const KENYA_PLACES: KenyaPlace[] = [
  { name: "Nairobi", latitude: -1.286389, longitude: 36.817223 },
  {
    name: "CBD Nairobi",
    latitude: -1.286389,
    longitude: 36.817223,
    kind: "urban_area",
    label: "around",
    specificity: 2,
  },
  {
    name: "Westlands",
    latitude: -1.2674,
    longitude: 36.8105,
    kind: "urban_area",
    label: "around",
    specificity: 2,
  },
  {
    name: "Karen",
    latitude: -1.3197,
    longitude: 36.7066,
    kind: "urban_area",
    label: "around",
    specificity: 2,
  },
  {
    name: "The Hub Karen",
    latitude: -1.3196,
    longitude: 36.7077,
    kind: "landmark",
    label: "near",
    specificity: 4,
  },
  {
    name: "Industrial Area",
    display_name: "Industrial Area, Nairobi",
    latitude: -1.3032,
    longitude: 36.8461,
    kind: "industrial_area",
    label: "around",
    specificity: 3,
  },
  {
    name: "JKIA / Embakasi",
    latitude: -1.3192,
    longitude: 36.9278,
    kind: "transport_hub",
    label: "around",
    specificity: 3,
  },
  {
    name: "Embakasi",
    latitude: -1.3175,
    longitude: 36.9003,
    kind: "urban_area",
    label: "around",
    specificity: 2,
  },
  {
    name: "Syokimau",
    latitude: -1.3591,
    longitude: 36.9326,
    kind: "urban_area",
    label: "around",
    specificity: 2,
  },
  {
    name: "SGR Nairobi Terminus",
    latitude: -1.3647,
    longitude: 36.9392,
    kind: "transport_hub",
    label: "near",
    specificity: 4,
  },
  { name: "Mlolongo", latitude: -1.3972, longitude: 36.9397 },
  { name: "Athi River", latitude: -1.4563, longitude: 36.9783 },
  { name: "Kitengela", latitude: -1.473, longitude: 36.959 },
  { name: "Machakos", latitude: -1.5177, longitude: 37.2634 },
  { name: "Machakos Junction", latitude: -1.516, longitude: 37.136, specificity: 2 },
  { name: "Salama", latitude: -1.833, longitude: 37.267 },
  { name: "Sultan Hamud", latitude: -2.0167, longitude: 37.3667 },
  { name: "Emali", latitude: -2.0833, longitude: 37.4667 },
  { name: "Kiboko", latitude: -2.217, longitude: 37.733 },
  { name: "Makindu", latitude: -2.2833, longitude: 37.8167 },
  { name: "Kibwezi", latitude: -2.4167, longitude: 37.9667 },
  { name: "Mtito Andei", latitude: -2.6899, longitude: 38.1667 },
  { name: "Voi", latitude: -3.396, longitude: 38.556 },
  { name: "Maungu", latitude: -3.554, longitude: 38.756 },
  { name: "Taru", latitude: -3.721, longitude: 39.088 },
  { name: "Samburu", latitude: -3.801, longitude: 39.27 },
  { name: "Mariakani", latitude: -3.862, longitude: 39.475 },
  { name: "Mazeras", latitude: -3.9706, longitude: 39.545 },
  { name: "Mombasa", latitude: -4.0435, longitude: 39.6682 },
  {
    name: "Mombasa Port",
    latitude: -4.058,
    longitude: 39.642,
    kind: "transport_hub",
    label: "near",
    specificity: 4,
  },
  { name: "Nakuru", latitude: -0.3031, longitude: 36.08 },
  { name: "Naivasha", latitude: -0.7167, longitude: 36.4333 },
  { name: "Longonot", latitude: -0.914, longitude: 36.452 },
  { name: "Gilgil", latitude: -0.5, longitude: 36.3167 },
  { name: "Salgaa", latitude: -0.24, longitude: 35.856 },
  { name: "Molo", latitude: -0.247, longitude: 35.731 },
  { name: "Mau Summit", latitude: -0.155, longitude: 35.69 },
  { name: "Timboroa", latitude: 0.071, longitude: 35.535 },
  { name: "Burnt Forest", latitude: 0.248, longitude: 35.433 },
  { name: "Eldoret", latitude: 0.5143, longitude: 35.2698 },
  { name: "Webuye", latitude: 0.607, longitude: 34.769 },
  { name: "Bungoma", latitude: 0.563, longitude: 34.561 },
  { name: "Kanduyi", latitude: 0.57, longitude: 34.57 },
  { name: "Malaba, Kenya border", latitude: 0.635, longitude: 34.281, label: "near" },
  { name: "Kisumu", latitude: -0.0917, longitude: 34.768 },
  { name: "Thika", latitude: -1.0332, longitude: 37.0693 },
  { name: "Ruiru", latitude: -1.145, longitude: 36.96 },
  { name: "Limuru", latitude: -1.107, longitude: 36.642 },
  { name: "Kiambu", latitude: -1.1714, longitude: 36.8356 },
  { name: "Narok", latitude: -1.078, longitude: 35.871 },
];

const CORRIDORS: string[][] = [
  [
    "Nairobi",
    "Mlolongo",
    "Athi River",
    "Machakos Junction",
    "Salama",
    "Sultan Hamud",
    "Emali",
    "Kiboko",
    "Makindu",
    "Kibwezi",
    "Mtito Andei",
    "Voi",
    "Maungu",
    "Taru",
    "Samburu",
    "Mariakani",
    "Mazeras",
    "Mombasa",
  ],
  [
    "Nairobi",
    "Limuru",
    "Naivasha",
    "Gilgil",
    "Nakuru",
    "Salgaa",
    "Molo",
    "Mau Summit",
    "Timboroa",
    "Burnt Forest",
    "Eldoret",
    "Webuye",
    "Bungoma",
    "Kanduyi",
    "Malaba, Kenya border",
  ],
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
    return formatNearestPlace(nearest.place, nearest.distance_meters, "close", point);
  }

  if (
    corridor &&
    corridor.offset_meters <= CORRIDOR_MAX_OFFSET_METERS &&
    nearest &&
    nearest.distance_meters <= NEAR_PLACE_METERS &&
    nearest.distance_meters > CLOSE_PLACE_METERS
  ) {
    return {
      display_label: `between ${displayPlaceName(corridor.from)} and ${displayPlaceName(
        corridor.to
      )}, near ${displayPlaceName(nearest.place)}`,
      evidence_label: "corridor-estimate",
      confidence: "medium",
      distance_meters: nearest.distance_meters,
      note: "Approximate operational location, not an exact address.",
    };
  }

  if (nearest && nearest.distance_meters <= NEAR_PLACE_METERS) {
    return formatNearestPlace(nearest.place, nearest.distance_meters, "near", point);
  }

  if (
    corridor &&
    corridor.offset_meters <= CORRIDOR_MAX_OFFSET_METERS &&
    nearest &&
    nearest.distance_meters > CORRIDOR_MIN_ENDPOINT_METERS
  ) {
    const nearestContext =
      nearest.distance_meters <= FAR_PLACE_METERS
        ? `, near ${displayPlaceName(nearest.place)}`
        : "";
    return {
      display_label: `between ${displayPlaceName(corridor.from)} and ${displayPlaceName(
        corridor.to
      )}${nearestContext}`,
      evidence_label: "corridor-estimate",
      confidence: "medium",
      distance_meters: nearest.distance_meters,
      note:
        "Approximate operational location, not an exact address.",
    };
  }

  if (corridor && corridor.offset_meters <= CORRIDOR_AREA_OFFSET_METERS) {
    return {
      display_label: `around the ${displayPlaceName(corridor.from)}-${displayPlaceName(
        corridor.to
      )} corridor`,
      evidence_label: "corridor-estimate",
      confidence: "low",
      note: "Approximate operational location, not an exact address.",
    };
  }

  if (nearest && nearest.distance_meters <= FAR_PLACE_METERS) {
    return formatNearestPlace(nearest.place, nearest.distance_meters, "far", point);
  }

  return null;
}

function formatNearestPlace(
  place: KenyaPlace,
  distanceMeters: number,
  proximity: "close" | "near" | "far",
  point: { latitude: number; longitude: number }
): KenyaOperationalLocation {
  const placeName = displayPlaceName(place);

  if (proximity === "far") {
    return {
      display_label: `near ${placeName} area`,
      evidence_label: "nearest-known-place",
      confidence: "low",
      distance_meters: distanceMeters,
      note: "Approximate operational location, not an exact address.",
    };
  }

  if (proximity === "near") {
    const prefix = prefixForPlace(place, "around");
    const relation = relationSuffix(place, distanceMeters, point);
    return {
      display_label:
        prefix === "around"
          ? `around ${placeName}${relation ? `, ${relation}` : ""}`
          : `near ${placeName}${relation ? `, ${relation}` : ""}`,
      evidence_label: "nearest-known-place",
      confidence: "medium",
      distance_meters: distanceMeters,
      note: "Approximate operational location, not an exact address.",
    };
  }

  const relation = relationSuffix(place, distanceMeters, point);
  return {
    display_label: `${prefixForPlace(place, "near")} ${placeName}${
      relation ? `, ${relation}` : ""
    }`,
    evidence_label: "nearest-known-place",
    confidence: "medium",
    distance_meters: distanceMeters,
    note: "Approximate operational location, not an exact address.",
  };
}

function displayPlaceName(place: KenyaPlace) {
  return place.display_name || place.name;
}

function findNearestPlace(point: { latitude: number; longitude: number }) {
  let best: { place: KenyaPlace; distance_meters: number; score: number } | null =
    null;
  for (const place of KENYA_PLACES) {
    const distance = distanceMeters(point, place);
    const score = distance - Number(place.specificity || 0) * 1500;
    if (!best || score < best.score) {
      best = { place, distance_meters: distance, score };
    }
  }
  return best;
}

function prefixForPlace(place: KenyaPlace, fallback: "near" | "around") {
  if (place.label) return place.label;
  if (
    place.kind === "urban_area" ||
    place.kind === "industrial_area" ||
    place.kind === "transport_hub"
  ) {
    return "around";
  }
  return fallback;
}

function relationSuffix(
  place: KenyaPlace,
  distanceMetersValue: number,
  point: { latitude: number; longitude: number }
) {
  if (!shouldShowRelation(place, distanceMetersValue)) return null;
  const direction = directionFromPlaceToPoint(place, point);
  return `about ${formatDistanceKm(distanceMetersValue)} ${direction} of town`;
}

function shouldShowRelation(place: KenyaPlace, distanceMetersValue: number) {
  if (distanceMetersValue < 500) return false;
  if (/border/i.test(place.name)) return false;
  if (
    place.kind &&
    place.kind !== "town" &&
    place.kind !== undefined
  ) {
    return false;
  }
  return true;
}

function directionFromPlaceToPoint(
  place: KenyaPlace,
  point: { latitude: number; longitude: number }
) {
  const deltaLat = point.latitude - place.latitude;
  const deltaLng = point.longitude - place.longitude;
  const angle = (Math.atan2(deltaLng, deltaLat) * 180) / Math.PI;
  const normalized = (angle + 360) % 360;
  const directions = [
    "north",
    "north east",
    "east",
    "south east",
    "south",
    "south west",
    "west",
    "north west",
  ];
  return directions[Math.round(normalized / 45) % directions.length];
}

function formatDistanceKm(distanceMetersValue: number) {
  const km = distanceMetersValue / 1000;
  return `${km.toLocaleString(undefined, {
    maximumFractionDigits: km >= 10 ? 0 : 1,
  })} km`;
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
