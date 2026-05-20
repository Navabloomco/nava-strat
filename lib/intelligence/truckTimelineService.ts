import { supabaseAdmin } from "../supabaseAdmin";
import {
  DEFAULT_OPERATIONAL_TIME_ZONE,
  operationalTimeZoneLabel,
} from "../timeFormatting";
import {
  resolveOperationalLocation,
} from "../location/resolveOperationalLocation";
import type { ResolvedOperationalLocation } from "../location/resolveOperationalLocation";
import {
  fetchActiveGeofences,
  matchPointToGeofence,
} from "./geofenceMatcher";
import { getVehicleMatchKeys, normalizeVehicleKey } from "./entityResolver";

type TimelineInput = {
  companyId: string;
  truckId: string;
  startTimeUtc?: string;
  endTimeUtc?: string;
  dayOffset?: number;
  timeframe?: "today" | "yesterday" | "custom";
  timeZone?: string;
  geofences?: any[];
  maxRows?: number;
  maxBlocks?: number;
};

type TimelineBlock = {
  index: number;
  state: "moving" | "stationary" | "unknown";
  start_at: string | null;
  end_at: string | null;
  duration_minutes: number | null;
  sample_count: number;
  min_speed: number | null;
  max_speed: number | null;
  average_speed: number | null;
  start_point: any;
  end_point: any;
  points: any[];
  start_location?: ResolvedOperationalLocation | null;
  end_location?: ResolvedOperationalLocation | null;
  geofence_match?: any;
};

const DEFAULT_MAX_ROWS = 2000;
const DEFAULT_MAX_BLOCKS = 12;
const MOVING_SPEED_THRESHOLD = 5;
const SHORT_STOP_MINUTES = 5;
const MEDIUM_STOP_MINUTES = 15;
const MAJOR_STOP_MINUTES = 45;

