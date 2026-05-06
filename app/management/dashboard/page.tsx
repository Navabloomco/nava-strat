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
    // Focus purely on financial and journey data
    const { data: journeyData } = await supabase.from("journeys").select("*");
    const { data: fuelData } = await supabase.from("fuel_logs").select("*");
    const { data: expenseData } = await supabase.from("expenses").select("*");

    setJourneys(journeyData || []);
    setFuelLogs(fuelData || []);
    setExpenses(expenseData || []);
    setLoading(false);
  }

  function marginForJourney(journey: any) {
    const revenue = Number(journey.revenue_kes || 0);

    const fuelCost = fuelLogs
      .filter((f) => f.journey_id === journey.id)
      .reduce((sum, f) => sum + Number(f.total_cost || 0), 0);

    const expenseCost = expenses
      .filter((e) => e.journey_id === journey.id)
      .reduce((sum, e) => sum + Number(e.amount || 0), 0);

    const totalCost = fuelCost + expenseCost;
    const margin = revenue - totalCost;

    return { revenue, fuelCost, expenseCost, totalCost, margin };
  }

  const totalRevenue = useMemo(() => {
    return journeys.reduce((sum, j) => sum + Number(j.revenue_kes || 0), 0);
  }, [journeys]);

  const totalMargin = useMemo(() => {
    return journeys.reduce((sum, j) => sum + marginForJourney(j).margin, 0);
  }, [journeys, fuelLogs, expenses]);

  const lossMaking = useMemo(() => {
    return journeys.filter((j) => marginForJourney(j).margin < 0);
  }, [journeys, fuelLogs, expenses]);

  if (loading) return <main style={{ padding: 40, fontFamily: 'sans-serif' }}>Loading Financial Intelligence...</main>;

  return (
    <main style={{ padding: 40, fontFamily: 'sans-serif', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '40px' }}>
        <h1>Management Intelligence Center</h1>
        <p style={{ color: '#666' }}>High-level profitability and commercial performance.</p>
      </header>

      {/* EXECUTIVE SUMMARY CARDS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
        <div style={{ padding: 25, border: "1px solid #eee", borderRadius: 12, background: '#fff', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
          <h3 style={{ color: '#666', fontSize: '14px', textTransform: 'uppercase', marginBottom: '10px' }}>Total Revenue</h3>
          <h1 style={{ margin: 0 }}>{totalRevenue.toLocaleString()} <span style={{ fontSize: '18px' }}>KES</span></h1>
        </div>

        <div style={{ padding: 25, border: "1px solid #eee", borderRadius: 12, background: '#fff', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
          <h3 style={{ color: '#666', fontSize: '14px', textTransform: 'uppercase', marginBottom: '10px' }}>Total Margin</h3>
          <h1 style={{ margin: 0, color: totalMargin < 0 ? "#dc3545" : "#28a745" }}>
            {totalMargin.toLocaleString()} <span style={{ fontSize: '18px' }}>KES</span>
          </h1>
        </div>

        <div style={{ padding: 25, border: "1px solid #eee", borderRadius: 12, background: '#fff', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
          <h3 style={{ color: '#666', fontSize: '14px', textTransform: 'uppercase', marginBottom: '10px' }}>Leakage (Loss Journeys)</h3>
          <h1 style={{ margin: 0, color: lossMaking.length > 0 ? "#dc3545" : "#28a745" }}>{lossMaking.length}</h1>
        </div>
      </div>

      <section style={{ marginTop: '50px' }}>
        <h2>Journey Profitability Ranking</h2>
        <div style={{ marginTop: '20px' }}>
          {journeys.map((journey) => {
            const m = marginForJourney(journey);
            return (
              <div key={journey.id} style={{
                padding: '20px',
                border: "1px solid #eee",
                borderRadius: 12,
                marginBottom: 15,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: m.margin < 0 ? '#fff8f8' : '#fff'
              }}>
                <div>
                  <strong style={{ fontSize: '18px' }}>{journey.truck} — {journey.client_name}</strong>
                  <div style={{ color: '#666', marginTop: '4px' }}>
                    {journey.from_location} → {journey.to_location}
                  </div>
                </div>
                
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '12px', color: '#888' }}>NET MARGIN</div>
                  <strong style={{ fontSize: '20px', color: m.margin < 0 ? "#dc3545" : "#28a745" }}>
                    {m.margin.toLocaleString()} KES
                  </strong>
                  <div style={{ fontSize: '11px', color: '#aaa' }}>
                    Rev: {m.revenue.toLocaleString()} | Costs: {m.totalCost.toLocaleString()}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
