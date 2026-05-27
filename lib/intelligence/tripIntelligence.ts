import { canViewFinance } from "../api/roleAccess";
import { readStoredVehicleIdentityContext } from "../providers/vehicleIdentity";
import { supabaseAdmin } from "../supabaseAdmin";
import {
  classifyProviderTimestampQuality,
  parseProviderTimestamp,
  resolveOperationalDayRange,
  resolveOperationalTimeZone,
} from "../timeFormatting";
import {
  FuelIssueAllocationSummary,
  isFuelAllocationSchemaMissing,
  isTripFuelAllocation,
  summarizeFuelIssue,
  summarizeAllocationsForJourney,
} from "./fuelAllocation";
import { normalizeVehicleKey } from "./entityResolver";

export type TripIntelligenceRange = "today" | "yesterday" | "7d";
export type ProfitabilityReadiness =
  | "calculable"
  | "partially_linked"
  | "not_enough_linked_data";

type TripIntelligenceInput = {
  companyId: string;
  company?: any;
  range?: string | null;
  roles?: string[];
  includeFinance?: boolean;
};

type QueryResult<T> = {
  rows: T[];
  missing?: boolean;
  error?: string | null;
};

type FuelAllocationQueryResult = QueryResult<any> & {
  issue_summaries?: Record<string, FuelIssueAllocationSummary>;
};

type TripTimeframe = {
  requested: TripIntelligenceRange;
  time_zone: string;
  start_utc: string;
  end_utc: string;
  local_start_date: string;
  local_end_date: string;
  display_label: string;
};

const STALE_TRACKING_THRESHOLD_MINUTES = 60;
const MAX_SEGMENT_MINUTES = 90;
const MAX_IMPLIED_SPEED_KPH = 160;
const MAX_INFERRED_TRIP_WINDOW_MS = 24 * 60 * 60 * 1000;

const OPERATIONAL_JOURNEY_SELECT =
  "id, company_id, internal_trip_id, asset_id, driver_id, client_name, truck, driver, from_location, to_location, route, expected_fuel_liters, status, start_time, end_time, created_at";
const FINANCE_JOURNEY_SELECT = `${OPERATIONAL_JOURNEY_SELECT}, loaded_quantity, offloaded_quantity, billing_quantity, billing_unit, rate_type, rate_amount, rate_currency, fx_rate, revenue_original, revenue_kes, revenue_status`;
const ASSET_SELECT =
  "id, company_id, provider_id, truck_id, registration, provider_name, status, last_seen_at, provider_location_label, asset_category, billing_status, intelligence_enabled, first_seen_at, telemetry_capability, telemetry_capabilities";

export function resolveTripIntelligenceTimeframe(input: {
  range?: string | null;
  company?: any;
}): TripTimeframe {
  const requested = normalizeRange(input.range);
  const timeZone = resolveOperationalTimeZone(input.company);
  const endDay = resolveOperationalDayRange(timeZone, 0);

  if (requested === "7d") {
    const startDay = resolveOperationalDayRange(timeZone, -6);
    return {
      requested,
      time_zone: timeZone,
      start_utc: startDay.startUtc,
      end_utc: endDay.endUtc,
      local_start_date: startDay.localDate,
      local_end_date: endDay.localDate,
      display_label: `${formatLocalDay(startDay.localDate)} to ${formatLocalDay(
        endDay.localDate
      )}`,
    };
  }

  const day = resolveOperationalDayRange(timeZone, requested === "yesterday" ? -1 : 0);
  return {
    requested,
    time_zone: timeZone,
    start_utc: day.startUtc,
    end_utc: day.endUtc,
    local_start_date: day.localDate,
    local_end_date: day.localDate,
    display_label: formatLocalDay(day.localDate),
  };
}

