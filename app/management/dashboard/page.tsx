"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function ManagementDashboard() {
  const [data, setData] = useState<any>({
    summary: {
      total_revenue: 0,
      total_fuel_cost: 0,
      total_expenses: 0,
      estimated_profit: 0,
      active_journeys: 0,
      completed_journeys: 0,
      loss_making_journeys: 0,
    },
    journey_ranking: [],
    profit_by_client: [],
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setMessage("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return;
    }

    const res = await fetch("/api/management/dashboard", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setMessage(json.error || "Failed to load management dashboard.");
      setLoading(false);
      return;
    }

    setData(json);
    setLoading(false);
  }

  if (loading) return <main style={{ padding: 40 }}>Loading Intelligence...</main>;

  const stats = data.summary || {};
  const sortedJourneys = data.journey_ranking || [];
  const clientPerformance = data.profit_by_client || [];

  return (
    <main style={{ padding: 40, fontFamily: 'sans-serif', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '40px' }}>
        <h1>Management Intelligence Center</h1>
        <p style={{ color: '#666' }}>Strategy & Profitability Engine</p>
      </header>

      {message && <pre style={{ background: "#f4f4f4", padding: 12 }}>{message}</pre>}

      {/* KPI CARDS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginBottom: 40 }}>
        <div style={cardStyle}>
          <div style={labelStyle}>Total Revenue</div>
          <div style={valueStyle}>{Number(stats.total_revenue || 0).toLocaleString()} KES</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Net Margin</div>
          <div style={{ ...valueStyle, color: Number(stats.estimated_profit || 0) < 0 ? "#dc3545" : "#28a745" }}>
            {Number(stats.estimated_profit || 0).toLocaleString()} KES
          </div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Leakage (Losses)</div>
          <div style={{ ...valueStyle, color: "#dc3545" }}>{stats.loss_making_journeys || 0} Journeys</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 40 }}>
        
        {/* NORMALIZED JOURNEY RANKING */}
        <section>
          <h2 style={{ fontSize: '18px', marginBottom: 20 }}>Journey Ranking (Worst First)</h2>
          {sortedJourneys.length === 0 ? (
            <div style={listItemStyle}>No journey revenue data yet.</div>
          ) : (
            sortedJourneys.map((journey: any) => (
              <div key={journey.id} style={{ ...listItemStyle, borderLeft: Number(journey.margin || 0) < 0 ? '5px solid #dc3545' : '5px solid #28a745' }}>
                <div>
                  <div style={{ fontWeight: 'bold' }}>
                    {(journey.truck || "N/A").toUpperCase()} — {(journey.client_name || "NO CLIENT").toUpperCase()}
                  </div>
                  <div style={{ fontSize: '12px', color: '#666' }}>
                    {(journey.from_location || "UNKNOWN").toUpperCase()} → {(journey.to_location || "UNKNOWN").toUpperCase()}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 'bold', color: Number(journey.margin || 0) < 0 ? '#dc3545' : '#28a745' }}>
                    {Number(journey.margin || 0).toLocaleString()} KES
                  </div>
                  <div style={{ fontSize: '11px', color: '#999' }}>REV: {Number(journey.revenue || 0).toLocaleString()}</div>
                </div>
              </div>
            ))
          )}
        </section>

        {/* CLIENT PROFITABILITY RANKING */}
        <section>
          <h2 style={{ fontSize: '18px', marginBottom: 20 }}>Top Clients by Profit</h2>
          <div style={{ background: '#fff', padding: 20, borderRadius: 12, border: '1px solid #eee' }}>
            {clientPerformance.length === 0 ? (
              <div style={{ color: '#666' }}>No client profitability data yet.</div>
            ) : (
              clientPerformance.map((c: any) => (
                <div key={c.name} style={{ marginBottom: 20, borderBottom: '1px solid #f9f9f9', paddingBottom: 15 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong style={{ fontSize: '15px' }}>{c.name}</strong>
                    <span style={{ color: Number(c.margin || 0) < 0 ? '#dc3545' : '#28a745', fontWeight: 'bold' }}>{Number(c.margin || 0).toLocaleString()} KES</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#666' }}>{c.count} Journeys | Total Rev: {Number(c.revenue || 0).toLocaleString()}</div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

const cardStyle = { padding: '20px', backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #eee' };
const labelStyle = { color: '#888', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' as const, marginBottom: '5px' };
const valueStyle = { fontSize: '22px', fontWeight: 'bold' };
const listItemStyle = { display: 'flex', justifyContent: 'space-between', padding: '15px', backgroundColor: '#fff', borderRadius: '8px', marginBottom: '10px', border: '1px solid #eee' };
