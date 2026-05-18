"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import {
  EmptyState,
  FormField,
  PageHeader,
  Panel,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
} from "../../components/ui/Primitives";

const assetCategories = [
  { value: "unknown", label: "Unknown" },
  { value: "truck", label: "Truck" },
  { value: "trailer", label: "Trailer" },
  { value: "van", label: "Van" },
  { value: "pickup", label: "Pickup" },
  { value: "car", label: "Car" },
  { value: "motorcycle", label: "Motorcycle" },
  { value: "equipment", label: "Equipment" },
  { value: "other", label: "Other" },
];

const excludedReasons = [
  { value: "", label: "Choose reason" },
  { value: "personal_use", label: "Personal use" },
  { value: "duplicate", label: "Duplicate" },
  { value: "inactive_device", label: "Inactive device" },
  { value: "test_device", label: "Test device" },
  { value: "sold_or_removed", label: "Sold or removed" },
  { value: "not_used_for_operations", label: "Not used for operations" },
  { value: "other", label: "Other" },
];

const inputClass =
  "w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300";

type AssetFormState = {
  asset_category: string;
  excluded_reason: string;
};

export default function AssetReviewPage() {
  const [assets, setAssets] = useState<any[]>([]);
  const [company, setCompany] = useState<any>(null);
  const [billing, setBilling] = useState<any>(null);
  const [operatingContext, setOperatingContext] = useState<any>(null);
  const [summary, setSummary] = useState({
    imported_count: 0,
    unreviewed_count: 0,
    enabled_count: 0,
    excluded_count: 0,
    disabled_count: 0,
  });
  const [forms, setForms] = useState<Record<string, AssetFormState>>({});
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadAssets();
  }, []);

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return null;
    }

    return session.access_token;
  }

  function seedForms(nextAssets: any[]) {
    const nextForms: Record<string, AssetFormState> = {};
    for (const asset of nextAssets) {
      nextForms[asset.id] = {
        asset_category: asset.asset_category || "unknown",
        excluded_reason: asset.excluded_reason || "",
      };
    }
    setForms(nextForms);
  }

  async function loadAssets() {
    setError("");
    setLoading(true);

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/fleet-assets", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load fleet assets.");
      }

      setAssets(json.assets || []);
      setCompany(json.company || null);
      setBilling(json.billing || null);
      setOperatingContext(json.operating_context || null);
      setSummary(json.summary || summary);
      seedForms(json.assets || []);
    } catch (err: any) {
      setError(err.message || "Failed to load fleet assets.");
    } finally {
      setLoading(false);
    }
  }

  function updateAssetForm(id: string, updates: Partial<AssetFormState>) {
    setForms((current) => ({
      ...current,
      [id]: {
        asset_category: current[id]?.asset_category || "unknown",
        excluded_reason: current[id]?.excluded_reason || "",
        ...updates,
      },
    }));
  }

  async function reviewAsset(id: string, action: string) {
    setActionId(id);
    setError("");
    setMessage("");

    const token = await getAccessToken();
    if (!token) return;

    const form = forms[id] || {
      asset_category: "unknown",
      excluded_reason: "",
    };

    try {
      const res = await fetch(`/api/fleet-assets/${id}`, {
        method: "PATCH",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          asset_category: form.asset_category,
          excluded_reason: form.excluded_reason,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to update asset.");
      }

      setMessage("Asset review updated.");
      await loadAssets();
    } catch (err: any) {
      setError(err.message || "Failed to update asset.");
    } finally {
      setActionId("");
    }
  }

  async function suggestClassifications() {
    setSuggesting(true);
    setError("");
    setMessage("");

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/fleet-assets/suggest-classification", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to suggest classifications.");
      }

      setMessage(
        `Classification suggestions updated for ${
          json.suggestions?.length || 0
        } asset${json.suggestions?.length === 1 ? "" : "s"}.`
      );
      await loadAssets();
    } catch (err: any) {
      setError(err.message || "Failed to suggest classifications.");
    } finally {
      setSuggesting(false);
    }
  }

  const billingPreview = useMemo(() => {
    const includedAssets = Number(billing?.included_assets || 0);
    const unitPrice = Number(billing?.asset_unit_price || 0);
    const enabledCount = Number(summary.enabled_count || 0);
    const billableAdditional = Math.max(enabledCount - includedAssets, 0);
    const estimatedMonthlyTotal = billableAdditional * unitPrice;
    const trialActive = isTrialActive(billing?.trial_starts_at, billing?.trial_ends_at);

    return {
      includedAssets,
      unitPrice,
      enabledCount,
      billableAdditional,
      estimatedMonthlyTotal,
      trialActive,
      currency: billing?.billing_currency || "KES",
    };
  }, [billing, summary.enabled_count]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Loading imported assets...</div>
        </Panel>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          dark
          eyebrow={`Fleet assets · ${company?.name || "Company workspace"}`}
          title="Asset review"
          body="Imported assets are not billed until enabled for Nava intelligence."
          actions={
            <SecondaryButton
              type="button"
              onClick={suggestClassifications}
              disabled={suggesting || assets.length === 0}
              className="w-full sm:w-auto"
            >
              {suggesting ? "Suggesting..." : "Suggest classifications"}
            </SecondaryButton>
          }
        />

        {operatingContext?.business_type && (
          <Panel dark className="mt-6 border-cyan-200/20 bg-cyan-300/10 p-4">
            <div className="text-sm leading-6 text-cyan-50">
              Suggestions consider your operating context, but review decisions stay under your control.
            </div>
          </Panel>
        )}

        {error && (
          <Panel dark className="mt-6 border-rose-300/30 bg-rose-500/10 p-4">
            <div className="text-sm text-rose-100">{error}</div>
          </Panel>
        )}

        {message && (
          <Panel dark className="mt-6 border-cyan-200/20 bg-cyan-300/10 p-4">
            <div className="text-sm text-cyan-50">{message}</div>
          </Panel>
        )}

        <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Imported assets" value={summary.imported_count} />
          <Metric label="Unreviewed" value={summary.unreviewed_count} warning={summary.unreviewed_count > 0} />
          <Metric label="Enabled intelligence vehicles" value={summary.enabled_count} />
          <Metric
            label="Excluded / disabled"
            value={summary.excluded_count + summary.disabled_count}
          />
        </section>

        <Panel dark className="mt-8 p-6">
          <div className="grid gap-5 lg:grid-cols-[1fr_1fr_1fr_1fr]">
            <BillingMetric label="Included assets" value={String(billingPreview.includedAssets)} />
            <BillingMetric
              label="Unit price"
              value={
                billingPreview.unitPrice
                  ? `${billingPreview.currency} ${billingPreview.unitPrice.toLocaleString()}`
                  : "Not configured"
              }
            />
            <BillingMetric label="Current enabled count" value={String(billingPreview.enabledCount)} />
            <BillingMetric
              label="Estimated monthly total"
              value={`${billingPreview.currency} ${billingPreview.estimatedMonthlyTotal.toLocaleString()}`}
              highlight
            />
          </div>
          <div className="mt-4 text-sm leading-6 text-slate-300">
            {billingPreview.trialActive
              ? "Trial is active. Amount due remains zero during trial, while estimates stay visible for planning."
              : "This is a planning estimate only. Nava does not create invoices or charges from this screen."}
          </div>
        </Panel>

        {assets.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              dark
              title="No imported assets yet"
              body="Assets will appear here after a provider sync imports vehicles or devices for review."
            />
          </div>
        ) : (
          <section className="mt-8 grid gap-4">
            {assets.map((asset) => {
              const form = forms[asset.id] || {
                asset_category: asset.asset_category || "unknown",
                excluded_reason: asset.excluded_reason || "",
              };
              const isUnreviewed = asset.billing_status === "unreviewed";

              return (
                <Panel
                  key={asset.id}
                  dark
                  className={
                    isUnreviewed
                      ? "border-amber-300/30 bg-amber-300/10 p-5"
                      : "p-5"
                  }
                >
                  <div className="grid gap-5 xl:grid-cols-[1.2fr_0.9fr_1.2fr]">
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="min-w-0 break-words text-lg font-semibold">
                          {asset.registration || asset.truck_id || "Unknown asset"}
                        </h2>
                        <StatusPill tone={statusTone(asset.billing_status)}>
                          {statusLabel(asset.billing_status)}
                        </StatusPill>
                        {asset.intelligence_enabled && (
                          <StatusPill tone="success">Intelligence enabled</StatusPill>
                        )}
                      </div>
                      {isUnreviewed && (
                        <div className="mt-3 rounded-md border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-50">
                          Waiting for review before this asset can appear in live tracking.
                        </div>
                      )}
                      <div className="mt-3 grid gap-2 text-sm text-slate-300 md:grid-cols-2">
                        <Detail label="Truck ID" value={asset.truck_id || "Not available"} />
                        <Detail label="Provider" value={asset.provider_name || "Not available"} />
                        <Detail label="Provider status" value={asset.status || "Not available"} />
                        <Detail label="First seen" value={formatDate(asset.first_seen_at)} />
                        <Detail label="Last seen" value={formatDate(asset.last_seen_at)} />
                        <Detail
                          label="Location"
                          value={asset.provider_location_label || "Not labeled yet"}
                        />
                      </div>
                      {asset.ai_suggested_category && (
                        <div className="mt-4 rounded-lg border border-cyan-200/20 bg-cyan-300/10 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold uppercase tracking-[0.12em] text-cyan-100">
                              Review suggestion
                            </span>
                            <StatusPill tone="info">
                              {categoryLabel(asset.ai_suggested_category)}
                            </StatusPill>
                            <span className="text-xs text-slate-300">
                              {formatConfidence(asset.ai_confidence)} confidence
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-slate-200">
                            {asset.ai_suggested_reason || "Not enough evidence"}
                          </p>
                          <p className="mt-2 text-xs leading-5 text-slate-400">
                            Review and confirm before enabling this asset for Nava intelligence.
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="grid gap-4">
                      <FormField label="Asset category" dark>
                        <select
                          value={form.asset_category}
                          onChange={(e) =>
                            updateAssetForm(asset.id, {
                              asset_category: e.target.value,
                            })
                          }
                          className={inputClass}
                        >
                          {assetCategories.map((category) => (
                            <option key={category.value} value={category.value}>
                              {category.label}
                            </option>
                          ))}
                        </select>
                      </FormField>

                      <FormField label="Excluded reason" dark>
                        <select
                          value={form.excluded_reason}
                          onChange={(e) =>
                            updateAssetForm(asset.id, {
                              excluded_reason: e.target.value,
                            })
                          }
                          className={inputClass}
                        >
                          {excludedReasons.map((reason) => (
                            <option key={reason.value} value={reason.value}>
                              {reason.label}
                            </option>
                          ))}
                        </select>
                      </FormField>
                    </div>

                    <div className="flex flex-col gap-3 xl:items-end">
                      <PrimaryButton
                        type="button"
                        onClick={() => reviewAsset(asset.id, "enable")}
                        disabled={actionId === asset.id}
                        className="w-full xl:w-auto"
                      >
                        Enable for intelligence
                      </PrimaryButton>
                      <SecondaryButton
                        type="button"
                        onClick={() => reviewAsset(asset.id, "exclude")}
                        disabled={actionId === asset.id}
                        className="w-full xl:w-auto"
                      >
                        Exclude
                      </SecondaryButton>
                      <SecondaryButton
                        type="button"
                        onClick={() => reviewAsset(asset.id, "disable")}
                        disabled={actionId === asset.id}
                        className="w-full xl:w-auto"
                      >
                        Disable
                      </SecondaryButton>
                      <SecondaryButton
                        type="button"
                        onClick={() => reviewAsset(asset.id, "review_later")}
                        disabled={actionId === asset.id}
                        className="w-full xl:w-auto"
                      >
                        Review later
                      </SecondaryButton>
                    </div>
                  </div>
                </Panel>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: number;
  warning?: boolean;
}) {
  return (
    <Panel dark className="p-4">
      <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
        {label}
      </div>
      <div
        className={
          warning
            ? "mt-3 text-3xl font-semibold text-amber-100"
            : "mt-3 text-3xl font-semibold text-white"
        }
      >
        {value.toLocaleString()}
      </div>
    </Panel>
  );
}

function BillingMetric({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </div>
      <div className={highlight ? "mt-2 text-xl font-semibold text-cyan-100" : "mt-2 text-xl font-semibold text-white"}>
        {value}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-slate-200">{value}</div>
    </div>
  );
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "enabled") return "success";
  if (status === "excluded") return "warning";
  if (status === "disabled") return "danger";
  if (status === "unreviewed") return "info";
  return "neutral";
}

function statusLabel(status: string) {
  if (status === "enabled") return "Enabled";
  if (status === "excluded") return "Excluded";
  if (status === "disabled") return "Disabled";
  if (status === "unreviewed") return "Unreviewed";
  return status || "Unknown";
}

function categoryLabel(value: string) {
  return (
    assetCategories.find((category) => category.value === value)?.label ||
    "Unknown"
  );
}

function formatConfidence(value: any) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "Low";
  return `${Math.round(numeric * 100)}%`;
}

function formatDate(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleString();
}

function isTrialActive(startsAt?: string | null, endsAt?: string | null) {
  if (!startsAt || !endsAt) return false;
  const now = Date.now();
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end;
}
