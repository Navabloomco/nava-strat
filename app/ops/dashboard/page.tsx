"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function OpsDashboard() {
  const [journeys, setJourneys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("journeys").select("*");
    setJourneys(data || []);
    setLoading(false);
  }

  // DATA NORMALIZATION LAYER
  const normalizedOps = useMemo(() => {
    return journeys.map(j => ({
      ...j,
      truck: (j.truck || "UNKNOWN").toUpperCase(),
      client: (j.client_name || "NO CLIENT").toUpperCase(),
      route: `${(j.from_location || "UNKNOWN").toUpperCase()} → ${(j.to_location || "UNKNOWN").toUpperCase()}`,
      driver: (j.driver_name || "NO DRIVER").toUpperCase(),
      location: (j.current_location || "GPS SEARCHING...").toUpperCase(),
      // Logic for status coloring
      status: j.is_moving ? "MOVING" : "IDLE",
      risk: j.revenue_kes < 1 ? "CRITICAL" : "HEALTHY" 
    }));
  }, [journeys]);

  if (loading) return <main style={{ padding: 40 }}>Initializing Command Center...</main>;

  return (
    <main style={{ padding: 40, fontFamily: 'sans-serif', backgroundColor: '#f4f7f6', minHeight: '100vh' }}>
      <header style={{ marginBottom: 30, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: '#1a202c' }}>Ops Command Center</h1>
          <p style={{ color: '#718096' }}>Live Fleet Intelligence</p>
        </div>
        
        {/* PROVIDER STATUS - Logic Point 4 */}
        <div style={{ display: 'flex', gap: 15 }}>
          <div style={providerBadge}>BLUETRAX ● ONLINE</div>
          <div style={{ ...providerBadge, color: '#e53e3e', borderColor: '#feb2b2' }}>SHELL ● OFFLINE</div>
        </div>
      </header>

      {/* INCIDENT FEED - Logic Point 3 */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={sectionHeader}>Real-Time Incidents</h2>
        <div style={incidentCard}>
          <div style={{ fontWeight: 'bold', color: '#e53e3e' }}>CRITICAL: KBJ123A — MISSING REVENUE DATA</div>
          <div style={{ fontSize: '12px', color: '#718096' }}>MOMBASA → JINJA | 2 mins ago</div>
        </div>
      </section>

      {/* ACTIVE OPERATIONS - Logic Point 5 (The Card Shift) */}
      <section>
        <h2 style={sectionHeader}>Active Operations</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
          {normalizedOps.map((op) => (
            <div key={op.id} style={{ 
              ...operationCard, 
              borderTop: op.risk === "CRITICAL" ? '4px solid #e53e3e' : '4px solid #38a169' 
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 15 }}>
                <strong style={{ fontSize: '18px' }}>{op.truck}</strong>
                <span style={{ 
                  fontSize: '10px', 
                  padding: '4px 8px', 
                  borderRadius: '4px', 
                  backgroundColor: op.status === "MOVING" ? '#f0fdf4' : '#edf2f7',
                  color: op.status === "MOVING" ? '#16a34a' : '#4a5568',
                  fontWeight: 'bold'
                }}>{op.status}</span>
              </div>

              <div style={cardRow}><span style={cardLabel}>CLIENT:</span> {op.client}</div>
              <div style={cardRow}><span style={cardLabel}>ROUTE:</span> {op.route}</div>
              <div style={cardRow}><span style={cardLabel}>LOCATION:</span> {op.location}</div>
              <div style={cardRow}><span style={cardLabel}>DRIVER:</span> {op.driver}</div>
              
              <div style={{ marginTop: 15, paddingTop: 15, borderTop: '1px solid #edf2f7', display: 'flex', justifyContent: 'space-between' }}>
                 <span style={{ fontSize: '12px', color: op.risk === "CRITICAL" ? '#e53e3e' : '#718096', fontWeight: 'bold' }}>
                   {op.risk === "CRITICAL" ? "⚠️ REVENUE ERROR" : "✓ STATUS OK"}
                 </span>
                 <button style={actionButton}>DETAILS</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

// STYLING SYSTEM
const sectionHeader = { fontSize: '14px', fontWeight: 'bold', color: '#4a5568', textTransform: 'uppercase' as const, marginBottom: 15, letterSpacing: '0.05em' };
const providerBadge = { padding: '6px 12px', borderRadius: '20px', border: '1px solid #c6f6d5', backgroundColor: '#fff', fontSize: '11px', fontWeight: 'bold', color: '#38a169' };
const incidentCard = { backgroundColor: '#fff', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #e53e3e', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' };
const operationCard = { backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', display: 'flex', flexDirection: 'column' as const };
const cardRow = { fontSize: '13px', color: '#2d3748', marginBottom: '6px' };
const cardLabel = { color: '#a0aec0', fontSize: '11px', fontWeight: 'bold', marginRight: '5px' };
const actionButton = { fontSize: '10px', fontWeight: 'bold', color: '#3182ce', background: 'none', border: '1px solid #3182ce', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' };
