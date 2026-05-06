"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function OpsDashboard() {
  // --- STATE ---
  const [fuelLogs, setFuelLogs] = useState<any[]>([]);
  const [journeys, setJourneys] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [trackingPoints, setTrackingPoints] = useState<any[]>([]);
  const [fuelDrops, setFuelDrops] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Intelligence State
  const [alerts, setAlerts] = useState<any[]>([]);
  const [syncLogs, setSyncLogs] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [trucks, setTrucks] = useState<any[]>([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);

    const { data: fuelData } = await supabase.from("fuel_logs").select("*").order("created_at", { ascending: false });
    const { data: journeyData } = await supabase.from("journeys").select("*").order("created_at", { ascending: false });
    const { data: expenseData } = await supabase.from("expenses").select("*").order("created_at", { ascending: false });
    const { data: trackingData } = await supabase.from("tracking_points").select("*").order("recorded_at", { ascending: false });
    const { data: fuelDropData } = await supabase.from("fuel_drop_events").select("*").order("recorded_at", { ascending: false });

    // Ingestion Queries
    const { data: alertData } = await supabase.from("tracking_alerts").select("*").order("created_at", { ascending: false });
    const { data: syncData } = await supabase.from("tracking_sync_logs").select("*").order("created_at", { ascending: false });
    const { data: providerData } = await supabase.from("tracking_providers").select("*");
    const { data: truckData } = await supabase.from("trucks").select("*");

    setFuelLogs(fuelData || []);
    setJourneys(journeyData || []);
    setExpenses(expenseData || []);
    setTrackingPoints(trackingData || []);
    setFuelDrops(fuelDropData || []);

    setAlerts(alertData || []);
    setSyncLogs(syncData || []);
    setProviders(providerData || []);
    setTrucks(truckData || []);
    
    setLoading(false);
  }

  // --- LOGIC HELPERS ---
  function totalFuelCostForJourney(journeyId: string) {
    return fuelLogs.filter((f) => f.journey_id === journeyId).reduce((sum, f) => sum + Number(f.total_cost || 0), 0);
  }

  function totalExpensesForJourney(journeyId: string) {
    return expenses.filter((e) => e.journey_id === journeyId).reduce((sum, e) => sum + Number(e.amount || 0), 0);
  }

  function marginForJourney(j: any) {
    const revenueKes = Number(j.revenue_kes || j.revenue || 0);
    const totalCost = totalFuelCostForJourney(j.id) + totalExpensesForJourney(j.id);
    const margin = revenueKes - totalCost;
    const marginPct = revenueKes > 0 ? (margin / revenueKes) * 100 : null;
    return { revenueKes, totalCost, margin, marginPct };
  }

  function latestTrackingForTruck(truck: string) {
    return trackingPoints.find((p) => (p.truck_text || "").toUpperCase() === (truck || "").toUpperCase()) || null;
  }

  // --- MEMOS ---
  const activeJourneys = useMemo(() => journeys.filter((j) => j.status === "active"), [journeys]);
  const unallocatedFuel = useMemo(() => fuelLogs.filter((f) => !f.journey_id), [fuelLogs]);
  const lossMakingJourneys = useMemo(() => activeJourneys.filter((j) => marginForJourney(j).margin < 0), [activeJourneys, fuelLogs, expenses]);

  const grouped = useMemo(() => {
    const map: any = {};
    activeJourneys.forEach((j) => {
      const client = j.client_name || "NO CLIENT";
      const route = `${j.from_location || "—"} → ${j.to_location || "—"}`;
      if (!map[client]) map[client] = {};
      if (!map[client][route]) map[client][route] = [];
      map[client][route].push(j);
    });
    return map;
  }, [activeJourneys]);

  if (loading) return <main style={{ padding: 40 }}>Loading Nava Strat Intelligence...</main>;

  return (
    <main style={{ padding: 40, fontFamily: 'sans-serif' }}>
      <h1>Ops Command Center</h1>

      {/* 1. FLEET INTELLIGENCE HEADER */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '30px' }}>
        <div style={{ background: '#f4f4f4', padding: '15px', borderRadius: '8px' }}>
          <strong>Infrastructure</strong>
          <p>Trucks: {trucks.length} | Providers: {providers.length}</p>
        </div>
        <div style={{ background: '#fff5f5', padding: '15px', borderRadius: '8px', border: '1px solid #feb2b2' }}>
          <strong>Risk & Alerts</strong>
          <p>Active: {alerts.filter(a => a.status !== "resolved").length} | Critical: {alerts.filter(a => a.severity === "critical").length}</p>
        </div>
        <div style={{ background: '#f0fff4', padding: '15px', borderRadius: '8px', border: '1px solid #9ae6b4' }}>
          <strong>Sync Health</strong>
          <p>Success: {syncLogs.filter(s => s.status === "success").length} | Failed: {syncLogs.filter(s => s.status === "error").length}</p>
        </div>
      </section>

      {/* 2. LIVE ALERT FEED WITH WORKFLOW ACTIONS */}
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, marginBottom: 24, background: "#fff" }}>
        <h3>Live Alert Feed</h3>
        {alerts.filter(a => a.status !== "resolved").length === 0 ? (
          <p>No active alerts. Fleet is secure.</p>
        ) : (
          alerts
            .filter((a) => a.status !== "resolved")
            .slice(0, 10)
            .map((alert) => (
              <div key={alert.id} style={{
                padding: 12, marginBottom: 10, borderRadius: 10,
                border: alert.severity === "critical" ? "1px solid red" : "1px solid #ddd",
                background: alert.severity === "critical" ? "#fff5f5" : "#f9f9f9"
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{alert.title}</strong>
                  <small>{new Date(alert.created_at).toLocaleString()}</small>
                </div>
                <p style={{ margin: '8px 0' }}>{alert.description}</p>
                <div style={{ fontSize: '13px' }}>Status: <strong>{alert.status || "active"}</strong></div>

                {/* WORKFLOW BUTTONS */}
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={async () => {
                      await supabase.from("tracking_alerts").update({ status: "resolved" }).eq("id", alert.id);
                      load();
                    }}
                    style={{ marginRight: 8, padding: "6px 10px", borderRadius: 6, border: "none", background: "green", color: "white", cursor: "pointer" }}
                  >
                    Resolve
                  </button>
                  <button
                    onClick={async () => {
                      await supabase.from("tracking_alerts").update({ status: "ignored" }).eq("id", alert.id);
                      load();
                    }}
                    style={{ padding: "6px 10px", borderRadius: 6, border: "none", background: "#666", color: "white", cursor: "pointer" }}
                  >
                    Ignore
                  </button>
                </div>
              </div>
            ))
        )}
      </div>

      {/* 3. ACTIVE OPERATIONS */}
      <h2>Active Operations</h2>
      {Object.keys(grouped).map((client) => (
        <div key={client} style={{ marginBottom: 30 }}>
          <h3 style={{ borderBottom: '1px solid #eee' }}>{client}</h3>
          {Object.keys(grouped[client]).map((route) => (
            <div key={route} style={{ marginLeft: 20, marginBottom: 16 }}>
              <strong>{route}</strong>
              <ul>
                {grouped[client][route].map((j: any) => {
                  const m = marginForJourney(j);
                  const latest = latestTrackingForTruck(j.truck);
                  return (
                    <li key={j.id} style={{ marginBottom: 8 }}>
                      <strong>{j.truck}</strong> — {latest?.interpreted_location || "Locating..."} 
                      <span style={{ color: m.margin < 0 ? 'red' : 'green', marginLeft: 10 }}>
                        ({m.margin.toLocaleString()} KES)
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </main>
  );
}
