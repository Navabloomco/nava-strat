"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import {
  EmptyState,
  PageHeader,
  Panel,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
} from "../../components/ui/Primitives";

type ReadinessStatus =
  | "ready"
  | "needs_assets"
  | "needs_provider"
  | "needs_billing_setup";

function readinessTone(status: ReadinessStatus) {
  if (status === "ready") return "success";
  if (status === "needs_billing_setup") return "warning";
  return "info";
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
  if (!value) return "No telemetry yet";
  return new Date(value).toLocaleString();
}

export default function PlatformTenantsPage() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadTenants();
  }, []);

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

  async function loadTenants() {
    setLoading(true);
    setError("");

    const token = await getToken();
    if (!token) return;

    try {
      const res = await fetch("/api/admin/tenants", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load tenants.");
      }

      setTenants(json.tenants || []);
      setTotals(json.totals || null);
    } catch (err: any) {
      setError(err.message || "Failed to load tenants.");
    } finally {
      setLoading(false);
    }
  }

  const estimatedRevenueLabel = useMemo(
    () => formatRevenueTotals(totals?.estimated_monthly_revenue_by_currency || {}),
    [totals]
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Loading tenant billing preview...</div>
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
              Tenant billing preview unavailable
            </h1>
            <p className="mt-3 text-sm leading-6 text-rose-100">{error}</p>
            <div className="mt-5">
              <Link href="/admin">
                <PrimaryButton type="button">Back to Admin Hub</PrimaryButton>
              </Link>
            </div>
          </Panel>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          dark
          eyebrow="Platform billing"
          title="Tenant Billing Preview"
          body="Estimate pilot billing readiness from reviewed, active, intelligence-enabled assets. This is an internal preview only; it does not create invoices."
          actions={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link href="/admin">
                <SecondaryButton type="button" className="w-full sm:w-auto">
                  Back to Admin Hub
                </SecondaryButton>
              </Link>
              <PrimaryButton
                type="button"
                onClick={loadTenants}
                className="w-full sm:w-auto"
              >
                Refresh
              </PrimaryButton>
            </div>
          }
        />

        <section className="mt-6 grid gap-4 md:grid-cols-4">
          <SummaryCard label="Tenants" value={totals?.tenant_count || 0} />
          <SummaryCard
            label="Imported assets"
            value={totals?.imported_asset_count || 0}
          />
          <SummaryCard
            label="Strict billable"
            value={totals?.strict_billable_asset_count || 0}
          />
          <SummaryCard
            label="Estimated monthly"
            value={estimatedRevenueLabel}
          />
        </section>

        {tenants.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              dark
              title="No tenants yet"
              body="Tenant billing preview appears after companies are created."
            />
          </div>
        ) : (
          <section className="mt-8 grid gap-4">
            {tenants.map((tenant) => (
              <Panel key={tenant.company.id} dark className="p-5">
                <div className="grid gap-5 lg:grid-cols-[1.4fr_2fr_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-xl font-semibold text-white">
                        {tenant.company.name}
                      </h2>
                      <StatusPill
                        tone={readinessTone(tenant.setup_readiness.status)}
                      >
                        {tenant.setup_readiness.label}
                      </StatusPill>
                    </div>
                    <div className="mt-2 text-sm text-slate-400">
                      {tenant.company.slug}
                    </div>
                    <div className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                      {tenant.company.subscription_plan || "Plan not set"}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Metric label="Members" value={tenant.active_member_count} />
                    <Metric label="Providers" value={tenant.provider_count} />
                    <Metric
                      label="Imported"
                      value={tenant.imported_asset_count}
                    />
                    <Metric
                      label="Billable"
                      value={tenant.strict_billable_asset_count}
                    />
                  </div>

                  <div className="grid gap-3 lg:min-w-[220px] lg:text-right">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                        Revenue preview
                      </div>
                      <div className="mt-1 text-lg font-semibold text-cyan-100">
                        {tenant.pricing.pricing_set
                          ? formatMoney(
                              tenant.estimated_monthly_revenue,
                              tenant.pricing.billing_currency
                            )
                          : "Pricing not set"}
                      </div>
                    </div>
                    <div className="text-xs leading-5 text-slate-500">
                      Last telemetry: {formatDate(tenant.last_telemetry_at)}
                    </div>
                    <Link href={`/admin/tenants/${tenant.company.id}`}>
                      <SecondaryButton type="button" className="w-full">
                        View Tenant
                      </SecondaryButton>
                    </Link>
                  </div>
                </div>
              </Panel>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: any }) {
  return (
    <Panel dark className="p-5">
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    </Panel>
  );
}

function formatRevenueTotals(totalsByCurrency: Record<string, number>) {
  const entries = Object.entries(totalsByCurrency).filter(([, value]) => value > 0);
  if (entries.length === 0) return "Pricing not set";
  if (entries.length === 1) {
    const [currency, value] = entries[0];
    return formatMoney(value, currency);
  }
  return `${entries.length} currencies`;
}

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-md border border-white/10 bg-slate-950/50 p-3">
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}