export async function buildTripIntelligenceSummary(input: TripIntelligenceInput) {
  const includeFinance =
    input.includeFinance === undefined
      ? canViewFinance(input.roles || [])
      : Boolean(input.includeFinance);
  const timeframe = resolveTripIntelligenceTimeframe({
    range: input.range,
    company: input.company,
  });

  const [journeysResult, assetsResult] = await Promise.all([
    fetchJourneys(input.companyId, timeframe, includeFinance),
    fetchAssets(input.companyId),
  ]);

  const journeys = journeysResult.rows;
  const assetLookup = buildAssetLookup(assetsResult.rows);
  const journeyIds = journeys.map((journey: any) => journey.id).filter(Boolean);
  const truckIds = uniqueStrings(
    journeys.map((journey: any) => cleanTruckLabel(journey.truck)).filter(Boolean)
  );

  const [
    assignmentsResult,
    distanceRowsResult,
    telemetryResult,
    eventsResult,
    fuelAllocationsResult,
    fuelResult,
    expensesResult,
  ] = await Promise.all([
    fetchDriverAssignments(input.companyId, timeframe),
    fetchProviderDistanceRows(input.companyId, timeframe, truckIds),
    fetchTelemetryRows(input.companyId, timeframe, truckIds),
    fetchTelemetryEventRows(input.companyId, timeframe, truckIds),
    includeFinance ? fetchFuelAllocations(input.companyId, journeyIds) : emptyResult<any>(),
    includeFinance ? fetchFuelLogs(input.companyId, journeyIds) : emptyResult<any>(),
    includeFinance ? fetchExpenses(input.companyId, journeyIds) : emptyResult<any>(),
  ]);

  const distanceByTruck = groupByTruckKey(distanceRowsResult.rows, "truck_id");
  const telemetryByTruck = groupByTruckKey(telemetryResult.rows, "truck_id");
  const eventsByTruck = groupByTruckKey(eventsResult.rows, "truck_id");
  const fuelAllocationsByJourney = groupBy(fuelAllocationsResult.rows, "journey_id");
  const fuelAllocationIssueSummaries =
    (fuelAllocationsResult as FuelAllocationQueryResult).issue_summaries || {};
  const fuelByJourney = groupBy(fuelResult.rows, "journey_id");
  const expensesByJourney = groupBy(expensesResult.rows, "journey_id");

  const tripRecords = journeys.map((journey: any) => {
    const tripWindow = resolveTripWindow(journey, timeframe);
    const asset = findJourneyAsset(journey, assetLookup);
    const truckKey = normalizeVehicleKey(journey.truck || asset?.truck_id || asset?.registration);
    const tripLocalDay = formatLocalDateInZone(tripWindow.start_utc, timeframe.time_zone);
    const distanceRows = filterDistanceRowsForTrip(
      distanceByTruck.get(truckKey) || [],
      tripWindow,
      tripLocalDay
    );
    const telemetryRows = filterTimedRowsForTrip(
      telemetryByTruck.get(truckKey) || [],
      tripWindow,
      "recorded_at"
    );
    const eventRows = filterTimedRowsForTrip(
      eventsByTruck.get(truckKey) || [],
      tripWindow,
      "created_at",
      "started_at"
    );
    const linkedFuelLogs = fuelByJourney.get(journey.id) || [];
    const linkedFuelAllocations = fuelAllocationsByJourney.get(journey.id) || [];
    const linkedExpenses = expensesByJourney.get(journey.id) || [];
    const driverEvidence = resolveDriverEvidence(
      journey,
      asset,
      assignmentsResult.rows,
      tripWindow
    );
    const assetEvidence = buildAssetEvidence(journey, asset);
    const movementEvidence = buildMovementEvidence(distanceRows, telemetryRows);
    const delayEvidence = buildDelayEvidence(eventRows, telemetryRows);
    const financeEvidence = buildFinanceEvidence(
      journey,
      linkedFuelAllocations,
      linkedFuelLogs,
      linkedExpenses,
      includeFinance,
      fuelAllocationIssueSummaries
    );
    const missingData = buildTripMissingData({
      journey,
      assetEvidence,
      driverEvidence,
      movementEvidence,
      financeEvidence,
      includeFinance,
    });
    const profitability = buildProfitabilityReadiness(
      financeEvidence,
      movementEvidence,
      missingData,
      includeFinance
    );
    const stale = buildStaleTrackingEvidence(asset);

    return {
      trip_identity: buildTripIdentity(journey, tripWindow),
      asset_evidence: assetEvidence,
      driver_evidence: driverEvidence,
      movement_evidence: movementEvidence,
      delay_evidence: delayEvidence,
      stale_tracking: stale,
      finance_evidence: financeEvidence,
      profitability_readiness: profitability,
      management_flags: buildManagementFlags({
        financeEvidence,
        movementEvidence,
        delayEvidence,
        driverEvidence,
        assetEvidence,
        stale,
        profitability,
        missingData,
        includeFinance,
      }),
      missing_data: missingData,
    };
  });

  return {
    timeframe,
    generated_at: new Date().toISOString(),
    data_sources: {
      journeys: sourceStatus(journeysResult),
      fleet_assets: sourceStatus(assetsResult),
      asset_driver_assignments: sourceStatus(assignmentsResult),
      provider_trip_summaries: sourceStatus(distanceRowsResult),
      telemetry_logs: sourceStatus(telemetryResult),
      telemetry_events: sourceStatus(eventsResult),
      fuel_allocations: includeFinance
        ? sourceStatus(fuelAllocationsResult)
        : hiddenSourceStatus(),
      fuel_logs: includeFinance ? sourceStatus(fuelResult) : hiddenSourceStatus(),
      expenses: includeFinance ? sourceStatus(expensesResult) : hiddenSourceStatus(),
    },
    empty_state: buildTripEmptyState(journeysResult, timeframe),
    summary: buildTripSummary(tripRecords),
    evidence_source_summary: buildEvidenceSourceSummary(tripRecords),
    missing_data_summary: buildMissingDataSummary(tripRecords),
    role_visibility: {
      finance_values_visible: includeFinance,
      notes: includeFinance
        ? []
        : [
            "Finance amounts, revenue, expenses, contribution, and profitability readiness are hidden for this role.",
          ],
    },
    trips: tripRecords,
  };
}

function normalizeRange(value: any): TripIntelligenceRange {
  const text = String(value || "").trim().toLowerCase();
  if (["today", "same_day", "same-day"].includes(text)) return "today";
  if (["7d", "7day", "7days", "week", "last_7_days", "last-7-days"].includes(text)) {
    return "7d";
  }
  return "yesterday";
}

async function fetchJourneys(
  companyId: string,
  timeframe: TripTimeframe,
  includeFinance: boolean
): Promise<QueryResult<any>> {
  try {
    const { data, error } = await supabaseAdmin
      .from("journeys")
      .select(includeFinance ? FINANCE_JOURNEY_SELECT : OPERATIONAL_JOURNEY_SELECT)
      .eq("company_id", companyId)
      .eq("is_demo", false)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (error) {
      if (isMissingSchemaError(error)) return { rows: [], missing: true, error: safeError(error) };
      throw error;
    }

    const rows = (data || []).filter((journey: any) => {
      return journeyOverlapsTimeframe(journey, timeframe);
    });

    return { rows };
  } catch (err: any) {
    if (isMissingSchemaError(err)) return { rows: [], missing: true, error: safeError(err) };
    throw err;
  }
}

async function fetchAssets(companyId: string): Promise<QueryResult<any>> {
  try {
    const { data, error } = await supabaseAdmin
      .from("fleet_assets")
      .select(ASSET_SELECT)
      .eq("company_id", companyId)
      .eq("status", "active")
      .limit(3000);

    if (error) {
      if (isMissingColumnError(error, "telemetry_capabilities")) {
        return fetchAssetsWithoutTelemetryCapabilities(companyId);
      }
      if (isMissingSchemaError(error)) return { rows: [], missing: true, error: safeError(error) };
      throw error;
    }

    return { rows: data || [] };
  } catch (err: any) {
    if (isMissingSchemaError(err)) return { rows: [], missing: true, error: safeError(err) };
    throw err;
  }
}

async function fetchAssetsWithoutTelemetryCapabilities(companyId: string) {
  const { data, error } = await supabaseAdmin
    .from("fleet_assets")
    .select(
      "id, company_id, provider_id, truck_id, registration, provider_name, status, last_seen_at, provider_location_label, asset_category, billing_status, intelligence_enabled, first_seen_at"
    )
    .eq("company_id", companyId)
    .eq("status", "active")
    .limit(3000);

  if (error) {
    if (isMissingSchemaError(error)) return { rows: [], missing: true, error: safeError(error) };
    throw error;
  }

  return { rows: data || [] };
}

async function fetchDriverAssignments(
  companyId: string,
  timeframe: TripTimeframe
): Promise<QueryResult<any>> {
  try {
    const { data, error } = await supabaseAdmin
      .from("asset_driver_assignments")
      .select("id, asset_id, truck_id, driver_id, driver_name, journey_id, assigned_from, assigned_to, assignment_status")
      .eq("company_id", companyId)
      .limit(4000);

    if (error) {
      if (isMissingSchemaError(error)) return { rows: [], missing: true, error: safeError(error) };
      throw error;
    }

    const rows = (data || []).filter((assignment: any) =>
      assignmentOverlapsWindow(assignment, {
        start_utc: timeframe.start_utc,
        end_utc: timeframe.end_utc,
      })
    );
    return { rows };
  } catch (err: any) {
    if (isMissingSchemaError(err)) return { rows: [], missing: true, error: safeError(err) };
    throw err;
  }
}

