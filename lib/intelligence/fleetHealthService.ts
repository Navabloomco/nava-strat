// lib/intelligence/fleetHealthService.ts
import { supabaseAdmin } from "../supabaseAdmin";

export async function getFleetHealth(companyId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [assetsResult, eventsResult] = await Promise.all([
    supabaseAdmin
      .from("fleet_assets")
      .select("truck_id, last_seen_at, latitude, longitude")
      .eq("company_id", companyId)
      .eq("status", "active"),
    supabaseAdmin
      .from("telemetry_events")
      .select("truck_id, event_type, severity, location_name, created_at, duration_minutes")
      .eq("company_id", companyId)
      .gte("created_at", since.toISOString()),
  ]);

  const assets = assetsResult.data || [];
  const events = eventsResult.data || [];
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
    .map(([truck_id, minutes]) => ({ truck_id, idle_minutes: minutes, idle_hours: (minutes / 60).toFixed(1) }));

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
    highest_idle_trucks: highestIdle,
    recent_critical_events: critical.slice(0, 10).map((e) => ({
      truck_id: e.truck_id,
      event_type: e.event_type,
      severity: e.severity,
      location_name: e.location_name,
      created_at: e.created_at,
    })),
  };
}
