import { supabaseAdmin } from "../supabaseAdmin";

type TelemetryLog = {
  id: string;
  provider_id: string | null;
  truck_id: string;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  fuel_level: number | null;
  recorded_at: string | null;
  created_at: string;
};

export async function runNavaEyeEventEngine() {
  const { data: trucks, error: truckError } = await supabaseAdmin
    .from("fleet_assets")
    .select("provider_id, truck_id, latitude, longitude, last_seen_at");

  if (truckError) {
    throw new Error(`Failed to load fleet assets: ${truckError.message}`);
  }

  const results = [];

  for (const truck of trucks || []) {
    const truckResult = await analyzeTruck(truck.truck_id);
    results.push({
      truck_id: truck.truck_id,
      ...truckResult,
    });
  }

  return {
    success: true,
    trucks_checked: results.length,
    results,
  };
}

async function analyzeTruck(truckId: string) {
  const { data: logs, error } = await supabaseAdmin
    .from("telemetry_logs")
    .select("*")
    .eq("truck_id", truckId)
    .order("recorded_at", { ascending: false })
    .limit(50);

  if (error) {
    return {
      success: false,
      message: error.message,
      events_created: 0,
    };
  }

  if (!logs || logs.length === 0) {
    return {
      success: true,
      message: "No telemetry logs found",
      events_created: 0,
    };
  }

  let eventsCreated = 0;

  const latest = logs[0] as TelemetryLog;

  const offlineCreated = await detectOffline(latest);
  if (offlineCreated) eventsCreated++;

  const speedingCreated = await detectSpeeding(latest);
  if (speedingCreated) eventsCreated++;

  const lowFuelCreated = await detectLowFuel(latest);
  if (lowFuelCreated) eventsCreated++;

  const idleCreated = await detectLongIdle(logs as TelemetryLog[]);
  if (idleCreated) eventsCreated++;

  const fuelDropCreated = await detectFuelDropWhileStationary(
    logs as TelemetryLog[]
  );
  if (fuelDropCreated) eventsCreated++;

  return {
    success: true,
    message: `Created ${eventsCreated} events`,
    events_created: eventsCreated,
  };
}

/**
 * Truck has not reported recently.
 */
async function detectOffline(latest: TelemetryLog) {
  if (!latest.recorded_at) return false;

  const lastSeen = new Date(latest.recorded_at);
  const now = new Date();

  const minutesOffline =
    (now.getTime() - lastSeen.getTime()) / 1000 / 60;

  if (minutesOffline < 30) return false;

  return createEventIfNotExists({
    provider_id: latest.provider_id,
    truck_id: latest.truck_id,
    event_type: "offline",
    severity: minutesOffline > 120 ? "high" : "medium",
    started_at: latest.recorded_at,
    latitude: latest.latitude,
    longitude: latest.longitude,
    metadata: {
      minutes_offline: Math.floor(minutesOffline),
      message: `${latest.truck_id} has not reported for ${Math.floor(
        minutesOffline
      )} minutes.`,
    },
  });
}

/**
 * Speed policy breach.
 */
async function detectSpeeding(latest: TelemetryLog) {
  if (latest.speed === null || latest.speed === undefined) return false;

  if (latest.speed <= 120) return false;

  return createEventIfNotExists({
    provider_id: latest.provider_id,
    truck_id: latest.truck_id,
    event_type: "speeding",
    severity: latest.speed > 140 ? "high" : "medium",
    started_at: latest.recorded_at,
    latitude: latest.latitude,
    longitude: latest.longitude,
    metadata: {
      speed: latest.speed,
      threshold: 120,
      message: `${latest.truck_id} recorded ${latest.speed} km/h.`,
    },
  });
}

/**
 * Simple low fuel warning.
 */
async function detectLowFuel(latest: TelemetryLog) {
  if (latest.fuel_level === null || latest.fuel_level === undefined) {
    return false;
  }

  if (latest.fuel_level >= 10) return false;

  return createEventIfNotExists({
    provider_id: latest.provider_id,
    truck_id: latest.truck_id,
    event_type: "low_fuel",
    severity: "medium",
    started_at: latest.recorded_at,
    latitude: latest.latitude,
    longitude: latest.longitude,
    metadata: {
      fuel_level: latest.fuel_level,
      threshold: 10,
      message: `${latest.truck_id} fuel is critically low at ${latest.fuel_level}%.`,
    },
  });
}

/**
 * Truck stayed idle for 30+ minutes.
 */