async function fetchProviderDistanceRows(
  companyId: string,
  timeframe: TripTimeframe,
  truckIds: string[]
): Promise<QueryResult<any>> {
  try {
    let query = supabaseAdmin
      .from("provider_trip_summaries")
      .select(
        "id, asset_id, truck_id, provider_trip_key, report_date, start_time, end_time, provider_mileage_km, odometer_delta_km, distance_source, distance_quality, motion_duration_minutes"
      )
      .eq("company_id", companyId)
      .gte("report_date", timeframe.local_start_date)
      .lte("report_date", timeframe.local_end_date)
      .limit(5000);

    if (truckIds.length) query = query.in("truck_id", truckIds);

    const { data, error } = await query;
    if (error) {
      if (isMissingColumnError(error, "motion_duration_minutes")) {
        return fetchProviderDistanceRowsWithoutMotion(companyId, timeframe, truckIds);
      }
      if (isMissingSchemaError(error)) return { rows: [], missing: true, error: safeError(error) };
      throw error;
    }

    return { rows: data || [] };
  } catch (err: any) {
    if (isMissingSchemaError(err)) return { rows: [], missing: true, error: safeError(err) };
    throw err;
  }
}

async function fetchProviderDistanceRowsWithoutMotion(
  companyId: string,
  timeframe: TripTimeframe,
  truckIds: string[]
): Promise<QueryResult<any>> {
  let query = supabaseAdmin
    .from("provider_trip_summaries")
    .select(
      "id, asset_id, truck_id, provider_trip_key, report_date, start_time, end_time, provider_mileage_km, odometer_delta_km, distance_source, distance_quality"
    )
    .eq("company_id", companyId)
    .gte("report_date", timeframe.local_start_date)
    .lte("report_date", timeframe.local_end_date)
    .limit(5000);

  if (truckIds.length) query = query.in("truck_id", truckIds);

  const { data, error } = await query;
  if (error) {
    if (isMissingSchemaError(error)) return { rows: [], missing: true, error: safeError(error) };
    throw error;
  }
  return { rows: data || [] };
}

async function fetchTelemetryRows(
  companyId: string,
  timeframe: TripTimeframe,
  truckIds: string[]
): Promise<QueryResult<any>> {
  if (!truckIds.length) return { rows: [] };

  try {
    const { data, error } = await supabaseAdmin
      .from("telemetry_logs")
      .select("truck_id, recorded_at, latitude, longitude, speed")
      .eq("company_id", companyId)
      .in("truck_id", truckIds)
      .gte("recorded_at", timeframe.start_utc)
      .lt("recorded_at", timeframe.end_utc)
      .order("recorded_at", { ascending: true })
      .limit(50000);

    if (error) {
      if (isMissingSchemaError(error)) return { rows: [], missing: true, error: safeError(error) };
      throw error;
    }
    return { rows: data || [] };
  } catch (err: any) {
    if (isMissingSchemaError(err)) return { rows: [], missing: true, error: safeError(err) };
    throw err;
  }
}

async function fetchTelemetryEventRows(
  companyId: string,
  timeframe: TripTimeframe,
  truckIds: string[]
): Promise<QueryResult<any>> {
  if (!truckIds.length) return { rows: [] };

  try {
    const { data, error } = await supabaseAdmin
      .from("telemetry_events")
      .select("id, truck_id, event_type, severity, created_at, started_at, context_label")
      .eq("company_id", companyId)
      .in("truck_id", truckIds)
      .gte("created_at", timeframe.start_utc)
      .lt("created_at", timeframe.end_utc)
      .order("created_at", { ascending: true })
      .limit(10000);

    if (error) {
      if (isMissingSchemaError(error)) return { rows: [], missing: true, error: safeError(error) };
      throw error;
    }
    return { rows: data || [] };
  } catch (err: any) {
    if (isMissingSchemaError(err)) return { rows: [], missing: true, error: safeError(err) };
    throw err;
  }
}

async function fetchFuelLogs(companyId: string, journeyIds: string[]): Promise<QueryResult<any>> {
  if (!journeyIds.length) return { rows: [] };

  try {
    const { data, error } = await supabaseAdmin
      .from("fuel_logs")
      .select("id, journey_id, truck_text, liters, total_cost, fuel_source, allocation_status, created_at")
      .eq("company_id", companyId)
      .in("journey_id", journeyIds)
      .limit(5000);

    if (error) {
      if (isMissingSchemaError(error)) return { rows: [], missing: true, error: safeError(error) };
      throw error;
    }
    return { rows: data || [] };
  } catch (err: any) {
    if (isMissingSchemaError(err)) return { rows: [], missing: true, error: safeError(err) };
    throw err;
  }
}

async function fetchFuelAllocations(
  companyId: string,
  journeyIds: string[]
): Promise<FuelAllocationQueryResult> {
  if (!journeyIds.length) return { rows: [], issue_summaries: {} };

  try {
    const { data, error } = await supabaseAdmin
      .from("fuel_allocations")
      .select(
        "id, company_id, fuel_log_id, journey_id, asset_id, truck_text, allocated_liters, allocated_cost, allocation_status, allocation_basis, notes, created_at"
      )
      .eq("company_id", companyId)
      .in("journey_id", journeyIds)
      .limit(5000);

    if (error) {
      if (isFuelAllocationSchemaMissing(error) || isMissingSchemaError(error)) {
        return { rows: [], missing: true, error: safeError(error), issue_summaries: {} };
      }
      throw error;
    }

    const rows = data || [];
    const fuelLogIds = uniqueStrings(
      rows.map((row: any) => String(row.fuel_log_id || "")).filter(Boolean)
    );
    if (!fuelLogIds.length) return { rows, issue_summaries: {} };

    const [fuelLogResult, allocationResult] = await Promise.all([
      supabaseAdmin
        .from("fuel_logs")
        .select("id, liters, total_cost, truck_text, journey_id, allocation_status, created_at")
        .eq("company_id", companyId)
        .in("id", fuelLogIds),
      supabaseAdmin
        .from("fuel_allocations")
        .select(
          "id, fuel_log_id, journey_id, allocated_liters, allocated_cost, allocation_status, allocation_basis"
        )
        .eq("company_id", companyId)
        .in("fuel_log_id", fuelLogIds),
    ]);

    if (fuelLogResult.error) throw fuelLogResult.error;
    if (allocationResult.error) throw allocationResult.error;

    const allAllocationsByFuelLog = groupBy(allocationResult.data || [], "fuel_log_id");
    const issueSummaries: Record<string, FuelIssueAllocationSummary> = {};
    for (const fuelLog of fuelLogResult.data || []) {
      if (!fuelLog.id) continue;
      issueSummaries[fuelLog.id] = summarizeFuelIssue(
        fuelLog,
        allAllocationsByFuelLog.get(fuelLog.id) || []
      );
    }

    return { rows, issue_summaries: issueSummaries };
  } catch (err: any) {
    if (isFuelAllocationSchemaMissing(err) || isMissingSchemaError(err)) {
      return { rows: [], missing: true, error: safeError(err), issue_summaries: {} };
    }
    throw err;
  }
}

