"use client";

import { useEffect, useMemo, useState } from "react";
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

const CATEGORY_ORDER = [
  "Company setup",
  "Provider setup",
  "Asset review",
  "Billing readiness",
  "Role/security readiness",
  "Operations readiness",
  "Nava Eye readiness",
];

function readinessTone(status: string) {
  if (status === "ready") return "success";
  if (status === "needs_attention") return "warning";
  return "danger";
}

function checkTone(status: string) {
  if (status === "pass") return "success";
  if (status === "warning") return "warning";
  return "danger";
}

function checkLabel(status: string) {
  if (status === "pass") return "Pass";
  if (status === "warning") return "Warning";
  return "Fail";
}

function formatDate(value: string | null) {
  if (!value) return "None yet";
  return new Date(value).toLocaleString();
}

export default function PilotReadinessDetailPage() {
  const params = useParams();
  const companyId = Array.isArray(params.companyId)
    ? params.companyId[0]
    : params.companyId;

  const [readiness, setReadiness] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (companyId) loadReadiness(companyId);
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

  async function loadReadiness(id: string) {
    setLoading(true);
    setError("");

    const token = await getToken();
    if (!token) return;

    try {
      const res = await fetch(`/api/admin/pilot-readiness/${id}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load pilot readiness.");
      }

      setReadiness(json.readiness || null);
    } catch (err: any) {
      setError(err.message || "Failed to load pilot readiness.");
    } finally {
      setLoading(false);
    }
  }

  const groupedChecks = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const check of readiness?.checks || []) {
      const category = check.category || "Other";
      groups.set(category, [...(groups.get(category) || []), check]);
    }
    return groups;
  }, [readiness]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Loading pilot checklist...</div>
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
              Pilot checklist unavailable
            </h1>
            <p className="mt-3 text-sm leading-6 text-rose-100">{error}</p>
            <div className="mt-5">
              <Link href="/admin/pilot-readiness">
                <PrimaryButton type="button">Back to Readiness</PrimaryButton>
              </Link>
            </div>
          </Panel>
        </div>
      </main>
    );
  }

  if (!readiness) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <EmptyState
          dark
          title="Tenant not found"
          body="This company could not be loaded from the pilot readiness checklist."
          action={
            <Link href="/admin/pilot-readiness">
              <PrimaryButton type="button">Back to Readiness</PrimaryButton>
            </Link>
          }
        />
      </main>
    );
  }

  const company = readiness.company || {};
  const overall = readiness.overall_readiness || {};
  const counts = readiness.check_counts || {};
  const links = readiness.links || {};
  const actions = readiness.actions || [];

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          dark
          eyebrow="Pilot checklist"
          title={company.name || "Tenant readiness"}
          body="Grouped go-live checks for company setup, provider sync, asset review, billing, roles, operations, and Nava Eye."
          actions={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link href={links.invoice_preview || "/admin/pilot-readiness"}>
                <PrimaryButton type="button" className="w-full sm:w-auto">
                  Invoice Preview
                </PrimaryButton>
              </Link>
              <Link href={links.tenant_billing || "/admin/pilot-readiness"}>
                <SecondaryButton type="button" className="w-full sm:w-auto">
                  Tenant Billing
                </SecondaryButton>
              </Link>
              <Link href="/admin/pilot-readiness">
                <SecondaryButton type="button" className="w-full sm:w-auto">
                  Back to Readiness
                </SecondaryButton>
              </Link>
              <SecondaryButton
                type="button"
                onClick={() => companyId && loadReadiness(companyId)}
                className="w-full sm:w-auto"
              >
                Refresh
              </SecondaryButton>
            </div>
          }
        />

        <section className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_2fr]">
          <Panel dark className="p-5">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill tone={readinessTone(overall.status)}>
                {overall.label || "Blocked"}
              </StatusPill>
              <StatusPill tone="neutral">
                {company.subscription_plan || "Plan not set"}
              </StatusPill>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              {overall.explanation}
            </p>
            <div className="mt-5 grid gap-3">
              <KeyValue label="Slug" value={company.slug || "Not set"} />
              <KeyValue
                label="Latest telemetry"
                value={formatDate(readiness.telemetry?.latest_recorded_at || null)}
              />
              <KeyValue
                label="Active members"
                value={readiness.members?.active_member_count || 0}
              />
            </div>
          </Panel>

          <div className="grid gap-4 sm:grid-cols-3">
            <SummaryCard label="Passing" value={counts.pass || 0} />
            <SummaryCard label="Warnings" value={counts.warning || 0} />
            <SummaryCard label="Blockers" value={counts.fail || 0} />
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <QuickLink
            label="Asset Review"
            body="Open Asset Review for imported and enabled vehicles."
            href={links.asset_review}
          />
          <QuickLink
            label="Provider Vault"
            body="Test provider sync and enrichment diagnostics."
            href={links.provider_vault}
          />
          <QuickLink
            label="Company Settings"
            body="Review operating context and pricing fields."
            href={links.company_settings}
          />
          <QuickLink
            label="Invoice Preview"
            body="Preview monthly billing math without creating an invoice."
            href={links.invoice_preview}
          />
        </section>

        <Panel dark className="mt-8 overflow-hidden border-cyan-200/20 bg-cyan-300/10">
          <div className="border-b border-white/10 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Go-live action panel
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  Highest priority blockers and warnings, with the safest next
                  place to act.
                </p>
              </div>
              <StatusPill tone={actions.length > 0 ? "warning" : "success"}>
                {actions.length > 0 ? `${actions.length} actions` : "No actions"}
              </StatusPill>
            </div>
          </div>

          {actions.length === 0 ? (
            <div className="px-5 py-5 text-sm leading-6 text-emerald-100">
              No blockers or warnings are currently open for this tenant.
            </div>
          ) : (
            <div className="divide-y divide-white/10">
              {actions.map((action: any, index: number) => (
                <div
                  key={`${action.category}:${action.label}:${index}`}
                  className="grid gap-4 px-5 py-5 lg:grid-cols-[180px_1fr_180px] lg:items-start"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={checkTone(action.severity)}>
                      {checkLabel(action.severity)}
                    </StatusPill>
                    <span className="text-xs font-bold uppercase tracking-[0.12em] text-cyan-100">
                      {action.category}
                    </span>
                  </div>

                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-white">
                      {action.label}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      {action.reason}
                    </p>
                    {action.route_note && (
                      <p className="mt-2 text-xs leading-5 text-slate-400">
                        {action.route_note}
                      </p>
                    )}
                  </div>

                  <div className="lg:text-right">
                    {action.route ? (
                      <Link href={action.route}>
                        <PrimaryButton type="button" className="w-full">
                          Open Action
                        </PrimaryButton>
                      </Link>
                    ) : (
                      <span className="text-xs leading-5 text-slate-400">
                        Manual admin action
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <section className="mt-8 grid gap-6">
          {CATEGORY_ORDER.map((category) => {
            const checks = groupedChecks.get(category) || [];
            if (checks.length === 0) return null;

            return (
              <Panel key={category} dark className="overflow-hidden">
                <div className="border-b border-white/10 px-5 py-4">
                  <h2 className="text-lg font-semibold text-white">{category}</h2>
                </div>
                <div className="divide-y divide-white/10">
                  {checks.map((check) => (
                    <div
                      key={`${check.category}:${check.label}`}
                      className="grid gap-3 px-5 py-4 lg:grid-cols-[220px_1fr_150px] lg:items-start"
                    >
                      <div>
                        <StatusPill tone={checkTone(check.status)}>
                          {checkLabel(check.status)}
                        </StatusPill>
                        <div className="mt-2 text-sm font-semibold text-white">
                          {check.label}
                        </div>
                      </div>
                      <div className="text-sm leading-6 text-slate-300">
                        <p>{check.explanation}</p>
                        <p className="mt-2 text-slate-400">
                          {check.suggested_next_action}
                        </p>
                      </div>
                      <div className="lg:text-right">
                        {check.route ? (
                          <Link href={check.route}>
                            <SecondaryButton type="button" className="w-full">
                              Open
                            </SecondaryButton>
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-500">
                            No direct route
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            );
          })}
        </section>
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

function KeyValue({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="text-right text-sm font-semibold text-slate-100">
        {value}
      </div>
    </div>
  );
}

function QuickLink({
  label,
  body,
  href,
}: {
  label: string;
  body: string;
  href?: string;
}) {
  return (
    <Link href={href || "/admin/pilot-readiness"} className="group block">
      <Panel
        dark
        className="h-full p-4 transition group-hover:border-cyan-200/40 group-hover:bg-cyan-300/10"
      >
        <h3 className="text-base font-semibold text-white">{label}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-300">{body}</p>
        <div className="mt-4 text-sm font-semibold text-cyan-100">Open</div>
      </Panel>
    </Link>
  );
}
