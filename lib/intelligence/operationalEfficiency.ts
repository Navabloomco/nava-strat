import { supabaseAdmin } from "../supabaseAdmin";
import { normalizeVehicleKey } from "./entityResolver";
import {
  DEFAULT_OPERATIONAL_TIME_ZONE,
  classifyProviderTimestampQuality,
  resolveOperationalDayRange,
  resolveOperationalTimeZone,
} from "../timeFormatting";
import {
  canonicalProviderIdleEventType,
  getIdleEvidenceSource,
  IDLE_COMPATIBILITY_EVENT_TYPES,
  isProviderIdleMarkerEvent,
  providerIdleMarkerEvidenceLabel,
} from "../providers/providerIdleMarkers";
import {
  extractProviderReportedEvidence,
  providerCurrentStopEvidenceFromSignalFlags,
  providerReportedDistanceValueFromSignalFlags,
} from "../providers/providerReportedFields";

export type OperationalEfficiencyRange = "today" | "yesterday" | "7d";

export type OperationalEfficiencyTimeframe = {
  requested: OperationalEfficiencyRange;
  selected_range_label: string;
  time_zone: string;
  start_utc: string;
  end_utc: string;
  query_start_utc: string;
  query_end_utc: string;
  local_start_date: string;
  local_end_date: string;
  period_start_local: string;
  period_end_local: string;
  data_window_start_local: string;
  data_window_end_local: string;
  display_label: string;
};

type OperationalEfficiencyInput = {
  companyId: string;
  company?: any;
  range?: OperationalEfficiencyRange | string | null;
};

type QueryResult<T> = {
  rows: T[];
  missing?: boolean;
  error?: string | null;
  fetch_status?: "complete" | "partial";
  pages_fetched?: number;
  page_size?: number;
  row_cap?: number;
  cap_reached?: boolean;
  partial_reason?: string | null;
  first_recorded_at?: string | null;
  latest_recorded_at?: string | null;
};

type EnabledAsset = {
  id: string;
  truck_id: string | null;
  registration: string | null;
  provider_name: string | null;
  provider_location_label?: string | null;
  last_seen_at: string | null;
  asset_category: string | null;
  raw_payload?: any;
};

type TruckTelemetryStats = {
  truck_key: string;
  truck_id: string;
  point_count: number;
  segment_count: number;
  large_gap_count: number;
  distance_km: number;
  provider_reported_distance_km: number;
  provider_reported_distance_points: number;
  provider_reported_distance_source: string | null;
  provider_reported_distance_status: string;
  provider_reported_distance_note: string;
  moving_minutes: number;
  stopped_minutes: number;
  observed_minutes: number;
  observed_coverage_ratio: number;
  gap_minutes: number;
  capped_estimate: boolean;
  stopped_time_confidence: "high" | "medium" | "low";
  stopped_time_confidence_reason: string;
  skipped_invalid_points: number;
  skipped_unrealistic_segments: number;
  first_recorded_at: string | null;
  latest_recorded_at: string | null;
  telemetry_coverage_status: "complete" | "partial" | "thin";
  telemetry_coverage_reason: string;
  telemetry_start_gap_minutes: number;
  telemetry_end_gap_minutes: number;
  latest_provider_location_label: string | null;
  provider_current_stop_duration_minutes: number | null;
  provider_current_stop_label: string | null;
  provider_current_status_label: string | null;
  provider_stop_source_path: string | null;
  provider_status_source_path: string | null;
  stop_context: StopContextType;
  stop_context_label: string;
  stop_context_note: string;
};

type StopContextType =
  | "provider_current_stop"
  | "provider_status_stopped"
  | "site_or_known_place"
  | "active_trip_site_context"
  | "unknown_stopped_time";

const MAX_CONTINUOUS_INTERVAL_MINUTES = 90;
const STALE_LOCATION_THRESHOLD_MINUTES = 60;
const TELEMETRY_PAGE_SIZE = 1000;
const TELEMETRY_MAX_ROWS = 150000;

export function resolveOperationalEfficiencyTimeframe(
  input: { range?: string | null; company?: any } = {}
): OperationalEfficiencyTimeframe {
  const requested = normalizeEfficiencyRange(input.range);
  const timeZone = resolveOperationalTimeZone(input.company);
  const endDay = resolveOperationalDayRange(timeZone, 0);
  const nowMs = Date.now();

  if (requested === "7d") {
    const startDay = resolveOperationalDayRange(timeZone, -6);
    return buildEfficiencyTimeframe({
      requested,
      selectedRangeLabel: "7 days",
      time_zone: timeZone,
      start_utc: startDay.startUtc,
      end_utc: endDay.endUtc,
      local_start_date: startDay.localDate,
      local_end_date: endDay.localDate,
      display_label: `${formatLocalDayLabel(startDay.localDate)} to ${formatLocalDayLabel(
        endDay.localDate
      )} (${shortTimeZoneLabel(timeZone)})`,
      nowMs,
    });
  }

  const day = resolveOperationalDayRange(timeZone, requested === "yesterday" ? -1 : 0);
  return buildEfficiencyTimeframe({
    requested,
    selectedRangeLabel: requested === "today" ? "Today" : "Yesterday",
    time_zone: timeZone,
    start_utc: day.startUtc,
    end_utc: day.endUtc,
    local_start_date: day.localDate,
    local_end_date: day.localDate,
    display_label: `${formatLocalDayLabel(day.localDate)} (${shortTimeZoneLabel(timeZone)})`,
    nowMs,
  });
}

export async function buildOperationalEfficiencySummary(
  input: OperationalEfficiencyInput
) {
  const timeframe = resolveOperationalEfficiencyTimeframe({
    range: input.range,
    company: input.company,
  });

  const assetsResult = await fetchEnabledAssets(input.companyId);
  const assets = assetsResult.rows;
  const assetLookups = buildAssetLookups(assets);
  const enabledTruckIds = Array.from(
    new Set(
      assets
        .flatMap((asset) => [asset.truck_id, asset.registration])
        .map(cleanTruckId)
        .filter(Boolean)
    )
  );

  const [providerDistanceResult, telemetryResult, idleEventResult] = await Promise.all([
    fetchProviderDistanceRows(input.companyId, timeframe),
    fetchTelemetryRows(input.companyId, enabledTruckIds, timeframe),
    fetchIdleEventRows(input.companyId, enabledTruckIds, timeframe),
  ]);

  const providerDistanceByTruck = summarizeProviderDistanceRows(
    providerDistanceResult.rows,
    assetLookups
  );
  const telemetryStatsByTruck = summarizeTelemetryRows(
    telemetryResult.rows,
    assetLookups,
    timeframe
  );
  const movement = buildTruckMovementSummary(
    providerDistanceByTruck,
    telemetryStatsByTruck,
    providerDistanceResult,
    telemetryResult,
    timeframe
  );
  const idle = buildIdleTimeSummary(
    idleEventResult.rows,
    telemetryStatsByTruck,
    idleEventResult,
    telemetryResult,
    assetLookups,
    timeframe
  );
  const staleLocations = buildStaleLocationSummary(assets);
  const productivity = buildProductivitySummary(
    movement.trucks,
    telemetryStatsByTruck,
    telemetryResult
  );

  const [driverAssignmentsResult, journeysResult] = await Promise.all([
    fetchDriverAssignments(input.companyId, timeframe),
    fetchJourneys(input.companyId, timeframe),
  ]);

  return {
    timeframe,
    generated_at: new Date().toISOString(),
    scope: {
      company_id: input.companyId,
      enabled_asset_count: assets.length,
      enabled_truck_count: enabledTruckIds.length,
    },
    data_sources: {
      provider_trip_summaries: sourceStatus(providerDistanceResult),
      telemetry_logs: sourceStatus(telemetryResult),
      telemetry_events: sourceStatus(idleEventResult),
      fleet_assets: sourceStatus(assetsResult),
      asset_driver_assignments: sourceStatus(driverAssignmentsResult),
      journeys: sourceStatus(journeysResult),
    },
    summaries: {
      movement,
      idle,
      stale_locations: staleLocations,
      productivity,
      driver_efficiency: buildDriverEfficiencySummary(
        movement.trucks,
        telemetryStatsByTruck,
        driverAssignmentsResult,
        assetLookups,
        timeframe
      ),
      client_waiting: buildClientWaitingSummary(journeysResult),
    },
    missing_data: buildMissingDataList({
      assets,
      providerDistanceResult,
      telemetryResult,
      idleEventResult,
      driverAssignmentsResult,
      journeysResult,
    }),
  };
}

export async function getTruckMovementSummaryForRange(input: OperationalEfficiencyInput) {
  const summary = await buildOperationalEfficiencySummary(input);
  return summary.summaries.movement;
}

export async function getIdleTimeSummaryForRange(input: OperationalEfficiencyInput) {
  const summary = await buildOperationalEfficiencySummary(input);
  return summary.summaries.idle;
}

export async function getStaleLocationSummary(input: OperationalEfficiencyInput) {
  const summary = await buildOperationalEfficiencySummary(input);
  return summary.summaries.stale_locations;
}

function normalizeEfficiencyRange(value: any): OperationalEfficiencyRange {
  const text = String(value || "").trim().toLowerCase();
  if (["today", "same_day", "same-day"].includes(text)) return "today";
  if (["7d", "7day", "7days", "week", "last_7_days", "last-7-days"].includes(text)) {
    return "7d";
  }
  if (["yesterday", "previous_day", "previous-day"].includes(text)) return "yesterday";
  return "today";
}