async function fetchExpenses(companyId: string, journeyIds: string[]): Promise<QueryResult<any>> {
  if (!journeyIds.length) return { rows: [] };

  try {
    const { data, error } = await supabaseAdmin
      .from("expenses")
      .select("id, journey_id, truck, expense_type, amount, created_at")
      .eq("company_id", companyId)
      .in("journey_id", journeyIds)
      .limit(5000);

    if (error) {
      if (isMissingSchemaError(error)) return { rows: [], missing: true, error: safeError(error) };
      throw error;
    }
    return { rows: data || [] };
  } catch (err: any) {
    if (isMissingSchemaError(err)) return { rows: [], missing: true, error: safeError(err) };
    throw err;
  }
}

function buildTripIdentity(journey: any, window: any) {
  const client = cleanText(journey.client_name);
  const from = cleanText(journey.from_location);
  const to = cleanText(journey.to_location);
  const billingQuantity = numericOrNull(
    journey.billing_quantity ?? journey.offloaded_quantity ?? journey.loaded_quantity
  );

  return {
    journey_id: journey.id,
    internal_trip_id: cleanText(journey.internal_trip_id),
    reference: cleanText(journey.internal_trip_id) || journey.id,
    status: cleanText(journey.status) || "unknown",
    company_id: journey.company_id || null,
    client_name: client,
    truck: cleanTruckLabel(journey.truck),
    route: {
      from_location: from,
      to_location: to,
      route_name: cleanText(journey.route),
      route_label: from || to ? `${from || "Unknown origin"} to ${to || "Unknown destination"}` : null,
    },
    cargo: {
      billing_quantity: billingQuantity,
      billing_unit: cleanText(journey.billing_unit),
      loaded_quantity: numericOrNull(journey.loaded_quantity),
      offloaded_quantity: numericOrNull(journey.offloaded_quantity),
    },
    expected_fuel_liters: numericOrNull(journey.expected_fuel_liters),
    date_window: {
      start_utc: window.start_utc,
      end_utc: window.end_utc,
      basis: window.basis,
      evidence_label:
        window.evidence_label ||
        "journey start/end timestamps when available; created_at is used only as a fallback",
    },
    created_at: journey.created_at || null,
    start_time: journey.start_time || null,
    end_time: journey.end_time || null,
  };
}

function buildAssetEvidence(journey: any, asset: any | null) {
  if (!asset) {
    return {
      linked: false,
      asset_id: null,
      provider_asset_label: null,
      internal_match_key: normalizeVehicleKey(journey.truck || "") || null,
      provider_name: null,
      enabled_for_intelligence: false,
      evidence_label: "unavailable",
      missing_asset_link: true,
    };
  }

  const identity = readStoredVehicleIdentityContext(asset);
  const providerLabel =
    identity.provider_label || asset.registration || asset.truck_id || journey.truck || null;
  return {
    linked: true,
    asset_id: asset.id || null,
    provider_asset_label: providerLabel,
    internal_match_key:
      identity.canonical_key ||
      normalizeVehicleKey(identity.canonical_truck_plate || asset.truck_id || asset.registration),
    provider_name: asset.provider_name || null,
    enabled_for_intelligence: Boolean(asset.intelligence_enabled),
    intelligence_status: asset.intelligence_enabled ? "enabled" : "not_enabled",
    asset_category: asset.asset_category || null,
    telemetry_capability: asset.telemetry_capability || "UNKNOWN",
    evidence_label: "fleet asset matched by truck/provider identity",
    missing_asset_link: false,
  };
}

function resolveDriverEvidence(
  journey: any,
  asset: any | null,
  assignments: any[],
  tripWindow: any
): any {
  const journeyDriver = cleanText(journey.driver);
  if (journeyDriver || journey.driver_id) {
    return {
      driver_name: journeyDriver,
      driver_id: journey.driver_id || null,
      evidence_label: "trip-linked",
      linked: true,
      missing_driver_link: false,
    };
  }

  const truckKey = normalizeVehicleKey(journey.truck || asset?.truck_id || asset?.registration);
  const assignment = assignments.find((candidate: any) => {
    if (!assignmentOverlapsWindow(candidate, tripWindow)) return false;
    if (candidate.journey_id && candidate.journey_id === journey.id) return true;
    if (asset?.id && candidate.asset_id === asset.id) return true;
    return truckKey && normalizeVehicleKey(candidate.truck_id) === truckKey;
  });

  if (assignment?.driver_name || assignment?.driver_id) {
    return {
      driver_name: cleanText(assignment.driver_name),
      driver_id: assignment.driver_id || null,
      evidence_label: "standing-assignment",
      linked: true,
      missing_driver_link: false,
      assignment_id: assignment.id || null,
    };
  }

  return {
    driver_name: null,
    driver_id: null,
    evidence_label: "unavailable",
    linked: false,
    missing_driver_link: true,
  };
}

function buildMovementEvidence(distanceRows: any[], telemetryRows: any[]) {
  const providerDistanceKm = roundMetric(
    distanceRows.reduce((sum, row) => sum + effectiveDistanceKm(row), 0)
  );
  if (providerDistanceKm > 0) {
    const motionMinutes = distanceRows.reduce(
      (sum, row) => sum + Number(row.motion_duration_minutes || 0),
      0
    );
    return {
      distance_km: providerDistanceKm,
      distance_source: "provider-reported",
      distance_evidence_basis: "provider trip/report summary matched by truck and date/window",
      provider_summary_count: distanceRows.length,
      telemetry_point_count: telemetryRows.length,
      movement_minutes: motionMinutes > 0 ? Math.round(motionMinutes) : null,
      stopped_minutes: null,
      gps_estimated_distance_km: null,
      missing_distance: false,
    };
  }

  const gps = calculateGpsDistance(telemetryRows);
  if (gps.distance_km > 0) {
    return {
      distance_km: gps.distance_km,
      distance_source: "gps-estimated",
      distance_evidence_basis: "GPS point intervals matched by truck and trip window",
      provider_summary_count: 0,
      telemetry_point_count: gps.point_count,
      movement_minutes: gps.moving_minutes,
      stopped_minutes: gps.stopped_minutes,
      gps_estimated_distance_km: gps.distance_km,
      skipped_invalid_points: gps.skipped_invalid_points,
      skipped_unrealistic_segments: gps.skipped_unrealistic_segments,
      missing_distance: false,
    };
  }

  return {
    distance_km: null,
    distance_source: "unavailable",
    distance_evidence_basis: "not enough provider distance or GPS point evidence",
    provider_summary_count: distanceRows.length,
    telemetry_point_count: telemetryRows.length,
    movement_minutes: null,
    stopped_minutes: gps.stopped_minutes || null,
    gps_estimated_distance_km: null,
    skipped_invalid_points: gps.skipped_invalid_points,
    skipped_unrealistic_segments: gps.skipped_unrealistic_segments,
    missing_distance: true,
  };
}

