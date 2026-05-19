export type CanonicalVehicle = {
  truck_id: string;

  latitude: number | null;
  longitude: number | null;

  speed: number | null;
  fuel_level: number | null;
  location_label?: string | null;

  recorded_at: string;

  provider: string;

  raw: any;

  validation: {
    valid: boolean;
    missing_fields: string[];
    warnings: string[];
  };
};

type MappingConfig = {
  truck?: string;
  latitude?: string;
 longitude?: string;
  speed?: string;
  fuel_level?: string;
  location_label?: string;
  recorded_at?: string;
};

export function normalizeVehicle(
  raw: any,
  mapping: MappingConfig,
  providerName: string
): CanonicalVehicle {
  const warnings: string[] = [];
  const missing_fields: string[] = [];

  const truck_id = getString(raw, mapping.truck);
  const latitude = getNumber(raw, mapping.latitude);
  const longitude = getNumber(raw, mapping.longitude);
  const speed = getNullableNumber(raw, mapping.speed);
  const fuel_level = getFuelLevel(raw, mapping);
  const location_label = getLocationLabel(raw, mapping);
  const recorded_at = getTimestamp(raw, mapping.recorded_at);

  // REQUIRED FIELDS

  if (!truck_id) {
    missing_fields.push("truck_id");
  }

  if (latitude === null) {
    missing_fields.push("latitude");
  }

  if (longitude === null) {
    missing_fields.push("longitude");
  }

  // VALIDATION RULES

  if (latitude !== null && (latitude < -90 || latitude > 90)) {
    warnings.push("Latitude outside valid range");
  }

  if (longitude !== null && (longitude < -180 || longitude > 180)) {
    warnings.push("Longitude outside valid range");
  }

  if (speed !== null && speed < 0) {
    warnings.push("Negative speed detected");
  }

  if (fuel_level !== null && fuel_level > 100) {
    warnings.push("Fuel value is above 100; treating it as provider units rather than percent");
  }

  return {
    truck_id: truck_id || "UNKNOWN",

    latitude,
    longitude,

    speed,
    fuel_level,
    location_label,

    recorded_at,

    provider: providerName,

    raw,

    validation: {
      valid: missing_fields.length === 0,
      missing_fields,
      warnings,
    },
  };
}

/* -------------------------------- */
/* FIELD EXTRACTION HELPERS */
/* -------------------------------- */

function getValue(raw: any, path?: string): any {
  if (!path) return null;

  return path.split(".").reduce((current, key) => {
    if (current === undefined || current === null) {
      return null;
    }

    return current[key];
  }, raw);
}

function getString(raw: any, path?: string): string | null {
  const value = getValue(raw, path);

  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function getLocationLabel(raw: any, mapping: MappingConfig): string | null {
  if (mapping.location_label) {
    return getString(raw, mapping.location_label);
  }

  return getFirstString(raw, ["location", "Location"]);
}

function getFirstString(raw: any, paths: string[]) {
  for (const path of paths) {
    const value = getString(raw, path);
    if (value) return value;
  }

  return null;
}

function getNumber(raw: any, path?: string): number | null {
  const value = getValue(raw, path);

  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    return null;
  }

  return parsed;
}

function getNullableNumber(
  raw: any,
  path?: string
): number | null {
  return getNumber(raw, path);
}

const FALLBACK_FUEL_KEYS = [
  "current_fuel",
  "currentFuel",
  "current fuel",
  "Current Fuel",
  "CURRENT FUEL",
  "fuel",
  "fuel_level",
  "fuelLevel",
  "fuel_liters",
  "fuelLiters",
  "litres",
  "liters",
  "tank_level",
  "tankLevel",
  "fuel_value",
  "fuelValue",
];

const NORMALIZED_FALLBACK_FUEL_KEYS = new Set(
  FALLBACK_FUEL_KEYS.map(normalizeFuelKey)
);

function getFuelLevel(raw: any, mapping: MappingConfig): number | null {
  const mappedValue = parseFuelValue(getFuelMappedValue(raw, mapping.fuel_level));

  if (mappedValue !== null && mappedValue !== 0) {
    return mappedValue;
  }

  const fallbackValue = findFallbackFuelValue(raw);
  if (fallbackValue !== null) {
    return fallbackValue;
  }

  return mappedValue;
}

function getFuelMappedValue(raw: any, path?: string): any {
  if (!path) return null;

  const exactValue = getValue(raw, path);
  if (exactValue !== undefined && exactValue !== null && exactValue !== "") {
    return exactValue;
  }

  return getValueByCaseInsensitivePath(raw, path);
}

function getValueByCaseInsensitivePath(raw: any, path: string): any {
  if (!raw || !path) return null;

  return path.split(".").reduce((current: any, segment: string) => {
    if (current === undefined || current === null) return null;

    if (
      typeof current === "object" &&
      !Array.isArray(current) &&
      segment in current
    ) {
      return current[segment];
    }

    if (typeof current !== "object" || Array.isArray(current)) return null;

    const target = normalizeFuelKey(segment);
    const match = Object.keys(current).find(
      (key) => normalizeFuelKey(key) === target
    );

    return match ? current[match] : null;
  }, raw);
}

function findFallbackFuelValue(raw: any): number | null {
  const seen = new Set<any>();
  const maxDepth = 6;

  function visit(value: any, depth: number): number | null {
    if (value === null || value === undefined || depth > maxDepth) {
      return null;
    }

    if (typeof value !== "object") {
      return null;
    }

    if (seen.has(value)) return null;
    seen.add(value);

    let zeroMatch: number | null = null;

    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = visit(item, depth + 1);
        if (nested !== null && nested !== 0) {
          return nested;
        }
        if (nested === 0) zeroMatch = 0;
      }
      return zeroMatch;
    }

    const keys = Object.keys(value);
    for (const fallbackKey of FALLBACK_FUEL_KEYS) {
      const normalizedFallbackKey = normalizeFuelKey(fallbackKey);
      if (!NORMALIZED_FALLBACK_FUEL_KEYS.has(normalizedFallbackKey)) {
        continue;
      }
      const key = keys.find(
        (candidateKey) => normalizeFuelKey(candidateKey) === normalizedFallbackKey
      );
      if (!key) continue;

      const parsed = parseFuelValue(value[key]);
      if (parsed !== null && parsed !== 0) return parsed;
      if (parsed === 0) zeroMatch = 0;
    }

    for (const key of keys) {
      const nested = visit(value[key], depth + 1);
      if (nested !== null && nested !== 0) {
        return nested;
      }
      if (nested === 0) zeroMatch = 0;
    }

    return zeroMatch;
  }

  return visit(raw, 0);
}

function parseFuelValue(value: any): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return isValidFuelNumber(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const numericMatch = trimmed.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    if (!numericMatch) return null;

    const parsed = Number(numericMatch[0]);
    return isValidFuelNumber(parsed) ? parsed : null;
  }

  return null;
}

function isValidFuelNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 5000;
}

function normalizeFuelKey(key: string): string {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getTimestamp(raw: any, path?: string): string {
  const value = getValue(raw, path);

  // FALLBACK TO CURRENT TIME
  if (!value) {
    return new Date().toISOString();
  }

  const date = new Date(value);

  // INVALID DATE FALLBACK
  if (isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return date.toISOString();
}
