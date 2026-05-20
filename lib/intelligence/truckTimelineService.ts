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
  start_location?: ResolvedOperationalLocation | null;
  end_location?: ResolvedOperationalLocation | null;
  geofence_match?: any;
};

const DEFAULT_MAX_ROWS = 2000;
const DEFAULT_MAX_BLOCKS = 12;
const MOVING_SPEED_THRESHOLD = 5;
const SHORT_STOP_MINUTES = 10;
const LONG_STOP_MINUTES = 30;

export async function buildTruckTimelineIntelligence(input: TimelineInput) {
  const timeZone = input.timeZone || DEFAULT_OPERATIONAL_TIME_ZONE;
  const localDayRange =
    input.startTimeUtc && input.endTimeUtc
      ? {
          localDate: null,
          startUtc: input.startTimeUtc,
          endUtc: input.endTimeUtc,
        }
      : getOperationalLocalDayUtcRange(timeZone);
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
      .gte("created_at", localDayRange.startUtc)
      .lt("created_at", localDayRange.endUtc)
      .order("created_at", { ascending: true })
      .limit(100),
  ]);

  if (telemetryResult.error) throw telemetryResult.error;
  if (eventsResult.error) throw eventsResult.error;

  const telemetryRows = (telemetryResult.data || []).map((row) => ({
    ...row,
    geofence_match: matchPointToGeofence(row, geofences),
  }));
  const idleEvents = (eventsResult.data || []).map((event) => ({
    ...event,
    geofence_match: matchPointToGeofence(event, geofences),
  }));

  const rawBlocks = aggregateTelemetryIntoMotionBlocks(telemetryRows);
  const selectedBlocks = selectTimelineBlocksForContext(rawBlocks, idleEvents, maxBlocks);
  const hydratedBlocks = await Promise.all(
    selectedBlocks.map((block) => hydrateBlockLocations(input.companyId, block, geofences))
  );
  const latestTelemetry = telemetryRows[telemetryRows.length - 1] || null;
  const latestPoint = latestTelemetry || asset || null;
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
      severity:
        Number(block.duration_minutes || 0) >= LONG_STOP_MINUTES ? "long_stop" : "stop",
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
    local_day: localDayRange.localDate,
    query_window_utc: {
      start: localDayRange.startUtc,
      end: localDayRange.endUtc,
      filter_strategy: "local_day_utc_range_equivalent_to_timezone_recorded_at_date_filter",
    },
    latest_snapshot: latestPoint
      ? {
          recorded_at: latestTelemetry?.recorded_at || asset.last_seen_at || null,
          speed: latestTelemetry?.speed ?? null,
          location_resolution: latestLocationResolution,
          geofence_match: matchPointToGeofence(latestPoint, geofences),
          timestamp_warnings: latestTelemetry?.validation?.warnings || [],
        }
      : null,
    current_status: {
      state: rawBlocks[rawBlocks.length - 1]?.state || "unknown",
      recorded_at: latestTelemetry?.recorded_at || asset.last_seen_at || null,
      freshness_minutes: latestPoint?.recorded_at || asset.last_seen_at
        ? Math.floor(
            (Date.now() -
              new Date(latestTelemetry?.recorded_at || asset.last_seen_at).getTime()) /
              60000
          )
        : null,
      location: latestLocationResolution,
      speed: latestTelemetry?.speed ?? null,
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
        geofence_match: row.geofence_match || null,
      });
      continue;
    }

    last.end_at = row.recorded_at || last.end_at;
    last.sample_count += 1;
    last.end_point = row;
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
    if (block.state === "stationary" && Number(block.duration_minutes || 0) >= LONG_STOP_MINUTES) {
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

function compareIdleEventToMotionBlocks(event: any, blocks: TimelineBlock[], latestPoint: any) {
  const eventTime = eventTimestampMillis(event);
  const movementAfterEvent = findMovementAfter(blocks, eventTime);
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
    movement_after_event_at: movementAfterEvent?.start_at || null,
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

function classifyTelemetryMotionState(row: any): TimelineBlock["state"] {
  const speed = finiteOrNull(row?.speed);
  if (speed === null) return "unknown";
  return speed > MOVING_SPEED_THRESHOLD ? "moving" : "stationary";
}

function findMovementAfter(blocks: TimelineBlock[], eventTime: number) {
  if (!Number.isFinite(eventTime)) return null;
  return (
    blocks.find((block) => {
      if (block.state !== "moving") return false;
      const start = new Date(block.start_at || 0).getTime();
      const end = new Date(block.end_at || 0).getTime();
      return (
        (Number.isFinite(start) && start > eventTime) ||
        (Number.isFinite(start) &&
          Number.isFinite(end) &&
          start <= eventTime &&
          end > eventTime)
      );
    }) || null
  );
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

function getOperationalLocalDayUtcRange(timeZone: string) {
  const now = new Date();
  const localParts = getZonedDateParts(now, timeZone);
  const start = zonedDateTimeToUtc(
    localParts.year,
    localParts.month,
    localParts.day,
    0,
    0,
    0,
    timeZone
  );
  const nextLocalDay = new Date(Date.UTC(localParts.year, localParts.month - 1, localParts.day + 1));
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
    localDate: `${localParts.year}-${String(localParts.month).padStart(2, "0")}-${String(
      localParts.day
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
    hour: lookup.hour || 0,
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

function minutesBetween(start: any, end: any) {
  const startMs = new Date(start || 0).getTime();
  const endMs = new Date(end || 0).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.max(0, Math.round((endMs - startMs) / 60000));
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
