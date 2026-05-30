import { supabaseAdmin } from "../supabaseAdmin";
import {
  DEFAULT_OPERATIONAL_TIME_ZONE,
  resolveOperationalDayRange,
  resolveOperationalTimeZone,
} from "../timeFormatting";
import {
  buildAssetAvailabilityLookup,
  fetchActiveAssetAvailabilityEvents,
  findAssetAvailabilityForTarget,
  isKnownUnavailableAvailability,
  labelAssetAvailabilityStatus,
} from "../operations/assetAvailability";
import { readStoredVehicleIdentityContext } from "../providers/vehicleIdentity";
import { normalizeVehicleKey } from "./entityResolver";
import { getTruckMovementSummaryForRange } from "./operationalEfficiency";
import { buildTruckTimelineIntelligence } from "./truckTimelineService";
import { buildBusinessMetricContext } from "./metricEngine";

type TruckDayStoryTimeframe = {
  requested?: "today" | "yesterday" | "day_before_yesterday";
  dayOffset?: number;
  day_offset?: number;
};

export async function buildTruckDayStory(input: {
  companyId: string;
  company?: any;
  truckId: string;
  timeframe?: TruckDayStoryTimeframe | null;
}) {
  const timeZone = resolveOperationalTimeZone(input.company || {});
  const timeframe = normalizeTruckDayStoryTimeframe(input.timeframe);
  const dayRange = resolveOperationalDayRange(timeZone, timeframe.dayOffset);
  const truckKey = normalizeVehicleKey(input.truckId);

  const [asset, timeline, movementRow, metricFallback, availability, activeTrip] =
    await Promise.all([
      fetchStoryAsset(input.companyId, truckKey),
      buildTruckTimelineIntelligence({
        companyId: input.companyId,
        truckId: input.truckId,
        dayOffset: timeframe.dayOffset,
        timeframe:
          timeframe.requested === "day_before_yesterday"
            ? "day_before_yesterday"
            : timeframe.requested,
        timeZone,
        maxBlocks: 14,
      }),
      fetchMovementRow(input.companyId, input.company || {}, truckKey, timeframe.requested),
      fetchDistanceFallback(input.companyId, input.company || {}, input.truckId, timeframe),
      fetchAvailability(input.companyId, input.truckId),
      fetchActiveTripContext(input.companyId, truckKey),
    ]);

  const identityContext = asset ? readStoredVehicleIdentityContext(asset) : null;
  const distance = normalizeDayStoryDistance(movementRow, metricFallback?.distance || null);
  const dayStory: any = timeline?.day_story || {};
  const currentStatus = buildCurrentStatus(timeline, movementRow);
  const stopSummary = buildStoppedSummary(timeline, movementRow);
  const actionNotes = buildActionNotes({
    availability,
    currentStatus,
    distance,
    stopSummary,
    activeTrip,
    telemetryPoints: timeline?.telemetry_summary?.points_found || 0,
  });

  return {
    type: "truck_day_story",
    identity: {
      truck_id: timeline?.truck_id || asset?.truck_id || input.truckId,
      registration: timeline?.registration || asset?.registration || null,
      provider_name: asset?.provider_name || null,
      provider_asset_label: identityContext?.provider_label || null,
      attached_trailer_plate: identityContext?.attached_trailer_plate || null,
    },
    period: {
      requested: timeframe.requested,
      day_offset: timeframe.dayOffset,
      local_day: dayRange.localDate,
      start_utc: dayRange.startUtc,
      end_utc: dayRange.endUtc,
      time_zone: timeZone,
      label:
        timeframe.requested === "yesterday"
          ? "yesterday"
          : timeframe.requested === "day_before_yesterday"
            ? "the day before yesterday"
            : "today",
    },
    start_of_day: normalizePointSummary(dayStory.first_seen),
    latest_status: currentStatus,
    movement: distance,
    stopped_time: stopSummary,
    route: {
      places: Array.isArray(dayStory.route_progression)
        ? dayStory.route_progression.slice(0, 8)
        : [],
      start_area: normalizePointSummary(dayStory.first_seen)?.location || null,
      current_area: normalizePointSummary(dayStory.latest_seen)?.location || null,
    },
    active_trip: activeTrip,
    availability: availability
      ? {
          status: availability.status,
          label: labelAssetAvailabilityStatus(availability.status),
          source: availability.source || "manual",
          started_at: availability.started_at || null,
          note: availability.note || null,
          known_unavailable: isKnownUnavailableAvailability(availability.status),
        }
      : null,
    tracker_idle_markers: {
      marker_count: Array.isArray(timeline?.idle_events) ? timeline.idle_events.length : 0,
      window_count: Array.isArray(timeline?.idle_alert_windows)
        ? timeline.idle_alert_windows.length
        : 0,
      windows: Array.isArray(timeline?.idle_alert_windows)
        ? timeline.idle_alert_windows.slice(0, 5)
        : [],
    },
    action_notes: actionNotes,
    timeline,
    audit: {
      telemetry_points: timeline?.telemetry_summary?.points_found || 0,
      motion_blocks: timeline?.telemetry_summary?.blocks_found || 0,
      blocks_returned: timeline?.telemetry_summary?.blocks_returned || 0,
      distance_audit: movementRow?.distance_audit || distance.audit || null,
      distance_fallback_missing: distance.missing || [],
      first_telemetry_at: dayStory.coverage_start_at || null,
      last_telemetry_at: dayStory.coverage_end_at || null,
      coverage_is_partial: Boolean(dayStory.coverage_is_partial),
      rows_truncated: Boolean(timeline?.telemetry_summary?.truncated),
    },
  };
}

