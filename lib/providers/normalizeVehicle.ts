import {
  DEFAULT_OPERATIONAL_TIME_ZONE,
  classifyProviderTimestampQuality,
  isAmbiguousProviderTimestampValue,
  parseProviderTimestamp,
} from "../timeFormatting";
import {
  type ProviderCapabilityProfile,
  buildProviderCapabilityProfile,
  isSignalSupported,
  isUnsupportedSignalValue,
  normalizeSignalKey,
  resolveTelemetryCapability,
} from "../telemetry/capabilities";
import { parseProviderVehicleIdentity } from "./vehicleIdentity";
import {
  extractProviderIdleMarkersFromRow,
  type ProviderIdleMarkerDetection,
} from "./providerIdleMarkers";

export type CanonicalVehicle = {
  truck_id: string;
  provider_label?: string | null;
  attached_trailer_plate?: string | null;

  latitude: number | null;
  longitude: number | null;

  speed: number | null;
  fuel_level: number | null;
  engine_rpm: number | null;
  engine_on: boolean | null;
  ignition_on: boolean | null;
  fuel_rate: number | null;
  lifetime_fuel_used: number | null;
  engine_hours: number | null;
  fuel_raw: number | null;
  fuel_volume_liters: number | null;
  location_label?: string | null;

  recorded_at: string;
  timestamp_quality: ProviderTimestampQuality;
  telemetry_capability: string;
  telemetry_capabilities: Record<string, any>;
  telemetry_capability_source: string;
  signal_quality: Record<string, any>;
  provider_signal_flags: Record<string, any>;
  provider_idle_markers: ProviderIdleMarkerDetection[];

  provider: string;

  raw: any;

  validation: {
    valid: boolean;
    missing_fields: string[];
    warnings: string[];
  };
};

type ProviderTimestampQuality = {
  status:
    | "valid"
    | "missing"
    | "invalid"
    | "suspect"
    | "slightly_future_clock_skew"
    | "future_suspicious";
  source: "provider" | "ingestion_fallback";
  reason: string;
  normalized_unit?: "seconds" | "milliseconds" | "datetime";
  minutes_ahead?: number | null;
};

type MappingConfig = {
  truck?: string;
  latitude?: string;
  longitude?: string;
  speed?: string;
  fuel_level?: string;
  engine_rpm?: string;
  engine_on?: string;
  ignition_on?: string;
  fuel_rate?: string;
  lifetime_fuel_used?: string;
  engine_hours?: string;
  fuel_raw?: string;
  fuel_volume_liters?: string;
  location_label?: string;
  recorded_at?: string;
};