async function detectLongIdle(logs: TelemetryLog[]) {
  const idleLogs = logs
    .filter((log) => log.speed !== null && log.speed !== undefined)
    .filter((log) => Number(log.speed) <= 1)
    .filter((log) => log.recorded_at);

  if (idleLogs.length < 2) return false;

  const newest = idleLogs[0];
  const oldest = idleLogs[idleLogs.length - 1];

  const newestTime = new Date(newest.recorded_at!);
  const oldestTime = new Date(oldest.recorded_at!);

  const durationMinutes =
    (newestTime.getTime() - oldestTime.getTime()) / 1000 / 60;

  if (durationMinutes < 30) return false;

  return createEventIfNotExists({
    provider_id: newest.provider_id,
    truck_id: newest.truck_id,
    event_type: "long_idle",
    severity: durationMinutes > 120 ? "high" : "medium",
    started_at: oldest.recorded_at,
    ended_at: newest.recorded_at,
    duration_minutes: Math.floor(durationMinutes),
    latitude: newest.latitude,
    longitude: newest.longitude,
    metadata: {
      duration_minutes: Math.floor(durationMinutes),
      message: `${newest.truck_id} has been idle for ${Math.floor(
        durationMinutes
      )} minutes.`,
    },
  });
}

/**
 * Fuel theft / fuel leak suspicion:
 * fuel drops while truck is stationary.
 */
async function detectFuelDropWhileStationary(logs: TelemetryLog[]) {
  const usable = logs
    .filter((log) => log.recorded_at)
    .filter((log) => log.fuel_level !== null && log.fuel_level !== undefined)
    .filter((log) => log.speed !== null && log.speed !== undefined)
    .sort(
      (a, b) =>
        new Date(a.recorded_at!).getTime() -
        new Date(b.recorded_at!).getTime()
    );

  if (usable.length < 2) return false;

  for (let i = 1; i < usable.length; i++) {
    const previous = usable[i - 1];
    const current = usable[i];

    const previousFuel = Number(previous.fuel_level);
    const currentFuel = Number(current.fuel_level);

    const fuelDrop = previousFuel - currentFuel;

    const previousSpeed = Number(previous.speed);
    const currentSpeed = Number(current.speed);

    const bothStationary = previousSpeed <= 1 && currentSpeed <= 1;

    const previousTime = new Date(previous.recorded_at!);
    const currentTime = new Date(current.recorded_at!);

    const minutes =
      (currentTime.getTime() - previousTime.getTime()) / 1000 / 60;

    if (
      bothStationary &&
      minutes <= 30 &&
      fuelDrop >= 5
    ) {
      return createEventIfNotExists({
        provider_id: current.provider_id,
        truck_id: current.truck_id,
        event_type: "fuel_drop_stationary",
        severity: fuelDrop >= 10 ? "high" : "medium",
        started_at: previous.recorded_at,
        ended_at: current.recorded_at,
        duration_minutes: Math.floor(minutes),
        latitude: current.latitude,
        longitude: current.longitude,
        metadata: {
          previous_fuel: previousFuel,
          current_fuel: currentFuel,
          fuel_drop,
          minutes: Math.floor(minutes),
          previous_speed: previousSpeed,
          current_speed: currentSpeed,
          message: `${current.truck_id} fuel dropped ${fuelDrop}% while stationary.`,
        },
      });
    }
  }

  return false;
}

async function createEventIfNotExists(event: {
  provider_id: string | null;
  truck_id: string;
  event_type: string;
  severity: string;
  started_at?: string | null;
  ended_at?: string | null;
  duration_minutes?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  location_name?: string | null;
  metadata?: any;
}) {
  const windowStart = event.started_at
    ? new Date(event.started_at)
    : new Date();

  const windowEnd = new Date(windowStart);
  windowEnd.setMinutes(windowEnd.getMinutes() + 5);

  const { data: existing } = await supabaseAdmin
    .from("telemetry_events")
    .select("id")
    .eq("truck_id", event.truck_id)
    .eq("event_type", event.event_type)
    .gte("started_at", windowStart.toISOString())
    .lte("started_at", windowEnd.toISOString())
    .limit(1);

  if (existing && existing.length > 0) {
    return false;
  }

  const { error } = await supabaseAdmin
    .from("telemetry_events")
    .insert({
      provider_id: event.provider_id,
      truck_id: event.truck_id,
      event_type: event.event_type,
      severity: event.severity,
      started_at: event.started_at || new Date().toISOString(),
      ended_at: event.ended_at || null,
      duration_minutes: event.duration_minutes || null,
      latitude: event.latitude || null,
      longitude: event.longitude || null,
      location_name: event.location_name || null,
      metadata: event.metadata || {},
    });

  if (error) {
    throw new Error(`Failed to create telemetry event: ${error.message}`);
  }

  return true;
}
