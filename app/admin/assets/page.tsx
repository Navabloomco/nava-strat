"use client";

import { useEffect, useMemo, useState } from "react";
import { isPendingAssetReview } from "../../../lib/assetReview";
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
  { value: "motorcycle", label: "Motorbike" },
  { value: "equipment", label: "Equipment" },
  { value: "other", label: "Other" },
];

const excludedReasons = [
  { value: "", label: "Choose reason" },
  { value: "personal_use", label: "Personal use" },
  { value: "duplicate", label: "Duplicate" },
  { value: "legacy_duplicate_canonical_exists", label: "Legacy duplicate; canonical truck exists" },
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
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
  const [billing, setBilling] = useState<any>(null);
  const [operatingContext, setOperatingContext] = useState<any>(null);
  const [summary, setSummary] = useState({
    imported_count: 0,
    asset_review_group_count: 0,
    raw_imported_count: 0,
    canonical_duplicate_count: 0,
    possible_collision_group_count: 0,
    possible_collision_row_count: 0,
    primary_review_count: 0,
    reviewable_primary_count: 0,
    needs_classification_count: 0,
    unreviewed_count: 0,
    unreviewed_likely_truck_count: 0,
    enabled_count: 0,
    enabled_intelligence_count: 0,
    billable_enabled_count: 0,
    excluded_count: 0,
    disabled_count: 0,
    needs_timestamp_review_count: 0,
  });
  const [forms, setForms] = useState<Record<string, AssetFormState>>({});
  const [filter, setFilter] = useState("unreviewed");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("last_seen");
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState("enable");
  const [bulkCategory, setBulkCategory] = useState("truck");
  const [bulkExcludedReason, setBulkExcludedReason] = useState("not_used_for_operations");
  const [bulkApplying, setBulkApplying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const companyId = companyIdFromLocation();
    setSelectedCompanyId(companyId);
    loadAssets(companyId);
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

  async function loadAssets(companyId = selectedCompanyId) {
    setError("");
    setLoading(true);

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch(`/api/fleet-assets${companyQuery(companyId)}`, {
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
      setIsPlatformOwner(Boolean(json.is_platform_owner));
      setBilling(json.billing || null);
      setOperatingContext(json.operating_context || null);
      setSummary(json.summary || summary);
      seedForms(json.assets || []);
      setSelectedAssetIds(new Set());
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
          ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to update asset.");
      }

      setMessage("Asset review updated.");
      await loadAssets(selectedCompanyId);
    } catch (err: any) {
      setError(err.message || "Failed to update asset.");
    } finally {
      setActionId("");
    }
  }

  function toggleAssetSelection(id: string) {
    setSelectedAssetIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectVisible() {
    setSelectedAssetIds((current) => {
      const visibleIds = filteredAssets.map((asset) => asset.id);
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.has(id));
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }

  async function applyBulkAction() {
    const selectedIds = Array.from(selectedAssetIds);
    if (selectedIds.length === 0) {
      setError("Select at least one asset first.");
      return;
    }

    const selectedAssets = assets.filter((asset) => selectedAssetIds.has(asset.id));
    const selectedProtectedCollisionRows = selectedAssets.filter(isProtectedCollisionRow);
    const selectedActiveCollisionRows = selectedAssets.filter(isCanonicalDuplicateSecondary);
    if (bulkAction === "enable") {
      if (selectedProtectedCollisionRows.length > 0) {
        setError(
          "Possible collision rows cannot be bulk-enabled. Resolve the legacy duplicate rows or enable the clean canonical truck rows instead."
        );
        return;
      }
      const preview = buildBulkEnablePreview(selectedAssets, billingPreview);
      const confirmed = window.confirm(
        [
          `Enable Nava intelligence for ${selectedIds.length} selected asset${selectedIds.length === 1 ? "" : "s"}?`,
          `Projected billable enabled count: ${preview.projectedBillableCount}.`,
          `Estimated monthly total: ${preview.currency} ${preview.estimatedMonthlyTotal.toLocaleString()}.`,
          "This is a planning estimate only.",
        ].join("\n")
      );
      if (!confirmed) return;
    } else if (bulkAction === "resolve_legacy_collision") {
      if (selectedActiveCollisionRows.length !== selectedAssets.length) {
        setError(
          "Resolve legacy collisions only applies to rows marked Possible duplicate. Clear non-collision rows from the selection first."
        );
        return;
      }
      const confirmed = window.confirm(
        [
          `Resolve ${selectedIds.length} legacy collision row${selectedIds.length === 1 ? "" : "s"}?`,
          "Only the selected old provider rows will be excluded as legacy duplicates.",
          "Clean canonical truck rows and enabled intelligence vehicles will not be changed.",
        ].join("\n")
      );
      if (!confirmed) return;
    } else {
      const confirmed = window.confirm(
        `Apply "${bulkActionLabel(bulkAction)}" to ${selectedIds.length} selected asset${selectedIds.length === 1 ? "" : "s"}?`
      );
      if (!confirmed) return;
    }

    setBulkApplying(true);
    setError("");
    setMessage("");

    try {
      const token = await getAccessToken();
      if (!token) return;

      const res = await fetch(`/api/fleet-assets${companyQuery(selectedCompanyId)}`, {
        method: "PATCH",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          asset_ids: selectedIds,
          action: bulkAction,
          asset_category: bulkCategory,
          excluded_reason:
            bulkAction === "resolve_legacy_collision"
              ? "legacy_duplicate_canonical_exists"
              : bulkExcludedReason,
          ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(
          json.error ||
            json.errors?.[0] ||
            "Failed to apply the selected bulk action."
        );
      }

      setMessage(
        `Bulk action applied to ${json.updated_count || selectedIds.length} asset${
          (json.updated_count || selectedIds.length) === 1 ? "" : "s"
        }.`
      );
      await loadAssets(selectedCompanyId);
    } catch (err: any) {
      setError(err.message || "Failed to apply the selected bulk action.");
    } finally {
      setBulkApplying(false);
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
        body: JSON.stringify(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
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
      await loadAssets(selectedCompanyId);
    } catch (err: any) {
      setError(err.message || "Failed to suggest classifications.");
    } finally {
      setSuggesting(false);
    }
  }

  const billingPreview = useMemo(() => {
    const includedAssets = Number(billing?.included_assets || 0);
    const unitPrice = Number(billing?.asset_unit_price || 0);
    const billableEnabledCount = Number(
      summary.billable_enabled_count ?? summary.enabled_count ?? 0
    );
    const billableAdditional = Math.max(billableEnabledCount - includedAssets, 0);
    const estimatedMonthlyTotal = billableAdditional * unitPrice;
    const trialActive = isTrialActive(billing?.trial_starts_at, billing?.trial_ends_at);

    return {
      includedAssets,
      unitPrice,
      billableEnabledCount,
      billableAdditional,
      estimatedMonthlyTotal,
      trialActive,
      currency: billing?.billing_currency || "KES",
    };
  }, [billing, summary.billable_enabled_count, summary.enabled_count]);

  const reviewInsights = useMemo(() => buildReviewInsights(assets), [assets]);
  const filteredAssets = useMemo(
    () =>
      sortFilteredAssets(
        assets.filter((asset) =>
          assetMatchesFilter(asset, filter, searchTerm, reviewInsights.duplicateKeys)
        ),
        sortBy
      ),
    [assets, filter, searchTerm, reviewInsights.duplicateKeys, sortBy]
  );
  const selectedCount = selectedAssetIds.size;
  const allVisibleSelected =
    filteredAssets.length > 0 &&
    filteredAssets.every((asset) => selectedAssetIds.has(asset.id));
  const selectedAssets = useMemo(
    () => assets.filter((asset) => selectedAssetIds.has(asset.id)),
    [assets, selectedAssetIds]
  );
  const selectedCollisionRows = useMemo(
    () => selectedAssets.filter(isProtectedCollisionRow),
    [selectedAssets]
  );
  const bulkEnablePreview = useMemo(
    () => buildBulkEnablePreview(selectedAssets, billingPreview),
    [selectedAssets, billingPreview]
  );

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
          body="Imported assets are not billed until they are reviewed, active, and enabled for Nava intelligence."
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

        {selectedCompanyId && isPlatformOwner && company && (
          <Panel dark className="mt-6 border-cyan-200/20 bg-cyan-300/10 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-100">
                  Platform tenant context
                </div>
                <div className="mt-1 text-sm text-cyan-50">
                  Viewing tenant: <span className="font-semibold">{company.name}</span>
                </div>
              </div>
              <StatusPill tone="info">{company.slug || "tenant"}</StatusPill>
            </div>
          </Panel>
        )}

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

        <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Metric
            label="Raw provider records"
            value={summary.raw_imported_count || assets.length}
            note="Rows imported from provider feeds"
          />
          <Metric
            label="Asset review groups"
            value={summary.asset_review_group_count || summary.imported_count}
            note="Canonical truck/device groups"
          />
          <Metric
            label="Primary review rows"
            value={summary.primary_review_count || summary.imported_count}
            note="One visible row per review group"
          />
          <Metric
            label="Unreviewed likely trucks"
            value={summary.unreviewed_likely_truck_count || summary.unreviewed_count}
            warning={(summary.unreviewed_likely_truck_count || summary.unreviewed_count) > 0}
            note="Truck candidates awaiting decision"
          />
          <Metric
            label="Enabled intelligence vehicles"
            value={summary.enabled_intelligence_count || summary.enabled_count}
            note="Unique enabled canonical assets"
          />
          <Metric
            label="Needs classification"
            value={summary.needs_classification_count || reviewInsights.needsClassification}
            warning={(summary.needs_classification_count || reviewInsights.needsClassification) > 0}
            note="Unknown, non-primary, or device-like rows"
          />
          <Metric
            label="Needs timestamp review"
            value={summary.needs_timestamp_review_count || reviewInsights.needsTimestampReview}
            warning={(summary.needs_timestamp_review_count || reviewInsights.needsTimestampReview) > 0}
            note="Invalid, missing, or suspicious timestamps"
          />
          <Metric
            label="Possible collision groups"
            value={summary.possible_collision_group_count || 0}
            warning={(summary.possible_collision_group_count || 0) > 0}
            note="Real identity conflicts only"
          />
          <Metric
            label="Excluded / disabled"
            value={summary.excluded_count + summary.disabled_count}
            note="Not active intelligence candidates"
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
            <BillingMetric
              label="Billable enabled count"
              value={String(billingPreview.billableEnabledCount)}
            />
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
          <>
            <Panel dark className="mt-8 p-5">
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-2">
                  {assetFilterTabs(reviewInsights, summary).map((tab) => (
                    <button
                      key={tab.value}
                      type="button"
                      onClick={() => setFilter(tab.value)}
                      className={
                        filter === tab.value
                          ? "rounded-full border border-cyan-200 bg-cyan-300 px-3 py-2 text-xs font-bold text-slate-950"
                          : "rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200 hover:border-cyan-200/60"
                      }
                    >
                      {tab.label} · {tab.count.toLocaleString()}
                    </button>
                  ))}
                </div>

                <div className="grid gap-3 lg:grid-cols-[1.4fr_0.8fr_auto]">
                  <input
                    type="search"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search plate, provider, category, or status"
                    className={inputClass}
                  />
                  <select
                    value={sortBy}
                    onChange={(event) => setSortBy(event.target.value)}
                    className={inputClass}
                  >
                    <option value="last_seen">Sort by last seen</option>
                    <option value="first_seen">Sort by first seen</option>
                    <option value="provider">Sort by provider</option>
                    <option value="category">Sort by category</option>
                    <option value="review_status">Sort by review status</option>
                  </select>
                  <SecondaryButton
                    type="button"
                    onClick={toggleSelectVisible}
                    className="w-full lg:w-auto"
                  >
                    {allVisibleSelected ? "Clear visible" : "Select all visible"}
                  </SecondaryButton>
                </div>

                <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                        Bulk review
                      </div>
                      <div className="mt-1 text-sm text-slate-300">
                        {selectedCount.toLocaleString()} selected. Bulk enable shows a billable planning preview before applying.
                      </div>
                    </div>
                    <select
                      value={bulkAction}
                      onChange={(event) => {
                        const nextAction = event.target.value;
                        setBulkAction(nextAction);
                        if (nextAction === "enable" && bulkCategory === "unknown") {
                          setBulkCategory("truck");
                        }
                        if (["exclude", "disable", "review_later"].includes(nextAction)) {
                          setBulkCategory("unknown");
                        }
                        if (nextAction === "resolve_legacy_collision") {
                          setBulkCategory("unknown");
                          setBulkExcludedReason("legacy_duplicate_canonical_exists");
                        }
                      }}
                      className={inputClass}
                    >
                      <option value="enable">Enable for intelligence</option>
                      <option value="resolve_legacy_collision">Resolve legacy collisions</option>
                      <option value="exclude">Exclude</option>
                      <option value="disable">Disable</option>
                      <option value="review_later">Review later</option>
                      <option value="set_category">Set category only</option>
                    </select>
                    <select
                      value={bulkCategory}
                      onChange={(event) => setBulkCategory(event.target.value)}
                      disabled={bulkAction === "resolve_legacy_collision"}
                      className={inputClass}
                    >
                      {assetCategories.map((category) => (
                        <option key={category.value} value={category.value}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={bulkExcludedReason}
                      onChange={(event) => setBulkExcludedReason(event.target.value)}
                      disabled={bulkAction === "resolve_legacy_collision"}
                      className={inputClass}
                    >
                      {excludedReasons.map((reason) => (
                        <option key={reason.value} value={reason.value}>
                          {reason.label}
                        </option>
                      ))}
                    </select>
                    <PrimaryButton
                      type="button"
                      onClick={applyBulkAction}
                      disabled={bulkApplying || selectedCount === 0}
                      className="w-full xl:w-auto"
                    >
                      {bulkApplying ? "Applying..." : "Apply to selected"}
                    </PrimaryButton>
                  </div>
                  {bulkAction === "enable" && selectedCount > 0 && (
                    <div className="mt-3 rounded-md border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm leading-6 text-amber-50">
                      Projected billable count: {bulkEnablePreview.projectedBillableCount.toLocaleString()} · Estimated monthly total: {bulkEnablePreview.currency} {bulkEnablePreview.estimatedMonthlyTotal.toLocaleString()}. Planning estimate only.
                    </div>
                  )}
                  {selectedCollisionRows.length > 0 && bulkAction === "enable" && (
                    <div className="mt-3 rounded-md border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-sm leading-6 text-rose-50">
                      {selectedCollisionRows.length.toLocaleString()} selected row{selectedCollisionRows.length === 1 ? "" : "s"} are legacy collision rows and will not be counted as new billable assets. Resolve them or select the clean canonical truck rows before enabling.
                    </div>
                  )}
                  {bulkAction === "resolve_legacy_collision" && selectedCount > 0 && (
                    <div className="mt-3 rounded-md border border-cyan-200/20 bg-cyan-300/10 px-3 py-2 text-sm leading-6 text-cyan-50">
                      This will exclude selected legacy collision rows as "Legacy duplicate; canonical truck exists." Provider labels and attached-trailer metadata stay preserved.
                    </div>
                  )}
                </div>
              </div>
            </Panel>

            <Panel dark className="mt-4 p-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <ReviewGroup label="Likely trucks" value={reviewInsights.trucks} />
                <ReviewGroup label="Cars/pickups/motorbikes" value={reviewInsights.lightVehicles} />
                <ReviewGroup label="Needs classification" value={reviewInsights.needsClassification} warning={reviewInsights.needsClassification > 0} />
                <ReviewGroup label="Timestamp needs review" value={reviewInsights.needsTimestampReview} warning={reviewInsights.needsTimestampReview > 0} />
                <ReviewGroup label="Collision rows" value={reviewInsights.duplicates} warning={reviewInsights.duplicates > 0} />
              </div>
            </Panel>

            {filteredAssets.length === 0 ? (
              <div className="mt-8">
                <EmptyState
                  dark
                  title="No assets match this review view"
                  body="Adjust the filter, search, or sort settings to continue reviewing imported assets."
                />
              </div>
            ) : (
              <section className="mt-8 grid gap-4">
                {filteredAssets.map((asset) => {
              const form = forms[asset.id] || {
                asset_category: asset.asset_category || "unknown",
                excluded_reason: asset.excluded_reason || "",
              };
              const isUnreviewed = isPendingAssetReview(asset);
              const needsTimestampReview = assetNeedsTimestampReview(asset);
              const isDuplicate = reviewInsights.duplicateKeys.has(asset.id);
              const isProtectedCollision = isProtectedCollisionRow(asset);

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
                        <input
                          type="checkbox"
                          checked={selectedAssetIds.has(asset.id)}
                          onChange={() => toggleAssetSelection(asset.id)}
                          aria-label={`Select ${asset.canonical_truck_id || asset.registration || asset.truck_id || "asset"}`}
                          className="h-4 w-4 rounded border-white/20 bg-slate-900"
                        />
                        <h2 className="min-w-0 break-words text-lg font-semibold">
                          {asset.canonical_truck_id || asset.registration || asset.truck_id || "Unknown asset"}
                        </h2>
                        <StatusPill tone={statusTone(asset.billing_status)}>
                          {statusLabel(asset.billing_status)}
                        </StatusPill>
                        {asset.intelligence_enabled && (
                          <StatusPill tone="success">Intelligence enabled</StatusPill>
                        )}
                        {needsTimestampReview && (
                          <StatusPill tone="warning">Timestamp needs review</StatusPill>
                        )}
                        {isDuplicate && (
                          <StatusPill tone="warning">Possible duplicate</StatusPill>
                        )}
                        {isResolvedLegacyCollisionRow(asset) && (
                          <StatusPill tone="neutral">Legacy duplicate resolved</StatusPill>
                        )}
                        {asset.non_primary_asset && (
                          <StatusPill tone="warning">Needs classification</StatusPill>
                        )}
                      </div>
                      {isUnreviewed && (
                        <div className="mt-3 rounded-md border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-50">
                          Waiting for review before this asset can appear in live tracking.
                        </div>
                      )}
                      {isDuplicate && (
                        <div className="mt-3 rounded-md border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-sm leading-6 text-rose-50">
                          Legacy collision row. Select it and use Resolve legacy collisions to exclude this old provider row without changing the clean canonical truck record.
                        </div>
                      )}
                      <div className="mt-3 grid gap-2 text-sm text-slate-300 md:grid-cols-2">
                        <Detail
                          label="Truck"
                          value={asset.canonical_truck_id || asset.truck_id || "Not available"}
                        />
                        <Detail
                          label="Attached trailer"
                          value={asset.attached_trailer_plate || "None reported"}
                        />
                        <Detail
                          label="Provider label"
                          value={asset.provider_label || asset.registration || "Not available"}
                        />
                        <Detail label="Provider" value={asset.provider_name || "Not available"} />
                        <Detail label="Provider status" value={asset.status || "Not available"} />
                        <Detail
                          label="Telemetry capability"
                          value={capabilityLabel(asset.telemetry_capability)}
                        />
                        <Detail label="First seen" value={formatDate(asset.first_seen_at)} />
                        <Detail label="Last seen" value={formatLastSeen(asset)} />
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
                        disabled={actionId === asset.id || isProtectedCollision}
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
          </>
        )}
      </div>
    </main>
  );
}

function companyIdFromLocation() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("companyId") || "";
}

function companyQuery(companyId: string) {
  return companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
}

function Metric({
  label,
  value,
  note,
  warning = false,
}: {
  label: string;
  value: number;
  note?: string;
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
      {note && <div className="mt-2 text-xs leading-5 text-slate-400">{note}</div>}
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

function ReviewGroup({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: number;
  warning?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className={warning ? "mt-2 text-xl font-semibold text-amber-100" : "mt-2 text-xl font-semibold text-white"}>
        {value.toLocaleString()}
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

function capabilityLabel(value: string) {
  const labels: Record<string, string> = {
    UNKNOWN: "Unknown Capability",
    GPS_ONLY: "GPS Intelligence",
    GPS_WITH_IGNITION: "Ignition-Aware GPS",
    CAN_BUS: "Engine Intelligence",
    FUEL_ROD: "Tank Intelligence",
    HYBRID_CAN_AND_FUEL_ROD: "Full Fuel Intelligence",
  };
  const key = String(value || "UNKNOWN").toUpperCase();
  return labels[key] || "Unknown Capability";
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

function formatLastSeen(asset: any) {
  const quality = getAssetTimestampQuality(asset);
  if (quality.status === "valid") return formatDate(asset.last_seen_at);
  if (quality.status === "missing") return "Last seen unavailable";
  return "Provider timestamp invalid";
}

function getAssetTimestampQuality(asset: any) {
  const quality = asset?.timestamp_quality || {};
  const status = String(quality.status || "").toLowerCase();
  if (["valid", "missing", "invalid", "suspect"].includes(status)) {
    return {
      status,
      reason: String(quality.reason || ""),
    };
  }

  if (!asset?.last_seen_at) return { status: "missing", reason: "last_seen_unavailable" };
  const lastSeen = new Date(asset.last_seen_at);
  if (Number.isNaN(lastSeen.getTime())) return { status: "invalid", reason: "unparseable" };
  if (lastSeen.getUTCFullYear() < 2000) {
    return { status: "invalid", reason: "before_2000" };
  }
  if (lastSeen.getTime() > Date.now() + 48 * 60 * 60 * 1000) {
    return { status: "invalid", reason: "future" };
  }
  if (asset.first_seen_at) {
    const firstSeen = new Date(asset.first_seen_at);
    if (
      Number.isFinite(firstSeen.getTime()) &&
      lastSeen.getTime() < firstSeen.getTime() - 24 * 60 * 60 * 1000
    ) {
      return { status: "invalid", reason: "last_seen_before_first_seen" };
    }
  }
  return { status: "valid", reason: "valid" };
}

function assetNeedsTimestampReview(asset: any) {
  return getAssetTimestampQuality(asset).status !== "valid";
}

function buildReviewInsights(assets: any[]) {
  const duplicateKeys = new Set(
    assets
      .filter(isAssetDuplicateCandidate)
      .map((asset) => asset.id)
      .filter(Boolean)
  );
  const primaryReviewAssets = assets.filter((asset) => !isCanonicalDuplicateSecondary(asset));
  const trucks = primaryReviewAssets.filter((asset) => effectiveCategory(asset) === "truck").length;
  const lightVehicles = primaryReviewAssets.filter((asset) =>
    ["car", "pickup", "motorcycle", "van"].includes(effectiveCategory(asset))
  ).length;
  const needsTimestampReview = primaryReviewAssets.filter(assetNeedsTimestampReview).length;
  const duplicates = duplicateKeys.size;
  const needsClassification = primaryReviewAssets.filter(assetNeedsClassification).length;
  const unknowns = primaryReviewAssets.filter((asset) => effectiveCategory(asset) === "unknown").length;
  const newProviderAssets = primaryReviewAssets.filter(isNewProviderAsset).length;

  return {
    trucks,
    lightVehicles,
    needsTimestampReview,
    duplicates,
    duplicateKeys,
    needsClassification,
    unknowns,
    newProviderAssets,
  };
}

function assetFilterTabs(insights: any, summary: any) {
  return [
    {
      value: "all",
      label: "Review assets",
      count: Number(summary.primary_review_count || summary.imported_count || 0),
    },
    {
      value: "unreviewed",
      label: "Unreviewed trucks",
      count: Number(summary.unreviewed_likely_truck_count || summary.unreviewed_count || 0),
    },
    {
      value: "needs_classification",
      label: "Needs classification",
      count: Number(summary.needs_classification_count || insights.needsClassification || 0),
    },
    {
      value: "enabled",
      label: "Enabled intelligence",
      count: Number(summary.enabled_intelligence_count || summary.enabled_count || 0),
    },
    {
      value: "excluded_disabled",
      label: "Excluded/disabled",
      count: Number(summary.excluded_count || 0) + Number(summary.disabled_count || 0),
    },
    {
      value: "timestamp_review",
      label: "Needs timestamp review",
      count: Number(summary.needs_timestamp_review_count || insights.needsTimestampReview || 0),
    },
    { value: "new_provider", label: "New provider assets", count: insights.newProviderAssets },
    { value: "light_vehicles", label: "Cars/pickups/motorbikes", count: insights.lightVehicles },
    { value: "trucks", label: "Trucks", count: insights.trucks },
    {
      value: "duplicates",
      label: "Possible collisions",
      count: Number(summary.possible_collision_group_count || insights.duplicates || 0),
    },
  ];
}

function assetMatchesFilter(
  asset: any,
  filter: string,
  searchTerm: string,
  duplicateKeys: Set<string>
) {
  const text = [
    asset.canonical_truck_id,
    asset.canonical_vehicle_key,
    asset.registration,
    asset.truck_id,
    asset.provider_name,
    asset.asset_category,
    asset.billing_status,
    asset.status,
    asset.provider_location_label,
    asset.attached_trailer_plate,
    asset.provider_label,
    asset.asset_identity_role,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const search = searchTerm.trim().toLowerCase();
  if (search && !text.includes(search)) return false;

  if (filter !== "duplicates" && isCanonicalDuplicateSecondary(asset)) {
    return false;
  }

  if (filter === "unreviewed") {
    return isPendingAssetReview(asset);
  }
  if (filter === "enabled") return Boolean(asset.intelligence_enabled);
  if (filter === "excluded_disabled") {
    return ["excluded", "disabled"].includes(String(asset.billing_status || ""));
  }
  if (filter === "timestamp_review") return assetNeedsTimestampReview(asset);
  if (filter === "needs_classification") return assetNeedsClassification(asset);
  if (filter === "new_provider") return isNewProviderAsset(asset);
  if (filter === "light_vehicles") {
    return ["car", "pickup", "motorcycle", "van"].includes(effectiveCategory(asset));
  }
  if (filter === "trucks") return effectiveCategory(asset) === "truck";
  if (filter === "duplicates") return duplicateKeys.has(asset.id);
  return true;
}

function sortFilteredAssets(assets: any[], sortBy: string) {
  return [...assets].sort((a, b) => {
    if (sortBy === "provider") {
      return String(a.provider_name || "").localeCompare(String(b.provider_name || ""));
    }
    if (sortBy === "category") {
      return effectiveCategory(a).localeCompare(effectiveCategory(b));
    }
    if (sortBy === "review_status") {
      return String(a.billing_status || "").localeCompare(String(b.billing_status || ""));
    }
    if (sortBy === "first_seen") {
      return safeDateMs(b.first_seen_at) - safeDateMs(a.first_seen_at);
    }
    return trustedLastSeenSortMs(b) - trustedLastSeenSortMs(a);
  });
}

function buildBulkEnablePreview(selectedAssets: any[], billingPreview: any) {
  const billableCandidates = selectedAssets.filter((asset) => !isProtectedCollisionRow(asset));
  const newlyBillable = billableCandidates.filter(
    (asset) =>
      !(
        asset.status === "active" &&
        asset.billing_status === "enabled" &&
        asset.intelligence_enabled &&
        asset.billing_enabled_at
      )
  ).length;
  const projectedBillableCount = Number(billingPreview.billableEnabledCount || 0) + newlyBillable;
  const billableAdditional = Math.max(
    projectedBillableCount - Number(billingPreview.includedAssets || 0),
    0
  );
  return {
    projectedBillableCount,
    estimatedMonthlyTotal: billableAdditional * Number(billingPreview.unitPrice || 0),
    currency: billingPreview.currency || "KES",
  };
}

function bulkActionLabel(action: string) {
  if (action === "enable") return "Enable for intelligence";
  if (action === "resolve_legacy_collision") return "Resolve legacy collisions";
  if (action === "exclude") return "Exclude";
  if (action === "disable") return "Disable";
  if (action === "review_later") return "Review later";
  if (action === "set_category") return "Set category only";
  return "Update";
}

function effectiveCategory(asset: any) {
  const category = String(asset.asset_category || asset.ai_suggested_category || "unknown").toLowerCase();
  if (asset.non_primary_asset && category === "truck") return "unknown";
  return category;
}

function assetNeedsClassification(asset: any) {
  return Boolean(asset.non_primary_asset) || effectiveCategory(asset) === "unknown";
}

function isCanonicalDuplicateSecondary(asset: any) {
  return (
    Boolean(asset.canonical_duplicate) &&
    String(asset.canonical_review_role || "").toLowerCase() === "duplicate"
  );
}

function isResolvedLegacyCollisionRow(asset: any) {
  return String(asset.excluded_reason || "").toLowerCase() === "legacy_duplicate_canonical_exists";
}

function isProtectedCollisionRow(asset: any) {
  return isCanonicalDuplicateSecondary(asset) || isResolvedLegacyCollisionRow(asset);
}

function isAssetDuplicateCandidate(asset: any) {
  return Boolean(asset.canonical_duplicate);
}

function isNewProviderAsset(asset: any) {
  const firstSeen = safeDateMs(asset.first_seen_at);
  if (!firstSeen) return isPendingAssetReview(asset);
  return Date.now() - firstSeen <= 14 * 24 * 60 * 60 * 1000;
}

function trustedLastSeenSortMs(asset: any) {
  return assetNeedsTimestampReview(asset)
    ? safeDateMs(asset.first_seen_at)
    : safeDateMs(asset.last_seen_at || asset.first_seen_at);
}

function safeDateMs(value: any) {
  const date = new Date(value || 0);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function isTrialActive(startsAt?: string | null, endsAt?: string | null) {
  if (!startsAt || !endsAt) return false;
  const now = Date.now();
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end;
}
