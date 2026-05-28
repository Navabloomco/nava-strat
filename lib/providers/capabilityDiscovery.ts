import { extractProviderIdleMarkersFromRow } from "./providerIdleMarkers";

export type ProviderCapabilityDiscoveryKey =
  | "has_gps"
  | "has_speed"
  | "has_provider_idle_markers"
  | "has_odometer"
  | "has_engine_hours"
  | "has_ignition_or_engine_state"
  | "has_fuel_level_or_fuel_used"
  | "has_driver"
  | "has_geofence_or_site"
  | "has_diagnostics_or_faults"
  | "has_raw_event_status_fields"
  | "has_pto_or_auxiliary"
  | "has_safety_events"
  | "has_hos_or_duty_status";

export type ProviderCapabilityDiscoverySummary = {
  summary_version: number;
  scanned_rows: number;
  scanned_sources: Array<{ name: string; row_count: number }>;
  capabilities: Record<ProviderCapabilityDiscoveryKey, boolean>;
  capability_details: Array<{
    key: ProviderCapabilityDiscoveryKey;
    label: string;
    status: "detected" | "not_detected";
    evidence: "mapped-field" | "raw-field" | "provider-marker" | "not-detected";
    row_count: number;
    sample_keys: string[];
  }>;
  mapped_fields_observed: string[];
  useful_unmapped_fields: Array<{
    capability: ProviderCapabilityDiscoveryKey;
    label: string;
    keys: string[];
    row_count: number;
  }>;
  next_actions: string[];
  safety_note: string;
};

type ScanOptions = {
  rowLimit?: number;
  fieldMapping?: Record<string, any> | null;
  configuredFieldNames?: string[];
  sources?: Array<{ name: string; row_count: number }>;
};

type CapabilityDefinition = {
  key: ProviderCapabilityDiscoveryKey;
  label: string;
  aliases: string[];
  requiresPair?: ProviderCapabilityDiscoveryKey;
};

type CapabilityScanState = {
  rowCount: number;
  keys: Map<string, string>;
};

const SUMMARY_VERSION = 1;
const DEFAULT_ROW_LIMIT = 150;

const CAPABILITY_DEFINITIONS: CapabilityDefinition[] = [
  {
    key: "has_gps",
    label: "GPS location",
    aliases: ["latitude", "lat", "gpslat", "gps_lat", "y", "longitude", "lng", "lon", "gpslng", "gps_lon", "x"],
  },
  {
    key: "has_speed",
    label: "Speed",
    aliases: ["speed", "speedkph", "speed_kph", "kph", "velocity"],
  },
  {
    key: "has_provider_idle_markers",
    label: "Provider idle marker fields",
    aliases: ["idle", "idling", "excessiveidle", "excessive_idle", "prolongedidle", "idleevent", "idlestatus", "idleduration"],
  },
  {
    key: "has_odometer",
    label: "Odometer or mileage fields",
    aliases: ["odometer", "odo", "odometerkm", "mileage", "kilometers", "kilometres", "totaldistance", "total_distance", "startodometer", "endodometer"],
  },
  {
    key: "has_engine_hours",
    label: "Engine hours",
    aliases: ["enginehours", "engine_hours", "enginehour", "hours"],
  },
  {
    key: "has_ignition_or_engine_state",
    label: "Ignition or engine state",
    aliases: ["ignition", "ignitionon", "ignition_on", "ignitionstatus", "acc", "accstatus", "engineon", "engine_on", "enginestatus", "engine_state"],
  },
  {
    key: "has_fuel_level_or_fuel_used",
    label: "Fuel level or fuel-used fields",
    aliases: ["fuel", "fuellevel", "fuel_level", "fuelused", "fuel_used", "fuelrate", "fuel_rate", "fuelconsumption", "lifetimefuelused", "totalfuelused", "tanklevel", "fuelvolume", "fuel_liters", "fuel_litres"],
  },
  {
    key: "has_driver",
    label: "Driver assignment/name",
    aliases: ["driver", "drivername", "driver_name", "driverid", "driver_id", "operator", "operatorname"],
  },
  {
    key: "has_geofence_or_site",
    label: "Geofence, site, or provider place label",
    aliases: ["geofence", "geo_fence", "site", "site_name", "zone", "depot", "yard", "place", "address", "locationname", "location_name"],
  },
  {
    key: "has_diagnostics_or_faults",
    label: "Diagnostics or fault codes",
    aliases: ["diagnostic", "diagnostics", "fault", "faultcode", "fault_code", "dtc", "troublecode", "trouble_code", "obd"],
  },
  {
    key: "has_raw_event_status_fields",
    label: "Event, alert, or status fields",
    aliases: ["event", "eventtype", "event_type", "alert", "alarm", "status", "state", "violation", "activity", "motion"],
  },
  {
    key: "has_pto_or_auxiliary",
    label: "PTO or auxiliary states",
    aliases: ["pto", "aux", "auxiliary", "pump", "mixer", "reefer", "power_take_off"],
  },
  {
    key: "has_safety_events",
    label: "Safety event fields",
    aliases: ["harshbraking", "harsh_braking", "harshaccel", "harsh_accel", "harshcornering", "overspeed", "speeding", "seatbelt", "crash", "collision"],
  },
  {
    key: "has_hos_or_duty_status",
    label: "HOS or duty status",
    aliases: ["hos", "hoursservice", "hours_of_service", "dutystatus", "duty_status", "driverstatus", "workstate", "work_state"],
  },
];