export async function buildTruckTimelineIntelligence(input: TimelineInput) {
  const timeZone = input.timeZone || DEFAULT_OPERATIONAL_TIME_ZONE;
  const explicitWindow = Boolean(input.startTimeUtc && input.endTimeUtc);
  const dayOffset = Number.isFinite(Number(input.dayOffset)) ? Number(input.dayOffset) : 0;
  const timeframe =
    input.timeframe || (explicitWindow ? "custom" : dayOffset === -1 ? "yesterday" : "today");
  const localDayRange =
    explicitWindow
      ? {
          localDate: null,
          startUtc: input.startTimeUtc as string,
          endUtc: input.endTimeUtc as string,
        }
      : getOperationalLocalDayUtcRange(timeZone, dayOffset);
  const localNowParts = getZonedDateParts(new Date(), timeZone);
  const elapsedLocalDayMinutes =
    timeframe === "today" ? localNowParts.hour * 60 + localNowParts.minute : null;
  const maxRows = clampInteger(input.maxRows, 50, 5000, DEFAULT_MAX_ROWS);
  const maxBlocks = clampInteger(input.maxBlocks, 4, 20, DEFAULT_MAX_BLOCKS);
  const geofences =
    input.geofences || (await fetchActiveGeofences(supabaseAdmin, input.companyId));
  const targetKey = normalizeVehicleKey(input.truckId);

  const { data: assetRows, error: assetError } = await supabaseAdmin
    .from("fleet_assets")
    .select(
      "id, truck_id, registration, latitude, longitude, last_seen_at, provider_location_label, status, asset_category"
    )
    .eq("company_id", input.companyId)
    .eq("status", "active")
    .eq("intelligence_enabled", true)
    .limit(1000);

  if (assetError) throw assetError;

  const asset = (assetRows || []).find((item) =>
    getVehicleMatchKeys(item).some((key) => key === targetKey)
  );
  const canonicalTruckId = asset?.truck_id || input.truckId;

  if (!asset) {
    return {
      type: "truck_stop_motion_timeline",
      truck_id: canonicalTruckId,
      asset_found: false,
      timezone: {
        time_zone: timeZone,
        label: operationalTimeZoneLabel(timeZone),
      },
      timeframe: {
        requested: timeframe,
        local_day: localDayRange.localDate,
        day_offset: explicitWindow ? null : dayOffset,
        elapsed_local_day_minutes: elapsedLocalDayMinutes,
        new_day_rollover_window: timeframe === "today" && Number(elapsedLocalDayMinutes || 0) <= 240,
      },
      local_day: localDayRange.localDate,
      query_window_utc: {
        start: localDayRange.startUtc,
        end: localDayRange.endUtc,
        filter_strategy: "local_day_utc_range_equivalent_to_timezone_recorded_at_date_filter",
      },
      telemetry_summary: {
        points_found: 0,
        blocks_found: 0,
        movement_blocks: 0,
        stationary_blocks: 0,
        data_density: "none",
        truncated: false,
      },
      motion_blocks: [],
      notable_stops: [],
      idle_events: [],
      continuity: {
        continuous_all_day_idle_supported: false,
        historical_idle_markers_broken_by_movement: false,
        movement_after_first_idle: false,
        conclusion: "asset_not_enabled_or_not_found",
      },
    };
  }

  const eventFetchStartUtc = shiftIsoTime(localDayRange.startUtc, -24 * 60);
  const eventFetchEndUtc = shiftIsoTime(localDayRange.endUtc, 24 * 60);
  const [telemetryResult, eventsResult] = await Promise.all([
    supabaseAdmin
      .from("telemetry_logs")
      .select(
        "truck_id, recorded_at, latitude, longitude, speed, provider_location_label, validation"
      )
      .eq("company_id", input.companyId)
      .eq("truck_id", canonicalTruckId)
      .gte("recorded_at", localDayRange.startUtc)
      .lt("recorded_at", localDayRange.endUtc)
      .order("recorded_at", { ascending: true })
      .limit(maxRows),
    supabaseAdmin
      .from("telemetry_events")
      .select(
        "truck_id, event_type, severity, location_name, latitude, longitude, created_at, started_at, duration_minutes, context_label, context_type"
      )
      .eq("company_id", input.companyId)
      .eq("truck_id", canonicalTruckId)
      .in("event_type", ["idle", "excessive_idle"])
      .gte("created_at", eventFetchStartUtc)
      .lt("created_at", eventFetchEndUtc)
      .order("created_at", { ascending: true })
      .limit(100),
  ]);

  if (telemetryResult.error) throw telemetryResult.error;
  if (eventsResult.error) throw eventsResult.error;

  const telemetryRows = (telemetryResult.data || []).map((row) => ({
    ...row,
    geofence_match: matchPointToGeofence(row, geofences),
  }));
  const windowStartMs = new Date(localDayRange.startUtc).getTime();
  const windowEndMs = new Date(localDayRange.endUtc).getTime();
  const idleEvents = (eventsResult.data || [])
    .filter((event) => eventIsInTimelineWindow(event, windowStartMs, windowEndMs))
    .map((event) => ({
      ...event,
      geofence_match: matchPointToGeofence(event, geofences),
    }));

  const rawBlocks = aggregateTelemetryIntoMotionBlocks(telemetryRows);
  const selectedBlocks = selectTimelineBlocksForContext(rawBlocks, idleEvents, maxBlocks);
  const hydratedBlocks = await Promise.all(
    selectedBlocks.map((block) => hydrateBlockLocations(input.companyId, block, geofences))
  );
  const allStationaryBlocks = rawBlocks.filter((block) => block.state === "stationary");
  const meaningfulStopBlocks = allStationaryBlocks.filter(
    (block) => Number(block.duration_minutes || 0) >= SHORT_STOP_MINUTES
  );
  const longestStopBlock = meaningfulStopBlocks
    .slice()
    .sort((a, b) => Number(b.duration_minutes || 0) - Number(a.duration_minutes || 0))[0] || null;
  const longestStopLocation = longestStopBlock
    ? await resolveOperationalLocation({
        company_id: input.companyId,
        latitude: longestStopBlock.end_point?.latitude,
        longitude: longestStopBlock.end_point?.longitude,
        provider_location_label: longestStopBlock.end_point?.provider_location_label,
        truck_id: canonicalTruckId,
        geofences,
      })
    : null;
  const firstTelemetry = telemetryRows[0] || null;
  const latestTelemetry = telemetryRows[telemetryRows.length - 1] || null;
  const latestPoint = latestTelemetry || (timeframe === "today" ? asset : null);
  const firstLocationResolution = firstTelemetry
    ? await resolveOperationalLocation({
        company_id: input.companyId,
        latitude: firstTelemetry.latitude,
        longitude: firstTelemetry.longitude,
        provider_location_label: firstTelemetry.provider_location_label,
        truck_id: canonicalTruckId,
        geofences,
      })
    : null;
  const latestLocationResolution = latestPoint
    ? await resolveOperationalLocation({
        company_id: input.companyId,
        latitude: latestPoint.latitude,
        longitude: latestPoint.longitude,
        provider_location_label:
          latestTelemetry?.provider_location_label || asset.provider_location_label || null,
        truck_id: canonicalTruckId,
        geofences,
      })
    : null;
  const idleEventComparisons = await Promise.all(
    idleEvents.map(async (event) => ({
      ...compareIdleEventToMotionBlocks(event, rawBlocks, latestPoint),
      location_resolution: await resolveOperationalLocation({
        company_id: input.companyId,
        latitude: event.latitude,
        longitude: event.longitude,
        provider_location_label: event.location_name,
        truck_id: canonicalTruckId,
        geofences,
      }),
    }))
  );
  const notableStops = hydratedBlocks
    .filter((block) => block.state === "stationary" && Number(block.duration_minutes || 0) >= SHORT_STOP_MINUTES)
    .map((block) => ({
      block_index: block.index,
      severity: classifyStopSeverity(block.duration_minutes),
      start_at: block.start_at,
      end_at: block.end_at,
      duration_minutes: block.duration_minutes,
      location: block.end_location || block.start_location || null,
      geofence_match: block.geofence_match || block.end_location?.geofence || null,
      nearby_idle_events: idleEventComparisons
        .filter((event) => event.nearby_block_index === block.index)
        .slice(0, 3)
        .map((event) => ({
          event_type: event.event_type,
          started_at: event.started_at,
          created_at: event.created_at,
        })),
    }))
    .slice(0, 8);
  const firstIdleComparison = idleEventComparisons[0] || null;
  const movementBlocks = rawBlocks.filter((block) => block.state === "moving");
  const stationaryBlocks = rawBlocks.filter((block) => block.state === "stationary");
  const totalMovingMinutes = sumDurations(movementBlocks);
  const totalStoppedMinutes = sumDurations(stationaryBlocks);
  const coverageMinutes =
    firstTelemetry && latestTelemetry
      ? minutesBetween(firstTelemetry.recorded_at, latestTelemetry.recorded_at)
      : null;
  const firstPointMinutesAfterDayStart = firstTelemetry
    ? minutesBetween(localDayRange.startUtc, firstTelemetry.recorded_at)
    : null;
  const newDayRolloverWindow = Boolean(
    timeframe === "today" &&
      ((elapsedLocalDayMinutes !== null && elapsedLocalDayMinutes <= 240) ||
        (firstPointMinutesAfterDayStart !== null &&
          firstPointMinutesAfterDayStart <= 30 &&
          Number(coverageMinutes || 0) <= 90 &&
          totalMovingMinutes === 0))
  );
  const averageMeaningfulStopMinutes =
    meaningfulStopBlocks.length > 0
      ? Math.round(sumDurations(meaningfulStopBlocks) / meaningfulStopBlocks.length)
      : null;
  const majorStops = meaningfulStopBlocks.filter(
    (block) => Number(block.duration_minutes || 0) >= MAJOR_STOP_MINUTES
  );
  const mediumStops = meaningfulStopBlocks.filter((block) => {
    const duration = Number(block.duration_minutes || 0);
    return duration >= MEDIUM_STOP_MINUTES && duration < MAJOR_STOP_MINUTES;
  });
  const shortStops = meaningfulStopBlocks.filter((block) => {
    const duration = Number(block.duration_minutes || 0);
    return duration >= SHORT_STOP_MINUTES && duration < MEDIUM_STOP_MINUTES;
  });
  const nonMajorStops = [...mediumStops, ...shortStops];
  const averageNonMajorStopMinutes =
    nonMajorStops.length > 0 ? Math.round(sumDurations(nonMajorStops) / nonMajorStops.length) : null;
  const progression = buildRouteProgression(hydratedBlocks);
  const latestSpeed = finiteOrNull(latestTelemetry?.speed);
  const continuousIdleSupported = Boolean(
    latestTelemetry &&
      latestSpeed !== null &&
      latestSpeed <= 2 &&
      firstIdleComparison &&
      firstIdleComparison.location_distance_km !== null &&
      firstIdleComparison.location_distance_km <= 0.5 &&
      !firstIdleComparison.movement_after_event
  );
  const hasBrokenIdleMarkers = idleEventComparisons.some(
    (comparison) => comparison.classification === "historical_broken_by_movement"
  );

  return {
    type: "truck_stop_motion_timeline",
    truck_id: canonicalTruckId,
    registration: asset.registration || null,
    asset_found: true,
    timezone: {
      time_zone: timeZone,
      label: operationalTimeZoneLabel(timeZone),
    },
    timeframe: {
      requested: timeframe,
      local_day: localDayRange.localDate,
      day_offset: explicitWindow ? null : dayOffset,
      elapsed_local_day_minutes: elapsedLocalDayMinutes,
      new_day_rollover_window: newDayRolloverWindow,
    },
    local_day: localDayRange.localDate,
    query_window_utc: {
      start: localDayRange.startUtc,
      end: localDayRange.endUtc,
      filter_strategy: "local_day_utc_range_equivalent_to_timezone_recorded_at_date_filter",
    },
    latest_snapshot: latestPoint
      ? {
          recorded_at:
            latestTelemetry?.recorded_at || (timeframe === "today" ? asset.last_seen_at : null),
          speed: latestTelemetry?.speed ?? null,
          location_resolution: latestLocationResolution,
          geofence_match: matchPointToGeofence(latestPoint, geofences),
          timestamp_warnings: latestTelemetry?.validation?.warnings || [],
        }
      : null,
    current_status: {
      state: rawBlocks[rawBlocks.length - 1]?.state || "unknown",
      recorded_at:
        latestTelemetry?.recorded_at || (timeframe === "today" ? asset.last_seen_at : null),
      freshness_minutes:
        latestPoint?.recorded_at || (timeframe === "today" ? asset.last_seen_at : null)
        ? Math.floor(
            (Date.now() -
              new Date(
                latestTelemetry?.recorded_at || (timeframe === "today" ? asset.last_seen_at : null)
              ).getTime()) /
              60000
          )
        : null,
      location: latestLocationResolution,
      speed: latestTelemetry?.speed ?? null,
    },
    day_story: {
      coverage_start_at: firstTelemetry?.recorded_at || null,
      coverage_end_at:
        latestTelemetry?.recorded_at || (timeframe === "today" ? asset.last_seen_at : null),
      coverage_minutes: coverageMinutes,
      first_point_minutes_after_day_start: firstPointMinutesAfterDayStart,
      new_day_rollover_window: newDayRolloverWindow,
      coverage_is_partial:
        telemetryRows.length === 0 ||
        isCoveragePartial(localDayRange.startUtc, firstTelemetry?.recorded_at),
      first_seen: firstTelemetry
        ? {
            recorded_at: firstTelemetry.recorded_at,
            location: firstLocationResolution,
            speed: firstTelemetry.speed ?? null,
          }
        : null,
      latest_seen: latestPoint
        ? {
            recorded_at:
              latestTelemetry?.recorded_at || (timeframe === "today" ? asset.last_seen_at : null),
            location: latestLocationResolution,
            speed: latestTelemetry?.speed ?? null,
          }
        : null,
      route_progression: progression,
      stop_summary: {
        total_moving_minutes: totalMovingMinutes,
        total_stopped_minutes: totalStoppedMinutes,
        meaningful_stop_count: meaningfulStopBlocks.length,
        major_stop_count: majorStops.length,
        medium_stop_count: mediumStops.length,
        short_stop_count: shortStops.length,
        average_meaningful_stop_minutes: averageMeaningfulStopMinutes,
        average_non_major_stop_minutes: averageNonMajorStopMinutes,
        longest_stop: longestStopBlock
          ? {
              start_at: longestStopBlock.start_at,
              end_at: longestStopBlock.end_at,
              duration_minutes: longestStopBlock.duration_minutes,
              location: longestStopLocation,
            }
          : null,
      },
    },
    telemetry_summary: {
      points_found: telemetryRows.length,
      blocks_found: rawBlocks.length,
      blocks_returned: hydratedBlocks.length,
      omitted_blocks: Math.max(rawBlocks.length - hydratedBlocks.length, 0),
      movement_blocks: movementBlocks.length,
      stationary_blocks: stationaryBlocks.length,
      data_density:
        telemetryRows.length === 0
          ? "none"
          : telemetryRows.length < 4
            ? "low"
            : telemetryRows.length < 12
              ? "medium"
              : "high",
      truncated: telemetryRows.length >= maxRows,
      max_rows: maxRows,
    },
    motion_blocks: hydratedBlocks,
    notable_stops: notableStops,
    idle_events: idleEventComparisons.slice(0, 20),
    continuity: {
      continuous_all_day_idle_supported: continuousIdleSupported,
      historical_idle_markers_broken_by_movement: hasBrokenIdleMarkers,
      movement_after_first_idle: Boolean(firstIdleComparison?.movement_after_event),
      conclusion: continuousIdleSupported
        ? "continuous_current_idle_supported"
        : hasBrokenIdleMarkers
          ? "historical_idle_markers_are_distinct"
          : telemetryRows.length < 4
            ? "limited_history"
            : "continuous_idle_not_proven",
    },
  };
}

