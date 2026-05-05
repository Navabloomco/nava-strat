"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

const PROVIDER_TEMPLATES = [
  {
    name: "Nava Pulse",
    slug: "nava_pulse",
    status: "BETA",
    description: "Proprietary sensor intelligence for high-security logistics. Exclusive to Nava Strat.",
    auth_type: "api_key",
    is_nava_pulse: true,
    field_mapping: {
      truck: "truck",
      latitude: "latitude",
      longitude: "longitude",
      speed: "speed",
      fuel_level: "fuel_level",
      recorded_at: "recorded_at",
    },
  },
  {
    name: "Bluetrax",
    slug: "bluetrax",
    status: "ACTIVE",
    description: "Popular fleet tracking provider in Kenya.",
    auth_type: "username_key",
    base_url: "https://public-api.bluetrax.co.ke",
    login_url: "https://public-api.bluetrax.co.ke/api/Login/Login",
    fleet_url: "https://public-api.bluetrax.co.ke/api/Public/fleet_current_locations",
    is_nava_pulse: false,
    field_mapping: {
      truck: "reg_no",
      latitude: "lat",
      longitude: "lng",
      speed: "speed",
      fuel_level: "fuellevel",
      recorded_at: "fixtime",
    },
  },
  {
    name: "FleetTrack",
    slug: "fleettrack",
    status: "ACTIVE",
    description: "Widely used logistics GPS system.",
    auth_type: "api_hash",
    base_url: "https://fleettrack.africa/api",
    fleet_url: "https://fleettrack.africa/api/get_devices",
    is_nava_pulse: false,
    field_mapping: {
      truck: "name",
      latitude: "lat",
      longitude: "lng",
      recorded_at: "time",
    },
  },
  {
    name: "Custom GPS",
    slug: "custom",
    status: "ACTIVE",
    description: "Connect any white-label GPS provider using API details.",
    auth_type: "api_key",
    is_nava_pulse: false,
    field_mapping: {
      truck: "reg_no",
      latitude: "lat",
      longitude: "lng",
      recorded_at: "time",
    },
  },
];

