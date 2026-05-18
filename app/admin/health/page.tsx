"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import {
  PageHeader,
  Panel,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
} from "../../components/ui/Primitives";

type CheckStatus = "pass" | "warn" | "fail";

type HealthCheck = {
  category: string;
  name: string;
  status: CheckStatus;
  detail: string;
};

const CATEGORY_ORDER = ["Environment", "Tables/Columns", "Constraints/RPCs"];

function statusTone(
  status: CheckStatus
): "success" | "warning" | "danger" {
  if (status === "pass") return "success";
  if (status === "warn") return "warning";
  return "danger";
}

function statusLabel(status: CheckStatus) {
  if (status === "pass") return "Ready";
  if (status === "warn") return "Review";
  return "Missing";
}

function overallCopy(status: CheckStatus) {
  if (status === "pass") return "Pilot readiness checks are passing.";
  if (status === "warn") {
    return "Pilot readiness has warnings. Review the items below before launch.";
  }
  return "Pilot readiness is blocked until the missing items below are fixed.";
}

export default function PlatformHealthPage() {
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [overallStatus, setOverallStatus] = useState<CheckStatus>("warn");
  const [checkedAt, setCheckedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadHealth();
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

  async function loadHealth() {
    setLoading(true);
    setError("");

    const token = await getToken();
    if (!token) return;

    try {
      const res = await fetch("/api/platform/health", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Unable to run platform health check.");
      }

      setChecks(json.checks || []);
      setOverallStatus(json.overall_status || "warn");
      setCheckedAt(json.checked_at || "");
    } catch (err: any) {
      setError(err.message || "Unable to run platform health check.");
    } finally {
      setLoading(false);
    }
  }

  const groupedChecks = useMemo(() => {
    const groups = new Map<string, HealthCheck[]>();
    for (const check of checks) {
      const category = check.category || "Other";
      groups.set(category, [...(groups.get(category) || []), check]);
    }
    return groups;
  }, [checks]);

  const counts = useMemo(
    () => ({
      pass: checks.filter((check) => check.status === "pass").length,
      warn: checks.filter((check) => check.status === "warn").length,
      fail: checks.filter((check) => check.status === "fail").length,
    }),
    [checks]
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Running pilot health checks...</div>
        </Panel>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <div className="mx-auto max-w-4xl">
          <Panel dark className="border-rose-300/30 bg-rose-500/10 p-6">
            <StatusPill tone="danger">Unavailable</StatusPill>
            <h1 className="mt-4 text-2xl font-semibold text-white">
              Platform health check unavailable
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
          eyebrow="Platform readiness"
          title="Platform Health"
          body="This page checks whether the database and environment are ready for pilot operations."
          actions={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link href="/admin">
                <SecondaryButton type="button" className="w-full sm:w-auto">
                  Back to Admin Hub
                </SecondaryButton>
              </Link>
              <PrimaryButton
                type="button"
                onClick={loadHealth}
                className="w-full sm:w-auto"
              >
                Refresh Checks
              </PrimaryButton>
            </div>
          }
        />

        <section className="mt-6 grid gap-4 md:grid-cols-4">
          <Panel dark className="p-5 md:col-span-2">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill tone={statusTone(overallStatus)}>
                {overallStatus.toUpperCase()}
              </StatusPill>
              <h2 className="text-xl font-semibold text-white">
                {overallCopy(overallStatus)}
              </h2>
            </div>
            {checkedAt && (
              <p className="mt-3 text-sm text-slate-400">
                Last checked {new Date(checkedAt).toLocaleString()}
              </p>
            )}
          </Panel>

          <SummaryCard label="Ready" value={counts.pass} tone="success" />
          <SummaryCard
            label={counts.fail > 0 ? "Blocked" : "Review"}
            value={counts.fail > 0 ? counts.fail : counts.warn}
            tone={counts.fail > 0 ? "danger" : "warning"}
          />
        </section>

        <section className="mt-8 grid gap-6">
          {CATEGORY_ORDER.map((category) => {
            const categoryChecks = groupedChecks.get(category) || [];
            if (categoryChecks.length === 0) return null;

            return (
              <Panel key={category} dark className="overflow-hidden">
                <div className="border-b border-white/10 px-5 py-4">
                  <h2 className="text-lg font-semibold text-white">{category}</h2>
                </div>
                <div className="divide-y divide-white/10">
                  {categoryChecks.map((check) => (
                    <div
                      key={`${check.category}:${check.name}`}
                      className="grid gap-3 px-5 py-4 lg:grid-cols-[220px_1fr_120px] lg:items-start"
                    >
                      <div className="min-w-0 text-sm font-semibold text-white">
                        {check.name}
                      </div>
                      <div className="min-w-0 break-words text-sm leading-6 text-slate-300">
                        {check.detail}
                      </div>
                      <div className="lg:text-right">
                        <StatusPill tone={statusTone(check.status)}>
                          {statusLabel(check.status)}
                        </StatusPill>
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

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "danger";
}) {
  return (
    <Panel dark className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
            {label}
          </div>
          <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
        </div>
        <StatusPill tone={tone}>{label}</StatusPill>
      </div>
    </Panel>
  );
}