function aggregateTelemetryIntoMotionBlocks(rows: any[]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];

  for (const row of rows || []) {
    const state = classifyTelemetryMotionState(row);
    const speed = finiteOrNull(row?.speed);
    const last = blocks[blocks.length - 1];

    if (!last || last.state !== state) {
      blocks.push({
        index: blocks.length,
        state,
        start_at: row.recorded_at || null,
        end_at: row.recorded_at || null,
        duration_minutes: 0,
        sample_count: 1,
        min_speed: speed,
        max_speed: speed,
        average_speed: speed,
        start_point: row,
        end_point: row,
        points: [row],
        geofence_match: row.geofence_match || null,
      });
      continue;
    }

    last.end_at = row.recorded_at || last.end_at;
    last.sample_count += 1;
    last.end_point = row;
    last.points.push(row);
    if (speed !== null) {
      last.min_speed = last.min_speed === null ? speed : Math.min(last.min_speed, speed);
      last.max_speed = last.max_speed === null ? speed : Math.max(last.max_speed, speed);
      const previousAverage = last.average_speed || 0;
      last.average_speed =
        (previousAverage * (last.sample_count - 1) + speed) / last.sample_count;
    }
    if (!last.geofence_match && row.geofence_match) {
      last.geofence_match = row.geofence_match;
    }
  }

  return blocks.map((block) => ({
    ...block,
    duration_minutes: minutesBetween(block.start_at, block.end_at),
  }));
}

