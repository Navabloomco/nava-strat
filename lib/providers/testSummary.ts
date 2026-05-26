export type ProviderTestSummary = {
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

function finiteNumber(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function optionalBoolean(value: any): boolean | null {
  return typeof value === "boolean" ? value : null;
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
  const vehiclesFound = finiteNumber(summary.vehicles_found);
  const matchedExistingTrucks = finiteNumber(summary.matched_existing_trucks);
  const unmatchedVehicles = finiteNumber(summary.unmatched_vehicles);
  const liveLocationVerified = optionalBoolean(summary.live_location_verified);
  const engineFuelVerified = optionalBoolean(summary.engine_fuel_verified);
  const reportFeedConfigured = optionalBoolean(summary.report_feed_configured);

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
  const vehiclesFound = finiteNumber(vehicleCount) ?? 0;
  const matchedTrucks = finiteNumber(matchedExistingTrucks);
  const supportedEngineTankSignals = Array.isArray(
    capabilitySummary?.supported_engine_tank_signals
  )
    ? capabilitySummary.supported_engine_tank_signals
    : Array.isArray(capabilitySummary?.supported_signals)
      ? capabilitySummary.supported_signals.filter((signal: any) =>
          /engine|ignition|rpm|fuel|tank|can/i.test(String(signal || ""))
        )
      : [];
  const reportFeedConfigured =
    Number(distanceDiagnostics?.automated_distance_feeds_configured || 0) > 0;

  return {
    status,
    vehicles_found: vehiclesFound,
    matched_existing_trucks: matchedTrucks,
    unmatched_vehicles:
      matchedTrucks !== null ? Math.max(vehiclesFound - matchedTrucks, 0) : null,
    live_location_verified: status === "success" && vehiclesFound > 0,
    engine_fuel_verified: supportedEngineTankSignals.length > 0,
    report_feed_configured: reportFeedConfigured,
    tested_at: testedAt,
    source,
  };
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