const SENSITIVE_KEY_PARTS = [
  "password",
  "pass",
  "secret",
  "token",
  "authorization",
  "cookie",
  "session",
  "jwt",
  "apikey",
  "api_key",
  "bearer",
  "hash",
];

export function scanProviderCapabilityRows(
  rows: any[],
  options: ScanOptions = {}
): ProviderCapabilityDiscoverySummary {
  const rowLimit = Math.max(1, Math.min(options.rowLimit || DEFAULT_ROW_LIMIT, 500));
  const sampledRows = Array.isArray(rows) ? rows.slice(0, rowLimit) : [];
  const configuredKeys = buildConfiguredKeySet(options);
  const states = new Map<ProviderCapabilityDiscoveryKey, CapabilityScanState>();
  const mappedFieldsObserved = new Set<string>();

  for (const definition of CAPABILITY_DEFINITIONS) {
    states.set(definition.key, { rowCount: 0, keys: new Map() });
  }

  sampledRows.forEach((row) => {
    const entries = collectSafeScalarEntries(row);
    const rowKeyMatches = new Map<ProviderCapabilityDiscoveryKey, Map<string, string>>();

    for (const entry of entries) {
      for (const definition of CAPABILITY_DEFINITIONS) {
        if (!matchesDefinition(entry, definition)) continue;
        const keyMatches = rowKeyMatches.get(definition.key) || new Map<string, string>();
        if (!keyMatches.has(entry.normalizedPath)) {
          keyMatches.set(entry.normalizedPath, entry.displayPath);
        }
        rowKeyMatches.set(definition.key, keyMatches);
      }

      if (configuredKeys.has(entry.normalizedPath) || configuredKeys.has(entry.normalizedLeaf)) {
        mappedFieldsObserved.add(entry.displayPath);
      }
    }

    const idleMarkers = extractProviderIdleMarkersFromRow(row);
    if (idleMarkers.length > 0) {
      const keyMatches = rowKeyMatches.get("has_provider_idle_markers") || new Map<string, string>();
      for (const marker of idleMarkers) {
        if (!marker.source_key) continue;
        const sanitized = sanitizeDisplayPath(marker.source_key);
        const normalized = normalizeKey(marker.source_key);
        if (normalized && !keyMatches.has(normalized)) {
          keyMatches.set(normalized, sanitized);
        }
      }
      if (keyMatches.size === 0) {
        keyMatches.set("provideridlemarker", "provider idle marker");
      }
      rowKeyMatches.set("has_provider_idle_markers", keyMatches);
    }

    normalizeGpsPair(rowKeyMatches);

    for (const [capability, keyMatches] of rowKeyMatches.entries()) {
      if (keyMatches.size === 0) continue;
      const state = states.get(capability);
      if (!state) continue;
      state.rowCount++;
      for (const [normalized, display] of keyMatches.entries()) {
        if (!state.keys.has(normalized)) state.keys.set(normalized, display);
      }
    }
  });

  const capabilities = Object.fromEntries(
    CAPABILITY_DEFINITIONS.map((definition) => [
      definition.key,
      (states.get(definition.key)?.rowCount || 0) > 0,
    ])
  ) as Record<ProviderCapabilityDiscoveryKey, boolean>;

  const capabilityDetails = CAPABILITY_DEFINITIONS.map((definition) => {
    const state = states.get(definition.key) || { rowCount: 0, keys: new Map<string, string>() };
    const sampleKeys = Array.from(state.keys.values()).slice(0, 8);
    const mapped = sampleKeys.some((key) => {
      const normalized = normalizeKey(key);
      return configuredKeys.has(normalized) || configuredKeys.has(normalizeKey(leafKey(key)));
    });
    const evidence: ProviderCapabilityDiscoverySummary["capability_details"][number]["evidence"] =
      state.rowCount <= 0
        ? "not-detected"
        : definition.key === "has_provider_idle_markers"
          ? "provider-marker"
          : mapped
            ? "mapped-field"
            : "raw-field";

    return {
      key: definition.key,
      label: definition.label,
      status: state.rowCount > 0 ? "detected" as const : "not_detected" as const,
      evidence,
      row_count: state.rowCount,
      sample_keys: sampleKeys,
    };
  });

  const usefulUnmappedFields = capabilityDetails
    .filter((detail) => detail.status === "detected")
    .map((detail) => {
      const unmappedKeys = detail.sample_keys.filter((key) => {
        const normalized = normalizeKey(key);
        return !configuredKeys.has(normalized) && !configuredKeys.has(normalizeKey(leafKey(key)));
      });
      if (unmappedKeys.length === 0) return null;
      return {
        capability: detail.key,
        label: detail.label,
        keys: unmappedKeys.slice(0, 6),
        row_count: detail.row_count,
      };
    })
    .filter(Boolean) as ProviderCapabilityDiscoverySummary["useful_unmapped_fields"];

  return {
    summary_version: SUMMARY_VERSION,
    scanned_rows: sampledRows.length,
    scanned_sources: sanitizeSources(options.sources, sampledRows.length),
    capabilities,
    capability_details: capabilityDetails,
    mapped_fields_observed: Array.from(mappedFieldsObserved).slice(0, 50),
    useful_unmapped_fields: usefulUnmappedFields.slice(0, 20),
    next_actions: buildCapabilityNextActions(capabilities),
    safety_note:
      "Capability discovery records safe field names and evidence labels only. It does not store raw provider values, secrets, coordinates, or payload samples.",
  };
}

