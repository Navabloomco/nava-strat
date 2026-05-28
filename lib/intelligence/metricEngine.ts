import { supabaseAdmin } from "../supabaseAdmin";
import { normalizeVehicleKey } from "./entityResolver";
import { distanceEvidenceWording } from "../telemetry/distance";
import {
  DEFAULT_OPERATIONAL_TIME_ZONE,
  resolveOperationalDayRange,
  resolveOperationalTimeZone,
} from "../timeFormatting";

export type BusinessMetricIntent =
  | "profit_readiness"
  | "contribution_per_km"
  | "moved_without_revenue"
  | "distance_covered"
  | "odometer_reliability"
  | "distance_status"
  | "missing_profit_data";

export type BusinessMetricTimeframe = {
  requested: "today" | "yesterday" | "day_before_yesterday" | "all_available";
  dayOffset: number | null;
  local_day: string | null;
  day_start_utc: string | null;
  day_end_utc: string | null;
  display_label: string;
};

type MetricFilters = {
  companyId: string;
  truckId?: string | null;
  assetId?: string | null;
  timeframe?: BusinessMetricTimeframe | null;
};

type QueryResult<T> = {
  rows: T[];
  missing?: boolean;
  error?: string | null;
};

const FINANCE_TABLE_ERROR =
  "Finance tables or columns are not fully available in this environment.";
const DISTANCE_TABLE_ERROR =
  "Distance evidence table or columns are not fully available in this environment.";

export function detectBusinessMetricIntent(input: string): BusinessMetricIntent | null {
  const lower = String(input || "")
    .toLowerCase()
    .replace(/[’]/g, "'");

  if (
    /\b(moved|movement|moving|travelled|traveled|distance)\b/.test(lower) &&
    /\b(no revenue|without revenue|missing revenue|unbilled|not billed)\b/.test(lower)
  ) {
    return "moved_without_revenue";
  }

  if (asksForMileageOrDistanceCovered(lower)) {
    return "distance_covered";
  }

  if (
    /\b(odometer|odo|mileage)\b/.test(lower) &&
    /\b(trust|reliable|reliability|status|working|broken|valid|static|zero|mismatch)\b/.test(
      lower
    )
  ) {
    return "odometer_reliability";
  }

  if (
    /\b(distance status|distance evidence|distance source|mileage status)\b/.test(lower)
  ) {
    return "distance_status";
  }

  if (
    /\b(what data|what's missing|what is missing|missing data|need before)\b/.test(
      lower
    ) &&
    /\b(profit|contribution|revenue per km|cost per km|make money|money)\b/.test(
      lower
    )
  ) {
    return "missing_profit_data";
  }

  if (
    /\b(contribution per km|contribution\/km|revenue per km|cost per km|profit per km|margin per km)\b/.test(
      lower
    )
  ) {
    return "contribution_per_km";
  }

  if (
    /\b(make money|made money|profit|profitable|profitability|loss|losing money|revenue|cost per km|costs? per km)\b/.test(
      lower
    )
  ) {
    return "profit_readiness";
  }

  return null;
}

export function resolveBusinessMetricTimeframe(
  input: string,
  company: any = {}
): BusinessMetricTimeframe {
  const lower = String(input || "")
    .toLowerCase()
    .replace(/[’]/g, "'");
  const timeZone = resolveOperationalTimeZone(company);

  if (
    lower.includes("day_before_yesterday") ||
    lower.includes("day before yesterday") ||
    lower.includes("day-before-yesterday") ||
    lower.includes("two days ago") ||
    lower.includes("previous previous day")
  ) {
    return buildMetricDayRange(timeZone, -2, "day_before_yesterday");
  }

  if (
    lower.includes("yesterday") ||
    lower.includes("previous day") ||
    lower.includes("previous-day") ||
    lower.includes("last operating day")
  ) {
    return buildMetricDayRange(timeZone, -1, "yesterday");
  }

  if (
    lower.includes("today") ||
    lower.includes("same day") ||
    lower.includes("same-day") ||
    lower.includes("current day")
  ) {
    return buildMetricDayRange(timeZone, 0, "today");
  }

  return {
    requested: "all_available",
    dayOffset: null,
    local_day: null,
    day_start_utc: null,
    day_end_utc: null,
    display_label: "all available records",
  };
}

