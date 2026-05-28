import { supabaseAdmin } from "../supabaseAdmin";
import { reverseGeocode } from "../location/reverseGeocode";

type TelemetryLog = {
  id: string;
  company_id?: string | null;
  provider_id: string | null;
  truck_id: string;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  fuel_level: number | null;
  recorded_at: string | null;
  created_at: string;
};

export async function runNavaEyeEventEngine(companyId?: string) {
  let truckQuery = supabaseAdmin
    .from("fleet_assets")
    .select("company_id, provider_id, truck_id, latitude, longitude, last_seen_at")
    .eq("status", "active")
    .eq("intelligence_enabled", true);

  if (companyId) {
    truckQuery = truckQuery.eq("company_id", companyId);
  }

  const { data: trucks, error: truckError } = await truckQuery;

  if (truckError) {
    throw new Error(`Failed to load fleet assets: ${truckError.message}`);
  }

  if (!trucks || trucks.length === 0) {
    return {
      success: true,
      trucks_checked: 0,
      trucks_analyzed: 0,
      results: [],
    };
  }

  const results = [];

  for (const truck of trucks) {
    const truckResult = await analyzeTruck(
      truck.truck_id,
      truck.company_id || companyId
    );
    results.push({
      truck_id: truck.truck_id,
      ...truckResult,
    });
  }

  return {
    success: true,
    trucks_checked: trucks.length,
    trucks_analyzed: results.length,
    results,
  };
}

