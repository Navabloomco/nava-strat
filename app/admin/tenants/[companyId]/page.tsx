"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import {
  EmptyState,
  PageHeader,
  Panel,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
} from "../../../components/ui/Primitives";

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
  if (!value) return "None yet";
  return new Date(value).toLocaleString();
}

function formatContextValue(value: any) {
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "Not set";
  return value || "Not set";
}

export default function PlatformTenantDetailPage() {
  const params = useParams();
  const companyId = Array.isArray(params.companyId)
    ? params.companyId[0]
    : params.companyId;

  const [tenant, setTenant] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [invoiceSetupMessage, setInvoiceSetupMessage] = useState("");
  const [invoiceActionId, setInvoiceActionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (companyId) loadTenant(companyId);
  }, [companyId]);

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

  async function loadTenant(id: string) {
    setLoading(true);
    setError("");

    const token = await getToken();
    if (!token) return;

    try {
      const [tenantRes, invoicesRes] = await Promise.all([
        fetch(`/api/admin/tenants/${id}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
        fetch(`/api/admin/tenants/${id}/invoices`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
      ]);
      const json = await tenantRes.json();

      if (!tenantRes.ok || !json.success) {
        throw new Error(json.error || "Failed to load tenant.");
      }

      setTenant(json);

      const invoiceJson = await invoicesRes.json();
      if (invoicesRes.ok && invoiceJson.success) {
        setInvoices(invoiceJson.invoices || []);
        setInvoiceSetupMessage(invoiceJson.setup_message || "");
      } else {
        setInvoices([]);
        setInvoiceSetupMessage(invoiceJson.error || "Unable to load invoices.");
      }
    } catch (err: any) {
      setError(err.message || "Failed to load tenant.");
    } finally {
      setLoading(false);
    }
  }

  async function updateInvoiceStatus(invoiceId: string, status: string) {
    if (!companyId) return;

    setInvoiceActionId(invoiceId);
    setError("");

    const token = await getToken();
    if (!token) {
      setInvoiceActionId("");
      return;
    }

    try {
      const res = await fetch(
        `/api/admin/tenants/${companyId}/invoices/${invoiceId}`,
        {
          method: "PATCH",
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status }),
        }
      );
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to update invoice.");
      }

      await loadTenant(companyId);
    } catch (err: any) {
      setError(err.message || "Failed to update invoice.");
    } finally {
      setInvoiceActionId("");
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Loading tenant readiness...</div>
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
              Tenant readiness unavailable
            </h1>
            <p className="mt-3 text-sm leading-6 text-rose-100">{error}</p>
            <div className="mt-5">
              <Link href="/admin/tenants">
                <PrimaryButton type="button">Back to Tenants</PrimaryButton>
              </Link>
            </div>
          </Panel>
        </div>
      </main>
    );
  }

  if (!tenant) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <EmptyState
          dark
          title="Tenant not found"
          body="This company could not be loaded from the platform tenant preview."
          action={
            <Link href="/admin/tenants">
              <PrimaryButton type="button">Back to Tenants</PrimaryButton>
            </Link>
          }
        />
      </main>
    );
  }

  const company = tenant.company || {};
  const pricing = tenant.pricing || {};
  const summary = tenant.asset_billing_summary || {};
  const context = tenant.operating_context || {};
  const readiness = tenant.setup_readiness || {
    status: "needs_assets",
    label: "Needs assets",
  };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          dark
          eyebrow="Tenant readiness"
          title={company.name || "Tenant"}
          body="Internal platform view for pilot billing readiness, provider setup, asset review, and telemetry freshness."
          actions={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link href={`/admin/tenants/${companyId || ""}/invoice-preview`}>
                <PrimaryButton type="button" className="w-full sm:w-auto">
                  Invoice Preview
                </PrimaryButton>
              </Link>
              <Link href="/admin/tenants">
                <SecondaryButton type="button" className="w-full sm:w-auto">
                  Back to Tenants
                </SecondaryButton>
              </Link>
              <SecondaryButton
                type="button"
                onClick={() => companyId && loadTenant(companyId)}
                className="w-full sm:w-auto"
              >
                Refresh
              </SecondaryButton>
            </div>
          }
        />

        <section className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_2fr]">
          <Panel dark className="p-5">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill tone={readinessTone(readiness.status)}>
                {readiness.label}
              </StatusPill>
              <StatusPill tone="neutral">
                {company.subscription_plan || "Plan not set"}
              </StatusPill>
            </div>
            <div className="mt-5 grid gap-3">
              <KeyValue label="Slug" value={company.slug || "Not set"} />
              <KeyValue label="Status" value={company.status || "Not available"} />
              <KeyValue
                label="Active members"
                value={tenant.members?.active_member_count || 0}
              />
              <KeyValue
                label="Latest telemetry"
                value={formatDate(tenant.telemetry?.latest_recorded_at || null)}
              />
              <KeyValue
                label={`Telemetry last ${tenant.telemetry?.recent_window_hours || 24}h`}
                value={tenant.telemetry?.recent_count || 0}
              />
            </div>
          </Panel>

          <Panel dark className="p-5">
            <h2 className="text-lg font-semibold text-white">
              Billing preview
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Strict billable assets must be active, enabled for billing, enabled
              for intelligence, and have a billing enabled timestamp.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Imported" value={summary.imported_asset_count || 0} />
              <Metric
                label="Enabled intelligence"
                value={summary.enabled_intelligence_count || 0}
              />
              <Metric
                label="Strict billable"
                value={summary.strict_billable_asset_count || 0}
              />
              <Metric
                label="Estimated monthly"
                value={
                  pricing.pricing_set
                    ? formatMoney(
                        pricing.estimated_monthly_revenue,
                        pricing.billing_currency
                      )
                    : "Pricing not set"
                }
              />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Metric label="Unreviewed" value={summary.unreviewed_asset_count || 0} />
              <Metric label="Excluded" value={summary.excluded_asset_count || 0} />
              <Metric label="Disabled" value={summary.disabled_asset_count || 0} />
            </div>
            <div className="mt-5">
              <Link href={`/admin/tenants/${companyId || ""}/invoice-preview`}>
                <PrimaryButton type="button" className="w-full sm:w-auto">
                  Open Invoice Preview
                </PrimaryButton>
              </Link>
            </div>
          </Panel>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <Panel dark className="p-5">
            <h2 className="text-lg font-semibold text-white">
              Operating context
            </h2>
            <div className="mt-5 grid gap-3">
              <KeyValue label="Business type" value={formatContextValue(context.business_type)} />
              <KeyValue
                label="Primary asset types"
                value={formatContextValue(context.primary_asset_types)}
              />
              <KeyValue
                label="Main billing unit"
                value={formatContextValue(context.main_billing_unit)}
              />
              <KeyValue
                label="Operating regions"
                value={formatContextValue(context.operating_regions)}
              />
              <KeyValue
                label="Primary use case"
                value={formatContextValue(context.primary_use_case)}
              />
            </div>
          </Panel>

          <Panel dark className="p-5">
            <h2 className="text-lg font-semibold text-white">
              Members by role
            </h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {Object.entries(tenant.members?.by_role || {}).map(([role, count]) => (
                <Metric key={role} label={role.replaceAll("_", " ")} value={count} />
              ))}
            </div>
          </Panel>
        </section>

        <section className="mt-8 grid gap-6">
          <Panel dark className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Recent invoices
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Draft, sent, paid, and void tracking for this tenant. No PDF,
                  Stripe, or email sending is attached.
                </p>
              </div>
              <Link href={`/admin/tenants/${companyId || ""}/invoice-preview`}>
                <PrimaryButton type="button" className="w-full sm:w-auto">
                  Create from Preview
                </PrimaryButton>
              </Link>
            </div>

            {invoiceSetupMessage ? (
              <div className="border-b border-amber-300/20 bg-amber-300/10 px-5 py-4 text-sm leading-6 text-amber-100">
                {invoiceSetupMessage}
              </div>
            ) : null}

            {invoices.length > 0 ? (
              <div className="divide-y divide-white/10">
                {invoices.slice(0, 8).map((invoice) => (
                  <div
                    key={invoice.id}
                    className="grid gap-4 px-5 py-4 xl:grid-cols-[1.2fr_1fr_1fr_auto] xl:items-center"
                  >
                    <div>
                      <div className="font-semibold text-white">
                        {invoice.invoice_number || "Draft invoice"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {formatDate(invoice.period_start)} to{" "}
                        {formatDate(invoice.period_end)}
                      </div>
                    </div>
                    <div>
                      <StatusPill tone={invoiceStatusTone(invoice.status)}>
                        {String(invoice.status || "draft").toUpperCase()}
                      </StatusPill>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-cyan-100">
                        {formatMoney(invoice.total || 0, invoice.currency || "KES")}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {invoice.extra_billable_assets || 0} extra vehicles
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 xl:justify-end">
                      {invoice.status === "draft" && (
                        <SecondaryButton
                          type="button"
                          disabled={invoiceActionId === invoice.id}
                          onClick={() => updateInvoiceStatus(invoice.id, "sent")}
                        >
                          Mark Sent
                        </SecondaryButton>
                      )}
                      {invoice.status === "sent" && (
                        <SecondaryButton
                          type="button"
                          disabled={invoiceActionId === invoice.id}
                          onClick={() => updateInvoiceStatus(invoice.id, "paid")}
                        >
                          Mark Paid
                        </SecondaryButton>
                      )}
                      {(invoice.status === "draft" || invoice.status === "sent") && (
                        <SecondaryButton
                          type="button"
                          disabled={invoiceActionId === invoice.id}
                          onClick={() => updateInvoiceStatus(invoice.id, "void")}
                        >
                          Void
                        </SecondaryButton>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-5 text-sm text-slate-400">
                {invoiceSetupMessage
                  ? "Invoice records will appear here after the billing_invoices setup SQL has been applied."
                  : "No invoice records yet. Create the first draft from invoice preview when the tenant is ready."}
              </div>
            )}
          </Panel>

          <Panel dark className="overflow-hidden">
            <div className="border-b border-white/10 px-5 py-4">
              <h2 className="text-lg font-semibold text-white">
                Provider summary
              </h2>
            </div>
            {tenant.providers?.length ? (
              <div className="divide-y divide-white/10">
                {tenant.providers.map((provider: any) => (
                  <div
                    key={provider.id}
                    className="grid gap-3 px-5 py-4 lg:grid-cols-[1.2fr_1fr_1fr_1fr] lg:items-center"
                  >
                    <div>
                      <div className="font-semibold text-white">
                        {provider.provider_name || "Unnamed provider"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {provider.provider_slug || "No slug"}
                      </div>
                    </div>
                    <div>
                      <StatusPill tone={provider.is_active ? "success" : "neutral"}>
                        {provider.is_active ? "Active" : "Inactive"}
                      </StatusPill>
                    </div>
                    <div className="text-sm text-slate-300">
                      Last sync: {formatDate(provider.last_sync_at)}
                    </div>
                    <div className="text-sm text-slate-300">
                      Status: {provider.last_status || "Not available"}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-5 text-sm text-slate-400">
                No provider connected for this tenant.
              </div>
            )}
          </Panel>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <AdminContextLink
            title="Asset Review"
            body="Review imported assets for this tenant before enabling intelligence and billing readiness."
            href={tenant.links?.asset_review}
          />
          <AdminContextLink
            title="Provider Vault"
            body="Open provider setup, tests, sync status, and enrichment diagnostics in this tenant context."
            href={tenant.links?.provider_vault}
          />
          <AdminContextLink
            title="Company Settings"
            body="Update operating context for this tenant without changing the active platform workspace manually."
            href={tenant.links?.company_settings}
          />
        </section>
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
    <div className="rounded-md border border-white/10 bg-slate-950/50 p-3">
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function AdminContextLink({
  title,
  body,
  href,
}: {
  title: string;
  body: string;
  href?: string | null;
}) {
  return (
    <Link href={href || "/admin/tenants"} className="group block">
      <Panel
        dark
        className="h-full p-5 transition group-hover:border-cyan-200/40 group-hover:bg-cyan-300/10"
      >
        <h2 className="text-base font-semibold text-white">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
        <div className="mt-4 text-sm font-semibold text-cyan-100">Open</div>
      </Panel>
    </Link>
  );
}

function invoiceStatusTone(status: string) {
  if (status === "paid") return "success";
  if (status === "sent") return "info";
  if (status === "void") return "danger";
  return "warning";
}