export async function buildBusinessMetricContext(input: {
  companyId: string;
  company?: any;
  intent: BusinessMetricIntent;
  truckId?: string | null;
  assetId?: string | null;
  timeframe?: BusinessMetricTimeframe | null;
}) {
  const filters = {
    companyId: input.companyId,
    truckId: input.truckId || null,
    assetId: input.assetId || null,
    timeframe: input.timeframe || null,
  };

  if (input.intent === "moved_without_revenue") {
    return {
      type: input.intent,
      timeframe: input.timeframe || null,
      moved_without_revenue: await findMovedButNoRevenue(filters),
    };
  }

  if (
    input.intent === "distance_covered" ||
    input.intent === "odometer_reliability" ||
    input.intent === "distance_status"
  ) {
    return {
      type: input.intent,
      timeframe: input.timeframe || null,
      distance: await calculateDistanceSummary(filters),
      odometer: await calculateOdometerReliability(filters),
    };
  }

  const [distance, finance] = await Promise.all([
    calculateDistanceSummary(filters),
    calculateFinanceDataReadiness(filters),
  ]);
  const contribution = calculateContributionReadiness(distance, finance);

  return {
    type: input.intent,
    timeframe: input.timeframe || null,
    distance,
    finance,
    contribution,
  };
}

export async function calculateDistanceSummary(filters: MetricFilters) {
  const [asset, summaries] = await Promise.all([
    resolveMetricAsset(filters.companyId, filters.truckId, filters.assetId),
    fetchProviderTripSummaries(filters),
  ]);

  const rows = summaries.rows;
  const evidenceRows = rows.filter((row: any) => effectiveDistanceKm(row) > 0);
  let distanceKm = roundMetric(
    evidenceRows.reduce((sum: number, row: any) => sum + effectiveDistanceKm(row), 0)
  );
  const gpsFallback =
    distanceKm > 0 ? null : await calculateGpsDerivedDistance(filters);
  const sourceCounts = countBy(
    evidenceRows.map((row: any) => row.distance_source || inferDistanceSource(row))
  );
  if (gpsFallback && gpsFallback.distance_km > 0) {
    distanceKm = gpsFallback.distance_km;
    sourceCounts.gps_estimated = gpsFallback.truck_count || 1;
  }
  const odometerHealthValues = [
    ...rows.map((row: any) => normalizeMetricText(row.odometer_health)),
    normalizeMetricText(asset?.odometer_health),
  ].filter(Boolean);
  const distanceQualityValues = [
    ...rows.map((row: any) => normalizeMetricText(row.distance_quality)),
    normalizeMetricText(readDistanceQualityStatus(asset?.distance_quality)),
  ].filter(Boolean);
  const odometerHealth = strongestOdometerHealth(odometerHealthValues);
  const distanceQuality = strongestDistanceQuality(distanceQualityValues);
  const representative = rows.find((row: any) => effectiveDistanceKm(row) > 0) || rows[0] || null;
  const missing: string[] = [];

  if (summaries.missing) missing.push(DISTANCE_TABLE_ERROR);
  if (!rows.length && (!gpsFallback || gpsFallback.distance_km <= 0)) {
    missing.push("provider trip summaries or enough valid telemetry points for GPS distance");
  } else if (distanceKm <= 0) {
    missing.push("positive distance evidence");
  }

  return {
    distance_km: distanceKm,
    distance_source:
      gpsFallback && gpsFallback.distance_km > 0
        ? "gps_estimated"
        : Object.keys(sourceCounts).length === 1
          ? Object.keys(sourceCounts)[0]
          : Object.keys(sourceCounts).length > 1
            ? "mixed"
            : "unknown",
    primary_distance_source:
      gpsFallback && gpsFallback.distance_km > 0
        ? "gps_estimated"
        : evidenceRows.some((row: any) => Number(row.provider_mileage_km || 0) > 0)
          ? "provider_mileage"
          : evidenceRows.some((row: any) => Number(row.odometer_delta_km || 0) > 0)
            ? "physical_odometer"
            : "unknown",
    provider_distance_available: evidenceRows.length > 0,
    gps_fallback: gpsFallback,
    evidence_count:
      rows.length + (gpsFallback && gpsFallback.distance_km > 0 ? gpsFallback.segment_count : 0),
    provider_summary_count: rows.length,
    telemetry_point_count: gpsFallback?.point_count || 0,
    source_counts: sourceCounts,
    odometer_health: odometerHealth,
    distance_quality:
      gpsFallback && gpsFallback.distance_km > 0 && distanceQuality === "unknown"
        ? "estimated"
        : distanceQuality,
    reliability_wording: distanceEvidenceWording({
      odometerHealth,
      distanceSource: representative?.distance_source || null,
      providerMileageKm: representative?.provider_mileage_km ?? null,
      odometerDeltaKm: representative?.odometer_delta_km ?? null,
    }),
    asset: sanitizeAsset(asset),
    timeframe: filters.timeframe || null,
    missing,
    setup_issue: summaries.error || gpsFallback?.setup_issue || null,
  };
}

