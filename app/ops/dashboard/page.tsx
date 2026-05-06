"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function OpsDashboard() {
  // --- STATE DECLARATIONS ---
  const [fuelLogs, setFuelLogs] = useState<any[]>([]);
  const [journeys, setJourneys] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [trackingPoints, setTrackingPoints] = useState<any[]>([]);
  const [fuelDrops, setFuelDrops] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Automated Telemetry & Intelligence State
  const [alerts, setAlerts] = useState<any[]>([]);
  const [syncLogs, setSyncLogs] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [trucks, setTrucks] = useState<any[]>([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);

    // Existing Business Logic Queries
    const { data: fuelData } = await supabase.from("fuel_logs").select("*").order("created_at", { ascending: false });
    const { data: journeyData } = await supabase.from("journeys").select("*").order("created_at", { ascending: false });
    const { data: expenseData } = await supabase.from("expenses").select("*").order("created_at", { ascending: false });
    const { data: trackingData } = await supabase.from("tracking_points").select("*").order("recorded_at", { ascending: false });
    const { data: fuelDropData } = await supabase.from("fuel_drop_events").select("*").order("recorded_at", { ascending: false });

    // Automated Ingestion & Intelligence Queries
    const { data: alertData } = await supabase.from("tracking_alerts").select("*").order("created_at", { ascending: false });
    const { data: syncData } = await supabase.from("tracking_sync_logs").select("*").order("created_at", { ascending: false });
    const { data: providerData } = await supabase.from("tracking_providers").select("*");
    const { data: truckData } = await supabase.from("trucks").select("*");

    setFuelLogs(fuelData || []);
    setJourneys(journeyData || []);
    setExpenses(expenseData || []);
    setTrackingPoints(trackingData || []);
    setFuelDrops(fuelDropData || []);

    // Set Automated Intelligence State
    setAlerts(alertData || []);
    setSyncLogs(syncData || []);
    setProviders(providerData || []);
    setTrucks(truckData || []);
    
    setLoading(false);
  }

  // --- LOGIC HELPERS ---
  function totalFuelCostForJourney(journeyId: string) {
    return fuelLogs.filter((fuel) => fuel.journey_id === journeyId).reduce((sum, fuel) => sum + Number(fuel.total_cost || 0), 0);
  }

  function totalExpensesForJourney(journeyId: string) {
    return expenses.filter((expense) => expense.journey_id === journeyId).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  }

  function marginForJourney(journey: any) {
    const revenueKes = Number(journey.revenue_kes || journey.revenue || 0);
    const fuelCost = totalFuelCostForJourney(journey.id);
    const expenseTotal = totalExpensesForJourney(journey.id);
    const totalCost = fuelCost + expenseTotal;
    const margin = revenueKes - totalCost;
    const marginPct = revenueKes > 0 ? (margin / revenueKes) * 100 : null;
    return { revenueKes, fuelCost, expenseTotal, totalCost, margin, marginPct };
  }

  function latestTrackingForTruck(truck: string) {
    return trackingPoints.find((p) => (p.truck_text || "").toUpperCase() === (truck || "").toUpperCase()) || null;
  }

  // --- MEMOS ---
  const activeJourneys = useMemo(() => journeys.filter((j) => j.status === "active"), [journeys]);
  const unallocatedFuel = useMemo(() => fuelLogs.filter((f) => !f.journey_id), [fuelLogs]);
  const lossMakingJourneys = useMemo(() => activeJourneys.filter((j) => {
    const m = marginForJourney(j);
    return m.revenueKes > 0 && m.margin < 0;
  }), [activeJourneys, fuelLogs, expenses]);

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
      <p>Fuel, tracking, expenses, revenue, and contribution margin.</p>

      {/* 1. Fleet Intelligence Header */}
      <hr />
      <section style={{ padding: '10px 0' }}>
        <h2>🚛 Fleet Intelligence Overview</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
          <div style={{ background: '#f4f4f4', padding: '15px', borderRadius: '8px' }}>
            <p style={{ margin: 0 }}><strong>Infrastructure</strong></p>
            <p>Trucks: {trucks.length} | Providers: {providers.length}</p>
          </div>
          <div style={{ background: '#fff5f5', padding: '15px', borderRadius: '8px', border: '1px solid #feb2b2' }}>
            <p style={{ margin: 0 }}><strong>Risk & Alerts</strong></p>
            <p>Active: {alerts.filter(a => a.status !== "resolved").length} | Critical: {alerts.filter(a => a.severity === "critical").length}</p>
          </div>
          <div style={{ background: '#f0fff4', padding: '15px', borderRadius: '8px', border: '1px solid #9ae6b4' }}>
            <p style={{ margin: 0 }}><strong>Sync Health</strong></p>
            <p>Success: {syncLogs.filter(s => s.status === "success").length} | Failed: {syncLogs.filter(s => s.status === "error").length}</p>
          </div>
        </div>
      </section>
      <hr />

      {/* 2. Nava Eye Alerts Summary */}
      <h2>🚨 Nava Eye Alerts</h2>
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <p>Unallocated Fuel: <strong>{unallocatedFuel.length}</strong></p>
        <p>Possible Fuel Drops: <strong>{fuelDrops.length}</strong></p>
        <p>Loss-Making Journeys: <strong>{lossMakingJourneys.length}</strong></p>
      </div>

      {/* 3. Live Alert Feed (The New Actionable Layer) */}
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, marginBottom: 24, background: "#fff" }}>
        <h3>Live Alert Feed</h3>
        {alerts.length === 0 ? (
          <p>No active alerts.</p>
        ) : (
          alerts.slice(0, 10).map((alert) => (
            <div
              key={alert.id}
              style={{
                padding: 12,
                marginBottom: 10,
                borderRadius: 10,
                border: alert.severity === "critical" ? "1px solid red" : alert.severity === "high" ? "1px solid orange" : "1px solid #ddd",
                background: alert.severity === "critical" ? "#fff5f5" : alert.severity === "high" ? "#fffaf0" : "#f9f9f9"
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{alert.title}</strong>
                <span style={{ fontSize: '12px', fontWeight: 'bold', color: alert.severity === 'critical' ? 'red' : '#666' }}>
                  {alert.severity.toUpperCase()}
                </span>
              </div>
              <small style={{ color: '#666' }}>{new Date(alert.created_at).toLocaleString()}</small>
              <p style={{ margin: '8px 0' }}>{alert.description}</p>
              <div style={{ fontSize: '13px' }}>Status: <strong>{alert.status || "active"}</strong></div>
            </div>
          ))
        )}
      </div>

      {/* 4. Loss Making Journeys */}
      {lossMakingJourneys.length > 0 && (
        <>
          <h3>Loss-Making Journeys</h3>
          {lossMakingJourneys.map((j: any) => {
            const m = marginForJourney(j);
            return (
              <div key={j.id} style={{ border: "1px solid red", padding: 12, marginBottom: 10, borderRadius: 8 }}>
                <strong>{j.truck} — {j.client_name}</strong><br />
                <span style={{ color: "red" }}>Margin: {m.margin.toLocaleString()} KES ({m.marginPct?.toFixed(1)}%)</span>
              </div>
            );
          })}
        </>
      )}

      {/* 5. Active Operations */}
      <h2 style={{ marginTop: 40 }}>Active Operations</h2>
      {Object.keys(grouped).map((client) => (
        <div key={client} style={{ marginBottom: 30 }}>
          <h3 style={{ borderBottom: '1px solid #eee', paddingBottom: '5px' }}>{client}</h3>
          {Object.keys(grouped[client]).map((route) => (
            <div key={route} style={{ marginLeft: 20, marginBottom: 16 }}>
              <strong>{route} ({grouped[client][route].length} trucks)</strong>
              <ul>
                {grouped[client][route].map((j: any) => {
                  const m = marginForJourney(j);
                  const latest = latestTrackingForTruck(j.truck);
                  return (
                    <li key={j.id} style={{ marginBottom: 12 }}>
                      <strong>{j.truck}</strong> — {j.driver || "NO DRIVER"}<br />
                      <small>Location: {latest?.interpreted_location || "No tracking yet"}</small><br />
                      <small>Margin: <span style={{ color: m.margin < 0 ? 'red' : 'green' }}>{m.revenueKes > 0 ? `${m.margin.toLocaleString()} KES` : 'Revenue Pending'}</span></small>
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