export function sanitizeProviderCapabilityDiscoverySummary(
  summary: any
): ProviderCapabilityDiscoverySummary | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;

  const capabilities = {} as Record<ProviderCapabilityDiscoveryKey, boolean>;
  for (const definition of CAPABILITY_DEFINITIONS) {
    capabilities[definition.key] = Boolean(summary.capabilities?.[definition.key]);
  }

  const capabilityDetails = Array.isArray(summary.capability_details)
    ? summary.capability_details
        .map((detail: any) => sanitizeCapabilityDetail(detail))
        .filter(Boolean)
        .slice(0, CAPABILITY_DEFINITIONS.length)
    : CAPABILITY_DEFINITIONS.map((definition) => ({
        key: definition.key,
        label: definition.label,
        status: capabilities[definition.key] ? "detected" as const : "not_detected" as const,
        evidence: capabilities[definition.key] ? "raw-field" as const : "not-detected" as const,
        row_count: 0,
        sample_keys: [],
      }));

  return {
    summary_version: toSafeInteger(summary.summary_version) || SUMMARY_VERSION,
    scanned_rows: toSafeInteger(summary.scanned_rows) || 0,
    scanned_sources: sanitizeSources(summary.scanned_sources, toSafeInteger(summary.scanned_rows) || 0),
    capabilities,
    capability_details: capabilityDetails as ProviderCapabilityDiscoverySummary["capability_details"],
    mapped_fields_observed: sanitizeStringArray(summary.mapped_fields_observed, 50),
    useful_unmapped_fields: sanitizeUnmappedFields(summary.useful_unmapped_fields),
    next_actions: sanitizeStringArray(summary.next_actions, 8),
    safety_note:
      typeof summary.safety_note === "string"
        ? summary.safety_note.slice(0, 240)
        : "Capability discovery records safe field names and evidence labels only.",
  };
}