function buildDelayEvidence(eventRows: any[], telemetryRows: any[]) {
  const idleRows = eventRows.filter((row) => isIdleEvent(row.event_type));
  const highSeverityRows = eventRows.filter(
    (row) => String(row.severity || "").toLowerCase() === "high"
  );
  const gps = calculateGpsDistance(telemetryRows);

  return {
    delay_evidence_present: idleRows.length > 0 || highSeverityRows.length > 0,
    idle_marker_count: idleRows.length,
    event_count: eventRows.length,
    high_severity_event_count: highSeverityRows.length,
    first_idle_marker_at: firstTimestamp(idleRows),
    last_idle_marker_at: lastTimestamp(idleRows),
    stopped_minutes: gps.stopped_minutes || null,
    evidence_label:
      "event-derived alert markers and GPS-estimated stopped intervals; not engine-on idling proof",
    engine_on_idling_confirmed: false,
  };
}

function buildFinanceEvidence(
  journey: any,
  fuelAllocations: any[],
  fuelLogs: any[],
  expenses: any[],
  includeFinance: boolean,
  fuelIssueSummaries: Record<string, FuelIssueAllocationSummary> = {}
) {
  if (!includeFinance) {
    return {
      visible: false,
      revenue_kes: null,
      linked_fuel_cost_kes: null,
      linked_fuel_liters: null,
      linked_expense_cost_kes: null,
      linked_variable_costs_kes: null,
      linked_fuel_log_count: null,
      linked_fuel_allocation_count: null,
      linked_expense_count: null,
      fuel_cost_source: null,
      fuel_allocation_notes: [],
      evidence_label: "finance hidden by role",
    };
  }

  const revenue = roundMoney(Number(journey.revenue_kes || 0));
  const activeFuelAllocations = fuelAllocations.filter(isTripFuelAllocation);
  const allocatedFuel = summarizeAllocationsForJourney(activeFuelAllocations);
  const hasFuelAllocations = activeFuelAllocations.length > 0;
  const legacyFuelCost = roundMoney(
    fuelLogs.reduce((sum, row) => sum + Number(row.total_cost || 0), 0)
  );
  const legacyFuelLiters = roundMetric(
    fuelLogs.reduce((sum, row) => sum + Number(row.liters || 0), 0)
  );
  const fuelCost = hasFuelAllocations ? allocatedFuel.allocated_cost : legacyFuelCost;
  const fuelLiters = hasFuelAllocations ? allocatedFuel.allocated_liters : legacyFuelLiters;
  const expenseCost = roundMoney(
    expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0)
  );
  const rateAmount = numericOrNull(journey.rate_amount);
  const fuelLogIds = uniqueStrings(
    (hasFuelAllocations ? activeFuelAllocations : fuelLogs)
      .map((row: any) => String(row.fuel_log_id || row.id || ""))
      .filter(Boolean)
  );
  const fuelAllocationNotes: string[] = [];

  if (hasFuelAllocations) {
    for (const fuelLogId of fuelLogIds) {
      const issueSummary = fuelIssueSummaries[fuelLogId];
      if (!issueSummary) continue;
      if (issueSummary.remaining_liters > 0 || issueSummary.remaining_cost > 0) {
        fuelAllocationNotes.push("fuel issue partially allocated");
      }
      if (issueSummary.carried_forward_liters > 0 || issueSummary.carried_forward_cost > 0) {
        fuelAllocationNotes.push("carried-forward fuel present");
      }
      if (issueSummary.over_allocated) {
        fuelAllocationNotes.push("fuel issue allocation needs review");
      }
    }
    if (fuelCost <= 0 && fuelLiters > 0) {
      fuelAllocationNotes.push("fuel allocation cost unavailable");
    }
  } else if (fuelLogs.length > 0) {
    fuelAllocationNotes.push("legacy fuel link used");
  } else {
    fuelAllocationNotes.push("fuel allocation missing");
  }

  const fuelCostSource = hasFuelAllocations
    ? "fuel_allocations"
    : fuelLogs.length > 0
      ? "legacy_journey_link"
      : "missing";

  return {
    visible: true,
    revenue_kes: revenue,
    revenue_status: cleanText(journey.revenue_status) || (revenue > 0 ? "available" : "missing"),
    rate_type: cleanText(journey.rate_type),
    rate_amount: rateAmount,
    rate_currency: cleanText(journey.rate_currency),
    billing_quantity: numericOrNull(journey.billing_quantity),
    billing_unit: cleanText(journey.billing_unit),
    linked_fuel_cost_kes: fuelCost,
    linked_fuel_liters: fuelLiters,
    linked_expense_cost_kes: expenseCost,
    linked_variable_costs_kes: roundMoney(fuelCost + expenseCost),
    linked_fuel_log_count: fuelLogIds.length,
    linked_fuel_allocation_count: activeFuelAllocations.length,
    linked_expense_count: expenses.length,
    fuel_cost_source: fuelCostSource,
    fuel_allocation_notes: uniqueStrings(fuelAllocationNotes),
    evidence_label: hasFuelAllocations
      ? "journey revenue, fuel_allocations assigned to this trip, and linked expenses"
      : fuelLogs.length > 0
        ? "journey revenue, legacy fuel_logs.journey_id fallback, and linked expenses"
        : "journey revenue and linked expenses; no fuel allocation evidence",
    unlinked_costs_used_for_profit: false,
  };
}

function buildProfitabilityReadiness(
  finance: any,
  movement: any,
  missingData: string[],
  includeFinance: boolean
) {
  if (!includeFinance || finance.visible === false) {
    return {
      visible: false,
      status: null,
      contribution_kes: null,
      contribution_margin_percent: null,
      contribution_per_km: null,
      contribution_per_tonne: null,
      missing: ["finance visibility for this role"],
      note: "Profitability values are hidden for this role.",
    };
  }

  const revenue = Number(finance.revenue_kes || 0);
  const variableCosts = Number(finance.linked_variable_costs_kes || 0);
  const hasRevenue = revenue > 0;
  const hasLinkedCostRecords =
    Number(finance.linked_fuel_log_count || 0) + Number(finance.linked_expense_count || 0) > 0;
  const hasLinkedCostEvidence = variableCosts > 0;
  const status: ProfitabilityReadiness =
    hasRevenue && hasLinkedCostEvidence
      ? "calculable"
      : hasRevenue || hasLinkedCostRecords || Number(movement.distance_km || 0) > 0
        ? "partially_linked"
        : "not_enough_linked_data";

  if (status !== "calculable") {
    return {
      visible: true,
      status,
      contribution_kes: null,
      contribution_margin_percent: null,
      contribution_per_km: null,
      contribution_per_tonne: null,
      missing: uniqueStrings(missingData),
    };
  }

  const contribution = roundMoney(revenue - variableCosts);
  const distanceKm = Number(movement.distance_km || 0);
  const billingQuantity = Number(finance.billing_quantity || 0);

  return {
    visible: true,
    status,
    contribution_kes: contribution,
    contribution_margin_percent:
      revenue > 0 ? roundMetric((contribution / revenue) * 100) : null,
    contribution_per_km:
      distanceKm > 0 ? roundMoney(contribution / distanceKm) : null,
    contribution_per_tonne:
      billingQuantity > 0 ? roundMoney(contribution / billingQuantity) : null,
    missing:
      distanceKm > 0
        ? []
        : ["distance evidence for per-km contribution"],
  };
}

