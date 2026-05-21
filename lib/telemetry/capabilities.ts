export const TELEMETRY_CAPABILITIES = [
  "UNKNOWN",
  "GPS_ONLY",
  "GPS_WITH_IGNITION",
  "CAN_BUS",
  "FUEL_ROD",
  "HYBRID_CAN_AND_FUEL_ROD",
] as const;

export type TelemetryCapability = (typeof TELEMETRY_CAPABILITIES)[number];

export type ProviderCapabilityProfile = {
  default_capability: TelemetryCapability;
  supported_signals: Record<string, boolean>;
  provider_timezone: string;
  source_signal_notes: Record<string, any>;
  source: "provider_declaration" | "unknown";
};

export type TelemetryCapabilityResolution = {
  capability: TelemetryCapability;
  label: string;
  source: "asset_manual" | "provider_declaration" | "auto_observed" | "unknown";
  wording: string;
};

export const TELEMETRY_CAPABILITY_LABELS: Record<TelemetryCapability, string> = {
  UNKNOWN: "Unknown Capability",
  GPS_ONLY: "GPS Intelligence",
  GPS_WITH_IGNITION: "Ignition-Aware GPS",
  CAN_BUS: "Engine Intelligence",
  FUEL_ROD: "Tank Intelligence",
  HYBRID_CAN_AND_FUEL_ROD: "Full Fuel Intelligence",
};

const TELEMETRY_CAPABILITY_WORDING: Record<TelemetryCapability, string> = {
  UNKNOWN:
    "Hardware capability is not classified yet. Location may be available, but engine and fuel conclusions are not verified.",
  GPS_ONLY:
    "This asset provides GPS movement data. Fuel burn and engine-on idling are not verified with current hardware.",
  GPS_WITH_IGNITION:
    "Ignition state is available. Idle risk can be verified by ignition, but exact fuel burn is not measured.",
  CAN_BUS:
    "Engine data is available. Engine-on idle and fuel-burn estimates can be supported by RPM/fuel-rate/lifetime fuel signals.",
  FUEL_ROD:
    "Tank sensor data is available. Physical tank-volume changes can be evaluated, subject to calibration and signal-quality checks.",
  HYBRID_CAN_AND_FUEL_ROD:
    "Engine and tank signals are available. Fuel movement can be cross-checked against engine activity and tank volume.",
};

const CAN_BUS_SIGNALS = new Set([
  "engine_rpm",
  "engine_on",
  "fuel_rate",
  "lifetime_fuel_used",
  "engine_hours",
]);

const FUEL_ROD_SIGNALS = new Set(["fuel_raw", "fuel_volume_liters"]);
const IGNITION_SIGNALS = new Set(["ignition_on"]);
const GPS_SIGNALS = new Set(["latitude", "longitude", "speed"]);

export function normalizeTelemetryCapability(value: any): TelemetryCapability {
  const text = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
  return (TELEMETRY_CAPABILITIES as readonly string[]).includes(text)
    ? (text as TelemetryCapability)
    : "UNKNOWN";
}

export function telemetryCapabilityLabel(value: any) {
  return TELEMETRY_CAPABILITY_LABELS[normalizeTelemetryCapability(value)];
}

export function telemetryCapabilityWording(value: any) {
  return TELEMETRY_CAPABILITY_WORDING[normalizeTelemetryCapability(value)];
}

export function buildProviderCapabilityProfile(provider: any): ProviderCapabilityProfile {
  const fleetConfig =
    provider?.fleet_config && typeof provider.fleet_config === "object"
      ? provider.fleet_config
      : {};
  const profile = firstObject(
    provider?.capability_profile,
    fleetConfig.capability_profile
  );
  const supportedSignals = normalizeSupportedSignals(
    provider?.supported_signals ||
      fleetConfig.supported_signals ||
      profile.supported_signals ||
      {}
  );
  const defaultCapability = normalizeTelemetryCapability(
    profile.default_capability ||
      profile.telemetry_capability ||
      fleetConfig.default_telemetry_capability ||
      provider?.telemetry_capability
  );

  return {
    default_capability: defaultCapability,
    supported_signals: supportedSignals,
    provider_timezone:
      safeShortText(
        provider?.provider_timezone ||
          fleetConfig.provider_timezone ||
          profile.provider_timezone
      ) ||
      "Africa/Nairobi",
    source_signal_notes: firstObject(
      provider?.source_signal_notes,
      fleetConfig.source_signal_notes,
      profile.source_signal_notes
    ),
    source:
      defaultCapability !== "UNKNOWN" || Object.keys(supportedSignals).length > 0
        ? "provider_declaration"
        : "unknown",
  };
}

