import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { reverseGeocode } from "../../../../lib/location/reverseGeocode";

export async function GET() {
  try {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    
    const startOfLast24Hours = new Date(now);
    startOfLast24Hours.setHours(now.getHours() - 24);
    
    const startOfLast7Days = new Date(now);
    startOfLast7Days.setDate(now.getDate() - 7);

    // Fetch all data in parallel for efficiency
    const [assetsResult, events24hResult, events7dResult, telemetryResult] = await Promise.all([
      supabaseAdmin.from("fleet_assets").select("*"),
      supabaseAdmin.from("telemetry_events").select("*").gte("created_at", startOfLast24Hours.toISOString()).order("created_at", { ascending: false }),
      supabaseAdmin.from("telemetry_events").select("*").gte("created_at", startOfLast7Days.toISOString()),
      supabaseAdmin.from("telemetry_logs").select("truck_id, recorded_at, latitude, longitude, speed").order("recorded_at", { ascending: false })
    ]);
    
    if (assetsResult.error) throw assetsResult.error;
    if (events24hResult.error) throw events24hResult.error;
    
    const assets = assetsResult.data || [];
    const events24h = events24hResult.data || [];
    const events7d = events7dResult.data || [];
    const telemetry = telemetryResult.data || [];
    
    const totalTrucks = assets.length;
    
    // Offline detection (30 minutes threshold)
    const offlineTrucks = assets.filter((asset) => {
      if (!asset.last_seen_at) return true;
      const minutes = (Date.now() - new Date(asset.last_seen_at).getTime()) / 60000;
      return minutes > 30;
    });
    
    const onlineTrucks = totalTrucks - offlineTrucks.length;
    
    // Event classifications
    const criticalEvents = events24h.filter((e) => e.severity === "high");
    const fuelEvents = events24h.filter((e) => ["fuel_drop_stationary", "low_fuel"].includes(e.event_type));
    const idleEvents = events24h.filter((e) => e.event_type === "excessive_idle");
    const overspeedEvents = events24h.filter((e) => e.event_type === "overspeed");
    
    // Trucks with most idle time (sum durations)
    const idleTimeByTruck: Record<string, number> = {};
    for (const event of idleEvents) {
      idleTimeByTruck[event.truck_id] = (idleTimeByTruck[event.truck_id] || 0) + (event.duration_minutes || 0);
    }
    const highestIdleTrucks = Object.entries(idleTimeByTruck)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([truck_id, idle_minutes]) => ({ truck_id, idle_minutes, idle_hours: (idle_minutes / 60).toFixed(1) }));
    
    // Repeated overspeeding (3+ events per truck)
    const overspeedCountByTruck: Record<string, number> = {};
    for (const event of overspeedEvents) {
      overspeedCountByTruck[event.truck_id] = (overspeedCountByTruck[event.truck_id] || 0) + 1;
    }
    const repeatOverspeedTrucks = Object.entries(overspeedCountByTruck)
      .filter(([, count]) => count >= 3)
      .map(([truck_id, count]) => ({ truck_id, overspeed_count: count }));
    
    // Event counts by truck
    const eventCountsByTruck: Record<string, number> = {};
    for (const event of events24h) {
      eventCountsByTruck[event.truck_id] = (eventCountsByTruck[event.truck_id] || 0) + 1;
    }
    const highestRiskTrucks = Object.entries(eventCountsByTruck)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([truck_id, event_count]) => ({ truck_id, event_count }));
    
    // Most active trucks (most telemetry points in last 24h)
    const telemetryLast24h = telemetry.filter(t => new Date(t.recorded_at) >= startOfLast24Hours);
    const telemetryCountByTruck: Record<string, number> = {};
    for (const point of telemetryLast24h) {
      telemetryCountByTruck[point.truck_id] = (telemetryCountByTruck[point.truck_id] || 0) + 1;
    }
    const mostActiveTrucks = Object.entries(telemetryCountByTruck)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([truck_id, points]) => ({ truck_id, telemetry_points: points }));
    
    // Trucks in Uganda (reverse geocode latest locations)
    const trucksInUganda: { truck_id: string; location: string }[] = [];
    const latestTelemetry: Record<string, any> = {};
    for (const point of telemetry) {
      if (!latestTelemetry[point.truck_id]) {
        latestTelemetry[point.truck_id] = point;
      }
    }
    
    // Process Uganda detection in parallel to avoid blocking
    const ugandaChecks = await Promise.all(
      Object.entries(latestTelemetry).map(async ([truck_id, point]) => {
        if (point.latitude && point.longitude) {
          const location = await reverseGeocode(Number(point.latitude), Number(point.longitude));
          if (location?.country?.toLowerCase() === "uganda") {
            return { truck_id, location: location.town || location.display_name || "Unknown" };
          }
        }
        return null;
      })
    );
    trucksInUganda.push(...ugandaChecks.filter(Boolean) as any);
    
    // Border crossings count from events (if you have this event type)
    const borderCrossings = events7d.filter((e) => e.event_type === "border_crossing").length;
    
    // Provider incident ranking
    const incidentsByProvider: Record<string, number> = {};
    for (const asset of assets) {
      if (asset.provider_id) {
        const truckEvents = events24h.filter((e) => e.truck_id === asset.truck_id);
        incidentsByProvider[asset.provider_id] = (incidentsByProvider[asset.provider_id] || 0) + truckEvents.length;
      }
    }
    const providerIncidentRanking = Object.entries(incidentsByProvider)
      .sort((a, b) => b[1] - a[1])
      .map(([provider_id, incident_count]) => ({ provider_id, incident_count }));
    
    // Calculate events for context
    const eventsLast24Hours = events24h.length;
    const eventsLast7Days = events7d.length;
    
    return NextResponse.json({
      success: true,
      period: "last_24_hours",
      fleet_health: {
        total_trucks: totalTrucks,
        online_trucks: onlineTrucks,
        offline_trucks: offlineTrucks.length,
        offline_percentage: totalTrucks ? ((offlineTrucks.length / totalTrucks) * 100).toFixed(1) : "0",
        critical_events: criticalEvents.length,
        fuel_events: fuelEvents.length,
        excessive_idle_events: idleEvents.length,
        overspeed_events: overspeedEvents.length,
        border_crossings: borderCrossings,
        trucks_in_uganda: trucksInUganda.length,
      },
      seven_day_context: {
        events_last_24_hours: eventsLast24Hours,
        events_last_7_days: eventsLast7Days,
      },
      ranking: {
        highest_risk_trucks: highestRiskTrucks,
        highest_idle_trucks: highestIdleTrucks,
        repeat_overspeed_trucks: repeatOverspeedTrucks,
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
      {
        success: false,
        message: err.message || "Fleet summary failed",
      },
      { status: 500 }
    );
  }
}
