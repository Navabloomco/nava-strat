// app/api/nava-eye/fleet-summary/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { reverseGeocode } from "../../../../lib/location/reverseGeocode";

export async function GET(req: Request) {
  try {
    // For now, assume JLCL; later extract tenant from auth token or query param
    const url = new URL(req.url);
    const tenantSlug = url.searchParams.get("tenant") || "jlcl";

    // Get company ID from slug
    const { data: company, error: companyError } = await supabaseAdmin
      .from("companies")
      .select("id")
      .eq("slug", tenantSlug)
      .single();

    if (companyError || !company) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const companyId = company.id;
    const now = new Date();
    const startOfLast24Hours = new Date(now);
    startOfLast24Hours.setHours(now.getHours() - 24);

    // Fetch active assets only
    const { data: assets, error: assetError } = await supabaseAdmin
      .from("fleet_assets")
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "active");

    if (assetError) throw assetError;

    // Fetch events for last 24 hours
    const { data: events, error: eventError } = await supabaseAdmin
      .from("telemetry_events")
      .select("*")
      .eq("company_id", companyId)
      .gte("created_at", startOfLast24Hours.toISOString())
      .order("created_at", { ascending: false });

    if (eventError) throw eventError;

    const totalTrucks = assets?.length || 0;
    const nowTs = Date.now();

    // Offline detection (no telemetry for >30 minutes)
    const offlineTrucks = assets?.filter((asset) => {
      if (!asset.last_seen_at) return true;
      const minutes = (nowTs - new Date(asset.last_seen_at).getTime()) / 60000;
      return minutes > 30;
    }) || [];

    const onlineTrucks = totalTrucks - offlineTrucks.length;

    // Classify events
    const criticalEvents = events?.filter((e) => e.severity === "high") || [];
    const fuelEvents = events?.filter((e) =>
      ["fuel_drop_stationary", "low_fuel"].includes(e.event_type)
    ) || [];
    const idleEvents = events?.filter((e) => e.event_type === "excessive_idle") || [];
    const overspeedEvents = events?.filter((e) => e.event_type === "overspeed") || [];

    // Event counts per truck
    const eventCountsByTruck: Record<string, number> = {};
    for (const event of events || []) {
      eventCountsByTruck[event.truck_id] = (eventCountsByTruck[event.truck_id] || 0) + 1;
    }
    const highestRiskTrucks = Object.entries(eventCountsByTruck)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([truck_id, event_count]) => ({ truck_id, event_count }));

    // Idle time summary (from fuel_risk_scores or events with duration)
    // Simplified: use events that have duration_minutes
    const idleTimeByTruck: Record<string, number> = {};
    for (const event of idleEvents) {
      idleTimeByTruck[event.truck_id] = (idleTimeByTruck[event.truck_id] || 0) + (event.duration_minutes || 0);
    }
    const highestIdleTrucks = Object.entries(idleTimeByTruck)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([truck_id, idle_minutes]) => ({ truck_id, idle_minutes, idle_hours: (idle_minutes / 60).toFixed(1) }));

    // Most active trucks (by telemetry points in last 24h)
    const { data: telemetry } = await supabaseAdmin
      .from("telemetry_logs")
      .select("truck_id, recorded_at")
      .eq("company_id", companyId)
      .gte("recorded_at", startOfLast24Hours.toISOString())
      .order("recorded_at", { ascending: false });

    const telemetryCountByTruck: Record<string, number> = {};
    for (const point of telemetry || []) {
      telemetryCountByTruck[point.truck_id] = (telemetryCountByTruck[point.truck_id] || 0) + 1;
    }
    const mostActiveTrucks = Object.entries(telemetryCountByTruck)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([truck_id, points]) => ({ truck_id, telemetry_points: points }));

    // Trucks in Uganda (reverse geocode latest location)
    const latestTelemetry: Record<string, any> = {};
    for (const point of telemetry || []) {
      if (!latestTelemetry[point.truck_id]) {
        latestTelemetry[point.truck_id] = point;
      }
    }
    const trucksInUganda: { truck_id: string; location: string }[] = [];
    for (const [truck_id, point] of Object.entries(latestTelemetry)) {
      if (point.latitude && point.longitude) {
        const location = await reverseGeocode(Number(point.latitude), Number(point.longitude));
        if (location?.country?.toLowerCase() === "uganda") {
          trucksInUganda.push({ truck_id, location: location.town || location.display_name || "Unknown" });
        }
      }
    }

    // Weekly context (events last 7 days)
    const startOfLast7Days = new Date(now);
    startOfLast7Days.setDate(now.getDate() - 7);
    const { data: events7d } = await supabaseAdmin
      .from("telemetry_events")
      .select("id")
      .eq("company_id", companyId)
      .gte("created_at", startOfLast7Days.toISOString());
    const eventsLast7Days = events7d?.length || 0;
    const eventsLast24Hours = events?.length || 0;

    // Provider incident ranking (only among active assets)
    const activeTruckIds = assets?.map(a => a.truck_id) || [];
    const providerIncidents: Record<string, number> = {};
    for (const event of events || []) {
      if (activeTruckIds.includes(event.truck_id)) {
        const asset = assets?.find(a => a.truck_id === event.truck_id);
        if (asset?.provider_id) {
          providerIncidents[asset.provider_id] = (providerIncidents[asset.provider_id] || 0) + 1;
        }
      }
    }
    const providerIncidentRanking = Object.entries(providerIncidents)
      .sort((a, b) => b[1] - a[1])
      .map(([provider_id, incident_count]) => ({ provider_id, incident_count }));

    return NextResponse.json({
      success: true,
      tenant: tenantSlug,
      period: "last_24_hours",
      fleet_health: {
        total_trucks: totalTrucks,
        online_trucks: onlineTrucks,
        offline_trucks: offlineTrucks.length,
        offline_percentage: totalTrucks ? ((offlineTrucks.length / totalTrucks) * 100).toFixed(1) : "0",
        critical_events_24h: criticalEvents.length,
        fuel_events_24h: fuelEvents.length,
        excessive_idle_events_24h: idleEvents.length,
        overspeed_events_24h: overspeedEvents.length,
        border_crossings: 0, // placeholder
        trucks_in_uganda: trucksInUganda.length,
      },
      seven_day_context: {
        events_last_24_hours: eventsLast24Hours,
        events_last_7_days: eventsLast7Days,
      },
      ranking: {
        highest_risk_trucks: highestRiskTrucks,
        highest_idle_trucks: highestIdleTrucks,
        most_active_trucks: mostActiveTrucks,
      },
      provider_incident_ranking: providerIncidentRanking,
      offline_trucks: offlineTrucks.map((t) => ({
        truck_id: t.truck_id,
        last_seen_at: t.last_seen_at,
      })),
      trucks_in_uganda: trucksInUganda,
      recent_critical_events: criticalEvents.slice(0, 10).map((e) => ({
        truck_id: e.truck_id,
        event_type: e.event_type,
        severity: e.severity,
        location_name: e.location_name,
        created_at: e.created_at,
      })),
      generated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("Fleet summary error:", err);
    return NextResponse.json(
      { error: err.message || "Fleet summary failed" },
      { status: 500 }
    );
  }
}
