"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../../lib/supabase";

export default function NewProviderPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    username: "",
    api_key: "",
    password: "",
    base_url: "",
    login_url: "",
    fleet_url: "",
  });

  useEffect(() => {
    loadTemplates();
  }, []);

  async function loadTemplates() {
    const { data, error } = await supabase
      .from("provider_templates")
      .select("*")
      .eq("is_public", true)
      .eq("is_verified", true)
      .order("display_name", { ascending: true });

    if (error) {
      alert(`Failed to load provider templates: ${error.message}`);
    } else {
      setTemplates(data || []);
    }

    setLoading(false);
  }

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  async function handleCreateProvider() {
    if (!selectedTemplate) {
      alert("Choose a supported provider first.");
      return;
    }

    if (!form.username || !form.api_key) {
      alert("Username and API key are required.");
      return;
    }

    const loginUrl =
      form.login_url ||
      selectedTemplate.default_login_url ||
      selectedTemplate.auth_config?.login_url ||
      null;

    const fleetUrl =
      form.fleet_url ||
      selectedTemplate.default_fleet_url ||
      selectedTemplate.fleet_config?.fleet_url ||
      null;

    if (!loginUrl) {
      alert("Login URL is missing from the template. Add an override.");
      return;
    }

    if (!fleetUrl) {
      alert("Fleet URL is missing from the template. Add an override.");
      return;
    }

    setSaving(true);

    const { error } = await supabase.from("tracking_providers").insert({
      provider_name: selectedTemplate.display_name,
      provider_slug: selectedTemplate.slug,

      auth_type: selectedTemplate.auth_type,
      auth_config: selectedTemplate.auth_config,
      fleet_config: selectedTemplate.fleet_config,
      field_mapping: selectedTemplate.field_mapping,

      username: form.username,
      api_key: form.api_key,
      password: form.password || null,

      base_url: form.base_url || null,
      login_url: loginUrl,
      fleet_url: fleetUrl,

      is_active: true,
      last_test_status: "not_tested",
    });

    setSaving(false);

    if (error) {
      alert(`Provider creation failed: ${error.message}`);
      return;
    }

    alert("Provider added. Now test the connection.");
    window.location.href = "/admin/providers";
  }

  if (loading) {
    return <main style={{ padding: 40 }}>Loading supported providers...</main>;
  }

  return (
    <main style={pageStyle}>
      <header style={{ marginBottom: 30 }}>
        <h1 style={titleStyle}>Add Provider</h1>
        <p style={subtitleStyle}>
          Add a verified tracking integration. Clients enter credentials; Nava
          Strat handles the telemetry rules.
        </p>
      </header>

      <section style={cardStyle}>
        <div style={fieldGroup}>
          <label style={labelStyle}>Supported Provider</label>
          <select
            style={inputStyle}
            value={selectedTemplateId}
            onChange={(e) => setSelectedTemplateId(e.target.value)}
          >
            <option value="">Choose provider...</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.display_name}
              </option>
            ))}
          </select>
        </div>

        {selectedTemplate && (
          <>
            <div style={noticeStyle}>
              Template loaded: <strong>{selectedTemplate.display_name}</strong>.
              Auth, fleet extraction, and telemetry mapping are preconfigured.
            </div>

            <div style={gridStyle}>
              <div style={fieldGroup}>
                <label style={labelStyle}>Username</label>
                <input
                  style={inputStyle}
                  value={form.username}
                  onChange={(e) =>
                    setForm({ ...form, username: e.target.value })
                  }
                />
              </div>

              <div style={fieldGroup}>
                <label style={labelStyle}>API Key / Secret</label>
                <input
                  type="password"
                  style={inputStyle}
                  value={form.api_key}
                  onChange={(e) =>
                    setForm({ ...form, api_key: e.target.value })
                  }
                />
              </div>

              <div style={fieldGroup}>
                <label style={labelStyle}>Password Optional</label>
                <input
                  type="password"
                  style={inputStyle}
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                />
              </div>

              <div style={fieldGroup}>
                <label style={labelStyle}>Base URL Optional</label>
                <input
                  style={inputStyle}
                  value={form.base_url}
                  onChange={(e) =>
                    setForm({ ...form, base_url: e.target.value })
                  }
                />
              </div>

              <div style={fieldGroup}>
                <label style={labelStyle}>Login URL Optional Override</label>
                <input
                  style={inputStyle}
                  value={form.login_url}
                  onChange={(e) =>
                    setForm({ ...form, login_url: e.target.value })
                  }
                />
              </div>

              <div style={fieldGroup}>
                <label style={labelStyle}>Fleet URL Optional Override</label>
                <input
                  style={inputStyle}
                  value={form.fleet_url}
                  onChange={(e) =>
                    setForm({ ...form, fleet_url: e.target.value })
                  }
                />
              </div>
            </div>

            <button
              onClick={handleCreateProvider}
              disabled={saving}
              style={buttonStyle}
            >
              {saving ? "ADDING PROVIDER..." : "ADD PROVIDER"}
            </button>
          </>
        )}
      </section>
    </main>
  );
}

const pageStyle = {
  padding: 40,
  maxWidth: 900,
};

const titleStyle = {
  fontSize: 30,
  fontWeight: 800,
  color: "#0f172a",
  marginBottom: 8,
};

const subtitleStyle = {
  color: "#64748b",
  fontSize: 14,
};

const cardStyle = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 14,
  padding: 28,
  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
};

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 18,
  marginTop: 20,
};

const fieldGroup = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 6,
};

const labelStyle = {
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase" as const,
  color: "#475569",
};

const inputStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  fontSize: 14,
};

const noticeStyle = {
  marginTop: 18,
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  padding: 14,
  borderRadius: 10,
  color: "#334155",
  fontSize: 13,
};

const buttonStyle = {
  marginTop: 24,
  background: "#0f172a",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "12px 18px",
  fontWeight: 800,
  cursor: "pointer",
};