function selectTimelineBlocksForContext(
  blocks: TimelineBlock[],
  idleEvents: any[],
  maxBlocks: number
) {
  if (blocks.length <= maxBlocks) return blocks;

  const selected = new Set<number>();
  selected.add(0);
  selected.add(blocks.length - 1);

  blocks.forEach((block) => {
    if (block.state === "stationary" && Number(block.duration_minutes || 0) >= MAJOR_STOP_MINUTES) {
      selected.add(block.index);
    }
  });

  for (const event of idleEvents || []) {
    const eventTime = eventTimestampMillis(event);
    const eventBlock = findBlockForTimestamp(blocks, eventTime);
    if (eventBlock) selected.add(eventBlock.index);
    const movementAfter = findMovementAfter(blocks, eventTime);
    if (movementAfter) selected.add(movementAfter.index);
  }

  blocks.forEach((block) => {
    if (selected.size >= maxBlocks) return;
    if (block.state === "stationary" && Number(block.duration_minutes || 0) >= SHORT_STOP_MINUTES) {
      selected.add(block.index);
    }
  });

  if (selected.size < maxBlocks) {
    const stride = Math.max(1, Math.floor(blocks.length / maxBlocks));
    for (let index = 0; index < blocks.length && selected.size < maxBlocks; index += stride) {
      selected.add(index);
    }
  }

  const selectedBlocks = blocks.filter((block) => selected.has(block.index));
  if (selectedBlocks.length <= maxBlocks) return selectedBlocks;

  const first = selectedBlocks[0];
  const last = selectedBlocks[selectedBlocks.length - 1];
  const middle = selectedBlocks
    .slice(1, -1)
    .slice(0, Math.max(maxBlocks - 2, 0));
  return [first, ...middle, last].filter(
    (block, index, list) => list.findIndex((item) => item.index === block.index) === index
  );
}