function buildEfficiencyTimeframe(input: {
  requested: OperationalEfficiencyRange;
  selectedRangeLabel: string;
  time_zone: string;
  start_utc: string;
  end_utc: string;
  local_start_date: string;
  local_end_date: string;
  display_label: string;
  nowMs: number;
}): OperationalEfficiencyTimeframe {
  const endMs = new Date(input.end_utc).getTime();
  const queryEndMs =
    input.requested === "today" || input.requested === "7d"
      ? Math.min(endMs, input.nowMs)
      : endMs;
  const queryEndUtc = new Date(
    Number.isFinite(queryEndMs) ? queryEndMs : endMs
  ).toISOString();

  return {
    requested: input.requested,
    selected_range_label: input.selectedRangeLabel,
    time_zone: input.time_zone,
    start_utc: input.start_utc,
    end_utc: input.end_utc,
    query_start_utc: input.start_utc,
    query_end_utc: queryEndUtc,
    local_start_date: input.local_start_date,
    local_end_date: input.local_end_date,
    period_start_local: formatLocalBoundary(input.start_utc, input.time_zone),
    period_end_local: formatLocalBoundary(
      new Date(new Date(input.end_utc).getTime() - 1).toISOString(),
      input.time_zone
    ),
    data_window_start_local: formatLocalBoundary(input.start_utc, input.time_zone),
    data_window_end_local: formatLocalBoundary(queryEndUtc, input.time_zone),
    display_label: input.display_label,
  };
}

async function fetchEnabledAssets(companyId: string): Promise<QueryResult<EnabledAsset>> {
  try {
    const { data, error } = await supabaseAdmin
      .from("fleet_assets")
      .select("id, truck_id, registration, provider_name, provider_location_label, last_seen_at, asset_category, raw_payload")
      .eq("company_id", companyId)
      .eq("status", "active")
      .eq("intelligence_enabled", true)
      .order("last_seen_at", { ascending: false })
      .limit(2000);

    if (error) {
      if (isMissingColumnError(error) && safeErrorMessage(error).includes("raw_payload")) {
        return fetchEnabledAssetsWithoutRawPayload(companyId);
      }
      if (isMissingSchemaError(error)) return { rows: [], missing: true, error: safeErrorMessage(error) };
      throw error;
    }

    return { rows: data || [] };
  } catch (err: any) {
    if (isMissingSchemaError(err)) {
      return { rows: [], missing: true, error: safeErrorMessage(err) };
    }
    throw err;
  }
}

async function fetchEnabledAssetsWithoutRawPayload(
  companyId: string
): Promise<QueryResult<EnabledAsset>> {
  const { data, error } = await supabaseAdmin
    .from("fleet_assets")
    .select("id, truck_id, registration, provider_name, provider_location_label, last_seen_at, asset_category")
    .eq("company_id", companyId)
    .eq("status", "active")
    .eq("intelligence_enabled", true)
    .order("last_seen_at", { ascending: false })
    .limit(2000);

  if (error) {
    if (isMissingSchemaError(error)) return { rows: [], missing: true, error: safeErrorMessage(error) };
    throw error;
  }

  return { rows: data || [] };
}

async function fetchProviderDistanceRows(
  companyId: string,
  timeframe: OperationalEfficiencyTimeframe
): Promise<QueryResult<any>> {
  try {
    const query = supabaseAdmin
      .from("provider_trip_summaries")
      .select(
        "id, asset_id, truck_id, report_date, start_time, end_time, provider_mileage_km, odometer_delta_km, distance_source, motion_duration_minutes"
      )
      .eq("company_id", companyId)
      .gte("report_date", timeframe.local_start_date)
      .lte("report_date", timeframe.local_end_date)
      .limit(5000);

    const { data, error } = await query;
    if (error) {
      if (isMissingColumnError(error) && safeErrorMessage(error).includes("motion_duration_minutes")) {
        return fetchProviderDistanceRowsWithoutMotion(companyId, timeframe);
      }
      if (isMissingSchemaError(error)) return { rows: [], missing: true, error: safeErrorMessage(error) };
      throw error;
    }

    return { rows: data || [] };
  } catch (err: any) {
    if (isMissingSchemaError(err)) {
      return { rows: [], missing: true, error: safeErrorMessage(err) };
    }
    throw err;
  }
}

async function fetchProviderDistanceRowsWithoutMotion(
  companyId: string,
  timeframe: OperationalEfficiencyTimeframe
): Promise<QueryResult<any>> {
  const { data, error } = await supabaseAdmin
    .from("provider_trip_summaries")
    .select(
      "id, asset_id, truck_id, report_date, start_time, end_time, provider_mileage_km, odometer_delta_km, distance_source"
    )
    .eq("company_id", companyId)
    .gte("report_date", timeframe.local_start_date)
    .lte("report_date", timeframe.local_end_date)
    .limit(5000);

  if (error) {
    if (isMissingSchemaError(error)) return { rows: [], missing: true, error: safeErrorMessage(error) };
    throw error;
  }

  return { rows: data || [] };
}

async function fetchTelemetryRows(
  companyId: string,
  truckIds: string[],
  timeframe: OperationalEfficiencyTimeframe
): Promise<QueryResult<any>> {
  if (!truckIds.length) return { rows: [], fetch_status: "complete" };

  try {
    return await fetchTelemetryRowsPaginated({
      companyId,
      truckIds,
      timeframe,
      selectColumns: "truck_id, recorded_at, latitude, longitude, speed, provider_location_label, provider_signal_flags",
    });
  } catch (err: any) {
    if (
      isMissingColumnError(err) &&
      safeErrorMessage(err).toLowerCase().includes("provider_signal_flags")
    ) {
      return fetchTelemetryRowsWithoutProviderSignalFlags(companyId, truckIds, timeframe);
    }
    if (
      isMissingColumnError(err) &&
      safeErrorMessage(err).toLowerCase().includes("provider_location_label")
    ) {
      return fetchTelemetryRowsWithoutProviderLocationLabel(companyId, truckIds, timeframe);
    }
    if (isMissingSchemaError(err)) {
      return { rows: [], missing: true, error: safeErrorMessage(err) };
    }
    throw err;
  }
}

async function fetchTelemetryRowsWithoutProviderSignalFlags(
  companyId: string,
  truckIds: string[],
  timeframe: OperationalEfficiencyTimeframe
): Promise<QueryResult<any>> {
  return fetchTelemetryRowsPaginated({
    companyId,
    truckIds,
    timeframe,
    selectColumns: "truck_id, recorded_at, latitude, longitude, speed",
  });
}

async function fetchTelemetryRowsWithoutProviderLocationLabel(
  companyId: string,
  truckIds: string[],
  timeframe: OperationalEfficiencyTimeframe
): Promise<QueryResult<any>> {
  return fetchTelemetryRowsPaginated({
    companyId,
    truckIds,
    timeframe,
    selectColumns: "truck_id, recorded_at, latitude, longitude, speed, provider_signal_flags",
  });
}

async function fetchTelemetryRowsPaginated(input: {
  companyId: string;
  truckIds: string[];
  timeframe: OperationalEfficiencyTimeframe;
  selectColumns: string;
}): Promise<QueryResult<any>> {
  const rows: any[] = [];
  let pagesFetched = 0;

  for (let offset = 0; offset < TELEMETRY_MAX_ROWS; offset += TELEMETRY_PAGE_SIZE) {
    const to = Math.min(offset + TELEMETRY_PAGE_SIZE - 1, TELEMETRY_MAX_ROWS - 1);
    const { data, error } = await supabaseAdmin
      .from("telemetry_logs")
      .select(input.selectColumns)
      .eq("company_id", input.companyId)
      .in("truck_id", input.truckIds)
      .gte("recorded_at", input.timeframe.query_start_utc)
      .lt("recorded_at", input.timeframe.query_end_utc)
      .order("recorded_at", { ascending: true })
      .order("truck_id", { ascending: true })
      .range(offset, to);

    if (error) {
      if (isMissingColumnError(error)) {
        throw error;
      }
      if (isMissingSchemaError(error)) {
        return { rows: [], missing: true, error: safeErrorMessage(error) };
      }
      throw error;
    }

    const pageRows = data || [];
    pagesFetched += 1;
    rows.push(...pageRows);

    if (pageRows.length < TELEMETRY_PAGE_SIZE) {
      return {
        rows,
        fetch_status: "complete",
        pages_fetched: pagesFetched,
        page_size: TELEMETRY_PAGE_SIZE,
        row_cap: TELEMETRY_MAX_ROWS,
        cap_reached: false,
        first_recorded_at: firstRecordedAtFromRows(rows),
        latest_recorded_at: latestRecordedAtFromRows(rows),
      };
    }
  }

  return {
    rows,
    fetch_status: "partial",
    pages_fetched: pagesFetched,
    page_size: TELEMETRY_PAGE_SIZE,
    row_cap: TELEMETRY_MAX_ROWS,
    cap_reached: true,
    partial_reason:
      "Telemetry row cap reached before the selected period was fully fetched.",
    first_recorded_at: firstRecordedAtFromRows(rows),
    latest_recorded_at: latestRecordedAtFromRows(rows),
  };
}

function firstRecordedAtFromRows(rows: any[]) {
  for (const row of rows) {
    if (row?.recorded_at) return row.recorded_at;
  }
  return null;
}

function latestRecordedAtFromRows(rows: any[]) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index]?.recorded_at) return rows[index].recorded_at;
  }
  return null;
}