export function resolveTelemetryCapability(input: {
  asset?: any;
  providerProfile?: ProviderCapabilityProfile | null;
  observedSignals?: Record<string, boolean>;
  hasGps?: boolean;
}): TelemetryCapabilityResolution {
  const sourceText = String(input.asset?.telemetry_capability_source || "")
    .trim()
    .toLowerCase();
  const assetCapability = normalizeTelemetryCapability(input.asset?.telemetry_capability);

  if (
    assetCapability !== "UNKNOWN" &&
    ["manual", "admin", "asset_review", "verified"].some((token) =>
      sourceText.includes(token)
    )
  ) {
    return capabilityResolution(assetCapability, "asset_manual");
  }

  const providerCapability =
    input.providerProfile?.default_capability || "UNKNOWN";
  if (providerCapability !== "UNKNOWN") {
    return capabilityResolution(providerCapability, "provider_declaration");
  }

  if (assetCapability !== "UNKNOWN") {
    return capabilityResolution(assetCapability, "asset_manual");
  }

  const observedCapability = inferCapabilityFromSignals(
    input.observedSignals || {},
    Boolean(input.hasGps)
  );

  if (observedCapability !== "UNKNOWN") {
    return capabilityResolution(observedCapability, "auto_observed");
  }

  return capabilityResolution("UNKNOWN", "unknown");
}

export function inferCapabilityFromSignals(
  signals: Record<string, boolean>,
  hasGps = false
): TelemetryCapability {
  const normalized = normalizeSupportedSignals(signals);
  const hasCan = Array.from(CAN_BUS_SIGNALS).some((signal) => normalized[signal]);
  const hasFuelRod = Array.from(FUEL_ROD_SIGNALS).some((signal) => normalized[signal]);
  const hasIgnition = Array.from(IGNITION_SIGNALS).some((signal) => normalized[signal]);
  const hasGpsSignals =
    hasGps || Array.from(GPS_SIGNALS).some((signal) => normalized[signal]);

  if (hasCan && hasFuelRod) return "HYBRID_CAN_AND_FUEL_ROD";
  if (hasFuelRod) return "FUEL_ROD";
  if (hasCan) return "CAN_BUS";
  if (hasIgnition && hasGpsSignals) return "GPS_WITH_IGNITION";
  if (hasGpsSignals) return "GPS_ONLY";
  return "UNKNOWN";
}

export function normalizeSupportedSignals(value: any): Record<string, boolean> {
  const output: Record<string, boolean> = {};

  if (Array.isArray(value)) {
    for (const item of value) {
      const key = normalizeSignalKey(item);
      if (key) output[key] = true;
    }
    return output;
  }

  if (!value || typeof value !== "object") return output;

  for (const [key, entry] of Object.entries(value)) {
    const signal = normalizeSignalKey(key);
    if (!signal) continue;
    const text = String(entry).trim().toLowerCase();
    output[signal] =
      entry === true ||
      ["true", "yes", "supported", "available", "verified"].includes(text);
  }

  return output;
}

export function isSignalSupported(
  profile: ProviderCapabilityProfile | null | undefined,
  signal: string
) {
  const key = normalizeSignalKey(signal);
  return Boolean(key && profile?.supported_signals?.[key]);
}

export function normalizeSignalKey(value: any) {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!text) return "";
  if (text === "rpm") return "engine_rpm";
  if (text === "ignition") return "ignition_on";
  if (text === "engine") return "engine_on";
  if (text === "fuel_liters" || text === "fuel_litres") return "fuel_volume_liters";
  return text;
}

export function isUnsupportedSignalValue(value: any) {
  if (value === undefined || value === null) return true;
  const text = String(value).trim().toLowerCase();
  return (
    !text ||
    text === "-" ||
    text === "--" ||
    text === "n/a" ||
    text === "na" ||
    text === "null" ||
    text === "undefined"
  );
}

export function buildCapabilitySummary(input: {
  rows_processed: number;
  capability_counts: Record<string, number>;
  placeholder_zero_signal_counts?: Record<string, number>;
  providerProfile?: ProviderCapabilityProfile | null;
}) {
  const counts = input.capability_counts || {};
  const supportedSignals = input.providerProfile?.supported_signals || {};
  const defaultCapability =
    input.providerProfile?.default_capability || "UNKNOWN";

  return {
    default_capability: defaultCapability,
    default_capability_label: telemetryCapabilityLabel(defaultCapability),
    provider_timezone: input.providerProfile?.provider_timezone || "Africa/Nairobi",
    supported_signals: Object.keys(supportedSignals).filter((key) => supportedSignals[key]),
    rows_processed: Number(input.rows_processed || 0),
    capability_counts: Object.fromEntries(
      Object.entries(counts).map(([key, count]) => [
        normalizeTelemetryCapability(key),
        Number(count || 0),
      ])
    ),
    placeholder_zero_signal_counts: Object.fromEntries(
      Object.entries(input.placeholder_zero_signal_counts || {}).map(([key, count]) => [
        normalizeSignalKey(key),
        Number(count || 0),
      ])
    ),
  };
}

function capabilityResolution(
  capability: TelemetryCapability,
  source: TelemetryCapabilityResolution["source"]
): TelemetryCapabilityResolution {
  return {
    capability,
    label: TELEMETRY_CAPABILITY_LABELS[capability],
    source,
    wording: TELEMETRY_CAPABILITY_WORDING[capability],
  };
}

function firstObject(...values: any[]) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
  }
  return {};
}

function safeShortText(value: any) {
  const text = String(value || "").trim();
  return text.length > 0 && text.length <= 120 ? text : "";
}
