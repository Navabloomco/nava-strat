"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  evaluateRevenueRuleMatch,
  type ClientRateRuleLike,
} from "../../../lib/finance/revenueRules";
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

const inputClass =
  "w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300";

type ManualForm = {
  open: boolean;
  loaded_quantity: string;
  offloaded_quantity: string;
  billing_quantity: string;
  rate_type: string;
  rate_amount: string;
  rate_currency: string;
  fx_rate: string;
  override_reason: string;
  revenue_notes: string;
};

const rateTypeOptions = [
  { value: "per_tonne", label: "Per tonne" },
  { value: "per_truck", label: "Per truck" },
  { value: "per_bag", label: "Per bag" },
  { value: "per_container", label: "Per container" },
  { value: "per_trip", label: "Per trip" },
  { value: "custom", label: "Custom unit" },
];

const currencyOptions = ["KES", "USD", "UGX", "TZS", "RWF", "EUR", "GBP", "ZAR"];

export default function RevenuePage() {
  const [journeys, setJourneys] = useState<any[]>([]);
  const [rateRules, setRateRules] = useState<ClientRateRuleLike[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [canEditFinance, setCanEditFinance] = useState(false);
  const [filter, setFilter] = useState("needs_review");
  const [applyingId, setApplyingId] = useState("");
  const [manualSavingId, setManualSavingId] = useState("");
  const [manualForms, setManualForms] = useState<Record<string, ManualForm>>({});

  useEffect(() => {
    loadRevenueReview();
  }, []);

  function companyQuery() {
    if (typeof window === "undefined") return "";
    const companyId = new URLSearchParams(window.location.search).get("companyId");
    return companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
  }

  async function getSessionToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return null;
    }

    return session.access_token;
  }

  async function loadRevenueReview(options: { preserveMessage?: boolean } = {}) {
    setLoading(true);
    setError("");
    if (!options.preserveMessage) setMessage("");

    const token = await getSessionToken();
    if (!token) return;

    try {
      const [revenueRes, rulesRes] = await Promise.all([
        fetch(`/api/finance/revenue${companyQuery()}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/finance/rate-rules${companyQuery()}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const revenueJson = await revenueRes.json();
      const rulesJson = await rulesRes.json();

      if (!revenueRes.ok || !revenueJson.success) {
        throw new Error(revenueJson.error || "Unable to load revenue review.");
      }
      if (!rulesRes.ok || !rulesJson.success) {
        throw new Error(rulesJson.error || "Unable to load client rate rules.");
      }

      setCompanyName(revenueJson.company?.name || rulesJson.company?.name || "");
      setCanEditFinance(Boolean(revenueJson.capabilities?.can_edit_finance));
      setJourneys(revenueJson.journeys || []);
      setRateRules(rulesJson.rate_rules || []);

      const warnings = [...(revenueJson.warnings || []), ...(rulesJson.warnings || [])];
      if (warnings.length) setMessage(Array.from(new Set(warnings)).join("\n"));
    } catch (err: any) {
      setError(err.message || "Unable to load revenue review.");
    } finally {
      setLoading(false);
    }
  }

  const reviewRows = useMemo(() => {
    return journeys.map((journey) => {
      const match = evaluateRevenueRuleMatch({ journey, rules: rateRules });
      const source = currentRevenueSource(journey);
      return {
        journey,
        match,
        source,
        needsReview:
          source !== "configured_rate" ||
          match.status !== "unique_match" ||
          !match.calculation,
      };
    });
  }, [journeys, rateRules]);

  const counts = useMemo(() => {
    return {
      total: reviewRows.length,
      needsReview: reviewRows.filter((row) => row.needsReview).length,
      missing: reviewRows.filter((row) => row.source === "missing").length,
      manual: reviewRows.filter((row) =>
        ["manual_finance_entry", "overridden"].includes(row.source)
      ).length,
      configured: reviewRows.filter((row) => row.source === "configured_rate").length,
      noRule: reviewRows.filter((row) => row.match.status === "no_rule").length,
      multiple: reviewRows.filter((row) => row.match.status === "multiple_matches").length,
    };
  }, [reviewRows]);

  const visibleRows = reviewRows.filter((row) => {
    if (filter === "all") return true;
    if (filter === "needs_review") return row.needsReview;
    if (filter === "missing") return row.source === "missing";
    if (filter === "manual") return ["manual_finance_entry", "overridden"].includes(row.source);
    if (filter === "configured") return row.source === "configured_rate";
    if (filter === "rule_issues") {
      return ["no_rule", "multiple_matches", "missing_quantity", "missing_fx"].includes(
        row.match.status
      );
    }
    return true;
  });

  async function applyConfiguredRate(journeyId: string) {
    setError("");
    setMessage("");
    setApplyingId(journeyId);

    const token = await getSessionToken();
    if (!token) return;

    try {
      const res = await fetch("/api/finance/revenue", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "apply_configured_rate",
          journeyId,
          companyId: new URLSearchParams(window.location.search).get("companyId"),
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Unable to apply matched rate.");
      }

      setMessage("Configured rate applied to Trip revenue.");
      await loadRevenueReview({ preserveMessage: true });
    } catch (err: any) {
      setError(err.message || "Unable to apply matched rate.");
    } finally {
      setApplyingId("");
    }
  }

  function toggleManualForm(journey: any) {
    setManualForms((current) => {
      const existing = current[journey.id];
      if (existing) {
        return { ...current, [journey.id]: { ...existing, open: !existing.open } };
      }
      return {
        ...current,
        [journey.id]: {
          open: true,
          loaded_quantity: valueOrEmpty(journey.loaded_quantity),
          offloaded_quantity: valueOrEmpty(journey.offloaded_quantity),
          billing_quantity: valueOrEmpty(journey.billing_quantity),
          rate_type: journey.rate_type || "per_tonne",
          rate_amount: valueOrEmpty(journey.rate_amount),
          rate_currency: journey.rate_currency || "KES",
          fx_rate: valueOrEmpty(journey.fx_rate || 1),
          override_reason: "",
          revenue_notes: journey.revenue_notes || "",
        },
      };
    });
  }

  function updateManualForm(journeyId: string, field: keyof ManualForm, value: string) {
    setManualForms((current) => ({
      ...current,
      [journeyId]: {
        ...(current[journeyId] || emptyManualForm()),
        [field]: value,
      },
    }));
  }

  async function saveManualRevenue(event: FormEvent<HTMLFormElement>, journey: any) {
    event.preventDefault();
    setError("");
    setMessage("");

    const form = manualForms[journey.id];
    if (!form?.rate_amount) {
      setError("Rate amount is required for manual finance entry.");
      return;
    }
    if (!form.override_reason.trim()) {
      setError("Add an override reason for manual finance entry.");
      return;
    }

    const token = await getSessionToken();
    if (!token) return;

    setManualSavingId(journey.id);
    try {
      const res = await fetch("/api/finance/revenue", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          journeyId: journey.id,
          companyId: new URLSearchParams(window.location.search).get("companyId"),
          loaded_quantity: Number(form.loaded_quantity || 0),
          offloaded_quantity: Number(form.offloaded_quantity || 0),
          billing_quantity: Number(form.billing_quantity || 0),
          rate_type: form.rate_type,
          rate_amount: Number(form.rate_amount || 0),
          rate_currency: form.rate_currency,
          fx_rate: form.rate_currency === "KES" ? 1 : Number(form.fx_rate || 1),
          override_reason: form.override_reason.trim(),
          revenue_notes: form.revenue_notes.trim() || null,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Unable to save manual revenue entry.");
      }

      setManualForms((current) => ({
        ...current,
        [journey.id]: { ...form, open: false },
      }));
      setMessage("Manual finance entry saved.");
      await loadRevenueReview({ preserveMessage: true });
    } catch (err: any) {
      setError(err.message || "Unable to save manual revenue entry.");
    } finally {
      setManualSavingId("");
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Loading revenue review...</div>
        </Panel>
      </main>
    );
  }

  if (error && journeys.length === 0) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <div className="mx-auto max-w-4xl">
          <EmptyState
            dark
            title="Revenue review unavailable"
            body={error}
            action={
              <Link href="/finance/dashboard">
                <PrimaryButton type="button">Back to Finance Hub</PrimaryButton>
              </Link>
            }
          />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          dark
          eyebrow="Finance control"
          title="Finance Revenue Review"
          body="Review trip quantities, match configured client rates, and apply revenue entries."
          actions={
            <Link href="/finance/rate-rules">
              <SecondaryButton type="button" className="w-full sm:w-auto">
                Manage client rate rules
              </SecondaryButton>
            </Link>
          }
        />

        <section className="mt-6 grid gap-4 md:grid-cols-4">
          <MetricCard label="Company" value={companyName || "Current company"} />
          <MetricCard label="Trips in review" value={counts.total} />
          <MetricCard label="Need review" value={counts.needsReview} />
          <MetricCard label="Configured revenue" value={counts.configured} />
        </section>

        {message && (
          <Panel dark className="mt-6 border-cyan-200/20 bg-cyan-300/10 p-4">
            <div className="whitespace-pre-wrap text-sm text-cyan-50">{message}</div>
          </Panel>
        )}
        {error && (
          <Panel dark className="mt-6 border-rose-300/25 bg-rose-400/10 p-4">
            <div className="text-sm text-rose-100">{error}</div>
          </Panel>
        )}

        <Panel dark className="mt-8 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Trip revenue queue</h2>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                Rates are configured in Client Rates. This page reviews current Trip evidence and applies matched rules.
              </p>
            </div>
            <SecondaryButton type="button" onClick={() => loadRevenueReview()}>
              Refresh
            </SecondaryButton>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <FilterButton active={filter === "needs_review"} onClick={() => setFilter("needs_review")}>
              Needs review ({counts.needsReview})
            </FilterButton>
            <FilterButton active={filter === "missing"} onClick={() => setFilter("missing")}>
              Missing revenue ({counts.missing})
            </FilterButton>
            <FilterButton active={filter === "rule_issues"} onClick={() => setFilter("rule_issues")}>
              Rule issues ({counts.noRule + counts.multiple})
            </FilterButton>
            <FilterButton active={filter === "manual"} onClick={() => setFilter("manual")}>
              Manual/override ({counts.manual})
            </FilterButton>
            <FilterButton active={filter === "configured"} onClick={() => setFilter("configured")}>
              Configured ({counts.configured})
            </FilterButton>
            <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
              All ({counts.total})
            </FilterButton>
          </div>
        </Panel>

        {journeys.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              dark
              title="No production Trips found"
              body="Create production Trips first. Finance can then review quantities, match configured rates, and apply revenue."
              action={
                <Link href="/ops/journey">
                  <PrimaryButton type="button">Open Trips</PrimaryButton>
                </Link>
              }
            />
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              dark
              title="No Trips in this filter"
              body="Choose another revenue review filter or refresh the current company queue."
            />
          </div>
        ) : (
          <section className="mt-8 grid gap-4">
            {visibleRows.map(({ journey, match, source }) => {
              const canApply =
                canEditFinance && match.status === "unique_match" && Boolean(match.calculation);
              const manualForm = manualForms[journey.id];

              return (
                <Panel key={journey.id} dark className="p-5">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="min-w-0 break-words text-lg font-semibold text-white">
                          {journey.internal_trip_id || journey.id}
                        </h3>
                        <StatusPill tone={sourceTone(source)}>
                          {sourceLabel(source)}
                        </StatusPill>
                        <StatusPill tone={matchTone(match.status)}>
                          {matchLabel(match.status)}
                        </StatusPill>
                      </div>
                      <div className="mt-3 grid gap-2 text-sm text-slate-300 md:grid-cols-2 xl:grid-cols-4">
                        <EvidenceLine label="Client" value={journey.client_name || "Client missing"} />
                        <EvidenceLine label="Route" value={routeLabel(journey)} />
                        <EvidenceLine label="Truck" value={journey.truck || "Truck missing"} />
                        <EvidenceLine label="Status" value={humanize(journey.status || "open")} />
                      </div>
                      <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                        <ReviewBox
                          label="Trip quantities"
                          value={quantitySummary(journey)}
                          note="Ops records quantities; finance reviews or corrects them."
                        />
                        <ReviewBox
                          label="Current revenue"
                          value={currentRevenueSummary(journey)}
                          note={source === "missing" ? "Revenue has not been applied yet." : sourceLabel(source)}
                        />
                        <ReviewBox
                          label="Matched rate rule"
                          value={rateRuleSummary(match)}
                          note={match.missing?.length ? `Missing: ${match.missing.join(", ")}` : "Ready when unique and complete."}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <Link href={`/ops/journey/${journey.id}`}>
                        <SecondaryButton type="button" className="w-full">
                          Open Trip Detail
                        </SecondaryButton>
                      </Link>
                      {canApply ? (
                        <PrimaryButton
                          type="button"
                          className="w-full"
                          disabled={applyingId === journey.id}
                          onClick={() => applyConfiguredRate(journey.id)}
                        >
                          {applyingId === journey.id ? "Applying..." : "Apply matched rate"}
                        </PrimaryButton>
                      ) : (
                        <div className="rounded-md border border-white/10 bg-white/[0.04] p-3 text-xs leading-5 text-slate-300">
                          {applyBlockedReason(match.status, canEditFinance)}
                        </div>
                      )}
                      {canEditFinance && (
                        <SecondaryButton
                          type="button"
                          className="w-full"
                          onClick={() => toggleManualForm(journey)}
                        >
                          {manualForm?.open ? "Close manual entry" : "Manual finance entry"}
                        </SecondaryButton>
                      )}
                    </div>
                  </div>

                  {manualForm?.open && (
                    <form
                      onSubmit={(event) => saveManualRevenue(event, journey)}
                      className="mt-5 rounded-lg border border-amber-200/20 bg-amber-300/10 p-4"
                    >
                      <div className="mb-4">
                        <h4 className="text-sm font-semibold text-amber-50">
                          Manual finance entry / override
                        </h4>
                        <p className="mt-1 text-sm leading-6 text-slate-300">
                          Use this only when a configured rule cannot be applied or finance needs a reviewed correction. Ops should not need these fields.
                        </p>
                      </div>
                      <div className="grid gap-4 md:grid-cols-3">
                        <FormField label="Loaded quantity" dark>
                          <input
                            value={manualForm.loaded_quantity}
                            onChange={(event) =>
                              updateManualForm(journey.id, "loaded_quantity", event.target.value)
                            }
                            className={inputClass}
                            inputMode="decimal"
                          />
                        </FormField>
                        <FormField label="Offloaded quantity" dark>
                          <input
                            value={manualForm.offloaded_quantity}
                            onChange={(event) =>
                              updateManualForm(journey.id, "offloaded_quantity", event.target.value)
                            }
                            className={inputClass}
                            inputMode="decimal"
                          />
                        </FormField>
                        <FormField label="Billing quantity" dark>
                          <input
                            value={manualForm.billing_quantity}
                            onChange={(event) =>
                              updateManualForm(journey.id, "billing_quantity", event.target.value)
                            }
                            className={inputClass}
                            inputMode="decimal"
                          />
                        </FormField>
                      </div>
                      <div className="mt-4 grid gap-4 md:grid-cols-4">
                        <FormField label="Rate basis" dark>
                          <select
                            value={manualForm.rate_type}
                            onChange={(event) =>
                              updateManualForm(journey.id, "rate_type", event.target.value)
                            }
                            className={inputClass}
                          >
                            {rateTypeOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </FormField>
                        <FormField label="Rate amount" dark>
                          <input
                            value={manualForm.rate_amount}
                            onChange={(event) =>
                              updateManualForm(journey.id, "rate_amount", event.target.value)
                            }
                            className={inputClass}
                            inputMode="decimal"
                            required
                          />
                        </FormField>
                        <FormField label="Currency" dark>
                          <select
                            value={manualForm.rate_currency}
                            onChange={(event) =>
                              updateManualForm(journey.id, "rate_currency", event.target.value)
                            }
                            className={inputClass}
                          >
                            {currencyOptions.map((currency) => (
                              <option key={currency} value={currency}>
                                {currency}
                              </option>
                            ))}
                          </select>
                        </FormField>
                        <FormField label="FX to KES" dark>
                          <input
                            value={manualForm.rate_currency === "KES" ? "1" : manualForm.fx_rate}
                            onChange={(event) =>
                              updateManualForm(journey.id, "fx_rate", event.target.value)
                            }
                            className={inputClass}
                            inputMode="decimal"
                            disabled={manualForm.rate_currency === "KES"}
                          />
                        </FormField>
                      </div>
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <FormField label="Override reason required" dark>
                          <input
                            value={manualForm.override_reason}
                            onChange={(event) =>
                              updateManualForm(journey.id, "override_reason", event.target.value)
                            }
                            className={inputClass}
                            placeholder="Why finance is applying this manually"
                            required
                          />
                        </FormField>
                        <FormField label="Revenue notes optional" dark>
                          <input
                            value={manualForm.revenue_notes}
                            onChange={(event) =>
                              updateManualForm(journey.id, "revenue_notes", event.target.value)
                            }
                            className={inputClass}
                            placeholder="Internal finance note"
                          />
                        </FormField>
                      </div>
                      <div className="mt-4">
                        <PrimaryButton type="submit" disabled={manualSavingId === journey.id}>
                          {manualSavingId === journey.id ? "Saving..." : "Save manual finance entry"}
                        </PrimaryButton>
                      </div>
                    </form>
                  )}
                </Panel>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: any }) {
  return (
    <Panel dark className="p-5">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </p>
      <p className="mt-2 truncate text-lg font-semibold text-white">{value}</p>
    </Panel>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-md border border-cyan-200/40 bg-cyan-300/15 px-3 py-2 text-sm font-semibold text-cyan-50"
          : "rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-300 hover:border-cyan-200/30 hover:text-white"
      }
    >
      {children}
    </button>
  );
}

function EvidenceLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-1 break-words font-medium text-slate-100">{value}</div>
    </div>
  );
}

function ReviewBox({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
      <div className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-2 break-words text-sm font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs leading-5 text-slate-400">{note}</div>
    </div>
  );
}

function currentRevenueSource(journey: any) {
  const entrySource = String(journey.latest_revenue_entry?.revenue_source || "").trim();
  if (entrySource) return entrySource;
  if (Number(journey.revenue_kes || journey.revenue_original || 0) > 0) {
    return "manual_finance_entry";
  }
  return "missing";
}

function sourceLabel(source: string) {
  if (source === "configured_rate") return "Configured rate";
  if (source === "manual_finance_entry") return "Manual finance entry";
  if (source === "overridden") return "Override";
  return "Missing revenue";
}

function sourceTone(source: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (source === "configured_rate") return "success";
  if (source === "manual_finance_entry" || source === "overridden") return "warning";
  return "danger";
}

function matchLabel(status: string) {
  return humanize(status);
}

function matchTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "unique_match") return "success";
  if (status === "missing_quantity" || status === "missing_fx") return "warning";
  if (status === "multiple_matches") return "warning";
  if (status === "no_rule") return "danger";
  return "neutral";
}

function routeLabel(journey: any) {
  const from = journey.from_location || "Origin missing";
  const to = journey.to_location || "Destination missing";
  return `${from} → ${to}`;
}

function quantitySummary(journey: any) {
  const parts = [
    `Loaded ${formatNumber(journey.loaded_quantity)}`,
    `Offloaded ${formatNumber(journey.offloaded_quantity)}`,
    `Billing ${formatNumber(journey.billing_quantity)}`,
  ];
  return parts.join(" / ");
}

function currentRevenueSummary(journey: any) {
  const entry = journey.latest_revenue_entry;
  const amount = entry?.revenue_kes ?? journey.revenue_kes;
  if (!amount) return "Not applied";
  return `KES ${formatMoney(amount)}`;
}

function rateRuleSummary(match: any) {
  if (match.status === "unique_match" && match.matches?.[0] && match.calculation) {
    const rule = match.matches[0];
    return `${formatMoney(rule.rate_amount)} ${rule.currency || "KES"} / ${humanize(rule.unit_type)} = KES ${formatMoney(match.calculation.revenue_kes)}`;
  }
  if (match.status === "multiple_matches") return `${match.matches?.length || 0} matching rules`;
  return matchLabel(match.status);
}

function applyBlockedReason(status: string, canEditFinance: boolean) {
  if (!canEditFinance) return "Read-only finance access. Finance editors can apply matched rates.";
  if (status === "no_rule") return "No configured rate rule matches this Trip yet.";
  if (status === "multiple_matches") return "Multiple matching rules found. Refine the rate rules before applying.";
  if (status === "missing_quantity") return "Required billing quantity is missing.";
  if (status === "missing_fx") return "FX rate to KES is missing for the matched rule.";
  return "Matched rate is not ready to apply.";
}

function emptyManualForm(): ManualForm {
  return {
    open: true,
    loaded_quantity: "",
    offloaded_quantity: "",
    billing_quantity: "",
    rate_type: "per_tonne",
    rate_amount: "",
    rate_currency: "KES",
    fx_rate: "1",
    override_reason: "",
    revenue_notes: "",
  };
}

function valueOrEmpty(value: any) {
  if (value === null || value === undefined || value === "") return "";
  return String(value);
}

function humanize(value: any) {
  return String(value || "not set").replace(/_/g, " ");
}

function formatNumber(value: any) {
  if (value === null || value === undefined || value === "") return "not captured";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatMoney(value: any) {
  const numeric = Number(value || 0);
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
