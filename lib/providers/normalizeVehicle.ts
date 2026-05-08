export type CanonicalVehicle = {
  truck_id: string;

  latitude: number | null;
  longitude: number | null;

  speed: number | null;
  fuel_level: number | null;

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
  const fuel_level = getNullableNumber(raw, mapping.fuel_level);
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

  if (fuel_level !== null && (fuel_level < 0 || fuel_level > 100)) {
    warnings.push("Fuel level outside expected range");
  }

  return {
    truck_id: truck_id || "UNKNOWN",

    latitude,
    longitude,

    speed,
    fuel_level,

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

  return String(value).trim();
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
