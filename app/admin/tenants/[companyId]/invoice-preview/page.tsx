"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "../../../../../lib/supabase";
import {
  PageHeader,
  Panel,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
} from "../../../../components/ui/Primitives";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMoney(value: number | null, currency = "KES") {
  if (value === null || value === undefined) return "Pricing not set";

  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Date(value).toLocaleDateString();
}

const inputClass =
  "w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300";

export default function TenantInvoicePreviewPage() {
  const params = useParams();
  const companyId = Array.isArray(params.companyId)
    ? params.companyId[0]
    : params.companyId;

  const [period, setPeriod] = useState(currentMonth());
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (companyId) loadPreview(companyId, period);
  }, [companyId, period]);

  async function getToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return null;
    }

    return session.access_token;
  }

  async function loadPreview(id: string, billingPeriod: string) {
    setLoading(true);
    setError("");

    const token = await getToken();
    if (!token) return;

    try {
      const res = await fetch(
        `/api/admin/tenants/${id}/invoice-preview?period=${encodeURIComponent(
          billingPeriod
        )}`,
        {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load invoice preview.");
      }

      setPreview(json.invoice_preview || null);
    } catch (err: any) {
      setError(err.message || "Failed to load invoice preview.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Loading invoice preview...</div>
        </Panel>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <div className="mx-auto max-w-4xl">
          <Panel dark className="border-rose-300/30 bg-rose-500/10 p-6">
            <StatusPill tone="danger">Platform only</StatusPill>
            <h1 className="mt-4 text-2xl font-semibold text-white">
              Invoice preview unavailable
            </h1>
            <p className="mt-3 text-sm leading-6 text-rose-100">{error}</p>
            <div className="mt-5">
              <Link href={`/admin/tenants/${companyId || ""}`}>
                <PrimaryButton type="button">Back to Tenant</PrimaryButton>
              </Link>
            </div>
          </Panel>
        </div>
      </main>
    );
  }

  const company = preview?.company || {};
  const currency = preview?.billing_currency || "KES";

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          dark
          eyebrow="Manual invoice preview"
          title={company.name || "Tenant invoice preview"}
          body="Preview tenant billing from strict billable intelligence vehicles. This does not create an invoice, send email, export a PDF, or update payment status."
          actions={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link href={`/admin/tenants/${companyId || ""}`}>
                <SecondaryButton type="button" className="w-full sm:w-auto">
                  Back to Tenant
                </SecondaryButton>
              </Link>
              <PrimaryButton
                type="button"
                onClick={() => companyId && loadPreview(companyId, period)}
                className="w-full sm:w-auto"
              >
                Refresh
              </PrimaryButton>
            </div>
          }
        />

        <section className="mt-6 grid gap-4 lg:grid-cols-[1fr_1.5fr]">
          <Panel dark className="p-5">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill tone="info">Preview only</StatusPill>
              {!preview?.pricing_set && (
                <StatusPill tone="warning">Pricing not set</StatusPill>
              )}
              {preview?.strict_billable_asset_count === 0 && (
                <StatusPill tone="warning">No billable assets</StatusPill>
              )}
            </div>

            <div className="mt-5 grid gap-3">
              <KeyValue label="Company slug" value={company.slug || "Not set"} />
              <KeyValue label="Currency" value={currency} />
              <KeyValue
                label="Period start"
                value={formatDate(preview?.period_start || null)}
              />
              <KeyValue
                label="Period end"
                value={formatDate(preview?.period_end || null)}
              />
            </div>

            <label className="mt-5 block">
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                Billing period
              </span>
              <input
                type="month"
                value={period}
                onChange={(event) => setPeriod(event.target.value || currentMonth())}
                className={`${inputClass} mt-2`}
              />
            </label>
          </Panel>

          <Panel dark className="p-5">
            <h2 className="text-lg font-semibold text-white">
              Estimated monthly total
            </h2>
            <div className="mt-3 text-4xl font-semibold text-cyan-100">
              {formatMoney(preview?.estimated_monthly_total ?? null, currency)}
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              {preview?.note || "Preview only. No invoice has been created."}
            </p>

            {preview?.readiness_warnings?.length > 0 && (
              <div className="mt-5 rounded-md border border-amber-300/30 bg-amber-300/10 p-4">
                <div className="text-sm font-semibold text-amber-100">
                  Readiness warnings
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-100">
                  {preview.readiness_warnings.map((warning: string) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-4">
          <Metric label="Imported assets" value={preview?.imported_asset_count || 0} />
          <Metric
            label="Strict billable"
            value={preview?.strict_billable_asset_count || 0}
          />
          <Metric label="Included assets" value={preview?.included_assets || 0} />
          <Metric
            label="Extra billable"
            value={preview?.extra_billable_assets || 0}
          />
        </section>

        <Panel dark className="mt-8 overflow-hidden">
          <div className="border-b border-white/10 px-5 py-4">
            <h2 className="text-lg font-semibold text-white">Line items</h2>
          </div>
          <div className="divide-y divide-white/10">
            {(preview?.line_items || []).map((item: any) => (
              <div
                key={item.label}
                className="grid gap-3 px-5 py-4 lg:grid-cols-[1.5fr_120px_160px_160px] lg:items-start"
              >
                <div>
                  <div className="font-semibold text-white">{item.label}</div>
                  <div className="mt-1 text-sm leading-6 text-slate-400">
                    {item.description}
                  </div>
                  {item.included_used !== undefined && (
                    <div className="mt-1 text-xs text-slate-500">
                      Used by current billable fleet: {item.included_used}
                    </div>
                  )}
                </div>
                <LineValue label="Quantity" value={item.quantity} />
                <LineValue
                  label="Unit price"
                  value={formatMoney(item.unit_price, currency)}
                />
                <LineValue
                  label="Amount"
                  value={formatMoney(item.amount, currency)}
                />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </main>
  );
}

function KeyValue({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-md border border-white/10 bg-slate-950/50 p-3">
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-semibold text-white">
        {String(value)}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <Panel dark className="p-5">
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    </Panel>
  );
}

function LineValue({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}