export default function TrackingProvidersPage() {
  const [tenantId, setTenantId] = useState("");
  const [providers, setProviders] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [providerSlug, setProviderSlug] = useState("");

  // Form State
  const [providerName, setProviderName] = useState("");
  const [authType, setAuthType] = useState("api_key");
  const [baseUrl, setBaseUrl] = useState("");
  const [loginUrl, setLoginUrl] = useState("");
  const [fleetUrl, setFleetUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [fieldMapping, setFieldMapping] = useState("");

  useEffect(() => {
    init();
  }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      window.location.href = "/login";
      return;
    }
    const { data: tenant } = await supabase.rpc("current_tenant_id");
    setTenantId(tenant);
    loadProviders();
  }

  async function loadProviders() {
    const { data } = await supabase.from("tracking_providers").select("*").order("created_at", { ascending: false });
    setProviders(data || []);
  }

  function selectTemplate(template: any) {
    // Positioning logic: Still block the card UI, but keep it selectable for internal setup
    if (template.slug === "nava_pulse") {
      setMessage("Nava Pulse is currently in private Beta. Securely mapping internal sensor nodes...");
    }
    setProviderName(template.name);
    setProviderSlug(template.slug);
    setAuthType(template.auth_type);
    setBaseUrl(template.base_url || "");
    setLoginUrl(template.login_url || "");
    setFleetUrl(template.fleet_url || "");
    setFieldMapping(JSON.stringify(template.field_mapping, null, 2));
  }

  async function saveProvider() {
    if (!tenantId) {
      setMessage("Tenant missing. Refresh page.");
      return;
    }

    let parsedMapping = {};
    try {
      parsedMapping = JSON.parse(fieldMapping || "{}");
    } catch {
      setMessage("Error: Invalid JSON mapping");
      return;
    }

    const { error } = await supabase.from("tracking_providers").insert([
      {
        tenant_id: tenantId,
        provider_name: providerName.toUpperCase(),
        provider_slug: providerSlug || "custom",
        base_url: baseUrl || null,
        login_url: loginUrl || null,
        fleet_url: fleetUrl || null,
        auth_type: authType,
        api_key: apiKey || null,
        field_mapping: parsedMapping,
        is_nava_pulse: providerSlug === "nava_pulse",
        is_active: true,
      },
    ]);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Connection saved successfully ✅");
    loadProviders();
  }

  return (
    <main style={{ padding: 40, fontFamily: "sans-serif", maxWidth: 1200, margin: "0 auto" }}>
      <header style={{ marginBottom: 40 }}>
        <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: 8 }}>Tracking Providers</h1>
        <p style={{ color: "#666" }}>
          Connect third-party GPS systems or activate <strong>Nava Pulse</strong> sensor intelligence.
        </p>
      </header>

      {message && (
        <div style={{ padding: 16, borderRadius: 8, background: "#f0f7ff", border: "1px solid #0070f3", color: "#0070f3", marginBottom: 24 }}>
          {message}
        </div>
      )}

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 20, marginBottom: 40 }}>
        {PROVIDER_TEMPLATES.map((t) => (
          <div
            key={t.slug}
            onClick={() => selectTemplate(t)}
            style={{
              padding: 24,
              borderRadius: 12,
              border: t.slug === providerSlug ? "2px solid #0070f3" : "1px solid #e2e8f0",
              background: t.slug === "nava_pulse" ? "#f8fbff" : "white",
              cursor: "pointer",
              position: "relative",
              boxShadow: t.slug === providerSlug ? "0 4px 12px rgba(0,112,243,0.1)" : "none"
            }}
          >
            <span style={{
              position: "absolute",
              top: 12,
              right: 12,
              fontSize: "0.7rem",
              fontWeight: "bold",
              padding: "4px 8px",
              borderRadius: "20px",
              background: t.status === "BETA" ? "#0070f3" : "#e2e8f0",
              color: t.status === "BETA" ? "white" : "#475569"
            }}>
              {t.status}
            </span>
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>{t.name}</h3>
            <p style={{ fontSize: "0.9rem", color: "#64748b", lineHeight: "1.4" }}>{t.description}</p>
          </div>
        ))}
      </section>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 32 }}>
        <h2 style={{ marginTop: 0 }}>Connection Details</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <input 
            placeholder="Provider Name (e.g. Bluetrax)" 
            value={providerName} 
            onChange={(e) => setProviderName(e.target.value)}
            style={{ padding: 12, borderRadius: 6, border: "1px solid #cbd5e1" }}
          />
          <input 
            placeholder="API Key / Auth Token" 
            value={apiKey} 
            type="password"
            onChange={(e) => setApiKey(e.target.value)}
            style={{ padding: 12, borderRadius: 6, border: "1px solid #cbd5e1" }}
          />
        </div>
        <textarea 
          placeholder="Field Mapping JSON"
          value={fieldMapping}
          onChange={(e) => setFieldMapping(e.target.value)}
          style={{ width: "100%", marginTop: 20, height: 120, padding: 12, borderRadius: 6, border: "1px solid #cbd5e1", fontFamily: "monospace" }}
        />
        <button 
          onClick={saveProvider}
          style={{ 
            marginTop: 24, 
            padding: "12px 24px", 
            background: "#0f172a", 
            color: "white", 
            border: "none", 
            borderRadius: 6, 
            fontWeight: "bold",
            cursor: "pointer"
          }}
        >
          Save Connection
        </button>
      </div>

      <section style={{ marginTop: 40 }}>
        <h2>Active Tracking Connections</h2>
        {providers.length === 0 ? <p>No connections configured yet.</p> : (
           <div style={{ display: 'grid', gap: 10 }}>
             {providers.map(p => (
               <div key={p.id} style={{ padding: 15, border: '1px solid #ddd', borderRadius: 8, display: 'flex', justifyContent: 'space-between' }}>
                 <div>
                   <strong>{p.provider_name}</strong> {p.is_nava_pulse && <span style={{ color: '#0070f3' }}>(Nava Pulse)</span>}
                 </div>
                 <div>{p.is_active ? "🟢 Connected" : "⚪ Inactive"}</div>
               </div>
             ))}
           </div>
        )}
      </section>
    </main>
  );
}
