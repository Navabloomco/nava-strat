"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";

export default function NewProviderPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");

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
    setLoadError("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return;
    }

    try {
      const res = await fetch("/api/providers/templates", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to load provider templates");
      }

      setTemplates(data.templates || []);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load provider templates");
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  function originFromUrl(url: string | null) {
    if (!url) return "";
    try {
      return new URL(url).origin;
    } catch {
      return "";
    }
  }

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
    const baseUrl =
      form.base_url ||
      selectedTemplate.base_url ||
      selectedTemplate.default_base_url ||
      selectedTemplate.auth_config?.base_url ||
      selectedTemplate.fleet_config?.base_url ||
      originFromUrl(fleetUrl);

    if (!loginUrl) {
      alert("Login URL is missing from the template. Add an override.");
      return;
    }

    if (!fleetUrl) {
      alert("Fleet URL is missing from the template. Add an override.");
      return;
    }

    setSaving(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      alert("Session expired. Please log in again.");
      setSaving(false);
      window.location.href = "/login";
      return;
    }

    const res = await fetch("/api/providers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
      provider_name: selectedTemplate.display_name,
      name: selectedTemplate.display_name,
      provider_slug: selectedTemplate.slug,
      provider_type: selectedTemplate.slug,

      auth_type: selectedTemplate.auth_type,
      auth_config: selectedTemplate.auth_config,
      fleet_config: selectedTemplate.fleet_config,
      field_mapping: selectedTemplate.field_mapping,

      username: form.username,
      api_key: form.api_key,
      password: form.password || null,

      base_url: baseUrl,
      login_url: loginUrl,
      fleet_url: fleetUrl,

      is_active: true,
      }),
    });
    const data = await res.json();

    setSaving(false);

    if (!res.ok || !data.success) {
      alert(`Provider creation failed: ${data.error || "Unknown error"}`);
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
        {templates.length === 0 ? (
          <EmptyTemplateState error={loadError} />
        ) : (
          <>
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
          </>
        )}
      </section>
    </main>
  );
}

function EmptyTemplateState({ error }: { error: string }) {
  return (
    <div style={emptyTemplateStyle}>
      <div style={emptyBadgeStyle}>Provider setup</div>
      <h2 style={emptyTitleStyle}>No verified provider templates available yet</h2>
      <p style={emptyBodyStyle}>
        Nava needs a verified GPS/telemetry setup template before it can create
        a secure connection for this provider.
      </p>

      {error && <div style={errorStyle}>{error}</div>}

      <div style={emptyActionsStyle}>
        <a
          href="mailto:support@navabloom.co?subject=Nava%20provider%20setup%20request"
          style={buttonStyle}
        >
          Request provider setup
        </a>
        <Link href="/onboarding" style={secondaryLinkStyle}>
          Back to onboarding
        </Link>
      </div>

      <div style={emptyNoteStyle}>
        Provider access details should only be saved after Nava has verified the
        provider connection pattern and telemetry mapping.
      </div>
    </div>
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
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const emptyTemplateStyle = {
  background: "linear-gradient(135deg, #07111f 0%, #0f172a 58%, #155e75 100%)",
  borderRadius: 18,
  padding: 28,
  color: "#e0f2fe",
  border: "1px solid rgba(14, 165, 233, 0.28)",
};

const emptyBadgeStyle = {
  display: "inline-flex",
  border: "1px solid rgba(125, 211, 252, 0.35)",
  borderRadius: 999,
  padding: "6px 10px",
  color: "#bae6fd",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase" as const,
  letterSpacing: 0,
  marginBottom: 16,
};

const emptyTitleStyle = {
  margin: 0,
  color: "#ffffff",
  fontSize: 24,
  fontWeight: 850,
};

const emptyBodyStyle = {
  color: "#cbd5e1",
  fontSize: 14,
  lineHeight: 1.7,
  maxWidth: 620,
  marginTop: 10,
};

const emptyActionsStyle = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap" as const,
  marginTop: 20,
};

const secondaryLinkStyle = {
  marginTop: 24,
  color: "#e0f2fe",
  border: "1px solid rgba(226, 232, 240, 0.35)",
  borderRadius: 8,
  padding: "12px 18px",
  fontWeight: 800,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const emptyNoteStyle = {
  marginTop: 22,
  background: "rgba(15, 23, 42, 0.55)",
  border: "1px solid rgba(148, 163, 184, 0.25)",
  borderRadius: 12,
  padding: 14,
  color: "#bae6fd",
  fontSize: 13,
};

const errorStyle = {
  marginTop: 16,
  background: "rgba(127, 29, 29, 0.45)",
  border: "1px solid rgba(248, 113, 113, 0.35)",
  borderRadius: 10,
  padding: 12,
  color: "#fecaca",
  fontSize: 13,
};