async function analyzeTruck(truckId: string, companyId?: string | null) {
  let telemetryQuery = supabaseAdmin
    .from("telemetry_logs")
    .select("*")
    .eq("truck_id", truckId)
    .order("recorded_at", { ascending: false })
    .limit(50);

  if (companyId) {
    telemetryQuery = telemetryQuery.eq("company_id", companyId);
  }

  const { data: logs, error } = await telemetryQuery;

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

  const idleCreated = await detectExcessiveIdle(logs as TelemetryLog[]);
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

  let locationName: string | null = null;
  let country: string | null = null;
  if (latest.latitude && latest.longitude) {
    const location = await reverseGeocode(
      Number(latest.latitude),
      Number(latest.longitude)
    );
    locationName = location?.town || location?.display_name || null;
    country = location?.country || null;
  }

  return createEventIfNotExists({
    company_id: latest.company_id || null,
    provider_id: latest.provider_id,
    truck_id: latest.truck_id,
    event_type: "offline",
    severity: minutesOffline > 120 ? "high" : "medium",
    started_at: latest.recorded_at,
    latitude: latest.latitude,
    longitude: latest.longitude,
    location_name: locationName,
    country: country,
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

  let locationName: string | null = null;
  let country: string | null = null;
  if (latest.latitude && latest.longitude) {
    const location = await reverseGeocode(
      Number(latest.latitude),
      Number(latest.longitude)
    );
    locationName = location?.town || location?.display_name || null;
    country = location?.country || null;
  }

  return createEventIfNotExists({
    company_id: latest.company_id || null,
    provider_id: latest.provider_id,
    truck_id: latest.truck_id,
    event_type: "overspeed",
    severity: latest.speed > 140 ? "high" : "medium",
    started_at: latest.recorded_at,
    latitude: latest.latitude,
    longitude: latest.longitude,
    location_name: locationName,
    country: country,
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

  let locationName: string | null = null;
  let country: string | null = null;
  if (latest.latitude && latest.longitude) {
    const location = await reverseGeocode(
      Number(latest.latitude),
      Number(latest.longitude)
    );
    locationName = location?.town || location?.display_name || null;
    country = location?.country || null;
  }

  return createEventIfNotExists({
    company_id: latest.company_id || null,
    provider_id: latest.provider_id,
    truck_id: latest.truck_id,
    event_type: "low_fuel",
    severity: "medium",
    started_at: latest.recorded_at,
    latitude: latest.latitude,
    longitude: latest.longitude,
    location_name: locationName,
    country: country,
    metadata: {
      fuel_level: latest.fuel_level,
      threshold: 10,
      message: `${latest.truck_id} fuel is critically low at ${latest.fuel_level}%.`,
    },
  });
}

/**
 * Truck appeared GPS-stopped for 30+ minutes.
 * This does not prove engine-on idle without ignition/engine evidence.
 */
async function detectExcessiveIdle(logs: TelemetryLog[]) {
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

  let locationName: string | null = null;
  let country: string | null = null;
  if (newest.latitude && newest.longitude) {
    const location = await reverseGeocode(
      Number(newest.latitude),
      Number(newest.longitude)
    );
    locationName = location?.town || location?.display_name || null;
    country = location?.country || null;
  }

  return createEventIfNotExists({
    company_id: newest.company_id || null,
    provider_id: newest.provider_id,
    truck_id: newest.truck_id,
    event_type: "excessive_idle",
    severity: durationMinutes > 120 ? "high" : "medium",
    started_at: oldest.recorded_at,
    ended_at: newest.recorded_at,
    duration_minutes: Math.floor(durationMinutes),
    latitude: newest.latitude,
    longitude: newest.longitude,
    location_name: locationName,
    country: country,
    metadata: {
      evidence_source: "gps-estimated",
      engine_on_idling_confirmed: false,
      fuel_burn_confirmed: false,
      duration_minutes: Math.floor(durationMinutes),
      message: `${newest.truck_id} appeared GPS-stopped for ${Math.floor(
        durationMinutes
      )} minutes. Engine-on idling is not verified without ignition/engine evidence.`,
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
      let locationName: string | null = null;
      let country: string | null = null;
      if (current.latitude && current.longitude) {
        const location = await reverseGeocode(
          Number(current.latitude),
          Number(current.longitude)
        );
        locationName = location?.town || location?.display_name || null;
        country = location?.country || null;
      }

      return createEventIfNotExists({
        company_id: current.company_id || null,
        provider_id: current.provider_id,
        truck_id: current.truck_id,
        event_type: "fuel_drop_stationary",
        severity: fuelDrop >= 10 ? "high" : "medium",
        started_at: previous.recorded_at,
        ended_at: current.recorded_at,
        duration_minutes: Math.floor(minutes),
        latitude: current.latitude,
        longitude: current.longitude,
        location_name: locationName,
        country: country,
        metadata: {
          previous_fuel: previousFuel,
          current_fuel: currentFuel,
          fuel_drop: fuelDrop,
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
  company_id?: string | null;
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
  country?: string | null;
  metadata?: any;
}) {
  // Generate a unique hash for this event
  let hashBase = `${event.truck_id}|${event.event_type}`;
  
  if (event.event_type === "excessive_idle") {
    const startedAt = event.started_at || new Date().toISOString();
    hashBase += `|${startedAt}`;
  } else if (event.event_type === "fuel_drop_stationary") {
    const startedAt = event.started_at || new Date().toISOString();
    const endedAt = event.ended_at || new Date().toISOString();
    hashBase += `|${startedAt}|${endedAt}`;
  } else {
    const startedAt = event.started_at || new Date().toISOString();
    hashBase += `|${startedAt}`;
  }
  
  // Simple hash using crypto (Edge compatible)
  const encoder = new TextEncoder();
  const data = encoder.encode(hashBase);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const eventHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
  
  // Check if event with this hash already exists
  const { data: existing } = await supabaseAdmin
    .from("telemetry_events")
    .select("id")
    .eq("event_hash", eventHash)
    .limit(1);
  
  if (existing && existing.length > 0) {
    // Event already exists, skip insertion
    return false;
  }
  
  // Insert new event with hash
  const { error } = await supabaseAdmin
    .from("telemetry_events")
    .insert({
      ...(event.company_id ? { company_id: event.company_id } : {}),
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
      country: event.country || null,
      metadata: event.metadata || {},
      event_hash: eventHash,
    });

  if (error) {
    // Ignore duplicate hash errors (unique constraint violation)
    if (
      error.message && (
        error.message.includes("idx_telemetry_events_event_hash") ||
        error.message.includes("duplicate key value") ||
        error.message.includes("unique constraint")
      )
    ) {
      // Duplicate event already exists, safe to ignore
      return false;
    }
    
    // Other errors should be logged and thrown
    console.error("Failed to create telemetry event:", error);
    throw new Error(`Failed to create telemetry event: ${error.message}`);
  }

  return true;
}