async function fetchIdleEventRows(
  companyId: string,
  truckIds: string[],
  timeframe: OperationalEfficiencyTimeframe
): Promise<QueryResult<any>> {
  if (!truckIds.length) return { rows: [] };

  try {
    const selectColumns =
      "id, truck_id, event_type, severity, created_at, started_at, ended_at, duration_minutes, context_label, context_type, metadata";
    const eventTypes = Array.from(IDLE_COMPATIBILITY_EVENT_TYPES);

    const startedResult = await supabaseAdmin
      .from("telemetry_events")
      .select(selectColumns)
      .eq("company_id", companyId)
      .in("truck_id", truckIds)
      .in("event_type", eventTypes)
      .gte("started_at", timeframe.query_start_utc)
      .lt("started_at", timeframe.query_end_utc)
      .order("started_at", { ascending: true })
      .limit(5000);

    if (startedResult.error) {
      if (isMissingSchemaError(startedResult.error)) {
        return { rows: [], missing: true, error: safeErrorMessage(startedResult.error) };
      }
      throw startedResult.error;
    }

    const createdResult = await supabaseAdmin
      .from("telemetry_events")
      .select(selectColumns)
      .eq("company_id", companyId)
      .in("truck_id", truckIds)
      .in("event_type", eventTypes)
      .gte("created_at", timeframe.query_start_utc)
      .lt("created_at", timeframe.query_end_utc)
      .order("created_at", { ascending: true })
      .limit(5000);

    const { data, error } = createdResult;
    if (error) {
      if (isMissingSchemaError(error)) return { rows: [], missing: true, error: safeErrorMessage(error) };
      throw error;
    }

    const rowsById = new Map<string, any>();
    for (const row of [...(startedResult.data || []), ...(data || [])]) {
      rowsById.set(String(row.id || `${row.truck_id}-${row.event_type}-${row.started_at || row.created_at}`), row);
    }
    const idleRows = Array.from(rowsById.values()).filter((row: any) =>
      isProviderIdleMarkerEvent(row)
    );
    return { rows: idleRows };
  } catch (err: any) {
    if (isMissingSchemaError(err)) {
      return { rows: [], missing: true, error: safeErrorMessage(err) };
    }
    throw err;
  }
}

async function fetchDriverAssignments(
  companyId: string,
  timeframe: OperationalEfficiencyTimeframe
): Promise<QueryResult<any>> {
  try {
    const { data, error } = await supabaseAdmin
      .from("asset_driver_assignments")
      .select("asset_id, truck_id, driver_id, driver_name, assigned_from, assigned_to, assignment_status")
      .eq("company_id", companyId)
      .limit(3000);

    if (error) {
      if (isMissingSchemaError(error)) return { rows: [], missing: true, error: safeErrorMessage(error) };
      throw error;
    }

    const rows = (data || []).filter((row: any) =>
      assignmentOverlapsTimeframe(row, timeframe)
    );
    return { rows };
  } catch (err: any) {
    if (isMissingSchemaError(err)) {
      return { rows: [], missing: true, error: safeErrorMessage(err) };
    }
    throw err;
  }
}

async function fetchJourneys(
  companyId: string,
  timeframe: OperationalEfficiencyTimeframe
): Promise<QueryResult<any>> {
  try {
    const { data, error } = await supabaseAdmin
      .from("journeys")
      .select("id, truck, driver, client_name, from_location, to_location, status, start_time, end_time, created_at")
      .eq("company_id", companyId)
      .eq("is_demo", false)
      .gte("created_at", timeframe.query_start_utc)
      .lt("created_at", timeframe.query_end_utc)
      .limit(3000);

    if (error) {
      if (isMissingSchemaError(error)) return { rows: [], missing: true, error: safeErrorMessage(error) };
      throw error;
    }

    return { rows: data || [] };
  } catch (err: any) {
    if (isMissingSchemaError(err)) {
      return { rows: [], missing: true, error: safeErrorMessage(err) };
    }
    throw err;
  }
}

function buildAssetLookups(assets: EnabledAsset[]) {
  const byKey = new Map<string, EnabledAsset>();
  const byId = new Map<string, EnabledAsset>();
  for (const asset of assets) {
    if (asset.id) byId.set(asset.id, asset);
    for (const candidate of [asset.truck_id, asset.registration]) {
      const key = normalizeVehicleKey(candidate || "");
      if (key && !byKey.has(key)) byKey.set(key, asset);
    }
  }
  return { byKey, byId };
}

function summarizeProviderDistanceRows(rows: any[], assetLookups: ReturnType<typeof buildAssetLookups>) {
  const byTruck = new Map<string, any>();

  for (const row of rows) {
    const asset = row.asset_id ? assetLookups.byId.get(row.asset_id) : null;
    const truckId = cleanTruckId(row.truck_id || asset?.truck_id || asset?.registration);
    const truckKey = normalizeVehicleKey(truckId || "");
    if (!truckKey) continue;

    const existing = byTruck.get(truckKey) || {
      truck_key: truckKey,
      truck_id: displayTruckLabel(truckId, asset),
      distance_km: 0,
      motion_duration_minutes: 0,
      rows: 0,
      source: "provider-reported",
    };
    existing.distance_km = roundMetric(existing.distance_km + effectiveDistanceKm(row));
    if (isFinitePositive(row.motion_duration_minutes)) {
      existing.motion_duration_minutes += Number(row.motion_duration_minutes);
    }
    existing.rows += 1;
    byTruck.set(truckKey, existing);
  }

  for (const value of Array.from(byTruck.values())) {
    value.motion_duration_minutes = Math.round(value.motion_duration_minutes);
  }

  return byTruck;
}

