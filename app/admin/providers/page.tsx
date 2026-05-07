"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { requirePermission } from "../../../lib/hooks/requirePermission";

export default function ProviderManager() {
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      // Hard Guard: Super Admin Bridge
      const check = await requirePermission("contact@navabloomco.com", "admin");
      setAllowed(check.allowed);

      if (check.allowed) {
        const { data } = await supabase.from("tracking_providers").select("*");
        setProviders(data || []);
      }
      setLoading(false);
    }
    init();
  }, []);

  const handleSave = async (id: string, providerData: any) => {
    setSavingId(id);
    let cleanData = { ...providerData };

    // Force validation of JSON field mapping before database touch
    if (typeof cleanData.field_mapping === "string") {
      try {
        cleanData.field_mapping = JSON.parse(cleanData.field_mapping);
      } catch {
        alert("Invalid Field Mapping JSON. Fix it before saving.");
        setSavingId(null);
        return;
      }
    }

    const { error } = await supabase
      .from("tracking_providers")
      .update(cleanData)
      .eq("id", id);

    if (error) {
      alert(`Update failed: ${error.message}`);
    } else {
      alert("Provider credentials secured.");
    }
    setSavingId(null);
  };

  if (loading) return <div style={msgStyle}>Initializing Admin Vault...</div>;

  if (!allowed) return (
    <div style={msgStyle}>
      <h2 style={{ color: '#dc2626' }}>Access Denied</h2>
      <p>This area requires SUPER_ADMIN clearance.</p>
    </div>
  );

  return (
    <main style={{ padding: 40, maxWidth: "1000px" }}>
      <header style={{ marginBottom: 40 }}>
        <h1 style={{ fontSize: "28px", fontWeight: "bold" }}>Fleet Provider Management</h1>
        <p style={{ color: "#64748b" }}>Configure API bridges and sync parameters.</p>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "40px" }}>
        {providers.map((p) => (
          <ProviderCard 
            key={p.id} 
            provider={p} 
            onSave={(updates: any) => handleSave(p.id, updates)} 
            isSaving={savingId === p.id}
          />
        ))}
      </div>
    </main>
  );
}

function ProviderCard({ provider, onSave, isSaving }: any) {
  const [form, setForm] = useState({ ...provider });

  return (
    <section style={cardStyle}>
      <div style={cardHeader}>
        <h2 style={{ margin: 0 }}>{form.provider_name}</h2>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <span style={form.is_active ? activeBadge : inactiveBadge}>
            {form.is_active ? "SYNC ENABLED" : "SYNC PAUSED"}
          </span>
          <button onClick={() => onSave(form)} disabled={isSaving} style={saveBtn}>
            {isSaving ? "SAVING..." : "SAVE CHANGES"}
          </button>
        </div>
      </div>

      <div style={gridStyle}>
        <Field label="Login URL" value={form.login_url} onChange={(v) => setForm({...form, login_url: v})} />
        <Field label="Fleet API URL" value={form.fleet_url} onChange={(v) => setForm({...form, fleet_url: v})} />
        <Field label="API Username" value={form.username} onChange={(v) => setForm({...form, username: v})} />
        <Field label="API Secret / Key" type="password" value={form.api_key} onChange={(v) => setForm({...form, api_key: v})} />
      </div>

      <div style={{ marginTop: 25 }}>
        <label style={labelStyle}>Field Mapping (JSONB)</label>
        <textarea 
          style={jsonArea}
          value={typeof form.field_mapping === 'string' ? form.field_mapping : JSON.stringify(form.field_mapping, null, 2)}
          onChange={(e) => setForm({...form, field_mapping: e.target.value})}
        />
      </div>

      <div style={statusFooter}>
        <span>Last Test: <strong>{form.last_test_status || "PENDING"}</strong></span>
        <button style={toggleBtn} onClick={() => setForm({...form, is_active: !form.is_active})}>
          {form.is_active ? "Pause Sync" : "Resume Sync"}
        </button>
      </div>
    </section>
  );
}

function Field({ label, value, onChange, type = "text" }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      <label style={labelStyle}>{label}</label>
      <input type={type} style={inputStyle} value={value || ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

const msgStyle = { padding: 60, textAlign: 'center' as const, color: '#64748b' };
const cardStyle = { backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '30px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' };
const cardHeader = { display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '20px', marginBottom: '20px' };
const gridStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' };
const labelStyle = { fontSize: '11px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase' as const };
const inputStyle = { padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' };
const jsonArea = { width: '100%', height: '120px', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontFamily: 'monospace', fontSize: '12px' };
const saveBtn = { backgroundColor: '#0f172a', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' };
const statusFooter = { marginTop: 20, paddingTop: 20, borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' };
const toggleBtn = { background: 'none', border: '1px solid #e2e8f0', padding: '5px 12px', borderRadius: '4px', cursor: 'pointer' };
const activeBadge = { fontSize: '10px', color: '#16a34a', fontWeight: 'bold', padding: '4px 8px', backgroundColor: '#f0fdf4', borderRadius: '4px' };
const inactiveBadge = { fontSize: '10px', color: '#dc2626', fontWeight: 'bold', padding: '4px 8px', backgroundColor: '#fef2f2', borderRadius: '4px' };