function buildTripMissingData(input: {
  journey: any;
  assetEvidence: any;
  driverEvidence: any;
  movementEvidence: any;
  financeEvidence: any;
  includeFinance: boolean;
}) {
  const missing: string[] = [];
  const hasClient = Boolean(cleanText(input.journey.client_name));
  const hasRoute = Boolean(cleanText(input.journey.from_location) && cleanText(input.journey.to_location));

  if (!input.assetEvidence.linked) missing.push("missing asset link");
  if (!input.driverEvidence.linked) missing.push("missing driver link");
  if (!hasClient || !hasRoute) missing.push("missing client/route");
  if (input.movementEvidence.missing_distance) missing.push("missing distance");

  if (input.includeFinance && input.financeEvidence.visible) {
    if (Number(input.financeEvidence.revenue_kes || 0) <= 0) missing.push("missing revenue");
    if (input.financeEvidence.fuel_cost_source === "missing") {
      missing.push("fuel allocation missing");
    } else if (input.financeEvidence.fuel_cost_source === "legacy_journey_link") {
      missing.push("legacy fuel link used");
    } else if (Number(input.financeEvidence.linked_fuel_cost_kes || 0) <= 0) {
      missing.push("fuel allocation cost unavailable");
    }
    if (Number(input.financeEvidence.linked_expense_count || 0) === 0) {
      missing.push("missing linked expenses");
    }
    if (Number(input.financeEvidence.linked_variable_costs_kes || 0) <= 0) {
      missing.push("missing linked cost evidence");
    }
  }

  return uniqueStrings(missing);
}

function buildManagementFlags(input: any) {
  const finance = input.financeEvidence || {};
  const movement = input.movementEvidence || {};
  const flags: string[] = [];
  const hasRevenue = input.includeFinance && Number(finance.revenue_kes || 0) > 0;
  const hasCosts =
    input.includeFinance && Number(finance.linked_variable_costs_kes || 0) > 0;
  const hasMovement = Number(movement.distance_km || 0) > 0;

  if (input.profitability?.status === "calculable") flags.push("ready_for_profit_review");
  if (input.includeFinance && hasMovement && !hasRevenue) flags.push("movement_without_revenue");
  if (input.includeFinance && hasRevenue && !hasMovement) {
    flags.push("revenue_without_movement_evidence");
  }
  if (input.includeFinance && hasCosts && !hasRevenue) flags.push("costs_without_revenue");
  if (input.stale?.stale) flags.push("stale_tracking");
  if (!input.driverEvidence?.linked) flags.push("missing_driver");
  if (input.missingData.includes("missing client/route")) flags.push("missing_client_or_route");
  if (input.includeFinance && input.profitability?.status !== "calculable") {
    flags.push("needs_finance_linking");
  }
  if (movement.distance_source !== "provider-reported") flags.push("needs_provider_distance");
  if (input.delayEvidence?.delay_evidence_present) flags.push("delay_evidence_present");
  if (input.profitability?.status === "not_enough_linked_data") {
    flags.push("not_enough_linked_data");
  }

  return uniqueStrings(flags);
}

function buildStaleTrackingEvidence(asset: any | null) {
  if (!asset?.last_seen_at) {
    return {
      stale: true,
      timestamp_quality: "missing",
      minutes_since_last_seen: null,
      evidence_label: "fleet asset last_seen_at unavailable",
    };
  }

  const quality = classifyProviderTimestampQuality(asset.last_seen_at);
  if (quality.status === "future_suspicious" || quality.status === "invalid") {
    return {
      stale: true,
      timestamp_quality: quality.status,
      minutes_since_last_seen: null,
      evidence_label: "provider timestamp needs review",
    };
  }

  if (quality.status === "slightly_future_clock_skew") {
    return {
      stale: false,
      timestamp_quality: quality.status,
      minutes_since_last_seen: 0,
      evidence_label: "provider timestamp appears very recent but slightly ahead of server clock",
    };
  }

  const timestampMs = quality.timestamp_ms ?? new Date(asset.last_seen_at).getTime();
  const minutes = Number.isFinite(timestampMs)
    ? Math.max(0, Math.round((Date.now() - timestampMs) / 60000))
    : null;
  return {
    stale: minutes === null ? true : minutes > STALE_TRACKING_THRESHOLD_MINUTES,
    timestamp_quality: quality.status,
    minutes_since_last_seen: minutes,
    evidence_label: "fleet asset last_seen_at from provider sync",
  };
}

function buildTripSummary(trips: any[]) {
  const readinessCounts = countBy(
    trips
      .map((trip) => trip.profitability_readiness?.status)
      .filter(Boolean)
  );
  return {
    trip_count: trips.length,
    ready_for_profit_review_count: trips.filter((trip) =>
      trip.management_flags.includes("ready_for_profit_review")
    ).length,
    partially_linked_count: readinessCounts.partially_linked || 0,
    not_enough_linked_data_count: readinessCounts.not_enough_linked_data || 0,
    movement_without_revenue_count: trips.filter((trip) =>
      trip.management_flags.includes("movement_without_revenue")
    ).length,
    stale_tracking_count: trips.filter((trip) =>
      trip.management_flags.includes("stale_tracking")
    ).length,
    missing_driver_count: trips.filter((trip) =>
      trip.management_flags.includes("missing_driver")
    ).length,
    delay_evidence_count: trips.filter((trip) =>
      trip.management_flags.includes("delay_evidence_present")
    ).length,
  };
}

function buildEvidenceSourceSummary(trips: any[]) {
  return {
    distance_sources: countBy(trips.map((trip) => trip.movement_evidence.distance_source)),
    driver_sources: countBy(trips.map((trip) => trip.driver_evidence.evidence_label)),
    finance_sources: countBy(trips.map((trip) => trip.finance_evidence.evidence_label)),
    trips_with_delay_evidence: trips.filter((trip) => trip.delay_evidence.delay_evidence_present).length,
  };
}

function buildMissingDataSummary(trips: any[]) {
  const counts: Record<string, number> = {};
  for (const trip of trips) {
    for (const item of trip.missing_data || []) {
      counts[item] = (counts[item] || 0) + 1;
    }
  }
  return counts;
}