function summarizeTelemetryRows(
  rows: any[],
  assetLookups: ReturnType<typeof buildAssetLookups>,
  timeframe: OperationalEfficiencyTimeframe
) {
  const rowsByTruck = new Map<string, any[]>();
  for (const row of rows) {
    const key = normalizeVehicleKey(row.truck_id || "");
    if (!key) continue;
    const group = rowsByTruck.get(key) || [];
    group.push(row);
    rowsByTruck.set(key, group);
  }

  const byTruck = new Map<string, TruckTelemetryStats>();
  const timeframeStartMs = new Date(timeframe.query_start_utc).getTime();
  const timeframeEndMs = new Date(timeframe.query_end_utc).getTime();
  const timeframeMinutes = Math.max(
    1,
    (timeframeEndMs - timeframeStartMs) / 60000
  );
  for (const [truckKey, groupRows] of Array.from(rowsByTruck.entries())) {
    const sorted = groupRows
      .slice()
      .sort((a: any, b: any) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
    const asset = assetLookups.byKey.get(truckKey);
    let previous: any = null;
    let pointCount = 0;
    let segmentCount = 0;
    let distanceKm = 0;
    let movingMinutes = 0;
    let stoppedMinutes = 0;
    let observedMinutes = 0;
    let gapMinutes = 0;
    let largeGapCount = 0;
    let skippedInvalidPoints = 0;
    let skippedUnrealisticSegments = 0;
    let firstRecordedAt: string | null = null;
    let latestRecordedAt: string | null = null;
    let latestProviderLocationLabel =
      cleanText(asset?.provider_location_label) || null;
    let latestProviderCurrentStop =
      providerCurrentStopEvidenceFromProviderEvidence(
        extractProviderReportedEvidence(asset?.raw_payload, asset?.provider_name)
      );
    const providerDistanceObservations: Array<{
      value: number;
      timestampMs: number;
      field_path: string | null;
    }> = [];

    for (const row of sorted) {
      const point = normalizeGpsPoint(row);
      if (!point) {
        skippedInvalidPoints += 1;
        continue;
      }

      pointCount += 1;
      firstRecordedAt = firstRecordedAt || row.recorded_at || null;
      latestRecordedAt = row.recorded_at || latestRecordedAt;
      latestProviderLocationLabel =
        cleanText(row.provider_location_label) || latestProviderLocationLabel;
      const rowProviderCurrentStop = providerCurrentStopEvidenceFromSignalFlags(
        row.provider_signal_flags
      );
      if (rowProviderCurrentStop) {
        latestProviderCurrentStop = rowProviderCurrentStop;
      }
      const providerDistanceValue = providerReportedDistanceValueFromSignalFlags(
        row.provider_signal_flags
      );
      if (providerDistanceValue !== null) {
        providerDistanceObservations.push({
          value: providerDistanceValue,
          timestampMs: point.timestampMs,
          field_path:
            row.provider_signal_flags?.provider_reported_evidence
              ?.distance_odometer?.field_path || null,
        });
      }
      if (!previous) {
        previous = point;
        continue;
      }

      const elapsedMinutes = (point.timestampMs - previous.timestampMs) / 60000;
      if (!Number.isFinite(elapsedMinutes) || elapsedMinutes <= 0) {
        previous = point;
        continue;
      }

      if (elapsedMinutes > MAX_CONTINUOUS_INTERVAL_MINUTES) {
        gapMinutes += elapsedMinutes;
        largeGapCount += 1;
        previous = point;
        continue;
      }

      const segmentKm = haversineDistanceKm(previous, point);
      const elapsedHours = elapsedMinutes / 60;
      const impliedSpeed = elapsedHours > 0 ? segmentKm / elapsedHours : 0;
      if (impliedSpeed > 160) {
        skippedUnrealisticSegments += 1;
        previous = point;
        continue;
      }

      const movingBySpeed = Number(previous.speed || 0) > 5 || Number(point.speed || 0) > 5;
      const movingByDistance = segmentKm > 0.2;
      if (movingBySpeed || movingByDistance) {
        movingMinutes += elapsedMinutes;
        distanceKm += Math.max(segmentKm, 0);
      } else {
        stoppedMinutes += elapsedMinutes;
      }

      observedMinutes += elapsedMinutes;
      segmentCount += 1;
      previous = point;
    }
    const confidence = classifyStoppedTimeConfidence({
      pointCount,
      segmentCount,
      largeGapCount,
      observedMinutes,
      timeframeMinutes,
      skippedUnrealisticSegments,
    });
    const providerDistance = calculateProviderReportedDistanceDelta(
      providerDistanceObservations
    );
    const coverage = classifyTelemetryCoverage({
      pointCount,
      observedCoverageRatio: observedMinutes / timeframeMinutes,
      firstRecordedAt,
      latestRecordedAt,
      timeframeStartMs,
      timeframeEndMs,
      timeframeMinutes,
    });
    const stopContext = classifyStopContext({
      providerCurrentStop: latestProviderCurrentStop,
      providerLocationLabel: latestProviderLocationLabel,
    });

    byTruck.set(truckKey, {
      truck_key: truckKey,
      truck_id: displayTruckLabel(sorted[0]?.truck_id, asset),
      point_count: pointCount,
      segment_count: segmentCount,
      large_gap_count: largeGapCount,
      distance_km: roundMetric(distanceKm),
      provider_reported_distance_km: providerDistance.distance_km,
      provider_reported_distance_points: providerDistance.point_count,
      provider_reported_distance_source: providerDistance.source,
      provider_reported_distance_status: providerDistance.status,
      provider_reported_distance_note: providerDistance.note,
      moving_minutes: Math.round(movingMinutes),
      stopped_minutes: Math.round(stoppedMinutes),
      observed_minutes: Math.round(observedMinutes),
      observed_coverage_ratio: roundMetric(observedMinutes / timeframeMinutes),
      gap_minutes: Math.round(gapMinutes),
      capped_estimate: largeGapCount > 0,
      stopped_time_confidence: confidence.confidence,
      stopped_time_confidence_reason: confidence.reason,
      skipped_invalid_points: skippedInvalidPoints,
      skipped_unrealistic_segments: skippedUnrealisticSegments,
      first_recorded_at: firstRecordedAt,
      latest_recorded_at: latestRecordedAt,
      telemetry_coverage_status: coverage.status,
      telemetry_coverage_reason: coverage.reason,
      telemetry_start_gap_minutes: coverage.start_gap_minutes,
      telemetry_end_gap_minutes: coverage.end_gap_minutes,
      latest_provider_location_label: latestProviderLocationLabel,
      provider_current_stop_duration_minutes:
        latestProviderCurrentStop?.provider_current_stop_duration_minutes ?? null,
      provider_current_stop_label:
        latestProviderCurrentStop?.provider_current_stop_label ?? null,
      provider_current_status_label:
        latestProviderCurrentStop?.provider_current_status_label ?? null,
      provider_stop_source_path:
        latestProviderCurrentStop?.provider_stop_source_path ?? null,
      provider_status_source_path:
        latestProviderCurrentStop?.provider_status_source_path ?? null,
      stop_context: stopContext.context,
      stop_context_label: stopContext.label,
      stop_context_note: stopContext.note,
    });
  }

  return byTruck;
}

function providerCurrentStopEvidenceFromProviderEvidence(evidence: any) {
  if (!evidence?.current_stop) return null;
  return providerCurrentStopEvidenceFromSignalFlags({
    provider_reported_evidence: evidence,
  });
}

function classifyStopContext(input: {
  providerCurrentStop: any;
  providerLocationLabel: string | null;
}): { context: StopContextType; label: string; note: string } {
  if (
    input.providerCurrentStop?.provider_current_stop_duration_minutes ||
    input.providerCurrentStop?.provider_current_stop_label
  ) {
    return {
      context: "provider_current_stop",
      label: "Context: Provider current stop episode",
      note:
        "Provider current stop is a current continuous episode; Nava GPS-stopped is the selected-period stationary total.",
    };
  }

  if (providerStatusIndicatesStopped(input.providerCurrentStop?.provider_current_status_label)) {
    return {
      context: "provider_status_stopped",
      label: "Context: Provider status indicates stopped/parked",
      note:
        "Provider status gives operational context, but it is not true engine-on idle or fuel-burn proof.",
    };
  }

  if (looksLikeKnownOperationalPlace(input.providerLocationLabel)) {
    return {
      context: "site_or_known_place",
      label: "Context: At/near known place",
      note:
        "Known operational context lowers blame confidence; unknown stopped time needs review.",
    };
  }

  return {
    context: "unknown_stopped_time",
    label: "Context: Unknown stopped time",
    note:
      "Unknown stopped time needs review; no provider current-stop or site context is linked yet.",
  };
}

function providerStatusIndicatesStopped(value: any) {
  const text = cleanText(value).toLowerCase();
  return /\b(stopped|stop|stationary|parked|parking|idle|idling|grounded|repair|maintenance)\b/.test(
    text
  );
}

function looksLikeKnownOperationalPlace(value: any) {
  const text = cleanText(value);
  if (!text) return false;
  const lower = text.toLowerCase();
  if (
    lower.includes("readable place name unavailable") ||
    lower.includes("location unavailable") ||
    lower.includes("unknown") ||
    lower === "near -" ||
    lower === "at -"
  ) {
    return false;
  }
  if (/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(text)) return false;
  return /[a-z]/i.test(text);
}

function classifyTelemetryCoverage(input: {
  pointCount: number;
  observedCoverageRatio: number;
  firstRecordedAt: string | null;
  latestRecordedAt: string | null;
  timeframeStartMs: number;
  timeframeEndMs: number;
  timeframeMinutes: number;
}) {
  if (!input.pointCount || !input.firstRecordedAt || !input.latestRecordedAt) {
    return {
      status: "thin" as const,
      reason: "No usable telemetry points were found inside the selected period.",
      start_gap_minutes: Math.round(input.timeframeMinutes),
      end_gap_minutes: Math.round(input.timeframeMinutes),
    };
  }

  const firstMs = new Date(input.firstRecordedAt).getTime();
  const latestMs = new Date(input.latestRecordedAt).getTime();
  const startGapMinutes = Number.isFinite(firstMs)
    ? Math.max(0, (firstMs - input.timeframeStartMs) / 60000)
    : input.timeframeMinutes;
  const endGapMinutes = Number.isFinite(latestMs)
    ? Math.max(0, (input.timeframeEndMs - latestMs) / 60000)
    : input.timeframeMinutes;
  const significantEndGap =
    endGapMinutes > 60 && endGapMinutes > input.timeframeMinutes * 0.1;

  if (significantEndGap) {
    return {
      status: "partial" as const,
      reason: "The latest telemetry point is well before the selected period end.",
      start_gap_minutes: Math.round(startGapMinutes),
      end_gap_minutes: Math.round(endGapMinutes),
    };
  }

  if (input.observedCoverageRatio < 0.1) {
    return {
      status: "thin" as const,
      reason: "Only a small share of the selected period has usable GPS intervals.",
      start_gap_minutes: Math.round(startGapMinutes),
      end_gap_minutes: Math.round(endGapMinutes),
    };
  }

  return {
    status: "complete" as const,
    reason: "Telemetry reaches the selected period end closely enough for ranking evidence.",
    start_gap_minutes: Math.round(startGapMinutes),
    end_gap_minutes: Math.round(endGapMinutes),
  };
}

function calculateProviderReportedDistanceDelta(
  observations: Array<{ value: number; timestampMs: number; field_path: string | null }>
) {
  const sorted = observations
    .filter(
      (item) =>
        Number.isFinite(item.value) &&
        item.value >= 0 &&
        Number.isFinite(item.timestampMs)
    )
    .sort((a, b) => a.timestampMs - b.timestampMs);

  if (sorted.length < 2) {
    return {
      distance_km: 0,
      point_count: sorted.length,
      source: null,
      status: sorted.length ? "insufficient_period_delta" : "not_detected",
      note: sorted.length
        ? "Provider mileage/odometer was detected, but at least two sane points inside the selected period are needed before Nava can calculate a period delta."
        : "No provider mileage/odometer values were detected in the selected period.",
    };
  }

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const delta = last.value - first.value;

  // Current-feed odometer/mileage values are useful only when they form a sane
  // cumulative delta inside the selected window. Unit ambiguity or resets fall
  // back to GPS estimates instead of manufacturing precision.
  if (!Number.isFinite(delta) || delta <= 0) {
    return {
      distance_km: 0,
      point_count: sorted.length,
      source: null,
      status: "no_positive_delta",
      note:
        "Provider mileage/odometer was detected, but it did not increase inside the selected period.",
    };
  }

  if (delta > 5000) {
    return {
      distance_km: 0,
      point_count: sorted.length,
      source: null,
      status: "impossible_jump",
      note:
        "Provider mileage/odometer delta exceeded the safe period threshold, so Nava used GPS-estimated fallback where available.",
    };
  }

  return {
    distance_km: roundMetric(delta),
    point_count: sorted.length,
    source: first.field_path
      ? `provider current-feed ${first.field_path} delta`
      : "provider current-feed distance/odometer delta",
    status: "available",
    note:
      "Provider current-feed mileage/odometer had at least two sane points inside the selected period.",
  };
}

function buildTruckMovementSummary(
  providerDistanceByTruck: Map<string, any>,
  telemetryStatsByTruck: Map<string, TruckTelemetryStats>,
  providerDistanceResult: QueryResult<any>,
  telemetryResult: QueryResult<any>,
  timeframe: OperationalEfficiencyTimeframe
) {
  const truckKeys = new Set([
    ...Array.from(providerDistanceByTruck.keys()),
    ...Array.from(telemetryStatsByTruck.keys()),
  ]);
  const trucks = Array.from(truckKeys).map((truckKey) => {
    const provider = providerDistanceByTruck.get(truckKey);
    const telemetry = telemetryStatsByTruck.get(truckKey);
    const useProviderDistance = provider && provider.distance_km > 0;
    const useCurrentFeedProviderDistance =
      !useProviderDistance && Number(telemetry?.provider_reported_distance_km || 0) > 0;
    const distanceKm = useProviderDistance
      ? provider.distance_km
      : useCurrentFeedProviderDistance
        ? Number(telemetry?.provider_reported_distance_km || 0)
      : Number(telemetry?.distance_km || 0);
    const distanceEvidenceType = useProviderDistance
      ? "provider_trip_report"
      : useCurrentFeedProviderDistance
        ? "provider_current_feed_delta"
        : telemetry && telemetry.distance_km > 0
          ? "gps_estimated"
          : "unavailable";
    const distanceConfidence = useProviderDistance
      ? "high"
      : useCurrentFeedProviderDistance
        ? "medium"
        : telemetry && telemetry.distance_km > 0
          ? gpsDistanceConfidence(telemetry)
          : "unavailable";
    const providerDeltaNote =
      telemetry?.provider_reported_distance_status &&
      telemetry.provider_reported_distance_status !== "not_detected" &&
      telemetry.provider_reported_distance_status !== "available"
        ? telemetry.provider_reported_distance_note
        : "";
    const telemetryCoverageStatus =
      telemetryResult.fetch_status === "partial"
        ? "partial"
        : telemetry?.telemetry_coverage_status || "unavailable";
    const telemetryCoverageNote =
      telemetryResult.partial_reason ||
      telemetry?.telemetry_coverage_reason ||
      null;
    return {
      truck_key: truckKey,
      truck_id: provider?.truck_id || telemetry?.truck_id || truckKey,
      distance_km: roundMetric(distanceKm),
      distance_evidence_type: distanceEvidenceType,
      distance_source: useProviderDistance
        ? "provider-reported"
        : useCurrentFeedProviderDistance
          ? "provider-reported"
        : telemetry && telemetry.distance_km > 0
          ? "GPS-estimated"
          : "unavailable",
      distance_evidence_detail: useProviderDistance
        ? "provider trip/report summary"
        : useCurrentFeedProviderDistance
          ? telemetry?.provider_reported_distance_source || "provider current-feed distance/odometer delta"
          : telemetry && telemetry.distance_km > 0
            ? providerDeltaNote
              ? `GPS point-to-point estimate; ${providerDeltaNote}`
              : "GPS point-to-point estimate"
            : "unavailable",
      distance_confidence: distanceConfidence,
      distance_reliability_note: distanceReliabilityNote({
        evidenceType: distanceEvidenceType,
        telemetry,
        providerDeltaNote,
      }),
      movement_minutes:
        provider?.motion_duration_minutes ||
        telemetry?.moving_minutes ||
        null,
      movement_time_source: provider?.motion_duration_minutes
        ? "provider-reported"
        : telemetry?.moving_minutes
          ? "GPS-estimated point intervals"
          : "unavailable",
      stopped_minutes: telemetry?.stopped_minutes ?? null,
      stopped_time_source:
        telemetry && telemetry.observed_minutes > 0
          ? "GPS-estimated point intervals"
          : "unavailable",
      stopped_time_confidence: telemetry?.stopped_time_confidence || null,
      stopped_time_confidence_reason: telemetry?.stopped_time_confidence_reason || null,
      stopped_time_capped_estimate: Boolean(telemetry?.capped_estimate),
      stopped_interval_count: telemetry?.segment_count || 0,
      stopped_large_gap_count: telemetry?.large_gap_count || 0,
      provider_current_stop_duration_minutes:
        telemetry?.provider_current_stop_duration_minutes ?? null,
      provider_current_stop_label: telemetry?.provider_current_stop_label || null,
      provider_current_status_label: telemetry?.provider_current_status_label || null,
      provider_stop_source_path: telemetry?.provider_stop_source_path || null,
      provider_status_source_path: telemetry?.provider_status_source_path || null,
      stop_context: telemetry?.stop_context || "unknown_stopped_time",
      stop_context_label: telemetry?.stop_context_label || "Context: Unknown stopped time",
      stop_context_note:
        telemetry?.stop_context_note ||
        "Unknown stopped time needs review; no provider current-stop or site context is linked yet.",
      stopped_reconciliation:
        telemetry?.provider_current_stop_duration_minutes ||
        telemetry?.provider_current_stop_label
          ? {
              nava_gps_stopped_minutes: telemetry?.stopped_minutes ?? null,
              provider_current_stop_minutes:
                telemetry?.provider_current_stop_duration_minutes ?? null,
              provider_current_stop_label:
                telemetry?.provider_current_stop_label || null,
              explanation:
                "Provider current stop is the current continuous episode; Nava GPS-stopped is the selected-period stationary total.",
            }
          : null,
      observed_minutes: telemetry?.observed_minutes || 0,
      observed_coverage_ratio: telemetry?.observed_coverage_ratio || 0,
      telemetry_points: telemetry?.point_count || 0,
      first_telemetry_at: telemetry?.first_recorded_at || null,
      last_telemetry_at: telemetry?.latest_recorded_at || null,
      selected_period_start: timeframe.query_start_utc,
      selected_period_end: timeframe.query_end_utc,
      telemetry_coverage_status: telemetryCoverageStatus,
      telemetry_coverage_ratio: telemetry?.observed_coverage_ratio || 0,
      telemetry_coverage_note: telemetryCoverageNote,
      distance_audit: {
        period_start_utc: timeframe.query_start_utc,
        period_end_utc: timeframe.query_end_utc,
        first_telemetry_at: telemetry?.first_recorded_at || null,
        last_telemetry_at: telemetry?.latest_recorded_at || null,
        points_used: telemetry?.point_count || 0,
        segments_used: telemetry?.segment_count || 0,
        coverage_status: telemetryCoverageStatus,
        coverage_ratio: telemetry?.observed_coverage_ratio || 0,
        coverage_reason: telemetryCoverageNote,
        telemetry_start_gap_minutes: telemetry?.telemetry_start_gap_minutes ?? null,
        telemetry_end_gap_minutes: telemetry?.telemetry_end_gap_minutes ?? null,
        telemetry_fetch_status: telemetryResult.fetch_status || "complete",
        telemetry_fetch_cap_reached: Boolean(telemetryResult.cap_reached),
        telemetry_fetch_partial_reason: telemetryResult.partial_reason || null,
        excluded_large_gaps: telemetry?.large_gap_count || 0,
        excluded_impossible_jumps: telemetry?.skipped_unrealistic_segments || 0,
        skipped_invalid_points: telemetry?.skipped_invalid_points || 0,
      },
      provider_summary_rows: provider?.rows || 0,
      provider_reported_distance_points:
        telemetry?.provider_reported_distance_points || 0,
      provider_current_feed_delta_status:
        telemetry?.provider_reported_distance_status || "not_detected",
      provider_current_feed_delta_note:
        telemetry?.provider_reported_distance_note || null,
    };
  });

  const ranked = trucks
    .filter((truck) => truck.distance_km > 0)
    .sort((a, b) => b.distance_km - a.distance_km);

  return {
    status: ranked.length ? "available" : "not_enough_evidence",
    evidence_label:
      "provider-reported trip/current-feed distance first, GPS-estimated distance when provider reports are unavailable",
    total_distance_km: roundMetric(
      ranked.reduce((sum, truck) => sum + Number(truck.distance_km || 0), 0)
    ),
    trucks_with_distance: ranked.length,
    trucks_analyzed: truckKeys.size,
    top_movers: ranked.slice(0, 15),
    trucks,
    missing:
      ranked.length === 0
        ? uniqueStrings([
            providerDistanceResult.missing ? "provider trip summary rows" : "",
            telemetryResult.missing ? "telemetry logs" : "",
            "positive distance evidence for the selected window",
          ])
        : [],
  };
}

function gpsDistanceConfidence(stats?: TruckTelemetryStats | null) {
  if (!stats || stats.point_count < 4 || stats.segment_count < 3) return "low";
  if (
    stats.large_gap_count > 0 ||
    stats.skipped_unrealistic_segments > 0 ||
    stats.observed_coverage_ratio < 0.35
  ) {
    return "medium";
  }
  return "medium";
}

function distanceReliabilityNote(input: {
  evidenceType: string;
  telemetry?: TruckTelemetryStats | null;
  providerDeltaNote?: string | null;
}) {
  if (input.evidenceType === "provider_trip_report") {
    return "Provider trip/report distance is the strongest distance evidence for this period.";
  }
  if (input.evidenceType === "provider_current_feed_delta") {
    return "Provider current-feed odometer/mileage delta is used only after two sane points exist in the selected period.";
  }
  if (input.evidenceType === "gps_estimated") {
    const parts = [
      "GPS point-to-point distance is a provisional fallback, not final provider distance.",
      input.providerDeltaNote || "",
      input.telemetry?.large_gap_count
        ? `${input.telemetry.large_gap_count} long telemetry gap(s) were excluded.`
        : "",
      input.telemetry?.skipped_unrealistic_segments
        ? `${input.telemetry.skipped_unrealistic_segments} impossible GPS jump(s) were filtered.`
        : "",
    ];
    return uniqueStrings(parts).join(" ");
  }
  return "Distance is unavailable for the selected period.";
}

function buildIdleTimeSummary(
  eventRows: any[],
  telemetryStatsByTruck: Map<string, TruckTelemetryStats>,
  eventResult: QueryResult<any>,
  telemetryResult: QueryResult<any>,
  assetLookups: ReturnType<typeof buildAssetLookups>,
  timeframe: OperationalEfficiencyTimeframe
) {
  const idleWindowsByTruck = buildIdleWindowsByTruck(eventRows, assetLookups, timeframe);
  const alertRank = Array.from(idleWindowsByTruck.values())
    .map((summary: any) => ({
      ...summary,
      total_alert_span_minutes: Math.round(summary.total_alert_span_minutes || 0),
      total_observed_marker_span_minutes: Math.round(
        summary.total_observed_marker_span_minutes || summary.total_alert_span_minutes || 0
      ),
    }))
    .sort((a: any, b: any) => {
      if (b.total_alert_span_minutes !== a.total_alert_span_minutes) {
        return b.total_alert_span_minutes - a.total_alert_span_minutes;
      }
      return b.marker_count - a.marker_count;
    });
  const stoppedRank = Array.from(telemetryStatsByTruck.values())
    .filter((stats) => stats.stopped_minutes > 0)
    .sort((a, b) => b.stopped_minutes - a.stopped_minutes)
    .map((stats) => ({
      truck_id: stats.truck_id,
      truck_key: stats.truck_key,
      stopped_minutes: stats.stopped_minutes,
      observed_minutes: stats.observed_minutes,
      stopped_share:
        stats.observed_minutes > 0
          ? roundMetric(stats.stopped_minutes / stats.observed_minutes)
          : null,
      evidence_label: stoppedTimeEvidenceLabel(stats),
      confidence: stats.stopped_time_confidence,
      confidence_reason: stats.stopped_time_confidence_reason,
      point_count: stats.point_count,
      interval_count: stats.segment_count,
      capped_estimate: stats.capped_estimate,
      large_gap_count: stats.large_gap_count,
      gap_minutes: stats.gap_minutes,
      observed_coverage_ratio: stats.observed_coverage_ratio,
      provider_current_stop_duration_minutes:
        stats.provider_current_stop_duration_minutes,
      provider_current_stop_label: stats.provider_current_stop_label,
      provider_current_status_label: stats.provider_current_status_label,
      provider_stop_source_path: stats.provider_stop_source_path,
      provider_status_source_path: stats.provider_status_source_path,
      stop_context: stats.stop_context,
      stop_context_label: stats.stop_context_label,
      stop_context_note: stats.stop_context_note,
      stopped_reconciliation:
        stats.provider_current_stop_duration_minutes ||
        stats.provider_current_stop_label
          ? {
              nava_gps_stopped_minutes: stats.stopped_minutes,
              provider_current_stop_minutes:
                stats.provider_current_stop_duration_minutes,
              provider_current_stop_label: stats.provider_current_stop_label,
              explanation:
                "Provider current stop is the current continuous episode; Nava GPS-stopped is the selected-period stationary total.",
            }
          : null,
    }));

  return {
    status:
      alertRank.length || stoppedRank.length ? "available" : "not_enough_evidence",
    evidence_label:
      "Provider idle markers include canonical provider_idle_marker rows and qualifying legacy excessive_idle/long_idle rows; GPS-stopped time is separate and not engine-on idle proof.",
    top_idle_alert_windows: alertRank.slice(0, 15),
    top_stopped_by_gps: stoppedRank.slice(0, 15),
    idle_alert_truck_count: alertRank.length,
    gps_stopped_truck_count: stoppedRank.length,
    missing:
      alertRank.length || stoppedRank.length
        ? []
        : uniqueStrings([
            eventResult.missing ? "telemetry event rows" : "",
            telemetryResult.missing ? "telemetry logs" : "",
            "provider idle markers or enough GPS-stopped intervals for the selected window",
          ]),
  };
}

function buildIdleWindowsByTruck(
  eventRows: any[],
  assetLookups: ReturnType<typeof buildAssetLookups>,
  timeframe: OperationalEfficiencyTimeframe
) {
  const grouped = new Map<string, any[]>();
  for (const row of eventRows) {
    const truckKey = normalizeVehicleKey(row.truck_id || "");
    if (!truckKey) continue;
    const group = grouped.get(truckKey) || [];
    group.push(row);
    grouped.set(truckKey, group);
  }

  const summaries = new Map<string, any>();
  for (const [truckKey, rows] of Array.from(grouped.entries())) {
    const sorted = rows
      .slice()
      .sort((a, b) => eventTimeMs(a) - eventTimeMs(b))
      .filter((row) => Number.isFinite(eventTimeMs(row)));
    const windows: any[] = [];
    let current: any[] = [];

    for (const row of sorted) {
      if (!current.length) {
        current = [row];
        continue;
      }
      const previous = current[current.length - 1];
      const gapMinutes = (eventTimeMs(row) - eventTimeMs(previous)) / 60000;
      const sameType =
        normalizeEventType(row) === normalizeEventType(previous);
      if (sameType && gapMinutes <= 15) {
        current.push(row);
      } else {
        windows.push(buildIdleWindow(current, timeframe));
        current = [row];
      }
    }

    if (current.length) windows.push(buildIdleWindow(current, timeframe));

    const asset = assetLookups.byKey.get(truckKey);
    const sourceCounts = sorted.reduce(
      (counts, row) => {
        const source = getIdleEvidenceSource(row);
        if (source === "legacy-provider-marker") counts.legacy_provider_markers += 1;
        if (source === "provider-derived") counts.canonical_provider_markers += 1;
        return counts;
      },
      { canonical_provider_markers: 0, legacy_provider_markers: 0 }
    );
    const evidenceLabel =
      sourceCounts.legacy_provider_markers > 0 && sourceCounts.canonical_provider_markers > 0
        ? "provider-derived and legacy provider idle marker windows"
        : sourceCounts.legacy_provider_markers > 0
          ? "legacy provider idle marker windows"
          : "provider-derived idle marker windows";
    const safeProviderDurationMinutes = windows.reduce(
      (sum, window) => sum + Number(window.safe_provider_duration_minutes || 0),
      0
    );
    const hasProviderDurationReview = windows.some(
      (window) => window.provider_duration_status === "needs_review"
    );
    const totalObservedSpanMinutes = windows.reduce(
      (sum, window) => sum + Number(window.observed_marker_span_minutes || 0),
      0
    );
    summaries.set(truckKey, {
      truck_key: truckKey,
      truck_id: displayTruckLabel(sorted[0]?.truck_id, asset),
      marker_count: sorted.length,
      canonical_provider_marker_count: sourceCounts.canonical_provider_markers,
      legacy_provider_marker_count: sourceCounts.legacy_provider_markers,
      alert_window_count: windows.length,
      total_alert_span_minutes: totalObservedSpanMinutes,
      total_observed_marker_span_minutes: totalObservedSpanMinutes,
      total_provider_duration_minutes: safeProviderDurationMinutes || null,
      provider_duration_status: safeProviderDurationMinutes
        ? "safe"
        : hasProviderDurationReview
          ? "needs_review"
          : "unavailable",
      provider_duration_note: safeProviderDurationMinutes
        ? "Provider duration was summed only from verified per-event duration fields."
        : hasProviderDurationReview
          ? "Provider duration field not summed because semantics are unclear or cumulative."
          : "Provider duration field unavailable; using observed marker span.",
      evidence_label: evidenceLabel,
      windows: windows.slice(0, 6),
      interpretation:
        "This is provider marker evidence, including legacy markers where present. It is not confirmed engine-on idling unless ignition/engine data is available.",
    });
  }

  return summaries;
}

function buildIdleWindow(rows: any[], timeframe: OperationalEfficiencyTimeframe) {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const startMs = eventTimeMs(first);
  const endMs = eventTimeMs(last);
  const bounds = observedIdleWindowBounds(rows, timeframe);
  const durationReview = providerDurationFromRows(
    rows,
    bounds.observed_marker_span_minutes,
    timeframeDurationMinutes(timeframe)
  );
  return {
    event_type: normalizeEventType(first) || "idle",
    first_marker_at: first?.created_at || first?.started_at || null,
    last_marker_at: last?.created_at || last?.started_at || null,
    marker_count: rows.length,
    alert_span_minutes:
      Number.isFinite(startMs) && Number.isFinite(endMs)
        ? Math.max(0, Math.round((endMs - startMs) / 60000))
        : 0,
    observed_marker_span_minutes: bounds.observed_marker_span_minutes,
    observed_marker_start_at: bounds.observed_marker_start_at,
    observed_marker_end_at: bounds.observed_marker_end_at,
    provider_duration_minutes: durationReview.safe_provider_duration_minutes,
    safe_provider_duration_minutes: durationReview.safe_provider_duration_minutes,
    raw_provider_duration_total_minutes: durationReview.raw_provider_duration_total_minutes,
    provider_duration_status: durationReview.status,
    provider_duration_note: durationReview.note,
    evidence_source: getIdleEvidenceSource(first),
    evidence_label: providerIdleMarkerEvidenceLabel(first),
  };
}

function buildStaleLocationSummary(assets: EnabledAsset[]) {
  const now = Date.now();
  const entries = assets.map((asset) => {
    const timestampQuality = classifyProviderTimestampQuality(asset.last_seen_at, { now });
    const lastSeenMs = timestampQuality.timestamp_ms ?? new Date(asset.last_seen_at || 0).getTime();
    const minutes_since_last_seen =
      asset.last_seen_at &&
      timestampQuality.status === "valid" &&
      Number.isFinite(lastSeenMs)
        ? Math.max(0, Math.round((now - lastSeenMs) / 60000))
        : timestampQuality.status === "slightly_future_clock_skew"
          ? 0
        : null;
    const status =
      timestampQuality.status === "future_suspicious"
        ? "timestamp_needs_review"
        : timestampQuality.status === "invalid"
          ? "timestamp_needs_review"
          : minutes_since_last_seen === null
        ? "unknown"
        : minutes_since_last_seen > STALE_LOCATION_THRESHOLD_MINUTES
          ? "stale"
          : "fresh";
    return {
      truck_id: displayTruckLabel(asset.truck_id || asset.registration, asset),
      provider_name: asset.provider_name || null,
      status,
      last_seen_at: asset.last_seen_at || null,
      minutes_since_last_seen,
      timestamp_quality: timestampQuality.status,
      timestamp_quality_reason: timestampQuality.reason,
    };
  });

  return {
    status: entries.length ? "available" : "not_enough_evidence",
    evidence_label: "fleet_assets last_seen_at from provider sync",
    stale_threshold_minutes: STALE_LOCATION_THRESHOLD_MINUTES,
    fresh_count: entries.filter((entry) => entry.status === "fresh").length,
    stale_count: entries.filter((entry) => entry.status === "stale").length,
    unknown_count: entries.filter((entry) => entry.status === "unknown").length,
    timestamp_review_count: entries.filter((entry) => entry.status === "timestamp_needs_review").length,
    stale_assets: entries
      .filter((entry) => entry.status === "stale")
      .sort((a, b) => Number(b.minutes_since_last_seen || 0) - Number(a.minutes_since_last_seen || 0))
      .slice(0, 20),
    timestamp_review_assets: entries
      .filter((entry) => entry.status === "timestamp_needs_review")
      .slice(0, 20),
    unknown_assets: entries.filter((entry) => entry.status === "unknown").slice(0, 20),
  };
}

function buildProductivitySummary(
  movementTrucks: any[],
  telemetryStatsByTruck: Map<string, TruckTelemetryStats>,
  telemetryResult: QueryResult<any>
) {
  const rows = movementTrucks
    .map((truck) => {
      const stats = telemetryStatsByTruck.get(truck.truck_key);
      if (!stats || stats.observed_minutes <= 0) return null;
      const productiveRatio = roundMetric(stats.moving_minutes / stats.observed_minutes);
      return {
        truck_id: truck.truck_id,
        truck_key: truck.truck_key,
        distance_km: truck.distance_km,
        moving_minutes: stats.moving_minutes,
        stopped_minutes: stats.stopped_minutes,
        observed_minutes: stats.observed_minutes,
        confidence: stats.stopped_time_confidence,
        confidence_reason: stats.stopped_time_confidence_reason,
        point_count: stats.point_count,
        interval_count: stats.segment_count,
        capped_estimate: stats.capped_estimate,
        large_gap_count: stats.large_gap_count,
        observed_coverage_ratio: stats.observed_coverage_ratio,
        provider_current_stop_duration_minutes:
          truck.provider_current_stop_duration_minutes ??
          stats.provider_current_stop_duration_minutes,
        provider_current_stop_label:
          truck.provider_current_stop_label || stats.provider_current_stop_label,
        provider_current_status_label:
          truck.provider_current_status_label || stats.provider_current_status_label,
        provider_stop_source_path:
          truck.provider_stop_source_path || stats.provider_stop_source_path,
        provider_status_source_path:
          truck.provider_status_source_path || stats.provider_status_source_path,
        stop_context: truck.stop_context || stats.stop_context,
        stop_context_label: truck.stop_context_label || stats.stop_context_label,
        stop_context_note: truck.stop_context_note || stats.stop_context_note,
        stopped_reconciliation: truck.stopped_reconciliation || (
          stats.provider_current_stop_duration_minutes ||
          stats.provider_current_stop_label
            ? {
                nava_gps_stopped_minutes: stats.stopped_minutes,
                provider_current_stop_minutes:
                  stats.provider_current_stop_duration_minutes,
                provider_current_stop_label: stats.provider_current_stop_label,
                explanation:
                  "Provider current stop is the current continuous episode; Nava GPS-stopped is the selected-period stationary total.",
              }
            : null
        ),
        productive_ratio: productiveRatio,
        evidence_label: stoppedTimeEvidenceLabel(stats),
      };
    })
    .filter(Boolean) as any[];

  const lowProductiveRows = rows
    .filter(
      (row) =>
        Number(row.distance_km || 0) > 1 &&
        (Number(row.productive_ratio || 0) < 0.25 ||
          Number(row.stopped_minutes || 0) > Number(row.moving_minutes || 0) * 2)
    )
    .sort((a, b) => {
      if (a.productive_ratio !== b.productive_ratio) return a.productive_ratio - b.productive_ratio;
      return b.stopped_minutes - a.stopped_minutes;
    });

  return {
    status: rows.length ? "available" : "not_enough_evidence",
    evidence_label:
      "productive time is estimated from moving versus stationary GPS point intervals; it is not engine-on idle, fuel burn, revenue, or profit.",
    analyzed_truck_count: rows.length,
    low_productive_time_count: lowProductiveRows.length,
    low_productive_trucks: lowProductiveRows.slice(0, 15),
    stopped_most_of_day: rows
      .slice()
      .sort((a, b) => b.stopped_minutes - a.stopped_minutes)
      .slice(0, 15),
    missing: rows.length
      ? []
      : uniqueStrings([
          telemetryResult.missing ? "telemetry logs" : "",
          "enough telemetry point intervals for moving/stopped time",
        ]),
  };
}

function buildDriverEfficiencySummary(
  movementTrucks: any[],
  telemetryStatsByTruck: Map<string, TruckTelemetryStats>,
  assignmentsResult: QueryResult<any>,
  assetLookups: ReturnType<typeof buildAssetLookups>,
  timeframe: OperationalEfficiencyTimeframe
) {
  if (assignmentsResult.missing) {
    return {
      status: "unavailable",
      evidence_label: "unavailable",
      reason: "Driver assignment table is not available in this environment.",
      missing: ["asset_driver_assignments"],
    };
  }

  if (!assignmentsResult.rows.length) {
    return {
      status: "not_enough_linked_data",
      evidence_label: "standing driver assignments",
      reason:
        "No driver assignment rows overlap the selected window, so driver efficiency cannot be ranked safely.",
      missing: ["driver assignment rows linked to trucks for the selected window"],
    };
  }

  const assignmentByTruck = new Map<string, any>();
  const assignmentByAssetId = new Map<string, any>();
  for (const assignment of assignmentsResult.rows) {
    if (assignment.asset_id && !assignmentByAssetId.has(assignment.asset_id)) {
      assignmentByAssetId.set(assignment.asset_id, assignment);
    }
    const truckKey = normalizeVehicleKey(assignment.truck_id || "");
    if (truckKey && !assignmentByTruck.has(truckKey)) assignmentByTruck.set(truckKey, assignment);
  }

  const byDriver = new Map<string, any>();
  for (const truck of movementTrucks) {
    if (Number(truck.distance_km || 0) <= 0) continue;
    const stats = telemetryStatsByTruck.get(truck.truck_key);
    const asset = assetLookups.byKey.get(truck.truck_key);
    const assignment =
      (asset?.id && assignmentByAssetId.get(asset.id)) ||
      assignmentByTruck.get(truck.truck_key);
    const driverName = cleanText(assignment?.driver_name);
    if (!driverName) continue;

    const key = normalizeVehicleKey(driverName) || driverName;
    const existing = byDriver.get(key) || {
      driver_name: driverName,
      truck_count: 0,
      truck_ids: [],
      distance_km: 0,
      moving_minutes: 0,
      stopped_minutes: 0,
    };
    existing.truck_count += 1;
    existing.truck_ids.push(truck.truck_id);
    existing.distance_km = roundMetric(existing.distance_km + Number(truck.distance_km || 0));
    existing.moving_minutes += Number(stats?.moving_minutes || 0);
    existing.stopped_minutes += Number(stats?.stopped_minutes || 0);
    byDriver.set(key, existing);
  }

  const rows = Array.from(byDriver.values())
    .map((driver) => ({
      ...driver,
      moving_minutes: Math.round(driver.moving_minutes),
      stopped_minutes: Math.round(driver.stopped_minutes),
      distance_per_moving_hour:
        driver.moving_minutes > 0
          ? roundMetric(driver.distance_km / (driver.moving_minutes / 60))
          : null,
      evidence_label:
        "standing-assignment linked movement; not trip-level driver proof",
    }))
    .sort((a, b) => Number(b.distance_km || 0) - Number(a.distance_km || 0));

  return {
    status: rows.length ? "available_with_caution" : "not_enough_linked_data",
    evidence_label:
      "standing-assignment linked movement; use as a readiness view until journey-level driver linkage is enforced",
    timeframe,
    top_drivers: rows.slice(0, 15),
    missing: rows.length ? [] : ["movement rows linked to overlapping driver assignments"],
  };
}

function buildClientWaitingSummary(journeysResult: QueryResult<any>) {
  const journeysWithClient = journeysResult.rows.filter((journey: any) =>
    cleanText(journey.client_name)
  );

  return {
    status: "not_enough_linked_data",
    evidence_label: "unavailable",
    linked_journey_count: journeysWithClient.length,
    reason:
      "Client waiting time requires GPS-stopped evidence or provider idle markers linked to client sites/geofences or journey legs. Current journey records alone are not enough to rank client-caused waiting safely.",
    missing: uniqueStrings([
      journeysResult.missing ? "journeys table" : "",
      "client-site geofence linkage",
      "GPS-stopped or provider idle-marker linkage to journey/client",
    ]),
  };
}

function classifyStoppedTimeConfidence(input: {
  pointCount: number;
  segmentCount: number;
  largeGapCount: number;
  observedMinutes: number;
  timeframeMinutes: number;
  skippedUnrealisticSegments: number;
}) {
  const coverage = input.observedMinutes / Math.max(1, input.timeframeMinutes);
  if (input.segmentCount < 3 || input.pointCount < 4) {
    return {
      confidence: "low" as const,
      reason:
        "Sparse GPS pings: stopped time is estimated from very few point intervals.",
    };
  }
  if (input.largeGapCount > 0 && coverage < 0.2) {
    return {
      confidence: "low" as const,
      reason:
        "Capped from sparse GPS intervals: long gaps were excluded from the stopped-time estimate.",
    };
  }
  if (coverage < 0.1) {
    return {
      confidence: "low" as const,
      reason:
        "Thin GPS coverage: the estimate covers only a small part of the selected window.",
    };
  }
  if (input.largeGapCount > 0 || input.skippedUnrealisticSegments > 0 || coverage < 0.35) {
    return {
      confidence: "medium" as const,
      reason:
        "Estimated from GPS point intervals with some gaps or filtered segments.",
    };
  }
  return {
    confidence: "high" as const,
    reason: "Estimated from frequent GPS point intervals in the selected window.",
  };
}

function stoppedTimeEvidenceLabel(stats: TruckTelemetryStats) {
  const prefix =
    stats.stopped_time_confidence === "low"
      ? "Low-confidence GPS-estimated stopped intervals"
      : stats.stopped_time_confidence === "medium"
        ? "Medium-confidence GPS-estimated stopped intervals"
        : "GPS-estimated stopped intervals";
  return stats.capped_estimate
    ? `${prefix}; long gaps excluded by the ${MAX_CONTINUOUS_INTERVAL_MINUTES}-minute interval cap`
    : prefix;
}

function assignmentOverlapsTimeframe(
  assignment: any,
  timeframe: OperationalEfficiencyTimeframe
) {
  const status = String(assignment.assignment_status || "").toLowerCase();
  if (status && status !== "active") return false;
  const assignedFromMs = new Date(assignment.assigned_from || 0).getTime();
  const assignedToMs = assignment.assigned_to
    ? new Date(assignment.assigned_to).getTime()
    : Infinity;
  const startMs = new Date(timeframe.start_utc).getTime();
  const endMs = new Date(timeframe.end_utc).getTime();

  if (!Number.isFinite(assignedFromMs)) return false;
  return assignedFromMs < endMs && assignedToMs >= startMs;
}

function sourceStatus(result: QueryResult<any>) {
  if (result.missing) {
    return {
      status: "missing",
      row_count: 0,
      error: result.error || null,
      coverage_status: "missing",
    };
  }
  return {
    status: result.rows.length ? "available" : "empty",
    row_count: result.rows.length,
    coverage_status: result.fetch_status || "complete",
    pages_fetched: result.pages_fetched || null,
    page_size: result.page_size || null,
    row_cap: result.row_cap || null,
    cap_reached: Boolean(result.cap_reached),
    partial_reason: result.partial_reason || null,
    first_recorded_at: result.first_recorded_at || null,
    latest_recorded_at: result.latest_recorded_at || null,
  };
}

function buildMissingDataList(input: {
  assets: EnabledAsset[];
  providerDistanceResult: QueryResult<any>;
  telemetryResult: QueryResult<any>;
  idleEventResult: QueryResult<any>;
  driverAssignmentsResult: QueryResult<any>;
  journeysResult: QueryResult<any>;
}) {
  const missing: string[] = [];
  if (!input.assets.length) missing.push("enabled intelligence assets");
  if (input.providerDistanceResult.missing) missing.push("provider trip summaries");
  if (input.telemetryResult.missing) missing.push("telemetry logs");
  if (input.idleEventResult.missing) missing.push("telemetry events");
  if (input.driverAssignmentsResult.missing || !input.driverAssignmentsResult.rows.length) {
    missing.push("driver assignments linked to selected trucks/dates");
  }
  if (input.journeysResult.missing) missing.push("journey records");
  missing.push("client waiting linkage to stops/geofences is not available yet");
  return uniqueStrings(missing);
}

function effectiveDistanceKm(row: any) {
  const providerMileage = Number(row?.provider_mileage_km || 0);
  if (Number.isFinite(providerMileage) && providerMileage > 0) return providerMileage;
  const odometerDelta = Number(row?.odometer_delta_km || 0);
  if (Number.isFinite(odometerDelta) && odometerDelta > 0) return odometerDelta;
  return 0;
}

function normalizeGpsPoint(row: any) {
  const latitude = Number(row?.latitude);
  const longitude = Number(row?.longitude);
  const timestampQuality = classifyProviderTimestampQuality(row?.recorded_at);
  let timestampMs = timestampQuality.timestamp_ms ?? new Date(row?.recorded_at || 0).getTime();
  if (timestampQuality.status === "future_suspicious") return null;
  if (timestampQuality.status === "slightly_future_clock_skew") {
    timestampMs = Date.now();
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (latitude === 0 && longitude === 0) return null;
  if (!Number.isFinite(timestampMs)) return null;

  return {
    latitude,
    longitude,
    timestampMs,
    speed: Number.isFinite(Number(row?.speed)) ? Number(row.speed) : null,
  };
}

function haversineDistanceKm(first: any, second: any) {
  const radiusKm = 6371;
  const deltaLat = toRadians(second.latitude - first.latitude);
  const deltaLon = toRadians(second.longitude - first.longitude);
  const lat1 = toRadians(first.latitude);
  const lat2 = toRadians(second.latitude);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLon / 2) *
      Math.sin(deltaLon / 2);
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function eventTimeMs(row: any) {
  const quality = classifyProviderTimestampQuality(row?.created_at || row?.started_at);
  if (quality.status === "future_suspicious") return Number.NaN;
  if (quality.status === "slightly_future_clock_skew") return Date.now();
  return quality.timestamp_ms ?? new Date(row?.created_at || row?.started_at || 0).getTime();
}

function normalizeEventType(rowOrType: any) {
  return canonicalProviderIdleEventType(rowOrType);
}

function observedIdleWindowBounds(
  rows: any[],
  timeframe: OperationalEfficiencyTimeframe
) {
  const timeframeStartMs = new Date(timeframe.query_start_utc).getTime();
  const timeframeEndMs = new Date(timeframe.query_end_utc).getTime();
  const starts: number[] = [];
  const ends: number[] = [];

  for (const row of rows) {
    const startMs = eventStartMs(row);
    const endMs = eventEndMs(row, startMs);
    if (Number.isFinite(startMs)) starts.push(clampMs(startMs, timeframeStartMs, timeframeEndMs));
    if (Number.isFinite(endMs)) ends.push(clampMs(endMs, timeframeStartMs, timeframeEndMs));
  }

  const startMs = starts.length ? Math.min(...starts) : Number.NaN;
  const endMs = ends.length ? Math.max(...ends) : startMs;
  const observed =
    Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(0, Math.round((endMs - startMs) / 60000))
      : 0;

  return {
    observed_marker_span_minutes: Math.min(observed, timeframeDurationMinutes(timeframe)),
    observed_marker_start_at: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    observed_marker_end_at: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
  };
}

function providerDurationFromRows(
  rows: any[],
  observedMarkerSpanMinutes: number,
  selectedWindowMinutes: number
) {
  const values = rows
    .map((row) => Number(row?.duration_minutes))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 24 * 60);
  if (!values.length) {
    return {
      safe_provider_duration_minutes: null,
      raw_provider_duration_total_minutes: null,
      status: "unavailable",
      note: "Provider duration field unavailable; using observed marker span.",
    };
  }

  const rawTotal = Math.round(values.reduce((sum, value) => sum + value, 0));
  const allPerEvent = rows
    .filter((row) => Number(row?.duration_minutes) > 0)
    .every((row) => hasVerifiedPerEventDurationSemantics(row));
  const repeatedOrCumulative = !allPerEvent && values.length > 1 && (
    new Set(values).size === 1 ||
    values.every((value, index) => index === 0 || value >= values[index - 1])
  );
  const exceedsSelectedWindow = rawTotal > selectedWindowMinutes;
  const exceedsObservedSpan =
    observedMarkerSpanMinutes > 0 && rawTotal > Math.max(30, observedMarkerSpanMinutes * 1.5);

  if (!allPerEvent || repeatedOrCumulative || exceedsSelectedWindow || exceedsObservedSpan) {
    return {
      safe_provider_duration_minutes: null,
      raw_provider_duration_total_minutes: rawTotal,
      status: "needs_review",
      note: "Provider duration field not summed because semantics are unclear or cumulative.",
    };
  }

  return {
    safe_provider_duration_minutes: rawTotal,
    raw_provider_duration_total_minutes: rawTotal,
    status: "safe",
    note: "Provider duration was summed only from verified per-event duration fields.",
  };
}

function hasVerifiedPerEventDurationSemantics(row: any) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  if (
    metadata.duration_is_per_event === true ||
    metadata.provider_duration_is_per_event === true
  ) {
    return true;
  }
  const text = String(
    metadata.duration_semantics ||
      metadata.provider_duration_semantics ||
      metadata.idle_duration_semantics ||
      metadata.duration_basis ||
      ""
  )
    .toLowerCase()
    .replace(/[_\s-]+/g, "_");
  return ["per_event", "event_duration", "single_event"].includes(text);
}