async function hydrateBlockLocations(companyId: string, block: TimelineBlock, geofences: any[]) {
  const [startLocation, endLocation] = await Promise.all([
    resolveOperationalLocation({
      company_id: companyId,
      latitude: block.start_point?.latitude,
      longitude: block.start_point?.longitude,
      provider_location_label: block.start_point?.provider_location_label,
      truck_id: block.start_point?.truck_id,
      geofences,
    }),
    resolveOperationalLocation({
      company_id: companyId,
      latitude: block.end_point?.latitude,
      longitude: block.end_point?.longitude,
      provider_location_label: block.end_point?.provider_location_label,
      truck_id: block.end_point?.truck_id,
      geofences,
    }),
  ]);

  return {
    index: block.index,
    state: block.state,
    start_at: block.start_at,
    end_at: block.end_at,
    duration_minutes: block.duration_minutes,
    sample_count: block.sample_count,
    min_speed: roundNumber(block.min_speed),
    max_speed: roundNumber(block.max_speed),
    average_speed: roundNumber(block.average_speed),
    start_location: startLocation,
    end_location: endLocation,
    geofence_match: block.geofence_match || endLocation?.geofence || startLocation?.geofence || null,
  };
}

function buildRouteProgression(blocks: any[]) {
  const labels: { label: string; key: string }[] = [];

  for (const block of blocks || []) {
    const start = conciseLocationLabel(block.start_location);
    const end = conciseLocationLabel(block.end_location);
    if (start) labels.push(start);
    if (end) labels.push(end);
  }

  const seen = new Set<string>();
  const route: string[] = [];

  for (const item of labels) {
    const previous = route[route.length - 1];
    const previousKey = previous ? routeLabelKey(previous) : "";
    if (!item.key || item.key === previousKey || seen.has(item.key)) continue;
    seen.add(item.key);
    route.push(item.label);
  }

  return route.slice(0, 10);
}