function sanitizeCapabilityDetail(detail: any) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const key = CAPABILITY_DEFINITIONS.find((definition) => definition.key === detail.key)?.key;
  if (!key) return null;
  const definition = CAPABILITY_DEFINITIONS.find((item) => item.key === key)!;
  const evidence = ["mapped-field", "raw-field", "provider-marker", "not-detected"].includes(String(detail.evidence))
    ? String(detail.evidence)
    : "not-detected";

  return {
    key,
    label: typeof detail.label === "string" ? detail.label.slice(0, 80) : definition.label,
    status: detail.status === "detected" ? "detected" as const : "not_detected" as const,
    evidence: evidence as ProviderCapabilityDiscoverySummary["capability_details"][number]["evidence"],
    row_count: toSafeInteger(detail.row_count) || 0,
    sample_keys: sanitizeStringArray(detail.sample_keys, 8),
  };
}

function normalizeGpsPair(rowKeyMatches: Map<ProviderCapabilityDiscoveryKey, Map<string, string>>) {
  const gpsMatches = rowKeyMatches.get("has_gps");
  if (!gpsMatches || gpsMatches.size === 0) return;
  const leafKeys = Array.from(gpsMatches.values()).map((key) => normalizeKey(leafKey(key)));
  const hasLatitude = leafKeys.some((key) =>
    key === "y" || ["latitude", "gpslat", "lat"].some((alias) => key.includes(alias))
  );
  const hasLongitude = leafKeys.some((key) =>
    key === "x" || ["longitude", "gpslng", "gpslon", "lng", "lon"].some((alias) => key.includes(alias))
  );
  if (!hasLatitude || !hasLongitude) rowKeyMatches.delete("has_gps");
}

function buildConfiguredKeySet(options: ScanOptions) {
  const keys = new Set<string>();
  const mapping = options.fieldMapping || {};

  for (const [field, value] of Object.entries(mapping)) {
    addConfiguredKey(keys, field);
    addConfiguredKey(keys, value);
  }

  for (const field of options.configuredFieldNames || []) {
    addConfiguredKey(keys, field);
  }

  return keys;
}

function addConfiguredKey(keys: Set<string>, value: any) {
  if (value === null || value === undefined) return;
  const text = String(value || "").trim();
  if (!text) return;
  keys.add(normalizeKey(text));
  keys.add(normalizeKey(leafKey(text)));
}

function collectSafeScalarEntries(row: any) {
  const entries: Array<{
    displayPath: string;
    normalizedPath: string;
    normalizedLeaf: string;
    valueType: string;
  }> = [];
  const seen = new Set<any>();

  function walk(value: any, path: string, depth: number) {
    if (entries.length >= 250 || depth > 5 || value === null || value === undefined) return;
    if (typeof value !== "object") {
      const displayPath = sanitizeDisplayPath(path);
      if (!displayPath) return;
      entries.push({
        displayPath,
        normalizedPath: normalizeKey(displayPath),
        normalizedLeaf: normalizeKey(leafKey(displayPath)),
        valueType: typeof value,
      });
      return;
    }

    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      value.slice(0, 5).forEach((item, index) =>
        walk(item, path ? `${path}[${index}]` : `[${index}]`, depth + 1)
      );
      return;
    }

    for (const [key, nested] of Object.entries(value)) {
      if (isSensitiveKey(key)) continue;
      const safeKey = sanitizeDisplayPath(key);
      if (!safeKey) continue;
      walk(nested, path ? `${path}.${safeKey}` : safeKey, depth + 1);
    }
  }

  walk(row, "", 0);
  return entries;
}

