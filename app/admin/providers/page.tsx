"use client";

import { useState } from "react";

export default function ProviderVault({ providers }: { providers: any[] }) {
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async (updatedProvider: any) => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/providers/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedProvider),
      });
      if (res.ok) alert("Provider Vault Updated");
    } catch (err) {
      alert("Save failed");
    } finally {
      setIsSaving(false);
    }
  };

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

function ProviderCard({ provider, onSave, isSaving }) {
  const [form, setForm] = useState({ ...provider });
  
  // 1. ADDED TEST STATE
  const [isTesting, setIsTesting] = useState(false);

  // 2. ADDED TEST FUNCTION
  async function handleTestConnection() {
    setIsTesting(true);

    try {
      const res = await fetch("/api/providers/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId: form.id,
        }),
      });

      const result = await res.json();

      if (result.success) {
        alert(`✅ ${result.message}`);
      } else {
        alert(`❌ ${result.stage || "ERROR"}: ${result.message}`);
        console.log("Provider test debug:", result.debug);
      }

      // Refresh to update the UI with new last_test_status from DB
      window.location.reload();
    } catch (err: any) {
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
          
          {/* 3. ADDED TEST BUTTON */}
          <button
            onClick={handleTestConnection}
            disabled={isTesting}
            style={testBtn}
          >
            {isTesting ? "COMMUNICATING..." : "TEST CONNECTION"}
          </button>

          <button 
            onClick={() => onSave(form)} 
            disabled={isSaving} 
            style={saveBtn}
          >
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
        <div>
          <label style={labelStyle}>Username / Client ID</label>
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
          <label style={labelStyle}>Field Mapping (Normalization Engine)</label>
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

const cardStyle = {
  backgroundColor: "#fff",
  borderRadius: "12px",
  padding: "24px",
  border: "1px solid #e2e8f0",
  marginBottom: "20px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  borderBottom: "1px solid #f1f5f9",
  paddingBottom: "16px",
  marginBottom: "20px"
};

const statusText = {
  fontSize: "12px",
  color: "#64748b",
  margin: "4px 0 0 0",
  fontWeight: "500"
};

const labelStyle = {
  display: "block",
  fontSize: "12px",
  fontWeight: "bold",
  color: "#475569",
  marginBottom: "6px",
  textTransform: "uppercase" as "uppercase"
};

const inputStyle = {
  width: "100%",
  padding: "10px",
  borderRadius: "6px",
  border: "1px solid #cbd5e1",
  marginBottom: "10px",
  fontSize: "14px"
};

const textareaStyle = {
  width: "100%",
  minHeight: "150px",
  padding: "12px",
  borderRadius: "6px",
  border: "1px solid #cbd5e1",
  fontFamily: "monospace",
  fontSize: "12px",
  backgroundColor: "#f8fafc"
};

const formGrid = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "20px"
};

const saveBtn = {
  backgroundColor: "#0f172a",
  color: "#fff",
  border: "none",
  padding: "8px 24px",
  borderRadius: "6px",
  fontWeight: "bold",
  cursor: "pointer"
};

// 4. ADDED TEST STYLE
const testBtn = {
  backgroundColor: "#fff",
  color: "#0f172a",
  border: "1px solid #cbd5e1",
  padding: "8px 20px",
  borderRadius: "6px",
  fontWeight: "bold",
  cursor: "pointer"
};
