"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";

function companyIdFromLocation() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("companyId") || "";
}

function companyQuery(companyId: string) {
  return companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
}

export default function ProviderVault() {
  const [providers, setProviders] = useState<any[]>([]);
  const [company, setCompany] = useState<any>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
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
    const companyId = companyIdFromLocation();
    setSelectedCompanyId(companyId);
    loadVault(companyId);
  }, []);

  async function loadVault(companyId = selectedCompanyId) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        window.location.href = "/login";
        return;
      }

      const res = await fetch(`/api/providers${companyQuery(companyId)}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const data = await res.json();
      if (data.success) {
        setProviders(data.providers || []);
        setCapabilities(data.capabilities || {});
        setCompany(data.company || null);
        setIsPlatformOwner(Boolean(data.is_platform_owner));
      } else alert(data.error || "Failed to load providers");
    } catch (err: any) {
      alert(err.message || "Failed to load providers");
    } finally {
      setLoading(false);
    }
  }

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
            capability_profile: parseJsonObjectField(
              finalProvider.capability_profile,
              "Capability profile"
            ),
            supported_signals: parseJsonObjectField(
              finalProvider.supported_signals,
              "Supported signals"
            ),
            provider_timezone: finalProvider.provider_timezone || "Africa/Nairobi",
            source_signal_notes: parseJsonObjectField(
              finalProvider.source_signal_notes,
              "Source signal notes"
            ),
            username: finalProvider.username || null,
            base_url: finalProvider.base_url || null,
            login_url: finalProvider.login_url || null,
            fleet_url: finalProvider.fleet_url || null,
            is_active: finalProvider.is_active,
            ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
          }
        : {
            username: finalProvider.username || null,
            ...(typeof finalProvider.is_active === "boolean"
              ? { is_active: finalProvider.is_active }
              : {}),
            ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
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
          <Link
            href={`/admin/providers/new${companyQuery(selectedCompanyId)}`}
            style={primaryLinkStyle}
          >
            Add Provider
          </Link>
        )}
      </div>

      {selectedCompanyId && isPlatformOwner && company && (
        <div style={tenantBannerStyle}>
          <div>
            <div style={tenantEyebrowStyle}>Platform tenant context</div>
            <div style={tenantTitleStyle}>
              Viewing tenant: <strong>{company.name}</strong>
            </div>
          </div>
          <div style={tenantSlugStyle}>{company.slug || "tenant"}</div>
        </div>
      )}

      {providers.length === 0 ? (
        <EmptyProviderState
          capabilities={capabilities}
          selectedCompanyId={selectedCompanyId}
        />
      ) : (
        providers.map((p) => (
          <ProviderCard 
            key={p.id} 
            provider={p} 
            onSave={handleSave} 
            isSaving={isSaving} 
            capabilities={capabilities}
            selectedCompanyId={selectedCompanyId}
          />
        ))
      )}
    </div>
  );
}

function EmptyProviderState({
  capabilities,
  selectedCompanyId,
}: {
  capabilities: any;
  selectedCompanyId: string;
}) {
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
              <Link
                href={`/admin/providers/new${companyQuery(selectedCompanyId)}`}
                style={primaryLinkStyle}
              >
                Add Provider
              </Link>
              <Link
                href={`/admin/providers/new${companyQuery(
                  selectedCompanyId
                )}${selectedCompanyId ? "&" : "?"}request=1`}
                style={secondaryLinkStyle}
              >
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
  selectedCompanyId,
}: {
  provider: any;
  onSave: (updatedProvider: any) => void;
  isSaving: boolean;
  capabilities: any;
  selectedCompanyId: string;
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
        body: JSON.stringify(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
      });

      const result = await res.json();
      setTestResult(result);

      if (result.success) {
        setForm((current: any) => ({
          ...current,
          last_test_status: "success",
          last_test_message: result.message || current.last_test_message,
          last_test_at: new Date().toISOString(),
        }));
      } else {
        setForm((current: any) => ({
          ...current,
          last_test_status: "failure",
          last_test_message: result.message || result.error || current.last_test_message,
          last_test_at: new Date().toISOString(),
        }));
      }
    } catch (err: any) {
      console.error("Test execution error:", err);
      setTestResult({
        success: false,
        message: "Connection test failed. Check the provider link and saved credentials.",
        error: err.message || "Provider test failed",
      });
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
            Connection:{" "}
            <span style={{ color: form.is_active ? "#10b981" : "#64748b" }}>
              {form.is_active ? "Active sync" : "Inactive until activated"}
            </span>
            {" · "}
            Test: <span style={{ color: form.last_test_status === 'success' ? '#10b981' : '#ef4444' }}>
              {form.last_test_status || "Pending"}
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

      {(capabilities.can_update_provider_credentials ||
        capabilities.can_edit_advanced_provider_config) && (
        <ProviderActivationPanel
          provider={form}
          isSaving={isSaving}
          onActivate={(nextActive) =>
            onSave({
              ...form,
              is_active: nextActive,
            })
          }
        />
      )}

      <ProviderTestOutcome result={testResult} />
      <ProviderFeedContractSummary summary={form.feed_summary || provider.feed_summary} />
      <ProviderCapabilityDiagnostics summary={testResult?.capability_summary} />
      <ProviderSecondSourceDiagnostics result={testResult} />
      <ProviderDistanceDiagnostics diagnostics={testResult?.distance_diagnostics} />
      <ProviderDataDiscoveryDiagnostics
        providerId={form.id}
        selectedCompanyId={selectedCompanyId}
        canRun={capabilities.can_test_provider}
      />
      <DistanceReportImport
        providerId={form.id}
        selectedCompanyId={selectedCompanyId}
        canImport={
          capabilities.can_update_provider_credentials ||
          capabilities.can_edit_advanced_provider_config
        }
      />

      <ProviderEnrichmentDiagnostics
        diagnostics={testResult?.supplemental_diagnostics}
        canShowAvailableKeys={capabilities.can_edit_advanced_provider_config}
      />
    </div>
  );
}

function ProviderCapabilityDiagnostics({ summary }: { summary: any }) {
  if (!summary) return null;

  return (
    <section style={diagnosticsStyle}>
      <div style={diagnosticsHeaderStyle}>
        <div>
          <div style={diagnosticsEyebrowStyle}>Telemetry capability</div>
          <h4 style={diagnosticsTitleStyle}>Signal Capability Summary</h4>
        </div>
        <div style={diagnosticsMetaStyle}>
          Provider default: {summary.default_capability_label || "Unknown Capability"}
        </div>
      </div>

      <div style={diagnosticsSummaryGridStyle}>
        <DiagnosticMetric
          label="Observed rows"
          value={summary.rows_processed}
        />
        <DiagnosticMetric
          label="Observed capabilities"
          value={(summary.observed_capabilities || []).length}
        />
        <DiagnosticMetric
          label="Engine/tank signals"
          value={(summary.supported_engine_tank_signals || []).length}
        />
        <DiagnosticMetric
          label="Placeholder zeros"
          value={Object.values(summary.placeholder_zero_signal_counts || {}).reduce(
            (sum: number, count: any) => sum + Number(count || 0),
            0
          )}
        />
      </div>

      <DiagnosticFieldBlock
        title="Provider default capability"
        value={[
          summary.default_capability_label || "Unknown Capability",
          `Timezone: ${summary.provider_timezone || "Africa/Nairobi"}`,
        ]}
      />
      <DiagnosticFieldBlock
        title="Observed row capability"
        value={(summary.observed_capabilities || []).map(
          (item: any) =>
            `${item.label || item.capability} — ${Number(item.rows || 0).toLocaleString()} row${
              Number(item.rows || 0) === 1 ? "" : "s"
            }`
        )}
        mutedEmpty="No rows were normalized during this test."
      />
      <DiagnosticFieldBlock
        title="Supported engine/tank signals"
        value={summary.supported_engine_tank_signals}
        mutedEmpty="None declared."
      />
      <DiagnosticFieldBlock
        title="Placeholder zero signals"
        value={summary.placeholder_zero_signal_counts}
        mutedEmpty="No unsupported zero engine/fuel placeholders detected."
        includeZeroCounts
      />
    </section>
  );
}

function ProviderActivationPanel({
  provider,
  isSaving,
  onActivate,
}: {
  provider: any;
  isSaving: boolean;
  onActivate: (nextActive: boolean) => void;
}) {
  const testedSuccessfully = provider.last_test_status === "success";
  const isActive = Boolean(provider.is_active);

  return (
    <section style={activationPanelStyle}>
      <div>
        <div style={activationEyebrowStyle}>Sync activation</div>
        <div style={activationTitleStyle}>
          {isActive
            ? "Provider sync is active"
            : testedSuccessfully
              ? "Connection tested. Sync can be activated."
              : "Test connection before activation"}
        </div>
        <p style={activationCopyStyle}>
          New providers stay inactive until a successful connection test. Sync
          activation is explicit so vehicles and signals can be reviewed before
          regular provider pulls are enabled.
        </p>
      </div>
      <div style={activationActionsStyle}>
        {isActive ? (
          <button
            type="button"
            disabled={isSaving}
            onClick={() => onActivate(false)}
            style={secondaryActionButtonStyle}
          >
            Pause sync
          </button>
        ) : (
          <button
            type="button"
            disabled={isSaving || !testedSuccessfully}
            onClick={() => onActivate(true)}
            style={{
              ...saveBtn,
              opacity: isSaving || !testedSuccessfully ? 0.55 : 1,
              cursor: isSaving || !testedSuccessfully ? "not-allowed" : "pointer",
            }}
          >
            Activate sync
          </button>
        )}
      </div>
    </section>
  );
}

function ProviderTestOutcome({ result }: { result: any }) {
  if (!result) return null;
  const success = Boolean(result.success);
  const title = success ? "Connection test complete" : "Connection needs attention";
  const message =
    result.message ||
    result.error ||
    (success
      ? "Provider connection is returning usable vehicle data."
      : "Connection test failed. Check the saved provider setup.");

  return (
    <section style={success ? successPanelStyle : warningPanelStyle}>
      <div style={diagnosticsEyebrowStyle}>Test connection</div>
      <h4 style={diagnosticsTitleStyle}>{title}</h4>
      <p style={panelCopyStyle}>{message}</p>
      {success ? (
        <div style={diagnosticsSummaryGridStyle}>
          <DiagnosticMetric label="Vehicles found" value={result.vehicles_found || 0} />
          <DiagnosticMetric label="Assets" value={result.assets_count || 0} />
          <DiagnosticMetric
            label="Latest telemetry"
            value={result.latest_telemetry_at ? "available" : "none yet"}
          />
        </div>
      ) : (
        <div style={panelCopyStyle}>
          {providerFailureNextStep(result.failure_stage, message)}
        </div>
      )}
    </section>
  );
}

function ProviderFeedContractSummary({ summary }: { summary: any }) {
  if (!summary) return null;
  const currentFeed = summary.current_vehicle_feed || {};
  const reportFeed = summary.report_feed || {};

  return (
    <section style={diagnosticsStyle}>
      <div style={diagnosticsHeaderStyle}>
        <div>
          <div style={diagnosticsEyebrowStyle}>Provider connection contract</div>
          <h4 style={diagnosticsTitleStyle}>Current vehicle feed and report feed</h4>
        </div>
      </div>
      <div style={feedGridStyle}>
        <div style={feedPanelStyle}>
          <div style={feedTitleStyle}>Current vehicle feed</div>
          <p style={panelCopyStyle}>
            {currentFeed.configured
              ? "Configured for live/current vehicle rows."
              : "Current vehicle endpoint is not configured yet."}
          </p>
          <DiagnosticMetric label="Method" value={currentFeed.method || "GET"} />
          <DiagnosticMetric
            label="Row path"
            value={(currentFeed.row_paths || []).join(", ") || "not set"}
          />
        </div>
        <div style={feedPanelStyle}>
          <div style={feedTitleStyle}>Report/distance feed</div>
          <p style={panelCopyStyle}>
            {reportFeed.configured
              ? "Configured separately for report and distance rows."
              : reportFeed.setup_message ||
                "Report endpoint not configured yet. Ask provider for get_reports parameters."}
          </p>
          <DiagnosticMetric
            label="Status"
            value={reportFeed.configured ? "configured" : "not active"}
          />
          <DiagnosticMetric label="Method" value={reportFeed.method || "GET"} />
        </div>
      </div>
    </section>
  );
}

function providerFailureNextStep(stage: string | null, message: string) {
  const text = String(message || "").toLowerCase();
  if (stage === "auth" || text.includes("sign-in") || text.includes("token")) {
    return "Check username/password, login endpoint, token path, and token placement.";
  }
  if (text.includes("vehicle endpoint") || text.includes("vehicle rows")) {
    return "Check the vehicle endpoint, token placement, and row path.";
  }
  if (text.includes("report")) {
    return "Check report endpoint parameters before enabling automated distance ingestion.";
  }
  return "Open Advanced settings only if the provider supplied exact endpoint or mapping details.";
}

function ProviderSecondSourceDiagnostics({ result }: { result: any }) {
  if (!result || !Number(result.cross_provider_asset_matches || 0)) return null;

  return (
    <section style={diagnosticsStyle}>
      <div style={diagnosticsHeaderStyle}>
        <div>
          <div style={diagnosticsEyebrowStyle}>Second provider safety</div>
          <h4 style={diagnosticsTitleStyle}>Existing Asset Matches</h4>
        </div>
        <div style={diagnosticsMetaStyle}>
          {Number(result.cross_provider_asset_matches || 0).toLocaleString()} matched
        </div>
      </div>
      <div style={diagnosticsEmptyStyle}>
        This provider reported vehicles that already exist from another provider.
        Nava kept those as cross-provider telemetry and did not create duplicate
        billable-review assets.
      </div>
      <DiagnosticFieldBlock
        title="Matched vehicles"
        value={(result.cross_provider_asset_match_samples || []).map(
          (item: any) =>
            `${item.truck_id} — existing: ${item.existing_provider_name || "provider"}, incoming: ${item.incoming_provider_name || "provider"}`
        )}
        mutedEmpty="No samples available."
      />
      <DiagnosticFieldBlock
        title="Capability updates"
        value={
          result.capability_upgrades_applied
            ? [`${result.capability_upgrades_applied} verified capability upgrade(s) applied`]
            : []
        }
        mutedEmpty="No capability upgrade was needed."
      />
    </section>
  );
}

function ProviderDistanceDiagnostics({ diagnostics }: { diagnostics: any }) {
  if (!diagnostics) return null;

  return (
    <section style={diagnosticsStyle}>
      <div style={diagnosticsHeaderStyle}>
        <div>
          <div style={diagnosticsEyebrowStyle}>Distance intelligence</div>
          <h4 style={diagnosticsTitleStyle}>Distance Evidence Summary</h4>
        </div>
        <div style={diagnosticsMetaStyle}>
          {diagnostics.write_mode === "dry_run" ? "test dry-run" : "sync write"}
        </div>
      </div>

      <div style={diagnosticsSummaryGridStyle}>
        <DiagnosticMetric
          label="Auto feeds"
          value={diagnostics.automated_distance_feeds_configured}
        />
        <DiagnosticMetric
          label="Rows found"
          value={diagnostics.automated_distance_rows_found}
        />
        <DiagnosticMetric
          label="Matched assets"
          value={diagnostics.matched_assets}
        />
        <DiagnosticMetric
          label={diagnostics.write_mode === "dry_run" ? "Would write" : "Written"}
          value={
            diagnostics.write_mode === "dry_run"
              ? diagnostics.summaries_would_write
              : diagnostics.summaries_written
          }
        />
      </div>

      {diagnostics.no_automated_distance_feed && (
        <div style={diagnosticsEmptyStyle}>
          No automated distance report feed is active yet. Configure a provider
          report endpoint, auth profile, row path, and distance field mapping.
        </div>
      )}

      {diagnostics.setup_required && (
        <div style={diagnosticsErrorStyle}>
          Distance schema setup is required before provider trip summaries or
          asset odometer health can be stored.
        </div>
      )}

      <DiagnosticFieldBlock
        title="Odometer health"
        value={diagnostics.odometer_health_counts}
        mutedEmpty="No odometer health evidence found."
        includeZeroCounts
      />
      <DiagnosticFieldBlock
        title="Distance source"
        value={diagnostics.distance_source_counts}
        mutedEmpty="No distance source evidence found."
        includeZeroCounts
      />
      <DiagnosticFieldBlock
        title="Automated feed setup"
        value={diagnostics.setup_requirements}
        mutedEmpty="Automated distance feed setup looks complete."
      />
      <DiagnosticFieldBlock
        title="Distance notes"
        value={[
          diagnostics.table_missing ? "provider_trip_summaries table missing" : "",
          diagnostics.fleet_asset_columns_missing
            ? "fleet_assets distance columns missing"
            : "",
          diagnostics.unmatched_rows
            ? `${diagnostics.unmatched_rows} report row(s) did not match provider assets`
            : "",
          diagnostics.rows_skipped_over_cap
            ? `${diagnostics.rows_skipped_over_cap} rows skipped over processing cap`
            : "",
          ...(diagnostics.errors || []),
        ]}
        mutedEmpty="No distance setup issues detected."
      />
    </section>
  );
}

function ProviderDataDiscoveryDiagnostics({
  providerId,
  selectedCompanyId,
  canRun,
}: {
  providerId: string;
  selectedCompanyId: string;
  canRun: boolean;
}) {
  const [candidateEndpoints, setCandidateEndpoints] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<any>(null);

  if (!canRun) return null;

  async function runDiscovery() {
    setIsRunning(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Session expired. Please log in again.");
      }

      const endpoints = parseDiscoveryEndpointText(candidateEndpoints);
      const res = await fetch(`/api/providers/${providerId}/test`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
          dataDiscoveryOnly: true,
          dataDiscoveryEndpoints: endpoints,
        }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || "Data discovery failed");
      }
      setResult(payload.data_discovery_diagnostics);
    } catch (err: any) {
      alert(err.message || "Data discovery failed");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section style={diagnosticsStyle}>
      <div style={diagnosticsHeaderStyle}>
        <div>
          <div style={diagnosticsEyebrowStyle}>Provider data discovery</div>
          <h4 style={diagnosticsTitleStyle}>Data Discovery Diagnostics</h4>
        </div>
        <div style={diagnosticsMetaStyle}>diagnostic only</div>
      </div>

      <div style={diagnosticsEmptyStyle}>
        Test the configured provider endpoint and any explicit report endpoint
        candidates. This does not activate sync and does not write telemetry or
        trip summaries.
      </div>

      <div style={discoveryInputPanelStyle}>
        <div>
          <label style={labelStyle}>Candidate report endpoints</label>
          <textarea
            style={{ ...textareaStyle, minHeight: 88 }}
            value={candidateEndpoints}
            placeholder="Optional: one report/trip endpoint URL per line"
            onChange={(event) => setCandidateEndpoints(event.target.value)}
          />
          <div style={diagnosticsSmallTextStyle}>
            Leave blank to test only configured endpoints. Add BlueTrax
            report/trip URLs only after the provider supplies them.
          </div>
        </div>
        <div style={distanceImportActionRowStyle}>
          <button
            type="button"
            onClick={runDiscovery}
            disabled={isRunning}
            style={testBtn}
          >
            {isRunning ? "DISCOVERING..." : "RUN DISCOVERY"}
          </button>
        </div>
      </div>

      {result && (
        <div style={distanceImportPreviewStyle}>
          <div style={diagnosticsSummaryGridStyle}>
            <DiagnosticMetric
              label="Endpoints"
              value={result.endpoints_configured}
            />
            <DiagnosticMetric
              label="Attempted"
              value={result.endpoints_attempted}
            />
            <DiagnosticMetric
              label="Succeeded"
              value={result.endpoints_succeeded}
            />
            <DiagnosticMetric
              label="Useful fields"
              value={(result.useful_fields_detected || []).length}
            />
          </div>

          <DiagnosticFieldBlock
            title="Useful fields detected"
            value={result.useful_fields_detected}
            mutedEmpty="No useful telemetry/report fields detected yet."
          />
          <DiagnosticFieldBlock
            title="Setup blockers"
            value={result.setup_blockers}
            mutedEmpty="No setup blockers detected."
          />

          <div style={diagnosticsFeedListStyle}>
            {(result.endpoints || []).map((endpoint: any, index: number) => (
              <div key={`${endpoint.name}-${index}`} style={diagnosticsFeedStyle}>
                <div style={diagnosticsFeedHeaderStyle}>
                  <div>
                    <strong>{endpoint.name}</strong>
                    <div style={diagnosticsSmallTextStyle}>
                      {endpoint.endpoint_source} · {endpoint.auth_used}
                    </div>
                  </div>
                  <span style={feedStatusStyle(endpoint.success)}>
                    {endpoint.success ? "Reached" : "Blocked"}
                  </span>
                </div>
                <div style={diagnosticsMiniGridStyle}>
                  <DiagnosticMetric
                    compact
                    label="HTTP"
                    value={endpoint.http_status || 0}
                  />
                  <DiagnosticMetric
                    compact
                    label="Rows"
                    value={endpoint.rows_detected || 0}
                  />
                  <DiagnosticMetric
                    compact
                    label="Arrays"
                    value={Object.keys(endpoint.candidate_row_paths_found || {}).length}
                  />
                  <DiagnosticMetric
                    compact
                    label="Fields"
                    value={(endpoint.detected_useful_fields || []).length}
                  />
                </div>
                <DiagnosticFieldBlock
                  title="Endpoint tested"
                  value={[endpoint.endpoint_tested]}
                />
                <DiagnosticFieldBlock
                  title="Response shape"
                  value={[
                    endpoint.response_type
                      ? `type: ${endpoint.response_type}`
                      : "",
                    endpoint.content_type
                      ? `content-type: ${endpoint.content_type}`
                      : "",
                    endpoint.body_truncated ? "body was truncated for safety" : "",
                  ]}
                  mutedEmpty="No response shape available."
                />
                <DiagnosticFieldBlock
                  title="Top-level keys"
                  value={endpoint.top_level_keys}
                  mutedEmpty="No safe top-level keys detected."
                />
                <DiagnosticFieldBlock
                  title="Candidate row paths"
                  value={endpoint.candidate_row_paths}
                  mutedEmpty="No row paths checked."
                />
                <DiagnosticFieldBlock
                  title="Array paths found"
                  value={endpoint.candidate_row_paths_found}
                  mutedEmpty="No array paths found."
                  includeZeroCounts
                />
                <DiagnosticFieldBlock
                  title="Useful fields"
                  value={endpoint.detected_useful_fields}
                  mutedEmpty="No useful fields detected."
                />
                {endpoint.setup_blocker && (
                  <div style={diagnosticsErrorStyle}>
                    {endpoint.setup_blocker}
                  </div>
                )}
                <details style={advancedDetailsStyle}>
                  <summary style={advancedSummaryStyle}>
                    Sanitized sample shape
                    <span style={advancedSummaryHintStyle}>
                      keys and value types only
                    </span>
                  </summary>
                  <pre style={sanitizedShapeStyle}>
                    {JSON.stringify(endpoint.sanitized_sample_shape || {}, null, 2)}
                  </pre>
                </details>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function parseDiscoveryEndpointText(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((url) => ({ url, method: "GET" }));
}

function DistanceReportImport({
  providerId,
  selectedCompanyId,
  canImport,
}: {
  providerId: string;
  selectedCompanyId: string;
  canImport: boolean;
}) {
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);

  if (!canImport) return null;

  async function handleFileChange(event: any) {
    const file = event.target.files?.[0];
    setResult(null);
    if (!file) {
      setCsvText("");
      setFileName("");
      return;
    }

    setFileName(file.name || "distance-report.csv");
    setCsvText(await file.text());
  }

  async function submitDistanceImport(dryRun: boolean) {
    if (!csvText.trim()) {
      alert("Choose a distance report CSV first.");
      return;
    }

    setIsSubmitting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Session expired. Please log in again.");
      }

      const res = await fetch(`/api/providers/${providerId}/distance-import`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dryRun,
          csvText,
          fileName,
          ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
        }),
      });
      const data = await res.json();
      setResult(data);

      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || "Distance import failed");
      }

      if (!dryRun) {
        alert("✅ Distance report imported");
      }
    } catch (err: any) {
      alert(err.message || "Distance import failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  const preview = result?.preview;
  const canCommit =
    preview?.dry_run &&
    Number(preview.rows_would_write || 0) > 0 &&
    !preview.setup_required;

  return (
    <section style={diagnosticsStyle}>
      <div style={diagnosticsHeaderStyle}>
        <div>
          <div style={diagnosticsEyebrowStyle}>Distance report import</div>
          <h4 style={diagnosticsTitleStyle}>CSV Fallback / Backfill Import</h4>
          <div style={diagnosticsSmallTextStyle}>
            Use this only when an automated provider distance report feed is not
            active yet, or when backfilling historical provider report exports.
            Dry-run first, then import matched report rows into trip summaries.
          </div>
        </div>
        <div style={diagnosticsMetaStyle}>
          CSV only
        </div>
      </div>

      <div style={distanceImportPanelStyle}>
        <div>
          <label style={labelStyle}>Distance report CSV</label>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            style={fileInputStyle}
          />
          {fileName && (
            <div style={diagnosticsSmallTextStyle}>
              Selected: <strong>{fileName}</strong>
            </div>
          )}
        </div>

        <div style={distanceImportActionRowStyle}>
          <button
            type="button"
            onClick={() => submitDistanceImport(true)}
            disabled={isSubmitting || !csvText.trim()}
            style={testBtn}
          >
            {isSubmitting ? "CHECKING..." : "DRY-RUN PREVIEW"}
          </button>
          <button
            type="button"
            onClick={() => submitDistanceImport(false)}
            disabled={isSubmitting || !canCommit}
            style={{
              ...saveBtn,
              opacity: isSubmitting || !canCommit ? 0.55 : 1,
              cursor: isSubmitting || !canCommit ? "not-allowed" : "pointer",
            }}
          >
            IMPORT MATCHED ROWS
          </button>
        </div>
      </div>

      {preview && (
        <div style={distanceImportPreviewStyle}>
          <div style={diagnosticsSummaryGridStyle}>
            <DiagnosticMetric label="Rows parsed" value={preview.rows_parsed} />
            <DiagnosticMetric label="Matched assets" value={preview.matched_assets} />
            <DiagnosticMetric label="Unmatched rows" value={preview.unmatched_rows} />
            <DiagnosticMetric label="Would write" value={preview.rows_would_write} />
          </div>

          {preview.setup_required && (
            <div style={diagnosticsErrorStyle}>
              Distance schema setup is required before this report can be fully stored.
            </div>
          )}

          <DiagnosticFieldBlock
            title="Odometer health from CSV"
            value={preview.odometer_health_counts}
            mutedEmpty="No odometer health evidence found."
            includeZeroCounts
          />
          <DiagnosticFieldBlock
            title="Distance source from CSV"
            value={preview.distance_source_counts}
            mutedEmpty="No distance source evidence found."
            includeZeroCounts
          />
          <DiagnosticFieldBlock
            title="Import notes"
            value={[
              preview.static_zero_count
                ? `${preview.static_zero_count} static-zero odometer row(s)`
                : "",
              preview.static_nonzero_count
                ? `${preview.static_nonzero_count} static odometer row(s)`
                : "",
              preview.mismatch_count
                ? `${preview.mismatch_count} odometer/mileage mismatch row(s)`
                : "",
              preview.rollover_suspected_count
                ? `${preview.rollover_suspected_count} rollover-suspected row(s)`
                : "",
              preview.fleet_asset_columns_missing
                ? "fleet_assets distance columns missing"
                : "",
              ...(preview.errors || []),
            ]}
            mutedEmpty="No import warnings."
          />
          <DiagnosticFieldBlock
            title="Unmatched vehicle samples"
            value={(preview.unmatched_samples || []).map(
              (row: any) => row.truck_id || "unknown vehicle"
            )}
            mutedEmpty="All parsed report rows matched provider assets."
          />
        </div>
      )}
    </section>
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
                    {feed.distance_report
                      ? "Automated distance report feed"
                      : feed.feed_type
                        ? `Feed type: ${feed.feed_type}`
                        : feed.success
                          ? "Feed reached"
                          : feed.attempted
                            ? "Feed failed"
                            : "Not attempted"}
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

              {feed.distance_report && feed.setup_requirement && (
                <DiagnosticFieldBlock
                  title="Distance report setup"
                  value={[feed.setup_requirement]}
                  mutedEmpty="Distance report feed setup looks complete."
                />
              )}

              <DiagnosticFieldBlock
                title="Auth profile"
                value={[
                  feed.auth_profile_used
                    ? `Profile: ${feed.auth_profile_used}`
                    : "Profile: primary provider auth",
                  feed.auth_profile_attempted ? "Profile auth attempted" : "",
                  feed.auth_profile_used
                    ? `Token captured: ${feed.auth_profile_token_captured ? "yes" : "no"}`
                    : "",
                  typeof feed.auth_profile_username_override_configured === "boolean"
                    ? `Username override: ${feed.auth_profile_username_override_configured ? "configured" : "not configured"}`
                    : "",
                  feed.auth_profile_error
                    ? `Auth issue: ${feed.auth_profile_error}`
                    : "",
                ]}
                mutedEmpty="Using primary provider auth."
              />

              <DiagnosticFieldBlock
                title="Auth credential sources"
                value={[
                  feed.auth_username_source
                    ? `Username source: ${feed.auth_username_source}`
                    : "",
                  feed.auth_password_source
                    ? `Password source: ${feed.auth_password_source}`
                    : "",
                  typeof feed.auth_username_present === "boolean"
                    ? `Username present: ${feed.auth_username_present ? "yes" : "no"}`
                    : "",
                  typeof feed.auth_password_present === "boolean"
                    ? `Password present: ${feed.auth_password_present ? "yes" : "no"}`
                    : "",
                  typeof feed.auth_username_length === "number"
                    ? `Username length: ${feed.auth_username_length}`
                    : "",
                  typeof feed.auth_password_length === "number"
                    ? `Password length: ${feed.auth_password_length}`
                    : "",
                ]}
                mutedEmpty="No credential source diagnostics captured."
              />

              {canShowAvailableKeys && feed.auth_profile_metadata_available?.length > 0 && (
                <DiagnosticFieldBlock
                  title="Auth metadata available"
                  value={feed.auth_profile_metadata_available}
                  mutedEmpty="No auth metadata keys captured."
                />
              )}

              {canShowAvailableKeys && feed.auth_profile_credential_macros_available?.length > 0 && (
                <DiagnosticFieldBlock
                  title="Credential macros available"
                  value={feed.auth_profile_credential_macros_available}
                  mutedEmpty="No credential macros available."
                />
              )}

              {(feed.auth_profile_attempted ||
                feed.auth_http_status ||
                feed.auth_response_type ||
                feed.auth_top_level_keys?.length > 0 ||
                typeof feed.auth_data_is_null === "boolean" ||
                typeof feed.auth_data_is_empty_object === "boolean" ||
                feed.auth_data_keys?.length > 0 ||
                Object.keys(feed.auth_data_array_paths_found || {}).length > 0 ||
                feed.auth_data_object_paths_found?.length > 0 ||
                Object.keys(feed.auth_data_result_paths_found || {}).length > 0 ||
                feed.auth_error_keys?.length > 0 ||
                feed.auth_operation_name_sent ||
                feed.auth_payload_key_paths_sent?.length > 0 ||
                feed.auth_variable_keys_sent?.length > 0 ||
                Object.keys(feed.auth_variable_value_types || {}).length > 0 ||
                Object.keys(feed.auth_variable_value_lengths || {}).length > 0 ||
                feed.auth_token_paths_checked?.length > 0 ||
                feed.auth_metadata_paths_checked?.length > 0 ||
                feed.auth_token_candidate_paths_found?.length > 0) && (
                <>
                  <DiagnosticFieldBlock
                    title="Auth response shape"
                    value={[
                      feed.auth_http_status ? `HTTP ${feed.auth_http_status}` : "",
                      feed.auth_response_type ? `Type: ${feed.auth_response_type}` : "",
                      typeof feed.auth_data_is_null === "boolean"
                        ? `Data null: ${feed.auth_data_is_null ? "yes" : "no"}`
                        : "",
                      typeof feed.auth_data_is_empty_object === "boolean"
                        ? `Data empty object: ${feed.auth_data_is_empty_object ? "yes" : "no"}`
                        : "",
                      feed.auth_operation_name_sent
                        ? `Operation sent: ${feed.auth_operation_name_sent}`
                        : "",
                    ]}
                    mutedEmpty="No auth response shape captured."
                  />
                  <DiagnosticFieldBlock
                    title="Auth payload key paths"
                    value={feed.auth_payload_key_paths_sent}
                    mutedEmpty="No auth payload key paths captured."
                  />
                  <DiagnosticFieldBlock
                    title="Auth variable keys"
                    value={feed.auth_variable_keys_sent}
                    mutedEmpty="No auth variables captured."
                  />
                  <DiagnosticFieldBlock
                    title="Auth variable value types"
                    value={feed.auth_variable_value_types}
                    mutedEmpty="No auth variable types captured."
                    includeZeroCounts
                  />
                  <DiagnosticFieldBlock
                    title="Auth variable value lengths"
                    value={feed.auth_variable_value_lengths}
                    mutedEmpty="No auth variable lengths captured."
                    includeZeroCounts
                  />
                  <DiagnosticFieldBlock
                    title="Auth top-level keys"
                    value={feed.auth_top_level_keys}
                    mutedEmpty="No auth response keys captured."
                  />
                  <DiagnosticFieldBlock
                    title="Auth data keys"
                    value={feed.auth_data_keys}
                    mutedEmpty="No keys found under auth response data."
                  />
                  <DiagnosticFieldBlock
                    title="Auth data array paths"
                    value={feed.auth_data_array_paths_found}
                    mutedEmpty="No arrays found under auth response data."
                    includeZeroCounts
                  />
                  <DiagnosticFieldBlock
                    title="Auth data object paths"
                    value={feed.auth_data_object_paths_found}
                    mutedEmpty="No nested objects found under auth response data."
                  />
                  <DiagnosticFieldBlock
                    title="Auth data result paths"
                    value={feed.auth_data_result_paths_found}
                    mutedEmpty="No result paths found under auth response data."
                    includeZeroCounts
                  />
                  <DiagnosticFieldBlock
                    title="Auth error/status keys"
                    value={feed.auth_error_keys}
                    mutedEmpty="No GraphQL or auth error keys detected."
                  />
                  <DiagnosticFieldBlock
                    title="Token paths checked"
                    value={feed.auth_token_paths_checked}
                    mutedEmpty="No token paths checked."
                  />
                  <DiagnosticFieldBlock
                    title="Token candidate paths found"
                    value={feed.auth_token_candidate_paths_found}
                    mutedEmpty="No token-like key paths found."
                  />
                  <DiagnosticFieldBlock
                    title="Metadata paths checked"
                    value={feed.auth_metadata_paths_checked}
                    mutedEmpty="No metadata paths configured."
                  />
                </>
              )}

              <DiagnosticFieldBlock
                title="Rendered request"
                value={[
                  feed.rendered_request?.method
                    ? `Method: ${feed.rendered_request.method}`
                    : "",
                  feed.rendered_request?.url_host
                    ? `Host: ${feed.rendered_request.url_host}`
                    : "",
                  feed.rendered_request?.url_path
                    ? `Path: ${feed.rendered_request.url_path}`
                    : "",
                  feed.rendered_request?.content_type
                    ? `Content-Type: ${feed.rendered_request.content_type}`
                    : "",
                ]}
                mutedEmpty="No rendered request captured."
              />

              {canShowAvailableKeys && feed.rendered_request && (
                <>
                  <DiagnosticFieldBlock
                    title="Payload top-level keys"
                    value={feed.rendered_request.payload_top_level_keys}
                    mutedEmpty="No payload keys detected."
                  />
                  <DiagnosticFieldBlock
                    title="Payload key paths"
                    value={feed.rendered_request.payload_key_paths}
                    mutedEmpty="No nested payload paths detected."
                  />
                  <DiagnosticFieldBlock
                    title="Payload value types"
                    value={feed.rendered_request.payload_value_types}
                    mutedEmpty="No payload value types detected."
                    includeZeroCounts
                  />
                  <DiagnosticFieldBlock
                    title="Allowed request values"
                    value={feed.rendered_request.allowed_values}
                    mutedEmpty="No safe enum/date/page values detected."
                    includeZeroCounts
                  />
                </>
              )}

              <DiagnosticFieldBlock
                title="Response shape"
                value={[
                  feed.http_status ? `HTTP ${feed.http_status}` : "",
                  feed.response_type ? `Type: ${feed.response_type}` : "",
                ]}
                mutedEmpty="No response shape captured."
              />

              {canShowAvailableKeys && (
                <>
                  <DiagnosticFieldBlock
                    title="Top-level response keys"
                    value={feed.top_level_keys}
                    mutedEmpty="No object keys detected."
                  />
                  <DiagnosticFieldBlock
                    title="Candidate row paths checked"
                    value={feed.candidate_row_paths_checked}
                    mutedEmpty="No row paths checked."
                  />
                  <DiagnosticFieldBlock
                    title="Array paths found"
                    value={feed.first_array_paths_found}
                    mutedEmpty="No arrays detected in the response."
                    includeZeroCounts
                  />
                  <DiagnosticFieldBlock
                    title="Possible error/status keys"
                    value={feed.response_error_keys}
                    mutedEmpty="No error/status keys detected."
                  />
                </>
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
  const displayValue =
    typeof value === "number"
      ? Number(value || 0).toLocaleString()
      : String(value ?? "");
  return (
    <div style={compact ? diagnosticsMiniMetricStyle : diagnosticsMetricStyle}>
      <div style={diagnosticsMetricValueStyle}>{displayValue}</div>
      <div style={diagnosticsMetricLabelStyle}>{label}</div>
    </div>
  );
}

function DiagnosticFieldBlock({
  title,
  value,
  mutedEmpty = "None",
  includeZeroCounts = false,
}: {
  title: string;
  value: any;
  mutedEmpty?: string;
  includeZeroCounts?: boolean;
}) {
  const entries = normalizeDiagnosticEntries(value, includeZeroCounts);

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

function normalizeDiagnosticEntries(value: any, includeZeroCounts = false) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, entry]) => {
        if (typeof entry === "string") return entry.trim().length > 0;
        return includeZeroCounts || Number(entry || 0) > 0;
      })
      .map(([field, entry]) => {
        const display =
          typeof entry === "number"
            ? entry.toLocaleString()
            : String(entry);
        return `${field}: ${display}`;
      });
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
    <>
      <div style={formGrid}>
        <CredentialProviderFields provider={provider} form={form} setForm={setForm} />
      </div>

      <details style={advancedDetailsStyle}>
        <summary style={advancedSummaryStyle}>
          Advanced settings
          <span style={advancedSummaryHintStyle}>
            endpoints, mappings, capability profile
          </span>
        </summary>

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

          <div style={{ gridColumn: "span 2" }}>
            <label style={labelStyle}>Connection Setup</label>
            <textarea
              style={textareaStyle}
              value={typeof form.field_mapping === 'object' ? JSON.stringify(form.field_mapping, null, 2) : form.field_mapping}
              onChange={(e) => setForm({...form, field_mapping: e.target.value})}
            />
          </div>

          <div style={{ gridColumn: "span 2" }}>
            <label style={labelStyle}>Telemetry Capability Profile</label>
            <textarea
              style={textareaStyle}
              value={jsonFieldValue(form.capability_profile)}
              onChange={(e) => setForm({ ...form, capability_profile: e.target.value })}
            />
          </div>

          <div style={{ gridColumn: "span 2" }}>
            <label style={labelStyle}>Supported Signals</label>
            <textarea
              style={textareaStyle}
              value={jsonFieldValue(form.supported_signals)}
              onChange={(e) => setForm({ ...form, supported_signals: e.target.value })}
            />
          </div>

          <div>
            <label style={labelStyle}>Provider Timezone</label>
            <input
              style={inputStyle}
              value={form.provider_timezone || "Africa/Nairobi"}
              onChange={(e) => setForm({ ...form, provider_timezone: e.target.value })}
            />
          </div>

          <div>
            <label style={labelStyle}>Signal Notes</label>
            <textarea
              style={textareaStyle}
              value={jsonFieldValue(form.source_signal_notes)}
              onChange={(e) => setForm({ ...form, source_signal_notes: e.target.value })}
            />
          </div>
        </div>
      </details>
    </>
  );
}

function parseJsonObjectField(value: any, label: string) {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Throw below with a friendly field label.
  }
  throw new Error(`${label} must be a JSON object.`);
}

function jsonFieldValue(value: any) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "{}";
  return JSON.stringify(value, null, 2);
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
const feedGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 12,
};
const feedPanelStyle = {
  border: "1px solid #e2e8f0",
  backgroundColor: "#fff",
  borderRadius: 10,
  padding: 14,
};
const feedTitleStyle = {
  color: "#0f172a",
  fontSize: 14,
  fontWeight: 850,
  marginBottom: 6,
};
const panelCopyStyle = {
  margin: "0 0 12px 0",
  color: "#475569",
  fontSize: 13,
  lineHeight: 1.55,
};
const successPanelStyle = {
  ...diagnosticsStyle,
  border: "1px solid #bbf7d0",
  background: "#f0fdf4",
};
const warningPanelStyle = {
  ...diagnosticsStyle,
  border: "1px solid #fde68a",
  background: "#fffbeb",
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
const distanceImportPanelStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(240px, 1fr) auto",
  gap: 14,
  alignItems: "end",
  border: "1px solid #e2e8f0",
  backgroundColor: "#fff",
  borderRadius: 10,
  padding: 14,
  marginBottom: 14,
};
const discoveryInputPanelStyle = {
  ...distanceImportPanelStyle,
  marginTop: 14,
};
const distanceImportActionRowStyle = {
  display: "flex",
  flexWrap: "wrap" as const,
  gap: 10,
  justifyContent: "flex-end",
};
const distanceImportPreviewStyle = {
  borderTop: "1px solid #f1f5f9",
  paddingTop: 14,
  marginTop: 12,
};
const fileInputStyle = {
  width: "100%",
  border: "1px dashed #cbd5e1",
  backgroundColor: "#f8fafc",
  borderRadius: 8,
  color: "#334155",
  padding: "10px",
  fontSize: 13,
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
const sanitizedShapeStyle = {
  margin: "12px 0 0 0",
  border: "1px solid #e2e8f0",
  backgroundColor: "#0f172a",
  color: "#e2e8f0",
  borderRadius: 8,
  padding: 12,
  overflowX: "auto" as const,
  fontSize: 12,
  lineHeight: 1.5,
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
const tenantBannerStyle = { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", border: "1px solid #bae6fd", backgroundColor: "#ecfeff", borderRadius: 12, padding: 16, marginBottom: 20 };
const tenantEyebrowStyle = { fontSize: 11, fontWeight: 900, color: "#0891b2", textTransform: "uppercase" as const, letterSpacing: "0.12em", marginBottom: 4 };
const tenantTitleStyle = { color: "#0f172a", fontSize: 14, lineHeight: 1.5 };
const tenantSlugStyle = { border: "1px solid #bae6fd", backgroundColor: "#fff", color: "#0e7490", borderRadius: 999, padding: "6px 10px", fontSize: 12, fontWeight: 850, whiteSpace: "nowrap" as const };
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
const advancedDetailsStyle = { marginTop: 14, border: "1px solid #e2e8f0", backgroundColor: "#f8fafc", borderRadius: 10, padding: 14 };
const advancedSummaryStyle = { cursor: "pointer", color: "#0f172a", fontSize: 13, fontWeight: 850 };
const advancedSummaryHintStyle = { marginLeft: 10, color: "#64748b", fontSize: 12, fontWeight: 650 };
const saveBtn = { backgroundColor: "#0f172a", color: "#fff", border: "none", padding: "8px 24px", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" };
const testBtn = { backgroundColor: "#fff", color: "#0f172a", border: "1px solid #cbd5e1", padding: "8px 20px", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" };
const statusOnlyStyle = { border: "1px solid #e2e8f0", backgroundColor: "#f8fafc", color: "#64748b", borderRadius: 8, padding: 14, fontSize: 13, lineHeight: 1.6 };
const activationPanelStyle = { marginTop: 18, display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center", border: "1px solid #bae6fd", backgroundColor: "#ecfeff", borderRadius: 12, padding: 16 };
const activationEyebrowStyle = { color: "#0891b2", fontSize: 11, fontWeight: 900, textTransform: "uppercase" as const, letterSpacing: "0.12em", marginBottom: 4 };
const activationTitleStyle = { color: "#0f172a", fontSize: 15, fontWeight: 850 };
const activationCopyStyle = { margin: "6px 0 0 0", color: "#475569", fontSize: 13, lineHeight: 1.6, maxWidth: 680 };
const activationActionsStyle = { flexShrink: 0 };
const secondaryActionButtonStyle = { backgroundColor: "#fff", color: "#0f172a", border: "1px solid #cbd5e1", padding: "8px 20px", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" };