function normalizeTruckDayStoryTimeframe(timeframe?: TruckDayStoryTimeframe | null) {
  const requested = String(timeframe?.requested || "today").toLowerCase();
  const safeRequested =
    requested === "yesterday" || requested === "day_before_yesterday" ? requested : "today";
  const rawOffset = timeframe?.dayOffset ?? timeframe?.day_offset;
  const dayOffset = Number.isFinite(Number(rawOffset))
    ? Number(rawOffset)
    : safeRequested === "yesterday"
      ? -1
      : safeRequested === "day_before_yesterday"
        ? -2
        : 0;
  return {
    requested: safeRequested as "today" | "yesterday" | "day_before_yesterday",
    dayOffset,
  };
}

async function fetchStoryAsset(companyId: string, truckKey: string) {
  if (!truckKey) return null;
  const richSelect =
    "id, truck_id, registration, provider_name, provider_location_label, last_seen_at, telemetry_capabilities, raw_payload, status";
  const baseSelect =
    "id, truck_id, registration, provider_location_label, last_seen_at, telemetry_capabilities, status";
  let { data, error } = await supabaseAdmin
    .from("fleet_assets")
    .select(richSelect)
    .eq("company_id", companyId)
    .eq("status", "active")
    .eq("intelligence_enabled", true)
    .limit(1000);

  if (isMissingOptionalColumnError(error)) {
    const retry = await supabaseAdmin
      .from("fleet_assets")
      .select(baseSelect)
      .eq("company_id", companyId)
      .eq("status", "active")
      .eq("intelligence_enabled", true)
      .limit(1000);
    data = retry.data as any;
    error = retry.error;
  }

  if (error) throw error;
  return (
    (data || []).find(
      (asset: any) =>
        normalizeVehicleKey(asset.truck_id) === truckKey ||
        normalizeVehicleKey(asset.registration) === truckKey ||
        normalizeVehicleKey(readStoredVehicleIdentityContext(asset).provider_label) === truckKey
    ) || null
  );
}

async function fetchMovementRow(
  companyId: string,
  company: any,
  truckKey: string,
  requested: "today" | "yesterday" | "day_before_yesterday"
) {
  if (!truckKey || requested === "day_before_yesterday") return null;
  const movement = await getTruckMovementSummaryForRange({
    companyId,
    company,
    range: requested,
  });
  return (
    (movement?.trucks || []).find(
      (truck: any) =>
        normalizeVehicleKey(truck.truck_id) === truckKey ||
        normalizeVehicleKey(truck.truck_key) === truckKey
    ) || null
  );
}