function matchesDefinition(
  entry: { normalizedPath: string; normalizedLeaf: string },
  definition: CapabilityDefinition
) {
  return definition.aliases.some((alias) => {
    const normalizedAlias = normalizeKey(alias);
    if (!normalizedAlias) return false;
    if (normalizedAlias.length <= 3) {
      return entry.normalizedLeaf === normalizedAlias || entry.normalizedPath === normalizedAlias;
    }
    return (
      entry.normalizedLeaf === normalizedAlias ||
      entry.normalizedPath === normalizedAlias ||
      entry.normalizedPath.includes(normalizedAlias)
    );
  });
}

function buildCapabilityNextActions(
  capabilities: Record<ProviderCapabilityDiscoveryKey, boolean>
) {
  const actions: string[] = [];
  if (!capabilities.has_provider_idle_markers) {
    actions.push("No provider idle marker fields were detected in sampled rows; ask for events or idle-report endpoints if the provider supports them.");
  }
  if (!capabilities.has_ignition_or_engine_state) {
    actions.push("Engine-on idle remains unverified until ignition or engine-state fields are available and mapped.");
  }
  if (!capabilities.has_fuel_level_or_fuel_used) {
    actions.push("Fuel burn or fuel level is not detected in sampled rows; keep fuel intelligence based on issued and allocated fuel.");
  }
  if (!capabilities.has_odometer) {
    actions.push("Provider distance or odometer may require a separate report/trip endpoint.");
  }
  if (capabilities.has_raw_event_status_fields && !capabilities.has_provider_idle_markers) {
    actions.push("Event/status fields were detected; review provider event labels before mapping idle or safety markers.");
  }
  if (!capabilities.has_diagnostics_or_faults) {
    actions.push("Fault/diagnostic codes were not detected; these often require separate provider permissions.");
  }
  return actions.slice(0, 6);
}

function sanitizeSources(sources: any, fallbackRows: number) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return [{ name: "provider sample rows", row_count: fallbackRows }];
  }

  return sources
    .map((source) => ({
      name: sanitizeDisplayPath(source?.name || "provider feed").slice(0, 80),
      row_count: toSafeInteger(source?.row_count) || 0,
    }))
    .slice(0, 12);
}

function sanitizeUnmappedFields(value: any) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const definition = CAPABILITY_DEFINITIONS.find((item) => item.key === entry?.capability);
      if (!definition) return null;
      return {
        capability: definition.key,
        label: typeof entry.label === "string" ? entry.label.slice(0, 80) : definition.label,
        keys: sanitizeStringArray(entry.keys, 6),
        row_count: toSafeInteger(entry.row_count) || 0,
      };
    })
    .filter(Boolean)
    .slice(0, 20) as ProviderCapabilityDiscoverySummary["useful_unmapped_fields"];
}

function sanitizeStringArray(value: any, limit: number) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => sanitizeDisplayPath(entry).slice(0, 120))
    .filter(Boolean)
    .slice(0, limit);
}

function sanitizeDisplayPath(value: any) {
  return String(value || "")
    .replace(/[^\w.[\]\s/-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function normalizeKey(value: any) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function leafKey(value: any) {
  const text = String(value || "");
  const parts = text.split(".");
  return parts[parts.length - 1] || text;
}

function isSensitiveKey(value: any) {
  const normalized = normalizeKey(value);
  if (!normalized) return true;
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(normalizeKey(part)));
}

function toSafeInteger(value: any) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return null;
  return Math.max(0, Math.floor(numberValue));
}