function conciseLocationLabel(location: ResolvedOperationalLocation | null | undefined) {
  const label = String(location?.display_label || "").trim();
  if (!label || location?.confidence_source === "coordinates_only") return null;
  const cleaned = label
    .replace(/^(near|inside|at)\s+/i, "")
    .split(",")[0]
    .replace(/\babout\s+\d+(?:\.\d+)?\s*km\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return {
    label: cleaned,
    key: routeLabelKey(cleaned),
  };
}

function routeLabelKey(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function classifyStopSeverity(durationMinutes: any) {
  const duration = Number(durationMinutes || 0);
  if (duration >= MAJOR_STOP_MINUTES) return "major_stop";
  if (duration >= MEDIUM_STOP_MINUTES) return "medium_stop";
  if (duration >= SHORT_STOP_MINUTES) return "short_stop";
  return "noise_stop";
}

function compareIdleEventToMotionBlocks(event: any, blocks: TimelineBlock[], latestPoint: any) {
  const eventTime = eventTimestampMillis(event);
  const movementAfterEvent = validateMovementAfterEvent(findMovementAfter(blocks, eventTime), eventTime);
  const nearbyBlock = findBlockForTimestamp(blocks, eventTime);
  const locationDistanceKm = distanceBetweenPointsKm(event, latestPoint);

  let classification = "continuity_unknown";
  if (movementAfterEvent) {
    classification = "historical_broken_by_movement";
  } else if (
    locationDistanceKm !== null &&
    locationDistanceKm <= 0.5 &&
    latestPoint &&
    finiteOrNull(latestPoint.speed) !== null &&
    Number(latestPoint.speed) <= 2
  ) {
    classification = "possibly_current_same_location";
  } else if (blocks.length > 0) {
    classification = "no_movement_after_event_but_not_confirmed_current";
  }

  return {
    event_type: event.event_type,
    severity: event.severity || null,
    created_at: event.created_at || null,
    started_at: event.started_at || null,
    duration_minutes: event.duration_minutes ?? null,
    location_name: event.location_name || null,
    context_label: event.context_label || null,
    geofence_match: event.geofence_match || null,
    nearby_block_index: nearbyBlock?.index ?? null,
    movement_after_event: Boolean(movementAfterEvent),
    movement_after_event_at: movementAfterEvent?.movement_after_at || movementAfterEvent?.start_at || null,
    movement_after_event_block: movementAfterEvent
      ? {
          block_index: movementAfterEvent.index,
          start_at: movementAfterEvent.start_at,
          end_at: movementAfterEvent.end_at,
          max_speed: movementAfterEvent.max_speed,
        }
      : null,
    location_distance_km: roundNumber(locationDistanceKm),
    classification,
  };
}

function validateMovementAfterEvent(movement: any, eventTime: number) {
  if (!movement || !Number.isFinite(eventTime)) return null;
  const movementTime = new Date(
    movement.movement_after_at || movement.start_at || 0
  ).getTime();
  if (!Number.isFinite(movementTime) || movementTime <= eventTime) return null;
  return movement;
}

function classifyTelemetryMotionState(row: any): TimelineBlock["state"] {
  const speed = finiteOrNull(row?.speed);
  if (speed === null) return "unknown";
  return speed > MOVING_SPEED_THRESHOLD ? "moving" : "stationary";
}

function findMovementAfter(blocks: TimelineBlock[], eventTime: number) {
  if (!Number.isFinite(eventTime)) return null;
  for (const block of blocks) {
    if (block.state !== "moving") continue;
    const firstPointAfterEvent = (block.points || []).find((point) => {
      const recordedAt = new Date(point?.recorded_at || 0).getTime();
      return Number.isFinite(recordedAt) && recordedAt > eventTime;
    });
    if (firstPointAfterEvent) {
      return {
        ...block,
        movement_after_at: firstPointAfterEvent.recorded_at,
      };
    }
  }

  return null;
}

function findBlockForTimestamp(blocks: TimelineBlock[], timestamp: number) {
  if (!Number.isFinite(timestamp)) return null;
  return (
    blocks.find((block) => {
      const start = new Date(block.start_at || 0).getTime();
      const end = new Date(block.end_at || 0).getTime();
      return Number.isFinite(start) && Number.isFinite(end) && start <= timestamp && end >= timestamp;
    }) || null
  );
}

function getOperationalLocalDayUtcRange(timeZone: string, dayOffset = 0) {
  const now = new Date();
  const localParts = getZonedDateParts(now, timeZone);
  const targetLocalDate = new Date(
    Date.UTC(localParts.year, localParts.month - 1, localParts.day + dayOffset)
  );
  const targetParts = getZonedDateParts(targetLocalDate, "UTC");
  const start = zonedDateTimeToUtc(
    targetParts.year,
    targetParts.month,
    targetParts.day,
    0,
    0,
    0,
    timeZone
  );
  const nextLocalDay = new Date(
    Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day + 1)
  );
  const nextParts = getZonedDateParts(nextLocalDay, "UTC");
  const end = zonedDateTimeToUtc(
    nextParts.year,
    nextParts.month,
    nextParts.day,
    0,
    0,
    0,
    timeZone
  );

  return {
    localDate: `${targetParts.year}-${String(targetParts.month).padStart(2, "0")}-${String(
      targetParts.day
    ).padStart(2, "0")}`,
    startUtc: start.toISOString(),
    endUtc: end.toISOString(),
  };
}

function getZonedDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const lookup: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") lookup[part.type] = Number(part.value);
  }
  return {
    year: lookup.year,
    month: lookup.month,
    day: lookup.day,
    hour: lookup.hour === 24 ? 0 : lookup.hour || 0,
    minute: lookup.minute || 0,
    second: lookup.second || 0,
  };
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimeZoneOffsetMillis(utcGuess, timeZone);
  const firstPass = new Date(utcGuess.getTime() - offset);
  const adjustedOffset = getTimeZoneOffsetMillis(firstPass, timeZone);
  return new Date(utcGuess.getTime() - adjustedOffset);
}

