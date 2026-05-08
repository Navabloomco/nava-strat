"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// Initialize the client (Using public keys)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ProviderVault() {
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function loadVault() {
      const { data } = await supabase.from("tracking_providers").select("*");
      if (data) setProviders(data);
      setLoading(false);
    }
    loadVault();
  }, []);

  const handleSave = async (updatedProvider: any) => {
    setIsSaving(true);
    try {
      // Ensure field_mapping is valid JSON if it's a string from the textarea
      let finalProvider = { ...updatedProvider };
      if (typeof finalProvider.field_mapping === 'string') {
        try {
          finalProvider.field_mapping = JSON.parse(finalProvider.field_mapping);
        } catch (e) {
          throw new Error("Invalid JSON in Field Mapping");
        }
      }

      const { error } = await supabase
        .from("tracking_providers")
        .update(finalProvider)
        .eq("id", finalProvider.id);

      if (error) throw error;
      alert("✅ Provider Vault Updated");
    } catch (err: any) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) return <div style={{ padding: "40px" }}>Accessing Nava Strat Vault...</div>;

  return (
    <div style={{ padding: "40px", maxWidth: "1200px", margin: "0 auto" }}>
      <h1 style={{ marginBottom: "30px" }}>Provider Vault</h1>
      {providers.map((p) => (
        <ProviderCard 
          key={p.id} 
          provider={p} 
          onSave={handleSave} 
          isSaving={isSaving} 
        />
      ))}
    </div>
  );
}

function ProviderCard({
  provider,
  onSave,
  isSaving,
}: {
  provider: any;
  onSave: (updatedProvider: any) => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState({ ...provider });
  const [isTesting, setIsTesting] = useState(false);

  async function handleTestConnection() {
    setIsTesting(true);
    console.log(`🚀 Starting Test for: ${provider.provider_name}`);
    
    try {
      const res = await fetch("/api/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: form.id }),
      });

      const result = await res.json();

      // --- THE TRUTH LOGS ---
      console.log("------------------------------------");
      console.log("FULL TEST RESULT:", result);
      console.log("NORMALIZED DATA:", result.sample_normalized);
      console.log("RAW DEBUG DATA:", result.debug);
      console.log("------------------------------------");

      if (result.success) {
        alert(`✅ ${result.message}\n\nCheck Console for the 'NORMALIZED' object.`);
      } else {
        alert(`❌ ${result.stage || "ERROR"}: ${result.message}`);
      }
    } catch (err: any) {
      console.error("Test execution error:", err);
      alert(`Test failed: ${err.message}`);
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <div>
          <h3 style={{ margin: 0 }}>{provider.provider_name}</h3>
          <p style={statusText}>
            Last Status: <span style={{ color: provider.last_test_status === 'success' ? '#10b981' : '#ef4444' }}>
              {provider.last_test_status || "Pending"}
            </span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={handleTestConnection} disabled={isTesting} style={testBtn}>
            {isTesting ? "COMMUNICATING..." : "TEST CONNECTION"}
          </button>
          <button onClick={() => onSave(form)} disabled={isSaving} style={saveBtn}>
            {isSaving ? "SAVING..." : "SAVE CHANGES"}
          </button>
        </div>
      </div>

      <div style={formGrid}>
        <div>
          <label style={labelStyle}>Login URL</label>
          <input 
            style={inputStyle}
            value={form.login_url || ""} 
            onChange={(e) => setForm({...form, login_url: e.target.value})} 
          />
        </div>
        <div>
          <label style={labelStyle}>Fleet URL</label>
          <input 
            style={inputStyle}
            value={form.fleet_url || ""} 
            onChange={(e) => setForm({...form, fleet_url: e.target.value})} 
          />
        </div>
        
        {/* DETERMINISTIC CONFIG FIELD */}
        <div style={{ gridColumn: "span 2" }}>
          <label style={labelStyle}>Vehicle List Path (e.g., 'data' or 'Result')</label>
          <input 
            style={inputStyle}
            placeholder="Type the exact path found in RAW DEBUG"
            value={form.fleet_config?.vehicle_paths?.[0] || ""} 
            onChange={(e) => {
              const newPath = e.target.value;
              setForm({
                ...form,
                fleet_config: {
                  ...form.fleet_config,
                  vehicle_paths: [newPath]
                }
              });
            }} 
          />
        </div>

        <div>
          <label style={labelStyle}>Username</label>
          <input 
            style={inputStyle}
            value={form.username || ""} 
            onChange={(e) => setForm({...form, username: e.target.value})} 
          />
        </div>
        <div>
          <label style={labelStyle}>API Key / Secret</label>
          <input 
            type="password"
            style={inputStyle}
            value={form.api_key || ""} 
            onChange={(e) => setForm({...form, api_key: e.target.value})} 
          />
        </div>

        <div style={{ gridColumn: "span 2" }}>
          <label style={labelStyle}>Field Mapping (Telemetry Rules)</label>
          <textarea 
            style={textareaStyle}
            value={typeof form.field_mapping === 'object' ? JSON.stringify(form.field_mapping, null, 2) : form.field_mapping}
            onChange={(e) => setForm({...form, field_mapping: e.target.value})}
          />
        </div>
      </div>
    </div>
  );
}

// --- STYLES ---
const cardStyle = { backgroundColor: "#fff", borderRadius: "12px", padding: "24px", border: "1px solid #e2e8f0", marginBottom: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" };
const headerStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f1f5f9", paddingBottom: "16px", marginBottom: "20px" };
const statusText = { fontSize: "12px", color: "#64748b", margin: "4px 0 0 0", fontWeight: "500" };
const labelStyle = { display: "block", fontSize: "11px", fontWeight: "bold", color: "#475569", marginBottom: "4px", textTransform: "uppercase" as "uppercase" };
const inputStyle = { width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #cbd5e1", marginBottom: "10px", fontSize: "14px" };
const textareaStyle = { width: "100%", minHeight: "120px", padding: "12px", borderRadius: "6px", border: "1px solid #cbd5e1", fontFamily: "monospace", fontSize: "12px", backgroundColor: "#f8fafc" };
const formGrid = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px" };
const saveBtn = { backgroundColor: "#0f172a", color: "#fff", border: "none", padding: "8px 24px", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" };
const testBtn = { backgroundColor: "#fff", color: "#0f172a", border: "1px solid #cbd5e1", padding: "8px 20px", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" };