function eventStartMs(row: any) {
  const quality = classifyProviderTimestampQuality(row?.started_at || row?.created_at);
  if (quality.status === "future_suspicious") return Number.NaN;
  if (quality.status === "slightly_future_clock_skew") return Date.now();
  return quality.timestamp_ms ?? new Date(row?.started_at || row?.created_at || 0).getTime();
}

function eventEndMs(row: any, fallbackStartMs: number) {
  if (!row?.ended_at) return fallbackStartMs;
  const quality = classifyProviderTimestampQuality(row.ended_at);
  if (quality.status === "future_suspicious") return Number.NaN;
  if (quality.status === "slightly_future_clock_skew") return Date.now();
  const ms = quality.timestamp_ms ?? new Date(row.ended_at).getTime();
  return Number.isFinite(ms) && ms >= fallbackStartMs ? ms : fallbackStartMs;
}

function timeframeDurationMinutes(timeframe: OperationalEfficiencyTimeframe) {
  const startMs = new Date(timeframe.query_start_utc).getTime();
  const endMs = new Date(timeframe.query_end_utc).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 24 * 60;
  return Math.max(1, Math.round((endMs - startMs) / 60000));
}

function clampMs(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return Number.NaN;
  return Math.min(Math.max(value, min), max);
}

function displayTruckLabel(value: any, asset?: EnabledAsset | null) {
  return (
    cleanTruckId(asset?.registration) ||
    cleanTruckId(asset?.truck_id) ||
    cleanTruckId(value) ||
    "Unknown truck"
  );
}