function getTimeZoneOffsetMillis(date: Date, timeZone: string) {
  const parts = getZonedDateParts(date, timeZone);
  const zonedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return zonedAsUtc - date.getTime();
}

function eventTimestampMillis(event: any) {
  const value = event?.started_at || event?.created_at || null;
  if (!value) return NaN;
  return new Date(value).getTime();
}

function eventIsInTimelineWindow(event: any, startMs: number, endMs: number) {
  const eventMs = eventTimestampMillis(event);
  if (!Number.isFinite(eventMs)) return false;
  return eventMs >= startMs && eventMs < endMs;
}

function shiftIsoTime(value: string, minutes: number) {
  const timestamp = new Date(value || 0).getTime();
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp + minutes * 60000).toISOString();
}

function minutesBetween(start: any, end: any) {
  const startMs = new Date(start || 0).getTime();
  const endMs = new Date(end || 0).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.max(0, Math.round((endMs - startMs) / 60000));
}

function sumDurations(blocks: TimelineBlock[]) {
  return blocks.reduce((total, block) => total + Number(block.duration_minutes || 0), 0);
}

function isCoveragePartial(dayStartUtc: string, firstTelemetryAt: any) {
  const dayStartMs = new Date(dayStartUtc || 0).getTime();
  const firstMs = new Date(firstTelemetryAt || 0).getTime();
  if (!Number.isFinite(dayStartMs) || !Number.isFinite(firstMs)) return true;
  return firstMs - dayStartMs > 60 * 60 * 1000;
}

function finiteOrNull(value: any) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function distanceBetweenPointsKm(first: any, second: any) {
  const lat1 = finiteOrNull(first?.latitude);
  const lon1 = finiteOrNull(first?.longitude);
  const lat2 = finiteOrNull(second?.latitude);
  const lon2 = finiteOrNull(second?.longitude);
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return null;

  const earthRadiusKm = 6371;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(deltaLon / 2) *
      Math.sin(deltaLon / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function roundNumber(value: any) {
  const number = finiteOrNull(value);
  return number === null ? null : Math.round(number * 10) / 10;
}

function clampInteger(value: any, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}