export function normalizeVehicle(
  raw: any,
  mapping: MappingConfig,
  providerName: string,
  providerCapabilityProfile?: ProviderCapabilityProfile | null
): CanonicalVehicle {
  const profile =
    providerCapabilityProfile || buildProviderCapabilityProfile({ provider_name: providerName });
  const warnings: string[] = [];
  const missing_fields: string[] = [];

  const providerVehicleLabel = getVehicleIdentifier(raw, mapping);
  const identity = parseProviderVehicleIdentity(providerVehicleLabel);
  const truck_id = identity.canonical_truck_plate || providerVehicleLabel;
  const latitude = getNumber(raw, mapping.latitude);
  const longitude = getNumber(raw, mapping.longitude);
  const speed = getNullableNumber(raw, mapping.speed);
  const rawFuelLevel = getFuelLevel(raw, mapping);
  const signalInspection = inspectTelemetrySignals(raw, mapping, profile);
  const fuel_level =
    rawFuelLevel === 0 && !isSignalSupported(profile, "fuel_level")
      ? null
      : rawFuelLevel;
  const location_label = getLocationLabel(raw, mapping);
  const providerIdleMarkers = extractProviderIdleMarkersFromRow(raw);
  const recordedAtValue = getValue(raw, mapping.recorded_at);
  if (isAmbiguousProviderTimestampValue(recordedAtValue)) {
    warnings.push(
      "Provider timestamp has no timezone; interpreted as Africa/Nairobi local time and should be treated as approximate"
    );
  }
  const normalizedTimestamp = normalizeProviderTimestamp(recordedAtValue);
  if (normalizedTimestamp.quality.status !== "valid") {
    warnings.push(`Provider timestamp ${normalizedTimestamp.quality.reason}; using ingestion time for storage only`);
  } else if (normalizedTimestamp.quality.reason === "unix_seconds_normalized") {
    warnings.push("Provider timestamp was normalized from Unix seconds");
  }
  const recorded_at = normalizedTimestamp.recorded_at;

  // REQUIRED FIELDS

  if (!truck_id) {
    missing_fields.push("truck_id");
  }
  if (identity.attached_trailer_plate) {
    warnings.push(
      "Provider asset name includes trailer context; internal matching uses the truck plate"
    );
  }
  if (
    identity.asset_identity_role === "non_primary_vehicle" ||
    identity.asset_identity_role === "device_identifier"
  ) {
    warnings.push(
      "Provider label looks like a non-truck asset or device identifier; keep it in review before enabling intelligence"
    );
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

  const placeholderZeroSignals = [
    ...(rawFuelLevel === 0 && fuel_level === null ? ["fuel_level"] : []),
    ...signalInspection.placeholder_zero_signals,
  ];
  if (placeholderZeroSignals.length > 0) {
    warnings.push(
      "Placeholder zero signal detected without verified support; high-stakes engine/fuel fields were not upgraded"
    );
  }

  const observedSignals = {
    latitude: latitude !== null,
    longitude: longitude !== null,
    speed: speed !== null,
    fuel_level: fuel_level !== null,
    ...signalInspection.meaningful_signals,
  };
  const capabilityResolution = resolveTelemetryCapability({
    providerProfile: profile,
    observedSignals,
    hasGps: latitude !== null && longitude !== null,
  });

  return {
    truck_id: truck_id || "",
    provider_label: identity.provider_label,
    attached_trailer_plate: identity.attached_trailer_plate,

    latitude,
    longitude,

    speed,
    fuel_level,
    engine_rpm: signalInspection.values.engine_rpm,
    engine_on: signalInspection.values.engine_on,
    ignition_on: signalInspection.values.ignition_on,
    fuel_rate: signalInspection.values.fuel_rate,
    lifetime_fuel_used: signalInspection.values.lifetime_fuel_used,
    engine_hours: signalInspection.values.engine_hours,
    fuel_raw: signalInspection.values.fuel_raw,
    fuel_volume_liters: signalInspection.values.fuel_volume_liters,
    location_label,

    recorded_at,
    timestamp_quality: normalizedTimestamp.quality,
    telemetry_capability: capabilityResolution.capability,
    telemetry_capabilities: {
      label: capabilityResolution.label,
      supported_signals: Object.keys(profile.supported_signals).filter(
        (signal) => profile.supported_signals[signal]
      ),
      meaningful_signals: Object.keys(observedSignals).filter(
        (signal) => (observedSignals as Record<string, boolean>)[signal]
      ),
      timestamp_quality: normalizedTimestamp.quality,
      provider_label: identity.provider_label,
      canonical_truck_plate: identity.canonical_truck_plate,
      attached_trailer_plate: identity.attached_trailer_plate,
      identity_source: identity.identity_source,
      asset_identity_role: identity.asset_identity_role,
    },
    telemetry_capability_source: capabilityResolution.source,
    signal_quality: {
      capability_label: capabilityResolution.label,
      capability_source: capabilityResolution.source,
      placeholder_zero_signals: placeholderZeroSignals,
      unsupported_signal_fields_seen: signalInspection.unsupported_signal_fields_seen,
      timestamp_quality: normalizedTimestamp.quality,
      provider_label: identity.provider_label,
      attached_trailer_plate: identity.attached_trailer_plate,
      identity_source: identity.identity_source,
      asset_identity_role: identity.asset_identity_role,
      meaningful_signals: Object.keys(observedSignals).filter(
        (signal) => (observedSignals as Record<string, boolean>)[signal]
      ),
    },
    provider_signal_flags: {
      provider_timezone: profile.provider_timezone,
      provider_supported_signals: Object.keys(profile.supported_signals).filter(
        (signal) => profile.supported_signals[signal]
      ),
      observed_signal_keys: signalInspection.observed_signal_keys,
      placeholder_zero_signals: placeholderZeroSignals,
      timestamp_quality: normalizedTimestamp.quality,
      provider_label: identity.provider_label,
      attached_trailer_plate: identity.attached_trailer_plate,
      identity_source: identity.identity_source,
      asset_identity_role: identity.asset_identity_role,
      provider_idle_markers_detected: providerIdleMarkers.length,
    },
    provider_idle_markers: providerIdleMarkers,

    provider: providerName,

    raw,

    validation: {
      valid: missing_fields.length === 0,
      missing_fields,
      warnings,
    },
  };
}

function inspectTelemetrySignals(
  raw: any,
  mapping: MappingConfig,
  profile: ProviderCapabilityProfile
) {
  const numberFields = [
    "engine_rpm",
    "fuel_rate",
    "lifetime_fuel_used",
    "engine_hours",
    "fuel_raw",
    "fuel_volume_liters",
  ];
  const values: Record<string, number | boolean | null> = {
    engine_rpm: null,
    engine_on: null,
    ignition_on: null,
    fuel_rate: null,
    lifetime_fuel_used: null,
    engine_hours: null,
    fuel_raw: null,
    fuel_volume_liters: null,
  };
  const meaningfulSignals: Record<string, boolean> = {};
  const observedSignalKeys: string[] = [];
  const placeholderZeroSignals: string[] = [];
  const unsupportedSignalFieldsSeen: string[] = [];

  for (const field of numberFields) {
    const inspection = inspectNumberSignal(raw, mapping, field, profile);
    values[field] = inspection.value;
    if (inspection.observed) observedSignalKeys.push(field);
    if (inspection.placeholder_zero) placeholderZeroSignals.push(field);
    if (inspection.unsupported_seen) unsupportedSignalFieldsSeen.push(field);
    if (inspection.value !== null) meaningfulSignals[field] = true;
  }

  for (const field of ["engine_on", "ignition_on"]) {
    const inspection = inspectBooleanSignal(raw, mapping, field, profile);
    values[field] = inspection.value;
    if (inspection.observed) observedSignalKeys.push(field);
    if (inspection.placeholder_zero) placeholderZeroSignals.push(field);
    if (inspection.unsupported_seen) unsupportedSignalFieldsSeen.push(field);
    if (inspection.value !== null) meaningfulSignals[field] = true;
  }

  return {
    values: values as {
      engine_rpm: number | null;
      engine_on: boolean | null;
      ignition_on: boolean | null;
      fuel_rate: number | null;
      lifetime_fuel_used: number | null;
      engine_hours: number | null;
      fuel_raw: number | null;
      fuel_volume_liters: number | null;
    },
    meaningful_signals: meaningfulSignals,
    observed_signal_keys: Array.from(new Set(observedSignalKeys)),
    placeholder_zero_signals: Array.from(new Set(placeholderZeroSignals)),
    unsupported_signal_fields_seen: Array.from(new Set(unsupportedSignalFieldsSeen)),
  };
}

function inspectNumberSignal(
  raw: any,
  mapping: MappingConfig,
  field: string,
  profile: ProviderCapabilityProfile
) {
  const rawValue = getProviderSignalValue(raw, mapping, field);
  if (isUnsupportedSignalValue(rawValue)) {
    return { value: null, observed: false, placeholder_zero: false, unsupported_seen: false };
  }

  const parsed = parseProviderSignalNumber(rawValue);
  if (parsed === null || !isSaneTelemetrySignalNumber(field, parsed)) {
    return { value: null, observed: true, placeholder_zero: false, unsupported_seen: true };
  }

  if (parsed === 0 && !isSignalSupported(profile, field)) {
    return { value: null, observed: true, placeholder_zero: true, unsupported_seen: true };
  }

  return { value: parsed, observed: true, placeholder_zero: false, unsupported_seen: false };
}

function inspectBooleanSignal(
  raw: any,
  mapping: MappingConfig,
  field: string,
  profile: ProviderCapabilityProfile
) {
  const rawValue = getProviderSignalValue(raw, mapping, field);
  if (isUnsupportedSignalValue(rawValue)) {
    return { value: null, observed: false, placeholder_zero: false, unsupported_seen: false };
  }

  const parsed = parseProviderBoolean(rawValue);
  if (parsed === null) {
    return { value: null, observed: true, placeholder_zero: false, unsupported_seen: true };
  }

  if (parsed === false && !isSignalSupported(profile, field)) {
    return { value: null, observed: true, placeholder_zero: true, unsupported_seen: true };
  }

  return { value: parsed, observed: true, placeholder_zero: false, unsupported_seen: false };
}

function getProviderSignalValue(raw: any, mapping: MappingConfig, field: string) {
  const configuredPath = (mapping as Record<string, string | undefined>)[field];
  if (configuredPath) {
    const configuredValue = getValueByCaseInsensitivePath(raw, configuredPath);
    if (!isUnsupportedSignalValue(configuredValue)) return configuredValue;
  }

  for (const fallbackKey of getSignalFallbackKeys(field)) {
    const value = getValueByCaseInsensitivePath(raw, fallbackKey);
    if (!isUnsupportedSignalValue(value)) return value;
  }

  return null;
}

function getSignalFallbackKeys(field: string) {
  const normalized = normalizeSignalKey(field);
  if (normalized === "engine_rpm") {
    return ["engine_rpm", "engineRpm", "rpm", "RPM", "Engine RPM"];
  }
  if (normalized === "engine_on") {
    return ["engine_on", "engineOn", "engine", "engine_status", "engineStatus"];
  }
  if (normalized === "ignition_on") {
    return ["ignition_on", "ignitionOn", "ignition", "ignition_status", "ignitionStatus"];
  }
  if (normalized === "fuel_rate") {
    return ["fuel_rate", "fuelRate", "fuel consumption", "fuel_consumption"];
  }
  if (normalized === "lifetime_fuel_used") {
    return ["lifetime_fuel_used", "lifetimeFuelUsed", "total_fuel_used", "totalFuelUsed"];
  }
  if (normalized === "engine_hours") {
    return ["engine_hours", "engineHours", "engine hours", "hours"];
  }
  if (normalized === "fuel_raw") {
    return ["fuel_raw", "fuelRaw", "fuel_adc", "fuelAdc", "tank_raw", "tankRaw"];
  }
  if (normalized === "fuel_volume_liters") {
    return [
      "fuel_volume_liters",
      "fuelVolumeLiters",
      "fuel_liters",
      "fuelLiters",
      "fuel_litres",
      "litres",
      "liters",
      "tank_volume_liters",
    ];
  }
  return [field];
}

function parseProviderSignalNumber(value: any): number | null {
  if (isUnsupportedSignalValue(value)) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const match = value.trim().replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseProviderBoolean(value: any): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (isUnsupportedSignalValue(value)) return null;
  const text = String(value).trim().toLowerCase();
  if (["on", "true", "yes", "running", "engine_on", "ignition_on", "1"].includes(text)) {
    return true;
  }
  if (["off", "false", "no", "stopped", "engine_off", "ignition_off", "0"].includes(text)) {
    return false;
  }
  return null;
}

function isSaneTelemetrySignalNumber(field: string, value: number) {
  if (!Number.isFinite(value)) return false;
  if (field === "engine_rpm") return value >= 0 && value <= 10000;
  if (field === "fuel_rate") return value >= 0 && value <= 500;
  if (field === "lifetime_fuel_used") return value >= 0 && value <= 100000000;
  if (field === "engine_hours") return value >= 0 && value <= 1000000;
  if (field === "fuel_raw") return value >= 0 && value <= 10000000;
  if (field === "fuel_volume_liters") return value >= 0 && value <= 5000;
  return true;
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

const FALLBACK_VEHICLE_IDENTIFIER_KEYS = [
  "reg_no",
  "regNo",
  "registration",
  "Registration",
  "truck_id",
  "truckId",
  "truck",
  "vehicle",
  "Vehicle",
  "plate",
  "unit_id",
  "unitId",
  "unit",
  "asset_id",
  "assetId",
  "device_id",
  "deviceId",
  "imei",
];

const NORMALIZED_FALLBACK_VEHICLE_IDENTIFIER_KEYS = new Set(
  FALLBACK_VEHICLE_IDENTIFIER_KEYS.map(normalizeIdentifierKey)
);

function getVehicleIdentifier(raw: any, mapping: MappingConfig): string | null {
  const mappedValue = coerceVehicleIdentifier(getValue(raw, mapping.truck));
  if (mappedValue) return mappedValue;

  if (mapping.truck) {
    const caseInsensitiveValue = coerceVehicleIdentifier(
      getValueByCaseInsensitivePath(raw, mapping.truck)
    );
    if (caseInsensitiveValue) return caseInsensitiveValue;
  }

  return findFallbackVehicleIdentifier(raw);
}

function findFallbackVehicleIdentifier(raw: any): string | null {
  const seen = new Set<any>();
  const maxDepth = 4;

  function visit(value: any, depth: number): string | null {
    if (value === null || value === undefined || depth > maxDepth) {
      return null;
    }

    if (typeof value !== "object") {
      return null;
    }

    if (seen.has(value)) return null;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = visit(item, depth + 1);
        if (nested) return nested;
      }
      return null;
    }

    const keys = Object.keys(value);
    for (const key of keys) {
      if (!NORMALIZED_FALLBACK_VEHICLE_IDENTIFIER_KEYS.has(normalizeIdentifierKey(key))) {
        continue;
      }

      const identifier = coerceVehicleIdentifier(value[key]);
      if (identifier) return identifier;
    }

    for (const key of keys) {
      const nested = visit(value[key], depth + 1);
      if (nested) return nested;
    }

    return null;
  }

  return visit(raw, 0);
}