function cleanTruckId(value: any) {
  const text = cleanText(value);
  return text ? text.toUpperCase() : "";
}

function cleanText(value: any) {
  const text = String(value || "").trim();
  if (!text || text === "-" || text.toLowerCase() === "null") return "";
  return text;
}

function isFinitePositive(value: any) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function roundMetric(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function isMissingSchemaError(error: any) {
  const message = safeErrorMessage(error).toLowerCase();
  return (
    message.includes("does not exist") ||
    message.includes("could not find") ||
    message.includes("schema cache") ||
    message.includes("column") ||
    message.includes("relation")
  );
}

function isMissingColumnError(error: any) {
  const message = safeErrorMessage(error).toLowerCase();
  return message.includes("column") || message.includes("schema cache");
}

function safeErrorMessage(error: any) {
  return String(error?.message || error?.details || error || "").slice(0, 200);
}

function formatLocalDayLabel(localDay: string | null) {
  if (!localDay) return "selected day";
  const date = new Date(`${localDay}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return localDay;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatLocalBoundary(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(date)} ${shortTimeZoneLabel(timeZone)}`;
}

function shortTimeZoneLabel(timeZone: string) {
  return timeZone === DEFAULT_OPERATIONAL_TIME_ZONE ? "EAT" : timeZone;
}
