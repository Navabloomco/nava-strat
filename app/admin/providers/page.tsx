"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";

export default function ProviderVault() {
  const [providers, setProviders] = useState<any[]>([]);
  const [capabilities, setCapabilities] = useState<any>({
    can_view_provider_status: false,
    can_add_provider: false,
    can_update_provider_credentials: false,
    can_test_provider: false,
    can_edit_advanced_provider_config: false,
  });
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function loadVault() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        window.location.href = "/login";
        return;
      }

      const res = await fetch("/api/providers", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const data = await res.json();
      if (data.success) {
        setProviders(data.providers || []);
        setCapabilities(data.capabilities || {});
      } else alert(data.error || "Failed to load providers");
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
          throw new Error("Invalid connection setup.");
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Session expired. Please log in again.");
      }

      const payload: any = capabilities.can_edit_advanced_provider_config
        ? {
            provider_name: finalProvider.provider_name,
            provider_slug: finalProvider.provider_slug,
            provider_type: finalProvider.provider_type,
            auth_type: finalProvider.auth_type,
            fleet_config: finalProvider.fleet_config,
            field_mapping: finalProvider.field_mapping,
            username: finalProvider.username || null,
            base_url: finalProvider.base_url || null,
            login_url: finalProvider.login_url || null,
            fleet_url: finalProvider.fleet_url || null,
            is_active: finalProvider.is_active,
          }
        : {
            username: finalProvider.username || null,
          };

      if (finalProvider.api_key) payload.api_key = finalProvider.api_key;
      if (finalProvider.password) payload.password = finalProvider.password;
      if (finalProvider.bearer_token) {
        payload.bearer_token = finalProvider.bearer_token;
      }

      const res = await fetch(`/api/providers/${finalProvider.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Provider update failed");
      }

      setProviders((current) =>
        current.map((provider) =>
          provider.id === data.provider.id ? data.provider : provider
        )
      );
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
      <div style={pageHeaderStyle}>
        <div>
          <div style={eyebrowStyle}>Provider onboarding</div>
          <h1 style={pageTitleStyle}>Provider Vault</h1>
          <p style={pageSubtitleStyle}>
            Connect real GPS and telemetry feeds so Nava Strat can build a live,
            secure fleet view.
          </p>
        </div>
        {capabilities.can_add_provider && (
          <Link href="/admin/providers/new" style={primaryLinkStyle}>
            Add Provider
          </Link>
        )}
      </div>

      {providers.length === 0 ? (
        <EmptyProviderState capabilities={capabilities} />
      ) : (
        providers.map((p) => (
          <ProviderCard 
            key={p.id} 
            provider={p} 
            onSave={handleSave} 
            isSaving={isSaving} 
            capabilities={capabilities}
          />
        ))
      )}
    </div>
  );
}

function EmptyProviderState({ capabilities }: { capabilities: any }) {
  const steps = [
    "Choose your GPS/telemetry provider",
    "Enter the access details supplied by your provider",
    "Save the connection securely",
    "Test the connection",
    "Return to onboarding once fleet data starts appearing",
  ];

  return (
    <section style={emptyStateStyle}>
      <div style={emptyContentStyle}>
        <div style={emptyBadgeStyle}>First connection</div>
        <h2 style={emptyTitleStyle}>No tracking provider connected yet</h2>
        <p style={emptyBodyStyle}>
          Connect your GPS or telemetry provider so Nava can begin receiving fleet
          assets, live locations, fuel readings, and movement history.
        </p>

        <div style={ctaRowStyle}>
          {capabilities.can_add_provider ? (
            <>
              <Link href="/admin/providers/new" style={primaryLinkStyle}>
                Add Provider
              </Link>
              <Link href="/admin/providers/new?request=1" style={secondaryLinkStyle}>
                Request provider setup
              </Link>
            </>
          ) : (
            <div style={trustNoteStyle}>
              You do not have provider administration access. Contact your
              company administrator if a provider needs to be added.
            </div>
          )}
          <Link href="/onboarding" style={secondaryLinkStyle}>
            Back to onboarding
          </Link>
        </div>

        <div style={noteGridStyle}>
          <div style={trustNoteStyle}>
            Provider access details are stored securely and not displayed after
            saving.
          </div>
          <div style={readinessNoteStyle}>
            After a successful test, Nava will confirm that fleet data is flowing
            before marking onboarding as ready.
          </div>
        </div>
      </div>

      <div style={guideStyle}>
        <h3 style={guideTitleStyle}>How setup works</h3>
        <div style={stepListStyle}>
          {steps.map((step, index) => (
            <div key={step} style={stepStyle}>
              <div style={stepNumberStyle}>{index + 1}</div>
              <div style={stepTextStyle}>{step}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProviderCard({
  provider,
  onSave,
  isSaving,
  capabilities,
}: {
  provider: any;
  onSave: (updatedProvider: any) => void;
  isSaving: boolean;
  capabilities: any;
}) {
  const [form, setForm] = useState({ ...provider });
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  async function handleTestConnection() {
    setIsTesting(true);
    
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Session expired. Please log in again.");
      }

      const res = await fetch(`/api/providers/${form.id}/test`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const result = await res.json();
      setTestResult(result);

      if (result.success) {
        alert(
          `✅ ${result.message}\nAssets: ${result.assets_count}\nLatest telemetry: ${
            result.latest_telemetry_at || "none"
          }`
        );
      } else {
        alert(`❌ ${result.stage || "ERROR"}: ${result.message || result.error}`);
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
          {capabilities.can_test_provider && (
            <button onClick={handleTestConnection} disabled={isTesting} style={testBtn}>
              {isTesting ? "COMMUNICATING..." : "TEST CONNECTION"}
            </button>
          )}
          {(capabilities.can_update_provider_credentials ||
            capabilities.can_edit_advanced_provider_config) && (
            <button onClick={() => onSave(form)} disabled={isSaving} style={saveBtn}>
              {isSaving ? "SAVING..." : "SAVE CHANGES"}
            </button>
          )}
        </div>
      </div>

      {capabilities.can_edit_advanced_provider_config ? (
        <AdvancedProviderEditor provider={provider} form={form} setForm={setForm} />
      ) : capabilities.can_update_provider_credentials ? (
        <CredentialProviderEditor provider={provider} form={form} setForm={setForm} />
      ) : (
        <div style={statusOnlyStyle}>
          You can view provider status, but provider administration is limited
          to company administrators.
        </div>
      )}

      <ProviderEnrichmentDiagnostics
        diagnostics={testResult?.supplemental_diagnostics}
        canShowAvailableKeys={capabilities.can_edit_advanced_provider_config}
      />
    </div>
  );
}

function ProviderEnrichmentDiagnostics({
  diagnostics,
  canShowAvailableKeys,
}: {
  diagnostics: any;
  canShowAvailableKeys: boolean;
}) {
  if (!diagnostics) return null;

  const feeds = diagnostics.feeds || [];

  return (
    <section style={diagnosticsStyle}>
      <div style={diagnosticsHeaderStyle}>
        <div>
          <div style={diagnosticsEyebrowStyle}>Provider enrichment feeds</div>
          <h4 style={diagnosticsTitleStyle}>Provider Enrichment Diagnostics</h4>
        </div>
        <div style={diagnosticsMetaStyle}>
          {Number(diagnostics.supplemental_feeds_configured || 0)} configured
        </div>
      </div>

      <div style={diagnosticsSummaryGridStyle}>
        <DiagnosticMetric
          label="Feeds attempted"
          value={diagnostics.supplemental_feeds_attempted}
        />
        <DiagnosticMetric
          label="Rows found"
          value={diagnostics.supplemental_rows_found}
        />
        <DiagnosticMetric
          label="Matches found"
          value={diagnostics.supplemental_matches_found}
        />
      </div>

      {feeds.length === 0 ? (
        <div style={diagnosticsEmptyStyle}>
          No supplemental enrichment feeds are configured for this provider yet.
        </div>
      ) : (
        <div style={diagnosticsFeedListStyle}>
          {feeds.map((feed: any, index: number) => (
            <div key={`${feed.name}-${index}`} style={diagnosticsFeedStyle}>
              <div style={diagnosticsFeedHeaderStyle}>
                <div>
                  <strong>{feed.name || "supplemental"}</strong>
                  <div style={diagnosticsSmallTextStyle}>
                    {feed.success ? "Feed reached" : feed.attempted ? "Feed failed" : "Not attempted"}
                  </div>
                </div>
                <div style={feedStatusStyle(feed.success)}>
                  {feed.success ? "ok" : feed.attempted ? "check" : "idle"}
                </div>
              </div>

              <div style={diagnosticsMiniGridStyle}>
                <DiagnosticMetric label="Rows" value={feed.rows_found} compact />
                <DiagnosticMetric label="Matches" value={feed.matches_found} compact />
                <DiagnosticMetric
                  label="Unmatched"
                  value={feed.unmatched_supplemental_rows}
                  compact
                />
              </div>

              {feed.error && (
                <div style={diagnosticsErrorStyle}>{feed.error}</div>
              )}

              <DiagnosticFieldBlock
                title="Mapped fields configured"
                value={feed.mapped_fields_configured}
              />
              <DiagnosticFieldBlock
                title="Mapped fields found"
                value={feed.mapped_fields_found}
              />
              <DiagnosticFieldBlock
                title="Mapped fields merged"
                value={feed.mapped_fields_merged}
              />
              <DiagnosticFieldBlock
                title="Mapped fields skipped"
                value={feed.mapped_fields_skipped}
              />

              {canShowAvailableKeys && (
                <DiagnosticFieldBlock
                  title="Available unmapped keys"
                  value={feed.unmapped_available_keys}
                  mutedEmpty="No extra unmapped keys detected."
                />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DiagnosticMetric({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: any;
  compact?: boolean;
}) {
  return (
    <div style={compact ? diagnosticsMiniMetricStyle : diagnosticsMetricStyle}>
      <div style={diagnosticsMetricValueStyle}>
        {Number(value || 0).toLocaleString()}
      </div>
      <div style={diagnosticsMetricLabelStyle}>{label}</div>
    </div>
  );
}

function DiagnosticFieldBlock({
  title,
  value,
  mutedEmpty = "None",
}: {
  title: string;
  value: any;
  mutedEmpty?: string;
}) {
  const entries = normalizeDiagnosticEntries(value);

  return (
    <div style={diagnosticsFieldBlockStyle}>
      <div style={diagnosticsFieldTitleStyle}>{title}</div>
      {entries.length === 0 ? (
        <div style={diagnosticsSmallTextStyle}>{mutedEmpty}</div>
      ) : (
        <div style={diagnosticsPillWrapStyle}>
          {entries.map((entry) => (
            <span key={entry} style={diagnosticsPillStyle}>
              {entry}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function normalizeDiagnosticEntries(value: any) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, count]) => Number(count || 0) > 0)
      .map(([field, count]) => `${field}: ${Number(count).toLocaleString()}`);
  }
  return [String(value)];
}

function AdvancedProviderEditor({
  provider,
  form,
  setForm,
}: {
  provider: any;
  form: any;
  setForm: (form: any) => void;
}) {
  return (
    <div style={formGrid}>
      <div>
        <label style={labelStyle}>Provider Access Setup</label>
        <input 
          style={inputStyle}
          value={form.login_url || ""} 
          onChange={(e) => setForm({...form, login_url: e.target.value})} 
        />
      </div>
      <div>
        <label style={labelStyle}>Fleet Data Setup</label>
        <input 
          style={inputStyle}
          value={form.fleet_url || ""} 
          onChange={(e) => setForm({...form, fleet_url: e.target.value})} 
        />
      </div>
      
      <div style={{ gridColumn: "span 2" }}>
        <label style={labelStyle}>Provider Data Group</label>
        <input 
          style={inputStyle}
          placeholder="Enter the confirmed provider data path"
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

      <CredentialProviderFields provider={provider} form={form} setForm={setForm} />

      <div style={{ gridColumn: "span 2" }}>
        <label style={labelStyle}>Connection Setup</label>
        <textarea 
          style={textareaStyle}
          value={typeof form.field_mapping === 'object' ? JSON.stringify(form.field_mapping, null, 2) : form.field_mapping}
          onChange={(e) => setForm({...form, field_mapping: e.target.value})}
        />
      </div>
    </div>
  );
}

function CredentialProviderEditor({
  provider,
  form,
  setForm,
}: {
  provider: any;
  form: any;
  setForm: (form: any) => void;
}) {
  return (
    <div style={formGrid}>
      <CredentialProviderFields provider={provider} form={form} setForm={setForm} />
    </div>
  );
}

function CredentialProviderFields({
  provider,
  form,
  setForm,
}: {
  provider: any;
  form: any;
  setForm: (form: any) => void;
}) {
  return (
    <>
      <div>
        <label style={labelStyle}>Username</label>
        <input 
          style={inputStyle}
          value={form.username || ""} 
          onChange={(e) => setForm({...form, username: e.target.value})} 
        />
      </div>
      <div>
        <label style={labelStyle}>
          Provider Password / Secret {provider.has_api_key ? "(stored)" : ""}
        </label>
        <input 
          type="password"
          style={inputStyle}
          placeholder={provider.has_api_key ? "Leave blank to keep existing" : ""}
          value={form.api_key || ""} 
          onChange={(e) => setForm({...form, api_key: e.target.value})} 
        />
      </div>
      <div>
        <label style={labelStyle}>
          Password {provider.has_password ? "(stored)" : ""}
        </label>
        <input
          type="password"
          style={inputStyle}
          placeholder={provider.has_password ? "Leave blank to keep existing" : ""}
          value={form.password || ""}
          onChange={(e) => setForm({...form, password: e.target.value})}
        />
      </div>
      <div>
        <label style={labelStyle}>
          Access Token {provider.has_bearer_token ? "(stored)" : ""}
        </label>
        <input
          type="password"
          style={inputStyle}
          placeholder={provider.has_bearer_token ? "Leave blank to keep existing" : ""}
          value={form.bearer_token || ""}
          onChange={(e) => setForm({...form, bearer_token: e.target.value})}
        />
      </div>
    </>
  );
}

// --- STYLES ---
const diagnosticsStyle = {
  marginTop: 20,
  border: "1px solid #cbd5e1",
  background: "linear-gradient(135deg, #f8fafc 0%, #ffffff 100%)",
  borderRadius: 12,
  padding: 18,
};
const diagnosticsHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  alignItems: "flex-start",
  marginBottom: 14,
};
const diagnosticsEyebrowStyle = {
  fontSize: 11,
  fontWeight: 900,
  color: "#0891b2",
  textTransform: "uppercase" as const,
  letterSpacing: "0.12em",
  marginBottom: 4,
};
const diagnosticsTitleStyle = {
  margin: 0,
  color: "#0f172a",
  fontSize: 17,
  fontWeight: 850,
};
const diagnosticsMetaStyle = {
  border: "1px solid #bae6fd",
  backgroundColor: "#ecfeff",
  color: "#0e7490",
  borderRadius: 999,
  padding: "6px 10px",
  fontSize: 12,
  fontWeight: 850,
  whiteSpace: "nowrap" as const,
};
const diagnosticsSummaryGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
  gap: 10,
  marginBottom: 14,
};
const diagnosticsMetricStyle = {
  border: "1px solid #e2e8f0",
  backgroundColor: "#fff",
  borderRadius: 10,
  padding: 12,
};
const diagnosticsMiniMetricStyle = {
  border: "1px solid #e2e8f0",
  backgroundColor: "#f8fafc",
  borderRadius: 8,
  padding: 10,
};
const diagnosticsMetricValueStyle = {
  color: "#0f172a",
  fontSize: 18,
  fontWeight: 900,
  lineHeight: 1.1,
};
const diagnosticsMetricLabelStyle = {
  marginTop: 4,
  color: "#64748b",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
};
const diagnosticsEmptyStyle = {
  border: "1px dashed #cbd5e1",
  backgroundColor: "#fff",
  borderRadius: 10,
  color: "#64748b",
  padding: 14,
  fontSize: 13,
  lineHeight: 1.6,
};
const diagnosticsFeedListStyle = {
  display: "grid",
  gap: 12,
};
const diagnosticsFeedStyle = {
  border: "1px solid #e2e8f0",
  backgroundColor: "#fff",
  borderRadius: 10,
  padding: 14,
};
const diagnosticsFeedHeaderStyle = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 12,
};
const diagnosticsSmallTextStyle = {
  marginTop: 3,
  color: "#64748b",
  fontSize: 12,
  lineHeight: 1.5,
};
const diagnosticsMiniGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
  gap: 8,
  marginBottom: 12,
};
const diagnosticsErrorStyle = {
  border: "1px solid #fecaca",
  backgroundColor: "#fef2f2",
  color: "#991b1b",
  borderRadius: 8,
  padding: 10,
  fontSize: 12,
  lineHeight: 1.5,
  marginBottom: 12,
};
const diagnosticsFieldBlockStyle = {
  borderTop: "1px solid #f1f5f9",
  paddingTop: 10,
  marginTop: 10,
};
const diagnosticsFieldTitleStyle = {
  color: "#334155",
  fontSize: 11,
  fontWeight: 900,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  marginBottom: 8,
};
const diagnosticsPillWrapStyle = {
  display: "flex",
  flexWrap: "wrap" as const,
  gap: 7,
};
const diagnosticsPillStyle = {
  display: "inline-flex",
  alignItems: "center",
  border: "1px solid #cbd5e1",
  backgroundColor: "#f8fafc",
  color: "#334155",
  borderRadius: 999,
  padding: "5px 8px",
  fontSize: 12,
  fontWeight: 750,
};
const feedStatusStyle = (success: boolean) => ({
  border: success ? "1px solid #99f6e4" : "1px solid #fde68a",
  backgroundColor: success ? "#f0fdfa" : "#fffbeb",
  color: success ? "#0f766e" : "#92400e",
  borderRadius: 999,
  padding: "5px 9px",
  fontSize: 11,
  fontWeight: 900,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
});

const cardStyle = { backgroundColor: "#fff", borderRadius: "12px", padding: "24px", border: "1px solid #e2e8f0", marginBottom: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" };
const pageHeaderStyle = { display: "flex", justifyContent: "space-between", gap: 24, alignItems: "flex-start", marginBottom: 28 };
const eyebrowStyle = { fontSize: 12, fontWeight: 800, color: "#0891b2", textTransform: "uppercase" as const, letterSpacing: "0.14em", marginBottom: 8 };
const pageTitleStyle = { margin: 0, fontSize: 34, fontWeight: 850, color: "#0f172a", letterSpacing: 0 };
const pageSubtitleStyle = { margin: "10px 0 0 0", maxWidth: 620, color: "#64748b", fontSize: 14, lineHeight: 1.7 };
const primaryLinkStyle = { display: "inline-flex", alignItems: "center", justifyContent: "center", backgroundColor: "#0f172a", color: "#fff", borderRadius: 8, padding: "12px 18px", fontSize: 14, fontWeight: 800, textDecoration: "none", whiteSpace: "nowrap" as const };
const secondaryLinkStyle = { display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid #cbd5e1", color: "#0f172a", backgroundColor: "#fff", borderRadius: 8, padding: "12px 18px", fontSize: 14, fontWeight: 800, textDecoration: "none", whiteSpace: "nowrap" as const };
const emptyStateStyle = { display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 24, background: "linear-gradient(135deg, #08111f 0%, #0f172a 55%, #123047 100%)", borderRadius: 16, padding: 28, border: "1px solid #0f2742", boxShadow: "0 24px 70px rgba(15, 23, 42, 0.22)" };
const emptyContentStyle = { color: "#fff" };
const emptyBadgeStyle = { display: "inline-flex", border: "1px solid rgba(103, 232, 249, 0.28)", background: "rgba(103, 232, 249, 0.10)", color: "#cffafe", borderRadius: 999, padding: "7px 11px", fontSize: 12, fontWeight: 800, marginBottom: 18 };
const emptyTitleStyle = { margin: 0, fontSize: 32, lineHeight: 1.15, fontWeight: 850, color: "#fff", letterSpacing: 0 };
const emptyBodyStyle = { margin: "14px 0 0 0", color: "#cbd5e1", fontSize: 15, lineHeight: 1.75, maxWidth: 640 };
const ctaRowStyle = { display: "flex", flexWrap: "wrap" as const, gap: 12, marginTop: 24 };
const noteGridStyle = { display: "grid", gridTemplateColumns: "1fr", gap: 10, marginTop: 24 };
const trustNoteStyle = { border: "1px solid rgba(148, 163, 184, 0.25)", background: "rgba(255, 255, 255, 0.06)", borderRadius: 10, padding: 14, color: "#dbeafe", fontSize: 13, lineHeight: 1.6 };
const readinessNoteStyle = { border: "1px solid rgba(34, 211, 238, 0.25)", background: "rgba(34, 211, 238, 0.08)", borderRadius: 10, padding: 14, color: "#cffafe", fontSize: 13, lineHeight: 1.6 };
const guideStyle = { background: "rgba(255, 255, 255, 0.08)", border: "1px solid rgba(255, 255, 255, 0.12)", borderRadius: 14, padding: 20, alignSelf: "start" };
const guideTitleStyle = { margin: "0 0 16px 0", color: "#fff", fontSize: 17, fontWeight: 850 };
const stepListStyle = { display: "grid", gap: 12 };
const stepStyle = { display: "grid", gridTemplateColumns: "30px 1fr", gap: 12, alignItems: "center" };
const stepNumberStyle = { width: 30, height: 30, borderRadius: 999, background: "#67e8f9", color: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900 };
const stepTextStyle = { color: "#e2e8f0", fontSize: 13, lineHeight: 1.5 };
const headerStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f1f5f9", paddingBottom: "16px", marginBottom: "20px" };
const statusText = { fontSize: "12px", color: "#64748b", margin: "4px 0 0 0", fontWeight: "500" };
const labelStyle = { display: "block", fontSize: "11px", fontWeight: "bold", color: "#475569", marginBottom: "4px", textTransform: "uppercase" as "uppercase" };
const inputStyle = { width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #cbd5e1", marginBottom: "10px", fontSize: "14px" };
const textareaStyle = { width: "100%", minHeight: "120px", padding: "12px", borderRadius: "6px", border: "1px solid #cbd5e1", fontFamily: "monospace", fontSize: "12px", backgroundColor: "#f8fafc" };
const formGrid = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px" };
const saveBtn = { backgroundColor: "#0f172a", color: "#fff", border: "none", padding: "8px 24px", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" };
const testBtn = { backgroundColor: "#fff", color: "#0f172a", border: "1px solid #cbd5e1", padding: "8px 20px", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" };
const statusOnlyStyle = { border: "1px solid #e2e8f0", backgroundColor: "#f8fafc", color: "#64748b", borderRadius: 8, padding: 14, fontSize: 13, lineHeight: 1.6 };