async function calculateGpsDerivedDistance(filters: MetricFilters) {
  const assetRows = await fetchDistanceAssets(filters);
  const assetTruckIds = Array.from(
    new Set(
      assetRows
        .flatMap((asset: any) => [asset.truck_id, asset.registration])
        .filter(Boolean)
    )
  );

  if (!assetTruckIds.length) {
    return {
      distance_km: 0,
      source: "gps_estimated",
      point_count: 0,
      segment_count: 0,
      truck_count: 0,
      skipped_invalid_points: 0,
      skipped_unrealistic_segments: 0,
      skipped_stationary_jitter_segments: 0,
      missing: ["enabled intelligence asset for GPS distance"],
    };
  }

  const telemetryResult = await fetchDistanceTelemetry(filters, assetTruckIds);
  const rows = telemetryResult.rows;
  if (telemetryResult.missing) {
    return {
      distance_km: 0,
      source: "gps_estimated",
      point_count: 0,
      segment_count: 0,
      truck_count: 0,
      skipped_invalid_points: 0,
      skipped_unrealistic_segments: 0,
      skipped_stationary_jitter_segments: 0,
      missing: ["telemetry logs for GPS distance"],
      setup_issue: telemetryResult.error || null,
    };
  }

  const rowsByTruck = new Map<string, any[]>();
  for (const row of rows) {
    const truckKey = normalizeVehicleKey(row.truck_id);
    if (!truckKey) continue;
    const group = rowsByTruck.get(truckKey) || [];
    group.push(row);
    rowsByTruck.set(truckKey, group);
  }

  let distanceKm = 0;
  let pointCount = 0;
  let segmentCount = 0;
  let skippedInvalidPoints = 0;
  let skippedUnrealisticSegments = 0;
  let skippedStationaryJitterSegments = 0;
  const truckSummaries: Array<{ truck_id: string; distance_km: number; points: number }> = [];

  for (const groupRows of Array.from(rowsByTruck.values())) {
    const sorted = groupRows
      .slice()
      .sort((a: any, b: any) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
    let previous: any = null;
    let truckDistanceKm = 0;
    let truckPointCount = 0;

    for (const row of sorted) {
      const point = normalizeGpsPoint(row);
      if (!point) {
        skippedInvalidPoints += 1;
        continue;
      }
      pointCount += 1;
      truckPointCount += 1;

      if (!previous) {
        previous = point;
        continue;
      }

      const elapsedHours = (point.timestampMs - previous.timestampMs) / 3600000;
      if (!Number.isFinite(elapsedHours) || elapsedHours <= 0) {
        previous = point;
        continue;
      }

      const segmentKm = haversineDistanceKm(previous, point);
      const impliedSpeed = segmentKm / elapsedHours;
      const bothStationary =
        Number(previous.speed || 0) <= 5 && Number(point.speed || 0) <= 5;

      if (segmentKm <= 0) {
        previous = point;
        continue;
      }
      if (bothStationary && segmentKm <= 0.05) {
        skippedStationaryJitterSegments += 1;
        previous = point;
        continue;
      }
      if (impliedSpeed > 160) {
        skippedUnrealisticSegments += 1;
        previous = point;
        continue;
      }

      truckDistanceKm += segmentKm;
      segmentCount += 1;
      previous = point;
    }

    if (truckDistanceKm > 0) {
      truckSummaries.push({
        truck_id: String(sorted[0]?.truck_id || "").toUpperCase(),
        distance_km: roundMetric(truckDistanceKm),
        points: truckPointCount,
      });
      distanceKm += truckDistanceKm;
    }
  }

  return {
    distance_km: roundMetric(distanceKm),
    source: "gps_estimated",
    point_count: pointCount,
    segment_count: segmentCount,
    truck_count: truckSummaries.length,
    truck_summaries: truckSummaries.slice(0, 20),
    skipped_invalid_points: skippedInvalidPoints,
    skipped_unrealistic_segments: skippedUnrealisticSegments,
    skipped_stationary_jitter_segments: skippedStationaryJitterSegments,
    rows_truncated: rows.length >= 12000,
    missing:
      pointCount < 2 || segmentCount === 0
        ? ["enough valid telemetry points to estimate GPS distance"]
        : [],
  };
}

async function fetchDistanceAssets(filters: MetricFilters) {
  try {
    const { data, error } = await supabaseAdmin
      .from("fleet_assets")
      .select("id, truck_id, registration")
      .eq("company_id", filters.companyId)
      .eq("status", "active")
      .eq("intelligence_enabled", true)
      .limit(1000);

    if (error) {
      if (isMissingSchemaError(error)) return [];
      throw error;
    }

    const truckKey = normalizeVehicleKey(filters.truckId || "");
    if (!truckKey) return data || [];
    return (data || []).filter(
      (asset: any) =>
        normalizeVehicleKey(asset.truck_id) === truckKey ||
        normalizeVehicleKey(asset.registration) === truckKey
    );
  } catch (err: any) {
    if (isMissingSchemaError(err)) return [];
    throw err;
  }
}

async function fetchDistanceTelemetry(
  filters: MetricFilters,
  truckIds: string[]
): Promise<QueryResult<any>> {
  try {
    let query = supabaseAdmin
      .from("telemetry_logs")
      .select("truck_id, recorded_at, latitude, longitude, speed")
      .eq("company_id", filters.companyId)
      .in("truck_id", truckIds)
      .order("recorded_at", { ascending: true })
      .limit(12000);

    if (filters.timeframe?.day_start_utc) {
      query = query.gte("recorded_at", filters.timeframe.day_start_utc);
    }
    if (filters.timeframe?.day_end_utc) {
      query = query.lt("recorded_at", filters.timeframe.day_end_utc);
    }

    const { data, error } = await query;
    if (error) {
      if (!isMissingSchemaError(error)) throw error;
      return { rows: [], missing: true, error: safeErrorMessage(error) };
    }

    return { rows: data || [] };
  } catch (err: any) {
    if (isMissingSchemaError(err)) {
      return { rows: [], missing: true, error: safeErrorMessage(err) };
    }
    throw err;
  }
}

function normalizeGpsPoint(row: any) {
  const latitude = Number(row?.latitude);
  const longitude = Number(row?.longitude);
  const timestampMs = new Date(row?.recorded_at || 0).getTime();
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

function asksForMileageOrDistanceCovered(lower: string) {
  return (
    /\b(how much mileage|mileage covered|covered mileage|mileage today|mileage yesterday)\b/.test(
      lower
    ) ||
    /\b(distance covered|covered distance|distance today|distance yesterday)\b/.test(
      lower
    ) ||
    /\bhow far\b/.test(lower) ||
    /\bhow many\s+km\b/.test(lower) ||
    /\bhow many\s+kilomet(?:er|re)s?\b/.test(lower) ||
    /\bkm\s+covered\b/.test(lower) ||
    /\bkilomet(?:er|re)s?\s+covered\b/.test(lower)
  );
}

export async function calculateFinanceDataReadiness(filters: MetricFilters) {
  const [journeysResult, fuelResult, expensesResult] = await Promise.all([
    fetchJourneys(filters),
    fetchFuelLogs(filters),
    fetchExpenses(filters),
  ]);

  const journeyRows = journeysResult.rows;
  const journeyIds = new Set(journeyRows.map((journey: any) => journey.id).filter(Boolean));
  const truckKey = normalizeVehicleKey(filters.truckId || "");
  const fuelRows = fuelResult.rows.filter((fuel: any) =>
    financeRowMatchesScope(fuel, truckKey, journeyIds, "truck_text")
  );
  const expenseRows = expensesResult.rows.filter((expense: any) =>
    financeRowMatchesScope(expense, truckKey, journeyIds, "truck")
  );
  const revenueRows = journeyRows.filter((journey: any) => Number(journey.revenue_kes || 0) > 0);
  const revenue = roundMoney(
    revenueRows.reduce((sum: number, journey: any) => sum + Number(journey.revenue_kes || 0), 0)
  );
  const fuelCost = roundMoney(
    fuelRows.reduce((sum: number, fuel: any) => sum + Number(fuel.total_cost || 0), 0)
  );
  const expenseCost = roundMoney(
    expenseRows.reduce((sum: number, expense: any) => sum + Number(expense.amount || 0), 0)
  );
  const variableCosts = roundMoney(fuelCost + expenseCost);
  const missing: string[] = [];

  if (journeysResult.missing || fuelResult.missing || expensesResult.missing) {
    missing.push(FINANCE_TABLE_ERROR);
  }
  if (!journeyRows.length) {
    missing.push(
      filters.truckId
        ? "journey or revenue records linked to this truck/date"
        : "journey or revenue records for this date range"
    );
  }
  if (!revenueRows.length) missing.push("linked revenue");
  if (!fuelRows.length && !expenseRows.length) missing.push("linked variable costs");

  return {
    revenue,
    fuel_cost: fuelCost,
    expense_cost: expenseCost,
    variable_costs: variableCosts,
    journey_count: journeyRows.length,
    revenue_record_count: revenueRows.length,
    fuel_record_count: fuelRows.length,
    expense_record_count: expenseRows.length,
    has_revenue: revenueRows.length > 0,
    has_cost_records: fuelRows.length + expenseRows.length > 0,
    matching_basis: filters.truckId
      ? "truck text plus journey_id where present"
      : "company date range",
    missing: uniqueStrings(missing),
    setup_issue:
      journeysResult.error || fuelResult.error || expensesResult.error || null,
  };
}

export function calculateContributionReadiness(distance: any, finance: any) {
  const missing = uniqueStrings([
    ...(Array.isArray(distance?.missing) ? distance.missing : []),
    ...(Array.isArray(finance?.missing) ? finance.missing : []),
  ]);
  const distanceKm = Number(distance?.distance_km || 0);
  const revenue = Number(finance?.revenue || 0);
  const variableCosts = Number(finance?.variable_costs || 0);

  if (distanceKm <= 0 || !finance?.has_revenue || !finance?.has_cost_records) {
    return {
      calculable: false,
      missing,
      revenue,
      variable_costs: variableCosts,
      distance_km: distanceKm,
      contribution: null,
      contribution_per_km: null,
      revenue_per_km: null,
      cost_per_km: null,
    };
  }

  const contribution = roundMoney(revenue - variableCosts);

  return {
    calculable: true,
    missing: [],
    revenue,
    variable_costs: variableCosts,
    distance_km: distanceKm,
    contribution,
    contribution_per_km: roundMoney(contribution / distanceKm),
    revenue_per_km: roundMoney(revenue / distanceKm),
    cost_per_km: roundMoney(variableCosts / distanceKm),
  };
}

export async function findMovedButNoRevenue(filters: MetricFilters) {
  const summaries = await fetchProviderTripSummaries(filters);
  const movedByTruck = new Map<string, { truck_id: string; distance_km: number; rows: number }>();

  for (const row of summaries.rows) {
    const truckId = String(row.truck_id || "").trim().toUpperCase();
    const key = normalizeVehicleKey(truckId);
    const distanceKm = effectiveDistanceKm(row);
    if (!truckId || !key || distanceKm <= 0) continue;
    const existing = movedByTruck.get(key) || { truck_id: truckId, distance_km: 0, rows: 0 };
    existing.distance_km = roundMetric(existing.distance_km + distanceKm);
    existing.rows += 1;
    movedByTruck.set(key, existing);
  }

  const journeysResult = await fetchJourneys({ ...filters, truckId: null });
  const revenueTruckKeys = new Set(
    journeysResult.rows
      .filter((journey: any) => Number(journey.revenue_kes || 0) > 0)
      .map((journey: any) => normalizeVehicleKey(journey.truck))
      .filter(Boolean)
  );
  const movedTrucks = Array.from(movedByTruck.values());
  const missing: string[] = [];

  if (summaries.missing) missing.push(DISTANCE_TABLE_ERROR);
  if (journeysResult.missing) missing.push(FINANCE_TABLE_ERROR);
  if (!movedTrucks.length) missing.push("movement/distance evidence");

  const reliableTripRevenueLinking = false;

  return {
    can_complete_reliably: reliableTripRevenueLinking,
    reason:
      "Movement evidence exists at provider report/truck level, but revenue is not linked to provider trip summaries. A reliable moved-without-revenue list requires trip or revenue records tied to the same truck/date movement.",
    moved_truck_count: movedTrucks.length,
    trucks_with_revenue_count: revenueTruckKeys.size,
    candidate_trucks_without_revenue: reliableTripRevenueLinking
      ? movedTrucks.filter((truck) => !revenueTruckKeys.has(normalizeVehicleKey(truck.truck_id)))
      : [],
    evidence_sample: movedTrucks.slice(0, 8),
    timeframe: filters.timeframe || null,
    missing: uniqueStrings(missing),
    setup_issue: summaries.error || journeysResult.error || null,
  };
}

export async function calculateOdometerReliability(filters: MetricFilters) {
  const [asset, distance] = await Promise.all([
    resolveMetricAsset(filters.companyId, filters.truckId, filters.assetId),
    calculateDistanceSummary(filters),
  ]);
  const health =
    normalizeMetricText(asset?.odometer_health) ||
    normalizeMetricText(distance.odometer_health) ||
    "unknown";
  const quality =
    normalizeMetricText(readDistanceQualityStatus(asset?.distance_quality)) ||
    normalizeMetricText(distance.distance_quality) ||
    "unknown";
  const status = classifyOdometerStatus(health, quality, distance.distance_km);

  return {
    status,
    odometer_health: health,
    distance_quality: quality,
    distance_km: distance.distance_km,
    evidence_count: distance.evidence_count,
    wording: distanceEvidenceWording({
      odometerHealth: health,
      distanceSource: distance.distance_source,
    }),
    missing:
      status === "unknown"
        ? uniqueStrings([...(distance.missing || []), "odometer health evidence"])
        : distance.missing || [],
    asset: sanitizeAsset(asset),
  };
}

function buildMetricDayRange(
  timeZone: string,
  dayOffset: number,
  requested: "today" | "yesterday" | "day_before_yesterday"
): BusinessMetricTimeframe {
  const range = resolveOperationalDayRange(timeZone, dayOffset);
  const displayDate = formatLocalDayLabel(range.localDate);
  return {
    requested,
    dayOffset,
    local_day: range.localDate,
    day_start_utc: range.startUtc,
    day_end_utc: range.endUtc,
    display_label: `${displayDate} (${shortTimeZoneLabel(timeZone)})`,
  };
}

async function fetchProviderTripSummaries(filters: MetricFilters): Promise<QueryResult<any>> {
  try {
    let query = supabaseAdmin
      .from("provider_trip_summaries")
      .select(
        "id, company_id, asset_id, truck_id, report_date, start_time, end_time, provider_mileage_km, odometer_delta_km, distance_source, distance_quality, odometer_health"
      )
      .eq("company_id", filters.companyId)
      .order("report_date", { ascending: true })
      .limit(2000);

    if (filters.assetId) query = query.eq("asset_id", filters.assetId);
    if (filters.timeframe?.local_day) {
      query = query.eq("report_date", filters.timeframe.local_day);
    }

    const { data, error } = await query;
    if (error) {
      if (
        isMissingColumnError(error) &&
        safeErrorMessage(error).toLowerCase().includes("odometer_health")
      ) {
        return fetchProviderTripSummariesWithoutOdometerHealth(filters);
      }
      if (!isMissingSchemaError(error)) throw error;
      return { rows: [], missing: true, error: safeErrorMessage(error) };
    }

    const truckKey = normalizeVehicleKey(filters.truckId || "");
    const rows = truckKey
      ? (data || []).filter((row: any) => normalizeVehicleKey(row.truck_id) === truckKey)
      : data || [];

    return { rows };
  } catch (err: any) {
    if (isMissingSchemaError(err)) {
      return { rows: [], missing: true, error: safeErrorMessage(err) };
    }
    throw err;
  }
}

async function fetchProviderTripSummariesWithoutOdometerHealth(
  filters: MetricFilters
): Promise<QueryResult<any>> {
  let query = supabaseAdmin
    .from("provider_trip_summaries")
    .select(
      "id, company_id, asset_id, truck_id, report_date, start_time, end_time, provider_mileage_km, odometer_delta_km, distance_source, distance_quality"
    )
    .eq("company_id", filters.companyId)
    .order("report_date", { ascending: true })
    .limit(2000);

  if (filters.assetId) query = query.eq("asset_id", filters.assetId);
  if (filters.timeframe?.local_day) {
    query = query.eq("report_date", filters.timeframe.local_day);
  }

  const { data, error } = await query;
  if (error) {
    if (!isMissingSchemaError(error)) throw error;
    return { rows: [], missing: true, error: safeErrorMessage(error) };
  }

  const truckKey = normalizeVehicleKey(filters.truckId || "");
  const rows = truckKey
    ? (data || []).filter((row: any) => normalizeVehicleKey(row.truck_id) === truckKey)
    : data || [];

  return { rows };
}

async function fetchJourneys(filters: MetricFilters): Promise<QueryResult<any>> {
  try {
    let query = supabaseAdmin
      .from("journeys")
      .select("id, truck, status, revenue_kes, created_at")
      .eq("company_id", filters.companyId)
      .eq("is_demo", false)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (filters.timeframe?.day_start_utc) {
      query = query.gte("created_at", filters.timeframe.day_start_utc);
    }
    if (filters.timeframe?.day_end_utc) {
      query = query.lt("created_at", filters.timeframe.day_end_utc);
    }

    const { data, error } = await query;
    if (error) {
      if (!isMissingSchemaError(error)) throw error;
      return { rows: [], missing: true, error: safeErrorMessage(error) };
    }

    const truckKey = normalizeVehicleKey(filters.truckId || "");
    const rows = truckKey
      ? (data || []).filter((row: any) => normalizeVehicleKey(row.truck) === truckKey)
      : data || [];

    return { rows };
  } catch (err: any) {
    if (isMissingSchemaError(err)) {
      return { rows: [], missing: true, error: safeErrorMessage(err) };
    }
    throw err;
  }
}

async function fetchFuelLogs(filters: MetricFilters): Promise<QueryResult<any>> {
  try {
    let query = supabaseAdmin
      .from("fuel_logs")
      .select("id, journey_id, truck_text, total_cost, created_at")
      .eq("company_id", filters.companyId)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (filters.timeframe?.day_start_utc) {
      query = query.gte("created_at", filters.timeframe.day_start_utc);
    }
    if (filters.timeframe?.day_end_utc) {
      query = query.lt("created_at", filters.timeframe.day_end_utc);
    }

    const { data, error } = await query;
    if (error) {
      if (!isMissingSchemaError(error)) throw error;
      return { rows: [], missing: true, error: safeErrorMessage(error) };
    }

    return { rows: data || [] };
  } catch (err: any) {
    if (isMissingSchemaError(err)) {
      return { rows: [], missing: true, error: safeErrorMessage(err) };
    }
    throw err;
  }
}

async function fetchExpenses(filters: MetricFilters): Promise<QueryResult<any>> {
  try {
    let query = supabaseAdmin
      .from("expenses")
      .select("id, journey_id, truck, amount, created_at")
      .eq("company_id", filters.companyId)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (filters.timeframe?.day_start_utc) {
      query = query.gte("created_at", filters.timeframe.day_start_utc);
    }
    if (filters.timeframe?.day_end_utc) {
      query = query.lt("created_at", filters.timeframe.day_end_utc);
    }

    const { data, error } = await query;
    if (error) {
      if (!isMissingSchemaError(error)) throw error;
      return { rows: [], missing: true, error: safeErrorMessage(error) };
    }

    return { rows: data || [] };
  } catch (err: any) {
    if (isMissingSchemaError(err)) {
      return { rows: [], missing: true, error: safeErrorMessage(err) };
    }
    throw err;
  }
}

async function resolveMetricAsset(
  companyId: string,
  truckId?: string | null,
  assetId?: string | null
) {
  try {
    let query = supabaseAdmin
      .from("fleet_assets")
      .select("id, truck_id, registration, odometer_health, distance_quality")
      .eq("company_id", companyId)
      .eq("status", "active")
      .limit(1000);

    if (assetId) query = query.eq("id", assetId);

    const { data, error } = await query;
    if (error) {
      if (isMissingSchemaError(error)) return null;
      throw error;
    }

    if (assetId) return data?.[0] || null;

    const truckKey = normalizeVehicleKey(truckId || "");
    if (!truckKey) return null;
    return (
      (data || []).find(
        (asset: any) =>
          normalizeVehicleKey(asset.truck_id) === truckKey ||
          normalizeVehicleKey(asset.registration) === truckKey
      ) || null
    );
  } catch (err: any) {
    if (isMissingSchemaError(err)) return null;
    throw err;
  }
}

function financeRowMatchesScope(
  row: any,
  truckKey: string,
  journeyIds: Set<string>,
  truckField: string
) {
  if (!truckKey) return true;
  if (row.journey_id && journeyIds.has(row.journey_id)) return true;
  return normalizeVehicleKey(row[truckField]) === truckKey;
}

function effectiveDistanceKm(row: any) {
  const providerMileage = Number(row?.provider_mileage_km || 0);
  if (Number.isFinite(providerMileage) && providerMileage > 0) return providerMileage;
  const odometerDelta = Number(row?.odometer_delta_km || 0);
  if (Number.isFinite(odometerDelta) && odometerDelta > 0) return odometerDelta;
  return 0;
}

function inferDistanceSource(row: any) {
  if (Number(row?.provider_mileage_km || 0) > 0) return "provider_mileage";
  if (Number(row?.odometer_delta_km || 0) > 0) return "physical_odometer";
  return "unknown";
}

function strongestOdometerHealth(values: string[]) {
  const order = [
    "static_zero",
    "static_nonzero",
    "rollover_suspected",
    "mismatch",
    "valid",
    "unknown",
  ];
  return order.find((value) => values.includes(value)) || "unknown";
}

function strongestDistanceQuality(values: string[]) {
  if (values.includes("suspect")) return "suspect";
  if (values.includes("mismatch")) return "suspect";
  if (values.includes("valid")) return "valid";
  return values[0] || "unknown";
}

function classifyOdometerStatus(health: string, quality: string, distanceKm: number) {
  if (health === "valid" && quality !== "suspect") return "reliable";
  if (["static_zero", "static_nonzero"].includes(health)) return "unreliable";
  if (["mismatch", "rollover_suspected"].includes(health) || quality === "suspect") {
    return "caution";
  }
  if (distanceKm > 0) return "caution";
  return "unknown";
}

function readDistanceQualityStatus(value: any) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if (value.distance_quality) return String(value.distance_quality);
    if (value.mismatch) return "suspect";
    if (value.distance_source) return String(value.distance_source);
  }
  return null;
}

function sanitizeAsset(asset: any) {
  if (!asset) return null;
  return {
    id: asset.id || null,
    truck_id: asset.truck_id || null,
    registration: asset.registration || null,
    odometer_health: asset.odometer_health || null,
    distance_quality: readDistanceQualityStatus(asset.distance_quality),
  };
}

function countBy(values: string[]) {
  return values.reduce((counts: Record<string, number>, value) => {
    const key = normalizeMetricText(value) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function normalizeMetricText(value: any) {
  return String(value || "").trim().toLowerCase();
}

function roundMetric(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function roundMoney(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
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

function shortTimeZoneLabel(timeZone: string) {
  return timeZone === DEFAULT_OPERATIONAL_TIME_ZONE ? "EAT" : timeZone;
}
