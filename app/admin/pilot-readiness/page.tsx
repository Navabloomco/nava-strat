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

function readinessTone(status: string) {
  if (status === "ready") return "success";
  if (status === "needs_attention") return "warning";
  return "danger";
}

export default function PilotReadinessPage() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadReadiness();
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

  async function loadReadiness() {
    setLoading(true);
    setError("");

    const token = await getToken();
    if (!token) return;

    try {
      const res = await fetch("/api/admin/pilot-readiness", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load pilot readiness.");
      }

      setTenants(json.tenants || []);
      setTotals(json.totals || null);
    } catch (err: any) {
      setError(err.message || "Failed to load pilot readiness.");
    } finally {
      setLoading(false);
    }
  }

  const summaryText = useMemo(() => {
    if (!totals) return "No readiness checks yet";
    return `${totals.pass || 0} passing · ${totals.warning || 0} warnings · ${
      totals.fail || 0
    } blockers`;
  }, [totals]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Loading pilot readiness...</div>
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
              Pilot readiness unavailable
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
          eyebrow="Pilot readiness"
          title="Pilot Readiness Checklist"
          body="See which tenants are ready for pilot operations, which need attention, and which are blocked before go-live."
          actions={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link href="/admin">
                <SecondaryButton type="button" className="w-full sm:w-auto">
                  Back to Admin Hub
                </SecondaryButton>
              </Link>
              <PrimaryButton
                type="button"
                onClick={loadReadiness}
                className="w-full sm:w-auto"
              >
                Refresh
              </PrimaryButton>
            </div>
          }
        />

        <section className="mt-6 grid gap-4 md:grid-cols-4">
          <SummaryCard label="Tenants" value={totals?.tenant_count || 0} />
          <SummaryCard label="Ready" value={totals?.ready || 0} />
          <SummaryCard
            label="Needs attention"
            value={totals?.needs_attention || 0}
          />
          <SummaryCard label="Blocked" value={totals?.blocked || 0} />
        </section>

        <Panel dark className="mt-6 p-4">
          <div className="text-sm text-slate-300">{summaryText}</div>
        </Panel>

        {tenants.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              dark
              title="No tenants yet"
              body="Pilot readiness appears after companies are created."
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
                        tone={readinessTone(tenant.overall_readiness.status)}
                      >
                        {tenant.overall_readiness.label}
                      </StatusPill>
                    </div>
                    <div className="mt-2 text-sm text-slate-400">
                      {tenant.company.slug || "Slug not set"}
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      {tenant.overall_readiness.explanation}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <Metric label="Passing" value={tenant.check_counts.pass} />
                    <Metric label="Warnings" value={tenant.check_counts.warning} />
                    <Metric label="Blockers" value={tenant.check_counts.fail} />
                  </div>

                  <div className="grid gap-2 lg:min-w-[220px]">
                    <Link href={`/admin/pilot-readiness/${tenant.company.id}`}>
                      <PrimaryButton type="button" className="w-full">
                        Open Checklist
                      </PrimaryButton>
                    </Link>
                    <Link href={`/admin/tenants/${tenant.company.id}`}>
                      <SecondaryButton type="button" className="w-full">
                        Tenant Billing
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

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}