function buildAssetLookup(assets: any[]) {
  const byKey = new Map<string, any>();
  const byId = new Map<string, any>();
  for (const asset of assets) {
    if (asset.id && !byId.has(asset.id)) byId.set(asset.id, asset);

    const identity = readStoredVehicleIdentityContext(asset);
    const keys = [
      asset.truck_id,
      asset.registration,
      identity.provider_label,
      identity.canonical_truck_plate,
      identity.canonical_key,
    ]
      .map((value) => normalizeVehicleKey(value || ""))
      .filter((key) => key.length >= 4);

    for (const key of keys) {
      if (!byKey.has(key)) byKey.set(key, asset);
    }
  }
  return { byKey, byId };
}

function findJourneyAsset(journey: any, lookup: ReturnType<typeof buildAssetLookup>) {
  if (journey.asset_id && lookup.byId.has(journey.asset_id)) {
    return lookup.byId.get(journey.asset_id) || null;
  }
  const key = normalizeVehicleKey(journey.truck || "");
  return key ? lookup.byKey.get(key) || null : null;
}

function resolveTripWindow(journey: any, timeframe: TripTimeframe) {
  const sourceWindow = resolveJourneySourceWindow(journey, timeframe);
  const timeframeStartMs = timestampMs(timeframe.start_utc) || 0;
  const timeframeEndMs = timestampMs(timeframe.end_utc) || timeframeStartMs;
  let startMs = Math.max(sourceWindow.start_ms, timeframeStartMs);
  const status = String(journey.status || "").toLowerCase();

  if (
    status === "active" &&
    !sourceWindow.has_explicit_start &&
    !sourceWindow.has_explicit_end
  ) {
    startMs = Math.max(startMs, sourceWindow.end_ms - MAX_INFERRED_TRIP_WINDOW_MS);
  }

  const endMs = Math.max(
    startMs,
    Math.min(sourceWindow.end_ms, timeframeEndMs)
  );

  return {
    start_utc: new Date(startMs).toISOString(),
    end_utc: new Date(endMs).toISOString(),
    basis: sourceWindow.basis,
    evidence_label: sourceWindow.evidence_label,
  };
}

function journeyOverlapsTimeframe(journey: any, timeframe: TripTimeframe) {
  const sourceWindow = resolveJourneySourceWindow(journey, timeframe);
  const timeframeStartMs = timestampMs(timeframe.start_utc);
  const timeframeEndMs = timestampMs(timeframe.end_utc);

  if (!timeframeStartMs || !timeframeEndMs) return false;
  return sourceWindow.start_ms < timeframeEndMs && sourceWindow.end_ms >= timeframeStartMs;
}

function resolveJourneySourceWindow(journey: any, timeframe: TripTimeframe) {
  const timeframeStartMs = timestampMs(timeframe.start_utc) || Date.now();
  const timeframeEndMs = timestampMs(timeframe.end_utc) || timeframeStartMs;
  const explicitStartMs = timestampMs(journey.start_time, timeframe.time_zone);
  const explicitEndMs = timestampMs(journey.end_time, timeframe.time_zone);
  const createdMs = timestampMs(journey.created_at, timeframe.time_zone);
  const status = String(journey.status || "").toLowerCase();
  const hasExplicitStart = Boolean(explicitStartMs);
  const hasExplicitEnd = Boolean(explicitEndMs);
  const startMs = explicitStartMs || createdMs || timeframeStartMs;
  let endMs: number;
  let basis = "journey_created_fallback_window";
  let evidenceLabel =
    "created_at fallback; first-class journey start/end times are not available for this record";

  if (explicitStartMs || explicitEndMs) {
    basis = "journey_start_end_window";
    evidenceLabel = "journey start_time/end_time";
  }

  if (explicitEndMs && explicitEndMs >= startMs) {
    endMs = explicitEndMs;
  } else if (status === "active") {
    endMs = Math.min(Date.now(), timeframeEndMs);
    if (!explicitStartMs && !explicitEndMs) {
      basis = "active_journey_recent_window";
      evidenceLabel =
        "active journey without end_time; window capped to avoid overstating old open trips";
    }
  } else {
    endMs = startMs + MAX_INFERRED_TRIP_WINDOW_MS;
  }

  if (!Number.isFinite(endMs) || endMs < startMs) {
    endMs = startMs;
  }

  return {
    start_ms: startMs,
    end_ms: endMs,
    basis,
    evidence_label: evidenceLabel,
    has_explicit_start: hasExplicitStart,
    has_explicit_end: hasExplicitEnd,
  };
}

function filterDistanceRowsForTrip(rows: any[], tripWindow: any, tripLocalDay: string) {
  return rows.filter((row) => {
    if (row.start_time || row.end_time) {
      const start = row.start_time || row.end_time;
      const end = row.end_time || row.start_time;
      return windowsOverlap(
        { start_utc: start, end_utc: end },
        tripWindow
      );
    }
    return String(row.report_date || "") === tripLocalDay;
  });
}

function filterTimedRowsForTrip(
  rows: any[],
  tripWindow: any,
  primaryField: string,
  fallbackField?: string
) {
  const startMs = new Date(tripWindow.start_utc).getTime();
  const endMs = new Date(tripWindow.end_utc).getTime();
  return rows.filter((row) => {
    const value = row[primaryField] || (fallbackField ? row[fallbackField] : null);
    const quality = classifyProviderTimestampQuality(value);
    if (quality.status === "future_suspicious" || quality.status === "invalid") return false;
    const timestampMs =
      quality.status === "slightly_future_clock_skew"
        ? Date.now()
        : quality.timestamp_ms ?? new Date(value || 0).getTime();
    return Number.isFinite(timestampMs) && timestampMs >= startMs && timestampMs < endMs;
  });
}

function calculateGpsDistance(rows: any[]) {
  const sorted = rows
    .map(normalizeGpsPoint)
    .filter(
      (
        point
      ): point is {
        latitude: number;
        longitude: number;
        timestamp_ms: number;
        speed: number | null;
      } => Boolean(point)
    )
    .sort((a: any, b: any) => a.timestamp_ms - b.timestamp_ms);
  let distanceKm = 0;
  let movingMinutes = 0;
  let stoppedMinutes = 0;
  let skippedUnrealisticSegments = 0;

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const point = sorted[index];
    const elapsedMinutes = (point.timestamp_ms - previous.timestamp_ms) / 60000;
    if (!Number.isFinite(elapsedMinutes) || elapsedMinutes <= 0) continue;
    if (elapsedMinutes > MAX_SEGMENT_MINUTES) continue;

    const segmentKm = haversineDistanceKm(previous, point);
    const impliedSpeed = segmentKm / (elapsedMinutes / 60);
    if (impliedSpeed > MAX_IMPLIED_SPEED_KPH) {
      skippedUnrealisticSegments += 1;
      continue;
    }

    const movingBySpeed = Number(previous.speed || 0) > 5 || Number(point.speed || 0) > 5;
    const movingByDistance = segmentKm > 0.2;
    if (movingBySpeed || movingByDistance) {
      distanceKm += segmentKm;
      movingMinutes += elapsedMinutes;
    } else {
      stoppedMinutes += elapsedMinutes;
    }
  }

  return {
    distance_km: roundMetric(distanceKm),
    point_count: sorted.length,
    moving_minutes: Math.round(movingMinutes),
    stopped_minutes: Math.round(stoppedMinutes),
    skipped_invalid_points: Math.max(rows.length - sorted.length, 0),
    skipped_unrealistic_segments: skippedUnrealisticSegments,
  };
}

