"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";

function companyIdFromLocation() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("companyId") || "";
}

function companyQuery(companyId: string) {
  return companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
}

type CredentialField = {
  name: "username" | "api_key" | "password" | "bearer_token";
  label: string;
  secret: boolean;
};

export default function NewProviderPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [company, setCompany] = useState<any>(null);
  const [capabilities, setCapabilities] = useState<any>({
    can_add_provider: false,
    can_edit_advanced_provider_config: false,
  });
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestSaving, setRequestSaving] = useState(false);
  const [requestSuccess, setRequestSuccess] = useState(false);
  const [requestError, setRequestError] = useState("");

  const [form, setForm] = useState({
    username: "",
    api_key: "",
    password: "",
    bearer_token: "",
  });
  const [requestForm, setRequestForm] = useState({
    provider_name: "",
    provider_website: "",
    provider_contact: "",
    access_type_known: "unsure",
    notes: "",
  });

  useEffect(() => {
    const companyId = companyIdFromLocation();
    setSelectedCompanyId(companyId);
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("request") === "1") {
        setRequestOpen(true);
      }
    }
    loadWizardData(companyId);
  }, []);

  async function loadWizardData(companyId = "") {
    setLoadError("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return;
    }

    try {
      const [templateRes, providerRes] = await Promise.all([
        fetch("/api/providers/templates", {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }),
        fetch(`/api/providers${companyQuery(companyId)}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }),
      ]);
      const templateData = await templateRes.json();
      const providerData = await providerRes.json();

      if (!templateRes.ok || !templateData.success) {
        throw new Error(templateData.error || "Failed to load provider templates");
      }

      if (!providerRes.ok || !providerData.success) {
        throw new Error(providerData.error || "Failed to load provider access");
      }

      setTemplates(templateData.templates || []);
      setCapabilities(providerData.capabilities || {});
      setCompany(providerData.company || null);
      setIsPlatformOwner(Boolean(providerData.is_platform_owner));
    } catch (err: any) {
      setLoadError(err.message || "Failed to load provider templates");
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const selectedTemplateIsSetupOnly = Boolean(
    selectedTemplate?.setup_only || selectedTemplate?.fleet_config?.setup_only
  );
  const requiredCredentialFields: CredentialField[] = selectedTemplate
    ? selectedTemplateIsSetupOnly
      ? []
      : getCredentialFields(selectedTemplate)
    : [];

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

    const missingCredential = requiredCredentialFields.find(
      (field: CredentialField) => !String(form[field.name] || "").trim()
    );

    if (missingCredential) {
      alert(`${missingCredential.label} is required.`);
      return;
    }

    const loginUrl =
      selectedTemplate.default_login_url ||
      selectedTemplate.auth_config?.login_url ||
      null;

    const fleetUrl =
      selectedTemplate.default_fleet_url ||
      selectedTemplate.fleet_config?.fleet_url ||
      null;
    const baseUrl =
      selectedTemplate.base_url ||
      selectedTemplate.default_base_url ||
      selectedTemplate.auth_config?.base_url ||
      selectedTemplate.fleet_config?.base_url ||
      originFromUrl(fleetUrl);

    if (!loginUrl) {
      alert("Provider setup is incomplete. Please request support.");
      return;
    }

    if (!fleetUrl) {
      alert("Provider setup is incomplete. Please request support.");
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
      capability_profile: selectedTemplate.capability_profile || selectedTemplate.fleet_config?.capability_profile || {},
      supported_signals: selectedTemplate.supported_signals || selectedTemplate.fleet_config?.supported_signals || {},
      provider_timezone: selectedTemplate.provider_timezone || selectedTemplate.fleet_config?.provider_timezone || "Africa/Nairobi",
      source_signal_notes: selectedTemplate.source_signal_notes || {},

      username: form.username,
      api_key: form.api_key,
      password: form.password || null,
      bearer_token: form.bearer_token || null,

      base_url: baseUrl,
      login_url: loginUrl,
      fleet_url: fleetUrl,

      is_active: false,
      ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
      }),
    });
    const data = await res.json();

    setSaving(false);

    if (!res.ok || !data.success) {
      alert(`Provider creation failed: ${data.error || "Unknown error"}`);
      return;
    }

    alert("Provider added inactive. Test the connection before activating sync.");
    window.location.href = `/admin/providers${companyQuery(selectedCompanyId)}`;
  }

  async function handleSubmitSetupRequest() {
    const providerName = requestForm.provider_name.trim();
    if (!providerName) {
      setRequestError("Provider name is required.");
      return;
    }

    setRequestSaving(true);
    setRequestError("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setRequestSaving(false);
      window.location.href = "/login";
      return;
    }

    try {
      const res = await fetch("/api/providers/setup-requests", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider_name: providerName,
          provider_website: requestForm.provider_website.trim() || null,
          provider_contact: requestForm.provider_contact.trim() || null,
          access_type_known: requestForm.access_type_known,
          notes: requestForm.notes.trim() || null,
          ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to submit provider setup request");
      }

      setRequestSuccess(true);
      setRequestForm({
        provider_name: "",
        provider_website: "",
        provider_contact: "",
        access_type_known: "unsure",
        notes: "",
      });
    } catch (err: any) {
      setRequestError(err.message || "Failed to submit provider setup request");
    } finally {
      setRequestSaving(false);
    }
  }

  if (loading) {
    return <main style={{ padding: 40 }}>Loading supported providers...</main>;
  }

  return (
    <main style={pageStyle}>
      <header style={{ marginBottom: 30 }}>
        <div style={eyebrowStyle}>Provider onboarding</div>
        <h1 style={titleStyle}>Connect your tracking provider</h1>
        <p style={subtitleStyle}>
          Choose a supported template, add the access details supplied by your
          provider, test safely, then activate sync only after the connection is
          verified.
        </p>
      </header>

      {selectedCompanyId && isPlatformOwner && company && (
        <div style={tenantBannerStyle}>
          <div>
            <div style={tenantEyebrowStyle}>Platform tenant context</div>
            <div style={tenantTitleStyle}>
              Adding provider for <strong>{company.name}</strong>
            </div>
          </div>
          <Link
            href={`/admin/providers${companyQuery(selectedCompanyId)}`}
            style={tenantBackLinkStyle}
          >
            Back to Provider Vault
          </Link>
        </div>
      )}

      <WizardSteps />

      <section style={cardStyle}>
        {!capabilities.can_add_provider ? (
          <div style={noAccessStyle}>
            <div style={emptyBadgeStyle}>Provider administration</div>
            <h2 style={emptyTitleStyle}>Provider setup requires an owner or admin</h2>
            <p style={emptyBodyStyle}>
              You can view provider status, but creating provider connections is
              limited to company owners/admins and platform owners.
            </p>
            <Link
              href={`/admin/providers${companyQuery(selectedCompanyId)}`}
              style={secondaryLinkStyle}
            >
              Back to Provider Vault
            </Link>
          </div>
        ) : templates.length === 0 ? (
          <EmptyTemplateState
            error={loadError}
            onRequest={() => setRequestOpen(true)}
          />
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

            <ProviderSetupRequestSection
              requestOpen={requestOpen}
              requestSuccess={requestSuccess}
              requestError={requestError}
              requestSaving={requestSaving}
              requestForm={requestForm}
              setRequestOpen={setRequestOpen}
              setRequestForm={setRequestForm}
              onSubmit={handleSubmitSetupRequest}
            />

            {selectedTemplate && (
              <>
                <div style={noticeStyle}>
                  <strong>{selectedTemplate.display_name}</strong> selected.{" "}
                  {selectedTemplateIsSetupOnly
                    ? "This is a setup example for signal planning; request support before adding live credentials."
                    : "The provider will be created inactive, then tested and activated from Provider Vault."}
                </div>

                <TemplateCapabilityPreview
                  template={selectedTemplate}
                  canShowAdvanced={Boolean(
                    capabilities.can_edit_advanced_provider_config
                  )}
                />

                {!selectedTemplateIsSetupOnly && (
                  <div style={gridStyle}>
                    {requiredCredentialFields.map((field) => (
                      <div key={field.name} style={fieldGroup}>
                        <label style={labelStyle}>{field.label}</label>
                        <input
                          type={field.secret ? "password" : "text"}
                          style={inputStyle}
                          value={form[field.name]}
                          onChange={(e) =>
                            setForm({ ...form, [field.name]: e.target.value })
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}

                {selectedTemplateIsSetupOnly ? (
                  <div style={noticeStyle}>
                    This template is an onboarding example only. Request provider
                    setup after confirming exact API endpoints and available
                    hardware signals.
                  </div>
                ) : (
                  <button
                    onClick={handleCreateProvider}
                    disabled={saving}
                    style={buttonStyle}
                  >
                    {saving ? "CREATING CONNECTION..." : "CREATE INACTIVE CONNECTION"}
                  </button>
                )}
              </>
            )}
          </>
        )}

        {capabilities.can_add_provider && templates.length === 0 && requestOpen && (
          <ProviderSetupRequestForm
            requestSuccess={requestSuccess}
            requestError={requestError}
            requestSaving={requestSaving}
            requestForm={requestForm}
            setRequestForm={setRequestForm}
            onSubmit={handleSubmitSetupRequest}
          />
        )}
      </section>
    </main>
  );
}

function WizardSteps() {
  const steps = [
    "Choose provider",
    "Enter credentials",
    "Test connection",
    "Review vehicles and signals",
    "Activate sync",
  ];

  return (
    <div style={wizardStepsStyle}>
      {steps.map((step, index) => (
        <div key={step} style={wizardStepStyle}>
          <span style={wizardStepNumberStyle}>{index + 1}</span>
          <span>{step}</span>
        </div>
      ))}
    </div>
  );
}

function TemplateCapabilityPreview({
  template,
  canShowAdvanced,
}: {
  template: any;
  canShowAdvanced: boolean;
}) {
  const capability =
    template.capability_profile?.default_capability ||
    template.fleet_config?.capability_profile?.default_capability ||
    "UNKNOWN";
  const supportedSignals =
    template.supported_signals || template.fleet_config?.supported_signals || {};
  const safeSupportedSignals =
    supportedSignals && typeof supportedSignals === "object" && !Array.isArray(supportedSignals)
      ? supportedSignals
      : {};
  const signalNames = Object.entries(safeSupportedSignals)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key);

  const endpointLabels = Array.isArray(template.default_endpoint_labels)
    ? template.default_endpoint_labels
    : [];
  const setupNotes = Array.isArray(template.setup_notes)
    ? template.setup_notes
    : [];

  return (
    <div style={templatePreviewStyle}>
      <div style={previewGridStyle}>
        <PreviewMetric
          label="Signal capability"
          value={capabilityLabel(capability)}
        />
        <PreviewMetric
          label="Auth method"
          value={template.auth_method_label || template.auth_type || "Provider credentials"}
        />
        <PreviewMetric
          label="Self-serve status"
          value={
            template.setup_only || template.fleet_config?.setup_only
              ? "Requires provider support"
              : "Self-serve template"
          }
        />
      </div>

      <div style={previewNoteStyle}>
        <strong>Supported signals:</strong>{" "}
        {signalNames.length > 0 ? signalNames.join(", ") : "none declared"}
      </div>

      {setupNotes.length > 0 && (
        <div style={previewNoteStyle}>
          <strong>Setup notes:</strong> {setupNotes.join(" ")}
        </div>
      )}

      {canShowAdvanced && (
        <details style={templateAdvancedStyle}>
          <summary style={templateAdvancedSummaryStyle}>Advanced template details</summary>
          <div style={previewNoteStyle}>
            <strong>Endpoint labels:</strong>{" "}
            {endpointLabels.length > 0 ? endpointLabels.join(", ") : "none declared"}
          </div>
          <div style={previewNoteStyle}>
            <strong>Field mapping:</strong>{" "}
            {Object.keys(template.field_mapping || {}).length > 0
              ? Object.keys(template.field_mapping).join(", ")
              : "none declared"}
          </div>
        </details>
      )}
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={previewMetricStyle}>
      <div style={previewMetricLabelStyle}>{label}</div>
      <div style={previewMetricValueStyle}>{value}</div>
    </div>
  );
}

function capabilityLabel(value: string) {
  const labels: Record<string, string> = {
    UNKNOWN: "Unknown Capability",
    GPS_ONLY: "GPS Intelligence",
    GPS_WITH_IGNITION: "Ignition-Aware GPS",
    CAN_BUS: "Engine Intelligence",
    FUEL_ROD: "Tank Intelligence",
    HYBRID_CAN_AND_FUEL_ROD: "Full Fuel Intelligence",
  };
  return labels[String(value || "UNKNOWN").toUpperCase()] || "Unknown Capability";
}

function getCredentialFields(template: any): CredentialField[] {
  if (Array.isArray(template.required_fields) && template.required_fields.length > 0) {
    return template.required_fields.map((field: any) => ({
      name: String(field.name || ""),
      label: String(field.label || field.name || "Credential"),
      secret: field.secret !== false,
    })).filter((field: any): field is CredentialField =>
      ["username", "api_key", "password", "bearer_token"].includes(field.name)
    );
  }

  const placeholders = new Set<string>();
  const configText = JSON.stringify({
    auth_config: template.auth_config || {},
    fleet_config: template.fleet_config || {},
  });

  const matches = configText.match(/{{\s*(username|api_key|password|bearer_token)\s*}}/g) || [];
  matches.forEach((match) => placeholders.add(match.replace(/[{}\s]/g, "")));

  const fields: CredentialField[] = [
    { name: "username", label: "API Username", secret: false },
    { name: "api_key", label: "Provider Password / Secret", secret: true },
    { name: "password", label: "Password", secret: true },
    { name: "bearer_token", label: "Access Token", secret: true },
  ];

  return fields.filter((field) => placeholders.has(field.name));
}

function EmptyTemplateState({
  error,
  onRequest,
}: {
  error: string;
  onRequest: () => void;
}) {
  return (
    <div style={emptyTemplateStyle}>
      <div style={emptyBadgeStyle}>Provider setup</div>
      <h2 style={emptyTitleStyle}>No verified provider setup available yet</h2>
      <p style={emptyBodyStyle}>
        Nava needs a verified GPS/telemetry setup template before it can create
        a secure connection for this provider.
      </p>

      {error && <div style={errorStyle}>{error}</div>}

      <div style={emptyActionsStyle}>
        <button
          type="button"
          onClick={onRequest}
          style={buttonStyle}
        >
          Request provider setup
        </button>
        <Link href="/onboarding" style={secondaryLinkStyle}>
          Back to onboarding
        </Link>
      </div>

      <div style={emptyNoteStyle}>
        Provider access details should only be saved after Nava has verified the
        provider connection safely.
      </div>
    </div>
  );
}

function ProviderSetupRequestSection({
  requestOpen,
  requestSuccess,
  requestError,
  requestSaving,
  requestForm,
  setRequestOpen,
  setRequestForm,
  onSubmit,
}: {
  requestOpen: boolean;
  requestSuccess: boolean;
  requestError: string;
  requestSaving: boolean;
  requestForm: any;
  setRequestOpen: (open: boolean) => void;
  setRequestForm: (form: any) => void;
  onSubmit: () => void;
}) {
  return (
    <div style={requestSectionStyle}>
      <div>
        <div style={requestTitleStyle}>Don&apos;t see your provider?</div>
        <p style={requestCopyStyle}>
          Nava can help set up a verified connection for your fleet.
        </p>
      </div>
      <button
        type="button"
        style={secondaryButtonStyle}
        onClick={() => setRequestOpen(!requestOpen)}
      >
        Request provider setup
      </button>

      {requestOpen && (
        <ProviderSetupRequestForm
          requestSuccess={requestSuccess}
          requestError={requestError}
          requestSaving={requestSaving}
          requestForm={requestForm}
          setRequestForm={setRequestForm}
          onSubmit={onSubmit}
        />
      )}
    </div>
  );
}

function ProviderSetupRequestForm({
  requestSuccess,
  requestError,
  requestSaving,
  requestForm,
  setRequestForm,
  onSubmit,
}: {
  requestSuccess: boolean;
  requestError: string;
  requestSaving: boolean;
  requestForm: any;
  setRequestForm: (form: any) => void;
  onSubmit: () => void;
}) {
  if (requestSuccess) {
    return (
      <div style={requestSuccessStyle}>
        Request received. Nava will review the provider and prepare a verified
        connection path before any credentials are collected.
      </div>
    );
  }

  return (
    <div style={requestFormStyle}>
      <div style={gridStyle}>
        <div style={fieldGroup}>
          <label style={labelStyle}>Provider Name</label>
          <input
            style={inputStyle}
            value={requestForm.provider_name}
            onChange={(e) =>
              setRequestForm({ ...requestForm, provider_name: e.target.value })
            }
          />
        </div>

        <div style={fieldGroup}>
          <label style={labelStyle}>Provider Website Optional</label>
          <input
            style={inputStyle}
            value={requestForm.provider_website}
            onChange={(e) =>
              setRequestForm({
                ...requestForm,
                provider_website: e.target.value,
              })
            }
          />
        </div>

        <div style={fieldGroup}>
          <label style={labelStyle}>Provider Contact Optional</label>
          <input
            style={inputStyle}
            value={requestForm.provider_contact}
            onChange={(e) =>
              setRequestForm({
                ...requestForm,
                provider_contact: e.target.value,
              })
            }
          />
        </div>

        <div style={fieldGroup}>
          <label style={labelStyle}>Access Type Known</label>
          <select
            style={inputStyle}
            value={requestForm.access_type_known}
            onChange={(e) =>
              setRequestForm({
                ...requestForm,
                access_type_known: e.target.value,
              })
            }
          >
            <option value="unsure">Unsure</option>
            <option value="username_password">Username/password</option>
            <option value="api_key">API key</option>
            <option value="token">Token</option>
          </select>
        </div>
      </div>

      <div style={fieldGroup}>
        <label style={labelStyle}>Notes Optional</label>
        <textarea
          style={textareaStyle}
          value={requestForm.notes}
          onChange={(e) =>
            setRequestForm({ ...requestForm, notes: e.target.value })
          }
        />
      </div>

      {requestError && <div style={requestErrorStyle}>{requestError}</div>}

      <button
        type="button"
        onClick={onSubmit}
        disabled={requestSaving}
        style={buttonStyle}
      >
        {requestSaving ? "SUBMITTING REQUEST..." : "SUBMIT REQUEST"}
      </button>
    </div>
  );
}

const pageStyle = {
  padding: 40,
  maxWidth: 900,
};

const eyebrowStyle = {
  fontSize: 12,
  fontWeight: 850,
  textTransform: "uppercase" as const,
  letterSpacing: "0.12em",
  color: "#0891b2",
  marginBottom: 8,
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

const tenantBannerStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  alignItems: "center",
  border: "1px solid #bae6fd",
  backgroundColor: "#ecfeff",
  borderRadius: 12,
  padding: 16,
  marginBottom: 18,
};

const tenantEyebrowStyle = {
  fontSize: 11,
  fontWeight: 900,
  color: "#0891b2",
  textTransform: "uppercase" as const,
  letterSpacing: "0.12em",
  marginBottom: 4,
};

const tenantTitleStyle = {
  color: "#0f172a",
  fontSize: 14,
  lineHeight: 1.5,
};

const tenantBackLinkStyle = {
  color: "#0f172a",
  border: "1px solid #bae6fd",
  backgroundColor: "#fff",
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 13,
  fontWeight: 800,
  textDecoration: "none",
  whiteSpace: "nowrap" as const,
};

const wizardStepsStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
  gap: 10,
  marginBottom: 18,
};

const wizardStepStyle = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  minWidth: 0,
  border: "1px solid #e2e8f0",
  backgroundColor: "#f8fafc",
  borderRadius: 10,
  padding: "10px 12px",
  color: "#334155",
  fontSize: 12,
  fontWeight: 750,
};

const wizardStepNumberStyle = {
  width: 22,
  height: 22,
  borderRadius: 999,
  backgroundColor: "#0f172a",
  color: "#fff",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  fontSize: 11,
  fontWeight: 900,
};

const noAccessStyle = {
  background: "linear-gradient(135deg, #07111f 0%, #0f172a 58%, #155e75 100%)",
  borderRadius: 14,
  padding: 24,
  color: "#e0f2fe",
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

const textareaStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  fontSize: 14,
  minHeight: 90,
  resize: "vertical" as const,
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

const templatePreviewStyle = {
  marginTop: 18,
  border: "1px solid #dbeafe",
  background: "#f8fafc",
  borderRadius: 12,
  padding: 16,
};

const previewGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 12,
};

const previewMetricStyle = {
  border: "1px solid #e2e8f0",
  background: "#fff",
  borderRadius: 10,
  padding: 12,
};

const previewMetricLabelStyle = {
  color: "#64748b",
  fontSize: 11,
  fontWeight: 850,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  marginBottom: 6,
};

const previewMetricValueStyle = {
  color: "#0f172a",
  fontSize: 13,
  fontWeight: 850,
  lineHeight: 1.4,
};

const previewNoteStyle = {
  marginTop: 12,
  color: "#334155",
  fontSize: 13,
  lineHeight: 1.6,
};

const templateAdvancedStyle = {
  marginTop: 14,
  borderTop: "1px solid #e2e8f0",
  paddingTop: 12,
};

const templateAdvancedSummaryStyle = {
  cursor: "pointer",
  color: "#0f172a",
  fontSize: 13,
  fontWeight: 850,
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

const requestSectionStyle = {
  marginTop: 18,
  border: "1px solid #dbeafe",
  borderRadius: 12,
  background: "#f8fafc",
  padding: 16,
};

const requestTitleStyle = {
  color: "#0f172a",
  fontWeight: 850,
  fontSize: 15,
};

const requestCopyStyle = {
  margin: "6px 0 0 0",
  color: "#64748b",
  fontSize: 13,
  lineHeight: 1.6,
};

const secondaryButtonStyle = {
  marginTop: 12,
  background: "#ffffff",
  color: "#0f172a",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  padding: "10px 14px",
  fontWeight: 800,
  cursor: "pointer",
};

const requestFormStyle = {
  marginTop: 16,
  borderTop: "1px solid #e2e8f0",
  paddingTop: 16,
};

const requestSuccessStyle = {
  marginTop: 16,
  background: "#ecfeff",
  border: "1px solid #67e8f9",
  borderRadius: 10,
  padding: 14,
  color: "#155e75",
  fontSize: 13,
  lineHeight: 1.6,
};

const requestErrorStyle = {
  marginTop: 12,
  background: "#fef2f2",
  border: "1px solid #fecaca",
  borderRadius: 10,
  padding: 12,
  color: "#991b1b",
  fontSize: 13,
};