async function fetchDistanceFallback(
  companyId: string,
  company: any,
  truckId: string,
  timeframe: { requested: string; dayOffset: number }
) {
  const timeZone = resolveOperationalTimeZone(company || {});
  const dayRange = resolveOperationalDayRange(timeZone, timeframe.dayOffset);
  return buildBusinessMetricContext({
    companyId,
    company,
    intent: "distance_covered",
    truckId,
    timeframe: {
      requested: timeframe.requested as any,
      dayOffset: timeframe.dayOffset,
      local_day: dayRange.localDate,
      day_start_utc: dayRange.startUtc,
      day_end_utc: dayRange.endUtc,
      display_label: `${dayRange.localDate || timeframe.requested} ${
        timeZone === DEFAULT_OPERATIONAL_TIME_ZONE ? "EAT" : timeZone
      }`,
    },
  });
}

async function fetchAvailability(companyId: string, truckId: string) {
  const result = await fetchActiveAssetAvailabilityEvents(companyId);
  const lookup = buildAssetAvailabilityLookup(result.rows || []);
  return findAssetAvailabilityForTarget(lookup, { truck_id: truckId, registration: truckId });
}

async function fetchActiveTripContext(companyId: string, truckKey: string) {
  if (!truckKey) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("journeys")
      .select(
        "id, internal_trip_id, status, client_name, from_location, to_location, truck, driver, start_time, end_time, created_at"
      )
      .eq("company_id", companyId)
      .eq("is_demo", false)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    const active = (data || []).find((journey: any) => {
      if (!journeyMatchesTruck(journey, truckKey)) return false;
      const status = String(journey.status || "").toLowerCase();
      return !["completed", "closed", "cancelled", "canceled", "archived"].includes(status);
    });
    if (!active) return null;
    return {
      journey_id: active.id || null,
      reference: active.internal_trip_id || null,
      status: active.status || null,
      client_name: active.client_name || null,
      route_from: active.from_location || null,
      route_to: active.to_location || null,
      driver: active.driver || null,
      start_time: active.start_time || active.created_at || null,
      end_time: active.end_time || null,
    };
  } catch {
    return null;
  }
}

function journeyMatchesTruck(journey: any, truckKey: string) {
  return normalizeVehicleKey(journey?.truck) === truckKey;
}

function normalizeDayStoryDistance(movementRow: any, metricDistance: any) {
  const movementDistance = Number(movementRow?.distance_km || 0);
  if (Number.isFinite(movementDistance) && movementDistance > 0) {
    return {
      distance_km: movementDistance,
      source: movementRow.distance_evidence_type || "unknown",
      source_label: movementRow.distance_source || "distance evidence",
      evidence_detail: movementRow.distance_evidence_detail || null,
      confidence: movementRow.distance_confidence || "unknown",
      provisional: movementRow.distance_evidence_type === "gps_estimated",
      reliability_note: movementRow.distance_reliability_note || null,
      audit: movementRow.distance_audit || null,
      missing: [],
    };
  }

  const fallbackDistance = Number(metricDistance?.distance_km || 0);
  if (Number.isFinite(fallbackDistance) && fallbackDistance > 0) {
    return {
      distance_km: fallbackDistance,
      source: metricDistance.primary_distance_source || metricDistance.distance_source || "unknown",
      source_label: metricDistance.primary_distance_source || metricDistance.distance_source || "distance evidence",
      evidence_detail: metricDistance.reliability_wording || null,
      confidence: metricDistance.distance_quality || "unknown",
      provisional:
        (metricDistance.primary_distance_source || metricDistance.distance_source) === "gps_estimated",
      audit: metricDistance.gps_fallback || null,
      missing: metricDistance.missing || [],
    };
  }

  return {
    distance_km: null,
    source: "unavailable",
    source_label: "unavailable",
    evidence_detail: null,
    confidence: "unavailable",
    provisional: false,
    audit: metricDistance?.gps_fallback || null,
    missing: metricDistance?.missing || ["positive distance evidence for the selected day"],
  };
}

