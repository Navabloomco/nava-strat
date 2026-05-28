"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import JourneyPicker from "../../components/JourneyPicker";
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

const unitTypeOptions = [
  { value: "tonne", label: "Per tonne" },
  { value: "truck", label: "Per truck" },
  { value: "bag", label: "Per bag" },
  { value: "container", label: "Per container" },
  { value: "trip", label: "Per trip" },
  { value: "custom", label: "Custom unit" },
];

const quantitySourceOptions = [
  { value: "loaded_quantity", label: "Loaded quantity" },
  { value: "offloaded_quantity", label: "Offloaded quantity" },
  { value: "billing_quantity", label: "Billing quantity" },
  { value: "manual_quantity", label: "Manual quantity" },
];

const fxPolicyOptions = [
  { value: "manual", label: "Manual FX" },
  { value: "company_standard", label: "Company standard FX" },
  { value: "fixed_rate", label: "Fixed rate" },
];

const statusOptions = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const currencyOptions = ["KES", "USD", "UGX", "TZS", "RWF", "EUR", "GBP", "ZAR"];

type RateRuleForm = {
  client_name: string;
  route_from: string;
  route_to: string;
  unit_type: string;
  billing_quantity_source: string;
  rate_amount: string;
  currency: string;
  fx_policy: string;
  fx_rate_to_kes: string;
  effective_from: string;
  effective_to: string;
  status: string;
  notes: string;
};

type JourneyHint = {
  id: string;
  internal_trip_id?: string | null;
  truck?: string | null;
  client_name?: string | null;
  from_location?: string | null;
  to_location?: string | null;
  status?: string | null;
  created_at?: string | null;
  loaded_quantity?: any;
  offloaded_quantity?: any;
  billing_quantity?: any;
  billing_unit?: string | null;
};

const initialForm = (): RateRuleForm => ({
  client_name: "",
  route_from: "",
  route_to: "",
  unit_type: "tonne",
  billing_quantity_source: "offloaded_quantity",
  rate_amount: "",
  currency: "KES",
  fx_policy: "manual",
  fx_rate_to_kes: "",
  effective_from: new Date().toISOString().slice(0, 10),
  effective_to: "",
  status: "active",
  notes: "",
});

