// lib/intelligence/fleetHealthService.ts
import { supabaseAdmin } from "../supabaseAdmin";

export async function getFleetHealth(companyId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [assetsResult, eventsResult] = await Promise.all([
    supabaseAdmin
      .from("fleet_assets")
      .select("truck_id, last_seen_at, latitude, longitude")
      .eq("company_id", companyId)
      .eq("status", "active")
      .eq("intelligence_enabled", true),
    supabaseAdmin
      .from("telemetry_events")
      .select("truck_id, event_type, severity, location_name, created_at, duration_minutes")
      .eq("company_id", companyId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false }),
  ]);

  const assets = assetsResult.data || [];
  const enabledTruckIds = new Set(assets.map((asset) => asset.truck_id).filter(Boolean));
  const events = (eventsResult.data || []).filter((event) =>
    enabledTruckIds.has(event.truck_id)
  );
  const now = Date.now();

  const offline = assets.filter((a) => {
    if (!a.last_seen_at) return true;
    return (now - new Date(a.last_seen_at).getTime()) / 60000 > 30;
  });

  const critical = events.filter((e) => e.severity === "high");
  const fuelEvents = events.filter((e) => ["fuel_drop_stationary", "low_fuel"].includes(e.event_type));
  const idleEvents = events.filter((e) => e.event_type === "excessive_idle");

  // Idle minutes per truck
  const idleMinutes: Record<string, number> = {};
  for (const e of idleEvents) {
    idleMinutes[e.truck_id] = (idleMinutes[e.truck_id] || 0) + (e.duration_minutes || 0);
  }
  const highestIdle = Object.entries(idleMinutes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([truck_id, minutes]) => {
      const latestIdleEvent = idleEvents.find((event) => event.truck_id === truck_id);

      return {
        truck_id,
        idle_minutes: minutes,
        idle_hours: (minutes / 60).toFixed(1),
        latest_idle_event_at: latestIdleEvent?.created_at || null,
        latest_idle_event_type: latestIdleEvent?.event_type || null,
        latest_idle_duration_minutes: latestIdleEvent?.duration_minutes ?? null,
      };
    });

  const latestTelemetryByTruck = await fetchLatestTelemetryByTruck(
    companyId,
    highestIdle.map((truck) => truck.truck_id)
  );
  const highestIdleWithTelemetry = highestIdle.map((truck) => {
    const latestTelemetry = latestTelemetryByTruck[truck.truck_id];
    const freshnessMinutes = latestTelemetry?.recorded_at
      ? Math.floor((now - new Date(latestTelemetry.recorded_at).getTime()) / 60000)
      : null;

    return {
      ...truck,
      latest_speed: latestTelemetry?.speed ?? null,
      latest_recorded_at: latestTelemetry?.recorded_at || null,
      freshness_minutes:
        freshnessMinutes !== null && Number.isFinite(freshnessMinutes)
          ? freshnessMinutes
          : null,
    };
  });

  const fuelTelemetrySummary = await fetchFuelTelemetrySummary(
    companyId,
    Array.from(enabledTruckIds),
    since
  );

  // Risk by event count
  const eventCounts: Record<string, number> = {};
  for (const e of events) eventCounts[e.truck_id] = (eventCounts[e.truck_id] || 0) + 1;
  const highestRisk = Object.entries(eventCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([truck_id, count]) => ({ truck_id, event_count: count }));

  return {
    total_trucks: assets.length,
    online_trucks: assets.length - offline.length,
    offline_trucks: offline.length,
    offline_truck_ids: offline.map((t) => t.truck_id),
    critical_events_24h: critical.length,
    fuel_events_24h: fuelEvents.length,
    idle_events_24h: idleEvents.length,
    highest_risk_trucks: highestRisk,
    highest_idle_trucks: highestIdleWithTelemetry,
    fuel_telemetry_summary: {
      ...fuelTelemetrySummary,
      fuel_events_24h: fuelEvents.length,
    },
    recent_critical_events: critical.slice(0, 10).map((e) => ({
      truck_id: e.truck_id,
      event_type: e.event_type,
      severity: e.severity,
      location_name: e.location_name,
      created_at: e.created_at,
    })),
  };
}

async function fetchLatestTelemetryByTruck(companyId: string, truckIds: string[]) {
  const uniqueTruckIds = Array.from(new Set(truckIds.filter(Boolean)));
  const entries = await Promise.all(
    uniqueTruckIds.map(async (truckId) => {
      const { data, error } = await supabaseAdmin
        .from("telemetry_logs")
        .select("truck_id, recorded_at, speed")
        .eq("company_id", companyId)
        .eq("truck_id", truckId)
        .order("recorded_at", { ascending: false })
        .limit(1);

      if (error) throw error;
      return [truckId, data?.[0] || null] as const;
    })
  );

  return Object.fromEntries(entries);
}

async function fetchFuelTelemetrySummary(
  companyId: string,
  truckIds: string[],
  since: Date
) {
  const uniqueTruckIds = Array.from(new Set(truckIds.filter(Boolean)));

  if (!uniqueTruckIds.length) {
    return {
      enabled_assets_checked: 0,
      recent_readings: 0,
      usable_readings: 0,
      enabled_assets_with_usable_fuel: 0,
      recent_fuel_scores: 0,
      enabled_assets_with_recent_fuel_scores: 0,
      latest_fuel_recorded_at: null,
    };
  }

  const [telemetryResult, scoresResult] = await Promise.all([
    supabaseAdmin
      .from("telemetry_logs")
      .select("truck_id, recorded_at, fuel_level")
      .eq("company_id", companyId)
      .in("truck_id", uniqueTruckIds)
      .gte("recorded_at", since.toISOString())
      .order("recorded_at", { ascending: false })
      .limit(1000),
    supabaseAdmin
      .from("fuel_risk_scores")
      .select("truck_id, risk_score, created_at")
      .eq("company_id", companyId)
      .in("truck_id", uniqueTruckIds)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  if (telemetryResult.error) throw telemetryResult.error;
  if (scoresResult.error) throw scoresResult.error;

  const rows = telemetryResult.data || [];
  const fuelScores = scoresResult.data || [];
  const usableRows = rows.filter((row) => {
    const fuelLevel = Number(row.fuel_level);
    return Number.isFinite(fuelLevel) && fuelLevel > 0;
  });
  const trucksWithUsableFuel = new Set(
    usableRows.map((row) => row.truck_id).filter(Boolean)
  );
  const trucksWithFuelScores = new Set(
    fuelScores.map((score) => score.truck_id).filter(Boolean)
  );

  return {
    enabled_assets_checked: uniqueTruckIds.length,
    recent_readings: rows.length,
    usable_readings: usableRows.length,
    enabled_assets_with_usable_fuel: trucksWithUsableFuel.size,
    recent_fuel_scores: fuelScores.length,
    enabled_assets_with_recent_fuel_scores: trucksWithFuelScores.size,
    latest_fuel_recorded_at: usableRows[0]?.recorded_at || rows[0]?.recorded_at || null,
  };
}