function normalizeGpsPoint(row: any) {
  const latitude = Number(row?.latitude);
  const longitude = Number(row?.longitude);
  const quality = classifyProviderTimestampQuality(row?.recorded_at);
  if (quality.status === "future_suspicious" || quality.status === "invalid") return null;
  const timestampMs =
    quality.status === "slightly_future_clock_skew"
      ? Date.now()
      : quality.timestamp_ms ?? new Date(row?.recorded_at || 0).getTime();

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (latitude === 0 && longitude === 0) return null;
  if (!Number.isFinite(timestampMs)) return null;

  return {
    latitude,
    longitude,
    timestamp_ms: timestampMs,
    speed: numericOrNull(row?.speed),
  };
}

function windowsOverlap(first: any, second: any) {
  const firstStart = new Date(first.start_utc || 0).getTime();
  const firstEnd = new Date(first.end_utc || first.start_utc || 0).getTime();
  const secondStart = new Date(second.start_utc || 0).getTime();
  const secondEnd = new Date(second.end_utc || second.start_utc || 0).getTime();
  if (![firstStart, firstEnd, secondStart, secondEnd].every(Number.isFinite)) return false;
  return firstStart < secondEnd && firstEnd >= secondStart;
}

function assignmentOverlapsWindow(assignment: any, window: any) {
  const status = String(assignment.assignment_status || "").toLowerCase();
  if (status && status !== "active") return false;
  const assignedFrom = new Date(assignment.assigned_from || 0).getTime();
  const assignedTo = assignment.assigned_to
    ? new Date(assignment.assigned_to).getTime()
    : Infinity;
  const start = new Date(window.start_utc || 0).getTime();
  const end = new Date(window.end_utc || 0).getTime();
  if (!Number.isFinite(assignedFrom) || !Number.isFinite(start) || !Number.isFinite(end)) {
    return false;
  }
  return assignedFrom < end && assignedTo >= start;
}

function effectiveDistanceKm(row: any) {
  const providerMileage = Number(row?.provider_mileage_km || 0);
  if (Number.isFinite(providerMileage) && providerMileage > 0) return providerMileage;
  const odometerDelta = Number(row?.odometer_delta_km || 0);
  if (Number.isFinite(odometerDelta) && odometerDelta > 0) return odometerDelta;
  return 0;
}

function isIdleEvent(value: any) {
  return /\b(idle|idling|excessive_idle|excessive idle|stationary|stopped)\b/i.test(
    String(value || "")
  );
}

function firstTimestamp(rows: any[]) {
  const values = rows.map(eventTimestampMs).filter(Number.isFinite);
  return values.length ? new Date(Math.min(...values)).toISOString() : null;
}

function lastTimestamp(rows: any[]) {
  const values = rows.map(eventTimestampMs).filter(Number.isFinite);
  return values.length ? new Date(Math.max(...values)).toISOString() : null;
}

function eventTimestampMs(row: any) {
  const value = row?.created_at || row?.started_at;
  const quality = classifyProviderTimestampQuality(value);
  if (quality.status === "future_suspicious" || quality.status === "invalid") return Number.NaN;
  if (quality.status === "slightly_future_clock_skew") return Date.now();
  return quality.timestamp_ms ?? new Date(value || 0).getTime();
}

function haversineDistanceKm(first: any, second: any) {
  const radiusKm = 6371;
  const deltaLat = toRadians(second.latitude - first.latitude);
  const deltaLon = toRadians(second.longitude - first.longitude);
  const lat1 = toRadians(first.latitude);
  const lat2 = toRadians(second.latitude);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function groupByTruckKey(rows: any[], field: string) {
  const map = new Map<string, any[]>();
  for (const row of rows) {
    const key = normalizeVehicleKey(row[field] || "");
    if (!key) continue;
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

function groupBy(rows: any[], field: string) {
  const map = new Map<string, any[]>();
  for (const row of rows) {
    const key = String(row[field] || "");
    if (!key) continue;
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

function sourceStatus(result: QueryResult<any>) {
  if (result.missing) return { status: "missing", row_count: 0, error: result.error || null };
  return { status: result.rows.length ? "available" : "empty", row_count: result.rows.length };
}

function buildTripEmptyState(result: QueryResult<any>, timeframe: TripTimeframe) {
  if (result.missing) {
    return {
      status: "journey_source_unavailable",
      message:
        "Trip records could not be read safely. Check the journey schema before using Trip Intelligence.",
      timeframe: timeframe.display_label,
    };
  }

  if (result.rows.length === 0) {
    return {
      status: "no_production_trips",
      message:
        "No real journey records are linked for this period yet. Demo journeys are excluded from production Trip Intelligence.",
      timeframe: timeframe.display_label,
    };
  }

  return null;
}

function hiddenSourceStatus() {
  return { status: "hidden_by_role", row_count: null };
}

function emptyResult<T>(): QueryResult<T> {
  return { rows: [] };
}

function isMissingSchemaError(error: any) {
  const message = safeError(error).toLowerCase();
  return (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find") ||
    message.includes("column") && message.includes("not found")
  );
}

function isMissingColumnError(error: any, column: string) {
  return safeError(error).toLowerCase().includes(column.toLowerCase());
}

function safeError(error: any) {
  return String(error?.message || error?.hint || error?.details || error || "Unknown error");
}

function countBy(values: any[]) {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = String(value || "unknown");
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function numericOrNull(value: any) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestampMs(value: any, timeZone?: string): number | null {
  if (!value) return null;
  const date = parseProviderTimestamp(value, timeZone);
  const ms = date ? date.getTime() : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
}

function roundMetric(value: any) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

function roundMoney(value: any) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

function cleanText(value: any) {
  const text = String(value || "").trim();
  return text || null;
}

function cleanTruckLabel(value: any) {
  const text = String(value || "").trim().toUpperCase();
  return text || null;
}

function uniqueStrings(values: any[]) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function formatLocalDateInZone(value: any, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") lookup[part.type] = part.value;
  }
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function formatLocalDay(value: string) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) return value || "selected period";
  return new Intl.DateTimeFormat("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
