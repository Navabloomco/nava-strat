"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function ManagementDashboard() {
  const [journeys, setJourneys] = useState<any[]>([]);
  const [fuelLogs, setFuelLogs] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data: journeyData } = await supabase.from("journeys").select("*");
    const { data: fuelData } = await supabase.from("fuel_logs").select("*");
    const { data: expenseData } = await supabase.from("expenses").select("*");

    setJourneys(journeyData || []);
    setFuelLogs(fuelData || []);
    setExpenses(expenseData || []);
    setLoading(false);
  }

  // --- FINANCIAL LOGIC ---
  function marginForJourney(journey: any) {
    const revenue = Number(journey.revenue_kes || 0);
    const fuelCost = fuelLogs.filter((f) => f.journey_id === journey.id).reduce((sum, f) => sum + Number(f.total_cost || 0), 0);
    const expenseCost = expenses.filter((e) => e.journey_id === journey.id).reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const totalCost = fuelCost + expenseCost;
    return { revenue, fuelCost, expenseCost, totalCost, margin: revenue - totalCost };
  }

  // --- NORMALIZED DATA & RANKING ---
  const stats = useMemo(() => {
    const totalRevenue = journeys.reduce((sum, j) => sum + Number(j.revenue_kes || 0), 0);
    const totalMargin = journeys.reduce((sum, j) => sum + marginForJourney(j).margin, 0);
    const lossMaking = journeys.filter((j) => marginForJourney(j).margin < 0);
    return { totalRevenue, totalMargin, lossCount: lossMaking.length };
  }, [journeys, fuelLogs, expenses]);

  const sortedJourneys = useMemo(() => {
    return [...journeys].sort((a, b) => marginForJourney(a).margin - marginForJourney(b).margin);
  }, [journeys, fuelLogs, expenses]);

  const clientPerformance = useMemo(() => {
    const clients: any = {};
    journeys.forEach(j => {
      const name = (j.client_name || "NO CLIENT").toUpperCase().trim();
      const m = marginForJourney(j);
      if (!clients[name]) clients[name] = { name, revenue: 0, margin: 0, count: 0 };
      clients[name].revenue += m.revenue;
      clients[name].margin += m.margin;
      clients[name].count += 1;
    });
    return Object.values(clients).sort((a: any, b: any) => b.margin - a.margin);
  }, [journeys, fuelLogs, expenses]);

  if (loading) return <main style={{ padding: 40 }}>Loading Intelligence...</main>;

  return (
    <main style={{ padding: 40, fontFamily: 'sans-serif', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '40px' }}>
        <h1>Management Intelligence Center</h1>
        <p style={{ color: '#666' }}>Strategy & Profitability Engine</p>
      </header>

      {/* KPI CARDS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginBottom: 40 }}>
        <div style={cardStyle}>
          <div style={labelStyle}>Total Revenue</div>
          <div style={valueStyle}>{stats.totalRevenue.toLocaleString()} KES</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Net Margin</div>
          <div style={{ ...valueStyle, color: stats.totalMargin < 0 ? "#dc3545" : "#28a745" }}>
            {stats.totalMargin.toLocaleString()} KES
          </div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Leakage (Losses)</div>
          <div style={{ ...valueStyle, color: "#dc3545" }}>{stats.lossCount} Journeys</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 40 }}>
        
        {/* NORMALIZED JOURNEY RANKING */}
        <section>
          <h2 style={{ fontSize: '18px', marginBottom: 20 }}>Journey Ranking (Worst First)</h2>
          {sortedJourneys.map((journey) => {
            const m = marginForJourney(journey);
            return (
              <div key={journey.id} style={{ ...listItemStyle, borderLeft: m.margin < 0 ? '5px solid #dc3545' : '5px solid #28a745' }}>
                <div>
                  <div style={{ fontWeight: 'bold' }}>
                    {(journey.truck || "N/A").toUpperCase()} — {(journey.client_name || "NO CLIENT").toUpperCase()}
                  </div>
                  <div style={{ fontSize: '12px', color: '#666' }}>
                    {(journey.from_location || "UNKNOWN").toUpperCase()} → {(journey.to_location || "UNKNOWN").toUpperCase()}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 'bold', color: m.margin < 0 ? '#dc3545' : '#28a745' }}>
                    {m.margin.toLocaleString()} KES
                  </div>
                  <div style={{ fontSize: '11px', color: '#999' }}>REV: {m.revenue.toLocaleString()}</div>
                </div>
              </div>
            );
          })}
        </section>

        {/* CLIENT PROFITABILITY RANKING */}
        <section>
          <h2 style={{ fontSize: '18px', marginBottom: 20 }}>Top Clients by Profit</h2>
          <div style={{ background: '#fff', padding: 20, borderRadius: 12, border: '1px solid #eee' }}>
            {clientPerformance.map((c: any) => (
              <div key={c.name} style={{ marginBottom: 20, borderBottom: '1px solid #f9f9f9', paddingBottom: 15 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: '15px' }}>{c.name}</strong>
                  <span style={{ color: c.margin < 0 ? '#dc3545' : '#28a745', fontWeight: 'bold' }}>{c.margin.toLocaleString()} KES</span>
                </div>
                <div style={{ fontSize: '12px', color: '#666' }}>{c.count} Journeys | Total Rev: {c.revenue.toLocaleString()}</div>
              </div>
            ))}
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