function coerceVehicleIdentifier(value: any): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" && typeof value !== "number") return null;

  const text = String(value).trim();
  if (!text) return null;

  const normalized = normalizeIdentifierValue(text);
  if (!normalized || /^0+$/.test(normalized)) return null;
  if (
    normalized.includes("unknown") ||
    normalized.includes("unidentified") ||
    [
      "na",
      "none",
      "null",
      "undefined",
      "notavailable",
      "notassigned",
    ].includes(normalized)
  ) {
    return null;
  }

  return text;
}

function normalizeIdentifierKey(key: string): string {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeIdentifierValue(value: string): string {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
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

function normalizeProviderTimestamp(value: any): {
  recorded_at: string;
  quality: ProviderTimestampQuality;
} {
  const fallback = new Date();
  if (value === undefined || value === null || value === "") {
    return {
      recorded_at: fallback.toISOString(),
      quality: {
        status: "missing",
        source: "ingestion_fallback",
        reason: "missing_provider_timestamp",
      },
    };
  }

  const candidate = parseProviderTimestampCandidate(value);
  if (!candidate.date || Number.isNaN(candidate.date.getTime())) {
    return {
      recorded_at: fallback.toISOString(),
      quality: {
        status: "invalid",
        source: "ingestion_fallback",
        reason: "unparseable_provider_timestamp",
      },
    };
  }

  const validation = validateProviderTimestamp(candidate.date);
  if (validation.status !== "valid") {
    return {
      recorded_at: fallback.toISOString(),
      quality: {
        status: validation.status,
        source: "ingestion_fallback",
        reason: validation.reason,
        normalized_unit: candidate.unit,
        minutes_ahead: validation.minutes_ahead ?? null,
      },
    };
  }

  return {
    recorded_at: candidate.date.toISOString(),
    quality: {
      status: "valid",
      source: "provider",
      reason: candidate.reason,
      normalized_unit: candidate.unit,
    },
  };
}

function parseProviderTimestampCandidate(value: any): {
  date: Date | null;
  unit: "seconds" | "milliseconds" | "datetime";
  reason: string;
} {
  if (value instanceof Date) {
    return { date: value, unit: "datetime", reason: "datetime" };
  }

  const numericValue = parseTimestampNumber(value);
  if (numericValue !== null) {
    if (numericValue === 0) {
      return {
        date: new Date(0),
        unit: "milliseconds",
        reason: "epoch_zero_provider_timestamp",
      };
    }

    const secondsDate =
      numericValue >= 946684800 && numericValue <= 4102444800
        ? new Date(numericValue * 1000)
        : null;
    const millisecondsDate =
      numericValue >= 946684800000 && numericValue <= 4102444800000
        ? new Date(numericValue)
        : null;

    if (secondsDate) {
      return {
        date: secondsDate,
        unit: "seconds",
        reason: "unix_seconds_normalized",
      };
    }

    if (millisecondsDate) {
      return {
        date: millisecondsDate,
        unit: "milliseconds",
        reason: "unix_milliseconds_normalized",
      };
    }

    return {
      date: new Date(numericValue),
      unit: "milliseconds",
      reason: "numeric_timestamp_outside_expected_range",
    };
  }

  const date = parseProviderTimestamp(value, DEFAULT_OPERATIONAL_TIME_ZONE);
  return { date, unit: "datetime", reason: "datetime" };
}

function parseTimestampNumber(value: any): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateProviderTimestamp(date: Date): {
  status: ProviderTimestampQuality["status"];
  reason: string;
  minutes_ahead?: number | null;
} {
  const quality = classifyProviderTimestampQuality(date);
  if (quality.status === "valid") {
    return { status: "valid", reason: quality.reason };
  }
  return {
    status: quality.status,
    reason: quality.reason,
    minutes_ahead: quality.minutes_ahead,
  };
}