function buildCurrentStatus(timeline: any, movementRow: any) {
  const latest = normalizePointSummary(timeline?.day_story?.latest_seen);
  const status = timeline?.current_status || {};
  const speed = Number.isFinite(Number(status.speed ?? latest?.speed))
    ? Number(status.speed ?? latest?.speed)
    : null;
  const freshness = Number.isFinite(Number(status.freshness_minutes))
    ? Number(status.freshness_minutes)
    : null;
  const state =
    freshness !== null && freshness > 60
      ? "stale"
      : speed !== null && speed > 5
        ? "moving"
        : status.state === "stationary"
          ? "stopped"
          : status.state || "unknown";

  return {
    state,
    recorded_at: status.recorded_at || latest?.recorded_at || movementRow?.last_telemetry_at || null,
    freshness_minutes: freshness,
    speed,
    location: latest?.location || null,
    provider_current_stop: movementRow?.stopped_reconciliation
      ? {
          duration_minutes:
            movementRow.stopped_reconciliation.provider_current_stop_minutes ?? null,
          label: movementRow.stopped_reconciliation.provider_current_stop_label || null,
          explanation: movementRow.stopped_reconciliation.explanation || null,
        }
      : null,
  };
}

function buildStoppedSummary(timeline: any, movementRow: any) {
  const stopSummary = timeline?.day_story?.stop_summary || {};
  const stoppedMinutes =
    movementRow?.stopped_minutes ?? stopSummary.total_stopped_minutes ?? null;
  const windows = Array.isArray(timeline?.notable_stops)
    ? timeline.notable_stops.slice(0, 5).map((stop: any) => ({
        start_at: stop.start_at || null,
        end_at: stop.end_at || null,
        duration_minutes: stop.duration_minutes ?? null,
        location: stop.location || null,
        severity: stop.severity || null,
        nearby_idle_marker_count: Array.isArray(stop.nearby_idle_events)
          ? stop.nearby_idle_events.length
          : 0,
      }))
    : [];

  return {
    total_gps_stopped_minutes: stoppedMinutes,
    source: stoppedMinutes !== null ? "GPS-estimated stopped-time evidence" : "unavailable",
    window_count: movementRow?.stopped_interval_count ?? stopSummary.meaningful_stop_count ?? 0,
    longest_stop: stopSummary.longest_stop || windows[0] || null,
    key_windows: windows,
    provider_current_stop: movementRow?.stopped_reconciliation || null,
    confidence: movementRow?.stopped_time_confidence || null,
    confidence_reason: movementRow?.stopped_time_confidence_reason || null,
  };
}

function normalizePointSummary(point: any) {
  if (!point) return null;
  return {
    recorded_at: point.recorded_at || null,
    speed: Number.isFinite(Number(point.speed)) ? Number(point.speed) : null,
    location: point.location || point.location_resolution || null,
  };
}

function buildActionNotes(input: {
  availability: any;
  currentStatus: any;
  distance: any;
  stopSummary: any;
  activeTrip: any;
  telemetryPoints: number;
}) {
  const notes: string[] = [];
  if (input.availability) {
    const label = labelAssetAvailabilityStatus(input.availability.status);
    if (isKnownUnavailableAvailability(input.availability.status)) {
      notes.push(`${label} is recorded, so stopped time should be reviewed as known downtime.`);
    } else {
      notes.push(`${label} is recorded operational context for today.`);
    }
  }
  if (!input.telemetryPoints || input.distance.source === "unavailable") {
    notes.push("Check provider sync/freshness before treating today's distance as known.");
  } else if (input.currentStatus.state === "stale") {
    notes.push("Last tracking point is stale; check provider sync or device freshness.");
  } else if (input.distance.provisional) {
    notes.push("Use the distance as provisional movement evidence until provider distance is available.");
  }
  const stoppedMinutes = Number(input.stopSummary.total_gps_stopped_minutes || 0);
  if (!input.availability && stoppedMinutes >= 120) {
    notes.push("Review stop context before treating the stopped time as an operational problem.");
  }
  if (input.activeTrip) {
    notes.push("Check active Trip context if dispatch needs a trip-level update.");
  }
  if (!notes.length) notes.push("No immediate exception is visible from the current movement evidence.");
  return Array.from(new Set(notes)).slice(0, 4);
}

function isMissingOptionalColumnError(error: any) {
  if (!error) return false;
  const code = String(error.code || "").toUpperCase();
  const message = String(error.message || error.details || error.hint || "").toLowerCase();
  return (
    code === "PGRST204" ||
    message.includes("column") ||
    message.includes("schema cache") ||
    message.includes("could not find")
  );
}
