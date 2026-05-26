export type ProviderTestSummary = {
  summary_version?: number;
  status?: string | null;
  vehicles_found?: number | null;
  matched_existing_trucks?: number | null;
  unmatched_vehicles?: number | null;
  live_location_verified?: boolean | null;
  engine_fuel_verified?: boolean | null;
  report_feed_configured?: boolean | null;
  tested_at?: string | null;
  source?: string | null;
};

const SUMMARY_VERSION = 2;
const VERIFIED_IGNITION_SIGNALS = ["ignition_on"];
const VERIFIED_ENGINE_SIGNALS = [
  "engine_rpm",
  "engine_on",
  "fuel_rate",
  "lifetime_fuel_used",
  "engine_hours",
];
const VERIFIED_TANK_SIGNALS = ["fuel_raw", "fuel_volume_liters"];

function finiteNumber(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function optionalBoolean(value: any): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeSignalKey(value: any) {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (text === "rpm") return "engine_rpm";
  if (text === "ignition") return "ignition_on";
  if (text === "engine") return "engine_on";
  if (text === "fuel_liters" || text === "fuel_litres") return "fuel_volume_liters";
  return text;
}

function sanitizeNonNegativeInteger(value: any): number | null {
  const numberValue = finiteNumber(value);
  if (numberValue === null) return null;
  return Math.max(0, Math.floor(numberValue));
}

export function parseVehicleCountFromMessage(message: any): number | null {
  if (!message) return null;
  const text = String(message);
  const patterns = [
    /(?:synced|found|processed|extracted|returned)\s+(\d[\d,]*)\s+(?:vehicles?|rows?)/i,
    /(\d[\d,]*)\s+(?:vehicles?|rows?)\s+(?:synced|found|processed|extracted|returned)/i,
    /(\d[\d,]*)\s+(?:vehicles?|rows?)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const parsed = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

export function sanitizeProviderTestSummary(summary: any): ProviderTestSummary | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return null;
  }

  const safeSummary: ProviderTestSummary = {};
  const summaryVersion = sanitizeNonNegativeInteger(summary.summary_version);
  const vehiclesFound = sanitizeNonNegativeInteger(summary.vehicles_found);
  const rawMatchedExistingTrucks = sanitizeNonNegativeInteger(
    summary.matched_existing_trucks
  );
  const hasTrustworthyMatchCount =
    vehiclesFound !== null &&
    rawMatchedExistingTrucks !== null &&
    rawMatchedExistingTrucks <= vehiclesFound;
  const matchedExistingTrucks = hasTrustworthyMatchCount
    ? rawMatchedExistingTrucks
    : null;
  const unmatchedVehicles =
    vehiclesFound !== null && matchedExistingTrucks !== null
      ? Math.max(vehiclesFound - matchedExistingTrucks, 0)
      : null;
  const liveLocationVerified = optionalBoolean(summary.live_location_verified);
  const versionedTruthFields = summaryVersion === SUMMARY_VERSION;
  const engineFuelVerified = versionedTruthFields
    ? optionalBoolean(summary.engine_fuel_verified)
    : summary.engine_fuel_verified === false
      ? false
      : null;
  const reportFeedConfigured = versionedTruthFields
    ? optionalBoolean(summary.report_feed_configured)
    : summary.report_feed_configured === false
      ? false
      : null;

  if (summaryVersion !== null) safeSummary.summary_version = summaryVersion;
  if (typeof summary.status === "string") safeSummary.status = summary.status;
  if (vehiclesFound !== null) safeSummary.vehicles_found = vehiclesFound;
  if (matchedExistingTrucks !== null) {
    safeSummary.matched_existing_trucks = matchedExistingTrucks;
  }
  if (unmatchedVehicles !== null) safeSummary.unmatched_vehicles = unmatchedVehicles;
  if (liveLocationVerified !== null) {
    safeSummary.live_location_verified = liveLocationVerified;
  }
  if (engineFuelVerified !== null) {
    safeSummary.engine_fuel_verified = engineFuelVerified;
  }
  if (reportFeedConfigured !== null) {
    safeSummary.report_feed_configured = reportFeedConfigured;
  }
  if (typeof summary.tested_at === "string") safeSummary.tested_at = summary.tested_at;
  if (typeof summary.source === "string") safeSummary.source = summary.source;

  return Object.keys(safeSummary).length > 0 ? safeSummary : null;
}

export function buildSafeProviderTestSummary(provider: any): ProviderTestSummary | null {
  const savedSummary = sanitizeProviderTestSummary(provider?.fleet_config?.test_summary);
  const parsedVehicleCount = parseVehicleCountFromMessage(provider?.last_test_message);
  const status =
    provider?.last_test_status ||
    savedSummary?.status ||
    (provider?.is_active ? "success" : null);

  if (!savedSummary && parsedVehicleCount === null && !status) return null;

  return {
    ...(savedSummary || {}),
    status: status || savedSummary?.status || null,
    vehicles_found: savedSummary?.vehicles_found ?? parsedVehicleCount ?? null,
  };
}

export function createProviderTestSummary({
  status,
  vehicleCount,
  matchedExistingTrucks,
  capabilitySummary,
  distanceDiagnostics,
  testedAt,
  source,
}: {
  status: "success" | "failure";
  vehicleCount: any;
  matchedExistingTrucks: any;
  capabilitySummary?: any;
  distanceDiagnostics?: any;
  testedAt: string;
  source: string;
}): ProviderTestSummary {
  const vehiclesFound = sanitizeNonNegativeInteger(vehicleCount) ?? 0;
  const rawMatchedTrucks = sanitizeNonNegativeInteger(matchedExistingTrucks);
  const matchedTrucks =
    rawMatchedTrucks !== null ? Math.min(rawMatchedTrucks, vehiclesFound) : null;

  return {
    summary_version: SUMMARY_VERSION,
    status,
    vehicles_found: vehiclesFound,
    matched_existing_trucks: matchedTrucks,
    unmatched_vehicles:
      matchedTrucks !== null ? Math.max(vehiclesFound - matchedTrucks, 0) : null,
    live_location_verified: status === "success" && vehiclesFound > 0,
    engine_fuel_verified: hasVerifiedEngineFuelSignals(capabilitySummary),
    report_feed_configured: hasVerifiedDistanceReportFeed(distanceDiagnostics),
    tested_at: testedAt,
    source,
  };
}

function hasVerifiedEngineFuelSignals(capabilitySummary: any) {
  if (!capabilitySummary || typeof capabilitySummary !== "object") return false;

  const supportedSignals = new Set(
    (Array.isArray(capabilitySummary.supported_signals)
      ? capabilitySummary.supported_signals
      : []
    ).map(normalizeSignalKey)
  );
  const meaningfulSignalCounts = capabilitySummary.meaningful_signal_counts || {};
  const placeholderZeroCounts = capabilitySummary.placeholder_zero_signal_counts || {};
  const capabilityCounts = capabilitySummary.capability_counts || {};
  const defaultCapability = String(
    capabilitySummary.default_capability || "UNKNOWN"
  ).toUpperCase();
  const higherObservedCapability = [
    "GPS_WITH_IGNITION",
    "CAN_BUS",
    "FUEL_ROD",
    "HYBRID_CAN_AND_FUEL_ROD",
  ].some((capability) => Number(capabilityCounts[capability] || 0) > 0);

  if (defaultCapability === "GPS_ONLY" && !higherObservedCapability) {
    return false;
  }

  return [
    ...VERIFIED_IGNITION_SIGNALS,
    ...VERIFIED_ENGINE_SIGNALS,
    ...VERIFIED_TANK_SIGNALS,
  ].some((signal) => {
    if (!supportedSignals.has(signal)) return false;
    if (Number(meaningfulSignalCounts[signal] || 0) <= 0) return false;
    return Number(placeholderZeroCounts[signal] || 0) <= 0;
  });
}

function hasVerifiedDistanceReportFeed(distanceDiagnostics: any) {
  if (!distanceDiagnostics || typeof distanceDiagnostics !== "object") return false;
  return (
    Number(distanceDiagnostics.summaries_normalized || 0) > 0 ||
    Number(distanceDiagnostics.summaries_would_write || 0) > 0 ||
    Number(distanceDiagnostics.summaries_written || 0) > 0
  );
}

export function mergeProviderTestSummaryIntoFleetConfig(
  fleetConfig: any,
  testSummary: ProviderTestSummary
) {
  const nextFleetConfig =
    fleetConfig && typeof fleetConfig === "object" && !Array.isArray(fleetConfig)
      ? { ...fleetConfig }
      : {};

  nextFleetConfig.test_summary = sanitizeProviderTestSummary(testSummary) || testSummary;
  return nextFleetConfig;
}