export default function FinanceRateRulesPage() {
  const [rateRules, setRateRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [canEditFinance, setCanEditFinance] = useState(false);
  const [form, setForm] = useState<RateRuleForm>(initialForm);
  const [journeyHints, setJourneyHints] = useState<JourneyHint[]>([]);
  const [selectedJourneyHintId, setSelectedJourneyHintId] = useState("");
  const [routeHelperError, setRouteHelperError] = useState("");

  useEffect(() => {
    loadRateRules();
  }, []);

  const activeCount = useMemo(
    () => rateRules.filter((rule) => String(rule.status || "") === "active").length,
    [rateRules]
  );

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

  async function loadRateRules(options: { preserveMessage?: boolean } = {}) {
    setLoading(true);
    setError("");
    if (!options.preserveMessage) setMessage("");

    const token = await getSessionToken();
    if (!token) return;

    try {
      const res = await fetch(`/api/finance/rate-rules${companyQuery()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Unable to load client rate rules.");
      }

      setCompanyName(json.company?.name || "");
      const canEdit = Boolean(json.capabilities?.can_edit_finance);
      setCanEditFinance(canEdit);
      setRateRules(json.rate_rules || []);
      if (canEdit) {
        await loadJourneyHints(token);
      } else {
        setJourneyHints([]);
        setSelectedJourneyHintId("");
        setRouteHelperError("");
      }
    } catch (err: any) {
      setError(err.message || "Unable to load client rate rules.");
    } finally {
      setLoading(false);
    }
  }

  async function loadJourneyHints(token: string) {
    setRouteHelperError("");
    try {
      const res = await fetch(`/api/finance/revenue${companyQuery()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Unable to load trip route helper.");
      }

      const hints = (json.journeys || [])
        .filter(
          (journey: JourneyHint) =>
            journey.client_name || journey.from_location || journey.to_location
        )
        .slice(0, 100);

      setJourneyHints(hints);
    } catch {
      setJourneyHints([]);
      setRouteHelperError(
        "Trip route helper is unavailable. Enter client and route fields manually."
      );
    }
  }

  function updateForm(field: keyof RateRuleForm, value: string) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "currency" && value === "KES") {
        next.fx_rate_to_kes = "";
      }
      return next;
    });
  }

  function applyJourneyHint(journeyId: string, journey: JourneyHint | null) {
    setSelectedJourneyHintId(journeyId);
    if (!journey) return;

    setForm((current) => ({
      ...current,
      client_name: journey.client_name || current.client_name,
      route_from: journey.from_location || current.route_from,
      route_to: journey.to_location || current.route_to,
    }));
  }

  function validateForm() {
    const errors: string[] = [];
    const rateAmount = Number(form.rate_amount || 0);
    const fxRate = Number(form.fx_rate_to_kes || 0);

    if (!form.client_name.trim()) errors.push("Client name is required.");
    if (!form.effective_from) errors.push("Effective from date is required.");
    if (!rateAmount || rateAmount <= 0) errors.push("Rate amount must be greater than zero.");
    if (form.fx_rate_to_kes && (!fxRate || fxRate <= 0)) {
      errors.push("FX rate must be greater than zero when supplied.");
    }
    if (
      form.effective_from &&
      form.effective_to &&
      form.effective_to < form.effective_from
    ) {
      errors.push("Effective to date must be after effective from date.");
    }
    if (form.currency !== "KES" && form.fx_policy !== "manual" && !form.fx_rate_to_kes) {
      errors.push("Add an FX rate to KES for non-KES fixed or company-standard rules.");
    }

    return errors;
  }

  async function createRateRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const errors = validateForm();
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }

    const token = await getSessionToken();
    if (!token) return;

    setSaving(true);
    try {
      const res = await fetch("/api/finance/rate-rules", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...form,
          companyId: new URLSearchParams(window.location.search).get("companyId"),
          rate_amount: Number(form.rate_amount),
          fx_rate_to_kes: form.fx_rate_to_kes ? Number(form.fx_rate_to_kes) : null,
          route_from: form.route_from.trim() || null,
          route_to: form.route_to.trim() || null,
          effective_to: form.effective_to || null,
          notes: form.notes.trim() || null,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Unable to create client rate rule.");
      }

      setForm(initialForm());
      setSelectedJourneyHintId("");
      setMessage("Client rate rule created.");
      await loadRateRules({ preserveMessage: true });
    } catch (err: any) {
      setError(err.message || "Unable to create client rate rule.");
    } finally {
      setSaving(false);
    }
  }

  function formatMoney(value: any, currency = "KES") {
    const amount = Number(value || 0);
    return `${currency} ${amount.toLocaleString(undefined, {
      maximumFractionDigits: 2,
    })}`;
  }

  function humanize(value: any) {
    return String(value || "not set").replace(/_/g, " ");
  }

  function effectiveWindow(rule: any) {
    return [rule.effective_from, rule.effective_to || "open ended"].filter(Boolean).join(" to ");
  }

  function routeDisplay(fromValue: any, toValue: any, emptyLabel = "Default / all routes") {
    const from = String(fromValue || "").trim();
    const to = String(toValue || "").trim();
    if (from && to) return `${from} → ${to}`;
    if (from) return `From ${from}`;
    if (to) return `To ${to}`;
    return emptyLabel;
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Loading client rate rules...</div>
        </Panel>
      </main>
    );
  }

  if (error && rateRules.length === 0 && !canEditFinance) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <div className="mx-auto max-w-4xl">
          <EmptyState
            dark
            title="Client rates unavailable"
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
          title="Client Rates"
          body="Configure company-specific client and route revenue rules. Ops can record quantities and proof without seeing confidential rates."
          actions={
            <Link href="/finance/revenue">
              <SecondaryButton type="button" className="w-full sm:w-auto">
                Revenue Review
              </SecondaryButton>
            </Link>
          }
        />

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <Panel dark className="p-5">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
              Company
            </p>
            <p className="mt-2 truncate text-lg font-semibold text-white">
              {companyName || "Current company"}
            </p>
          </Panel>
          <Panel dark className="p-5">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
              Active rules
            </p>
            <p className="mt-2 text-lg font-semibold text-white">{activeCount}</p>
          </Panel>
          <Panel dark className="p-5">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
              Total rules
            </p>
            <p className="mt-2 text-lg font-semibold text-white">{rateRules.length}</p>
          </Panel>
        </section>

        {message && (
          <Panel dark className="mt-6 border-emerald-300/20 bg-emerald-300/10 p-4">
            <div className="text-sm text-emerald-50">{message}</div>
          </Panel>
        )}
        {error && (
          <Panel dark className="mt-6 border-rose-300/25 bg-rose-400/10 p-4">
            <div className="text-sm text-rose-100">{error}</div>
          </Panel>
        )}

        {canEditFinance ? (
          <Panel dark className="mt-8 p-6">
            <div className="mb-5">
              <h2 className="text-xl font-semibold">Create rate rule</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Use client and route text from the current company. Direction matters, so origin-to-destination can be priced differently from the reverse. FX is manual or configured here; Nava does not call external FX feeds.
              </p>
            </div>

            <form onSubmit={createRateRule} className="grid gap-5">
              {journeyHints.length > 0 && (
                <Panel dark className="border-cyan-200/20 bg-cyan-300/10 p-4">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-cyan-50">
                      Fill from an existing Trip optional
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-slate-300">
                      Selecting a Trip copies its client, From / Origin, and To / Destination into the fields below. You can still edit the rule before saving.
                    </p>
                  </div>
                  <JourneyPicker
                    journeys={journeyHints}
                    value={selectedJourneyHintId}
                    onChange={applyJourneyHint}
                    placeholder="Search trips by truck, client, route, or reference"
                  />
                </Panel>
              )}

              {routeHelperError && (
                <div className="rounded-md border border-amber-200/20 bg-amber-300/10 p-3 text-sm text-amber-50">
                  {routeHelperError}
                </div>
              )}

              <div className="grid gap-5 md:grid-cols-3">
                <FormField label="Client name" dark>
                  <input
                    value={form.client_name}
                    onChange={(event) => updateForm("client_name", event.target.value)}
                    className={inputClass}
                    placeholder="Client name"
                    required
                  />
                </FormField>
                <FormField label="From / Origin optional" dark>
                  <input
                    value={form.route_from}
                    onChange={(event) => updateForm("route_from", event.target.value)}
                    className={inputClass}
                    placeholder="Origin"
                  />
                </FormField>
                <FormField label="To / Destination optional" dark>
                  <input
                    value={form.route_to}
                    onChange={(event) => updateForm("route_to", event.target.value)}
                    className={inputClass}
                    placeholder="Destination"
                  />
                </FormField>
              </div>
              <p className="-mt-2 text-sm text-slate-400">
                Leave From / Origin and To / Destination blank for a client-wide/default rate.
              </p>

              <div className="grid gap-5 md:grid-cols-4">
                <FormField label="Unit type" dark>
                  <select
                    value={form.unit_type}
                    onChange={(event) => updateForm("unit_type", event.target.value)}
                    className={inputClass}
                  >
                    {unitTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Quantity source" dark>
                  <select
                    value={form.billing_quantity_source}
                    onChange={(event) =>
                      updateForm("billing_quantity_source", event.target.value)
                    }
                    className={inputClass}
                  >
                    {quantitySourceOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Rate amount" dark>
                  <input
                    value={form.rate_amount}
                    onChange={(event) => updateForm("rate_amount", event.target.value)}
                    className={inputClass}
                    inputMode="decimal"
                    placeholder="0.00"
                    required
                  />
                </FormField>
                <FormField label="Currency" dark>
                  <select
                    value={form.currency}
                    onChange={(event) => updateForm("currency", event.target.value)}
                    className={inputClass}
                  >
                    {currencyOptions.map((currency) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>

              <div className="grid gap-5 md:grid-cols-4">
                <FormField label="FX policy" dark>
                  <select
                    value={form.fx_policy}
                    onChange={(event) => updateForm("fx_policy", event.target.value)}
                    className={inputClass}
                  >
                    {fxPolicyOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="FX rate to KES optional" dark>
                  <input
                    value={form.fx_rate_to_kes}
                    onChange={(event) => updateForm("fx_rate_to_kes", event.target.value)}
                    className={inputClass}
                    inputMode="decimal"
                    placeholder={form.currency === "KES" ? "Not needed for KES" : "0.00"}
                    disabled={form.currency === "KES"}
                  />
                </FormField>
                <FormField label="Effective from" dark>
                  <input
                    type="date"
                    value={form.effective_from}
                    onChange={(event) => updateForm("effective_from", event.target.value)}
                    className={inputClass}
                    required
                  />
                </FormField>
                <FormField label="Effective to optional" dark>
                  <input
                    type="date"
                    value={form.effective_to}
                    onChange={(event) => updateForm("effective_to", event.target.value)}
                    className={inputClass}
                  />
                </FormField>
              </div>

              <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
                <FormField label="Status" dark>
                  <select
                    value={form.status}
                    onChange={(event) => updateForm("status", event.target.value)}
                    className={inputClass}
                  >
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Notes optional" dark>
                  <input
                    value={form.notes}
                    onChange={(event) => updateForm("notes", event.target.value)}
                    className={inputClass}
                    placeholder="Internal finance notes"
                  />
                </FormField>
              </div>

              <div>
                <PrimaryButton type="submit" disabled={saving}>
                  {saving ? "Creating..." : "Create rate rule"}
                </PrimaryButton>
              </div>
            </form>
          </Panel>
        ) : (
          <Panel dark className="mt-8 border-cyan-200/20 bg-cyan-300/10 p-5">
            <h2 className="text-lg font-semibold text-cyan-50">Read-only finance access</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              You can review client rate rules, but only finance editors, admins, and platform owners can create or change them.
            </p>
          </Panel>
        )}

        <Panel dark className="mt-8 overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Current rate rules</h2>
              <p className="mt-1 text-sm text-slate-400">
                These rules belong to the current company only.
              </p>
            </div>
            <SecondaryButton type="button" onClick={() => loadRateRules()}>
              Refresh
            </SecondaryButton>
          </div>

          {rateRules.length === 0 ? (
            <div className="p-5">
              <EmptyState
                dark
                title="No client rate rules yet"
                body="Finance can create rules by client, route, unit, effective date, currency, and FX policy."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-white/10 text-left text-sm">
                <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.12em] text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Client</th>
                    <th className="px-4 py-3 font-semibold">Route / lane</th>
                    <th className="px-4 py-3 font-semibold">Unit</th>
                    <th className="px-4 py-3 font-semibold">Quantity source</th>
                    <th className="px-4 py-3 font-semibold">Rate</th>
                    <th className="px-4 py-3 font-semibold">FX</th>
                    <th className="px-4 py-3 font-semibold">Effective window</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10 text-slate-200">
                  {rateRules.map((rule) => (
                    <tr key={rule.id} className="align-top hover:bg-white/[0.03]">
                      <td className="px-4 py-4 font-semibold text-white">
                        {rule.client_name}
                      </td>
                      <td className="px-4 py-4">{routeDisplay(rule.route_from, rule.route_to)}</td>
                      <td className="px-4 py-4 capitalize">{humanize(rule.unit_type)}</td>
                      <td className="px-4 py-4 capitalize">
                        {humanize(rule.billing_quantity_source)}
                      </td>
                      <td className="px-4 py-4 font-semibold text-cyan-100">
                        {formatMoney(rule.rate_amount, rule.currency)}
                      </td>
                      <td className="px-4 py-4">
                        <div className="capitalize">{humanize(rule.fx_policy)}</div>
                        {rule.currency === "KES" ? (
                          <div className="mt-1 text-xs text-slate-400">KES base</div>
                        ) : rule.fx_rate_to_kes ? (
                          <div className="mt-1 text-xs text-slate-400">
                            {Number(rule.fx_rate_to_kes).toLocaleString()} to KES
                          </div>
                        ) : (
                          <div className="mt-1 text-xs text-amber-100">FX needed</div>
                        )}
                      </td>
                      <td className="px-4 py-4">{effectiveWindow(rule)}</td>
                      <td className="px-4 py-4">
                        <StatusPill tone={rule.status === "active" ? "success" : "neutral"}>
                          {humanize(rule.status)}
                        </StatusPill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </main>
  );
}
