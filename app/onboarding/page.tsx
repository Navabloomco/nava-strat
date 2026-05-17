"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

type Checklist = {
  company_created: boolean;
  tracking_provider_connected: boolean;
  provider_tested_successfully: boolean;
  fleet_assets_received: boolean;
  recent_telemetry_received: boolean;
  ready_to_create_first_journey: boolean;
};

type OnboardingState =
  | "no_company"
  | "no_provider"
  | "provider_request_submitted"
  | "provider_connected_not_tested"
  | "provider_tested_no_fleet"
  | "fleet_no_recent_location"
  | "live_tracking_ready";

const checklistItems: Array<{ key: keyof Checklist; label: string; detail: string }> = [
  {
    key: "company_created",
    label: "Company created",
    detail: "Your secure company workspace is ready.",
  },
  {
    key: "tracking_provider_connected",
    label: "Tracking provider connected",
    detail: "Add at least one GPS or telemetry provider for this company.",
  },
  {
    key: "provider_tested_successfully",
    label: "Provider tested successfully",
    detail: "Run a provider test or sync and confirm Nava can read the feed.",
  },
  {
    key: "fleet_assets_received",
    label: "Fleet assets received",
    detail: "Nava has received your first fleet records.",
  },
  {
    key: "recent_telemetry_received",
    label: "Recent telemetry received",
    detail: "Nava has received recent live location data.",
  },
  {
    key: "ready_to_create_first_journey",
    label: "Ready to create first journey",
    detail: "Provider, fleet, and telemetry checks are green.",
  },
];

export default function Onboarding() {
  const [companyName, setCompanyName] = useState("");
  const [subscriptionPlan, setSubscriptionPlan] = useState("starter");
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadStatus();
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

  async function loadStatus() {
    setLoading(true);
    setMessage("");

    const token = await getAccessToken();
    if (!token) return;

    const res = await fetch("/api/onboarding/company", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setMessage(json.error || "Failed to load onboarding status.");
      setLoading(false);
      return;
    }

    setStatus(json);
    setLoading(false);
  }

  async function createCompany(e: any) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    const token = await getAccessToken();
    if (!token) return;

    const res = await fetch("/api/onboarding/company", {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: companyName,
        subscription_plan: subscriptionPlan,
      }),
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setMessage(json.error || "Failed to create company.");
      setSaving(false);
      return;
    }

    setStatus(json);
    setCompanyName("");
    setSaving(false);
  }

  const checklist = status?.checklist || {};
  const completeCount = useMemo(() => {
    return checklistItems.filter((item) => checklist[item.key]).length;
  }, [checklist]);
  const onboardingState = getOnboardingState(status);
  const nextStep = getNextBestStep(onboardingState, status, loadStatus);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 text-slate-950 sm:p-10">
        Loading onboarding...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-950 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 rounded-lg border border-slate-200 bg-white p-5 sm:p-8">
          <p className="break-words text-sm font-bold uppercase tracking-[0.14em] text-cyan-700 sm:tracking-[0.18em]">
            SaaS onboarding
          </p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="break-words text-3xl font-semibold tracking-normal sm:text-4xl">
                Set up your Nava Strat workspace
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                Create the company workspace, connect a real tracking provider, and
                verify live fleet data before creating the first operational journey.
              </p>
            </div>
            {status?.company && (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                <div className="font-semibold">{status.company.name}</div>
                <div className="text-slate-500">{status.company.slug}</div>
              </div>
            )}
          </div>
        </header>

        {message && (
          <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {message}
          </div>
        )}

        {!status?.company ? (
          <section className="rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="text-xl font-semibold">Create company workspace</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              You do not have active company access yet. Create a company to start
              setting up your secure company workspace.
            </p>

            <form onSubmit={createCompany} className="mt-6 grid max-w-2xl gap-4">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">
                  Company name
                </span>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Your logistics company"
                  className="mt-2 w-full rounded-md border border-slate-300 px-4 py-3 outline-none focus:border-cyan-600"
                  required
                />
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">
                  Subscription plan
                </span>
                <select
                  value={subscriptionPlan}
                  onChange={(e) => setSubscriptionPlan(e.target.value)}
                  className="mt-2 w-full rounded-md border border-slate-300 px-4 py-3 outline-none focus:border-cyan-600"
                >
                  <option value="starter">Starter</option>
                  <option value="growth">Growth</option>
                  <option value="enterprise">Enterprise</option>
                  <option value="platform_custom">Platform / Custom</option>
                </select>
              </label>

              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-slate-950 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Creating workspace..." : "Create company"}
              </button>
            </form>
          </section>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <section className="rounded-lg border border-slate-200 bg-white p-6">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold">Pilot readiness checklist</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {completeCount} of {checklistItems.length} checks complete.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadStatus}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                >
                  Refresh
                </button>
              </div>

              <div className="space-y-3">
                {checklistItems.map((item) => {
                  const done = Boolean(checklist[item.key]);
                  return (
                    <div
                      key={item.key}
                      className="flex gap-4 rounded-md border border-slate-200 p-4"
                    >
                      <div
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                          done
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {done ? "✓" : "•"}
                      </div>
                      <div>
                        <div className="font-semibold">{item.label}</div>
                        <div className="mt-1 text-sm leading-6 text-slate-600">
                          {item.detail}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <aside className="space-y-6">
              <section className="rounded-lg border border-slate-200 bg-white p-6">
                <h2 className="text-xl font-semibold">Live data status</h2>
                <div className="mt-5 grid gap-3">
                  <Metric label="Providers" value={status.counts?.providers || 0} />
                  <Metric label="Fleet assets" value={status.counts?.fleet_assets || 0} />
                  <Metric
                    label="Recent telemetry"
                    value={status.counts?.recent_telemetry || 0}
                  />
                </div>
                <p className="mt-4 text-sm text-slate-500">
                  Latest telemetry: {status.latest_telemetry_at || "none yet"}
                </p>
              </section>

              <NextBestStepCard step={nextStep} />
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

function getOnboardingState(status: any): OnboardingState {
  if (!status?.company) return "no_company";

  const checklist = status.checklist || {};
  const providerCount = Number(status.counts?.providers || 0);
  const providerRequestCount = Number(status.provider_setup_requests_count || 0);

  if (providerCount === 0 && providerRequestCount > 0) {
    return "provider_request_submitted";
  }

  if (providerCount === 0) {
    return "no_provider";
  }

  if (!checklist.provider_tested_successfully) {
    return "provider_connected_not_tested";
  }

  if (!checklist.fleet_assets_received) {
    return "provider_tested_no_fleet";
  }

  if (!checklist.recent_telemetry_received) {
    return "fleet_no_recent_location";
  }

  return "live_tracking_ready";
}

function getNextBestStep(state: OnboardingState, status: any, onRefresh: () => void) {
  const providerName = status?.latest_provider_setup_request_provider_name;

  const steps: Record<OnboardingState, any> = {
    no_company: {
      eyebrow: "Workspace setup",
      title: "Create your company workspace",
      body: "Start by creating the secure workspace your team will use for fleet operations.",
      primary: null,
      secondary: null,
      tertiary: null,
    },
    no_provider: {
      eyebrow: "First connection",
      title: "Connect your tracking provider",
      body: "Add your GPS or telemetry provider so Nava can begin receiving your fleet picture.",
      primary: { label: "Add Provider", href: "/admin/providers/new" },
      secondary: {
        label: "Request Provider Setup",
        href: "/admin/providers/new?request=1",
      },
      tertiary: null,
    },
    provider_request_submitted: {
      eyebrow: "Setup request received",
      title: providerName
        ? `${providerName} is being prepared`
        : "Your provider setup request is in progress",
      body: "Nava will prepare a verified connection path before any access details are collected.",
      primary: {
        label: "Back to Provider Setup",
        href: "/admin/providers/new?request=1",
      },
      secondary: { label: "Refresh Onboarding", onClick: onRefresh },
      tertiary: null,
    },
    provider_connected_not_tested: {
      eyebrow: "Connection check",
      title: "Test your provider connection",
      body: "Open the Provider Vault and run a connection test so Nava can confirm the feed is ready.",
      primary: { label: "Open Provider Vault", href: "/admin/providers" },
      secondary: { label: "Refresh Onboarding", onClick: onRefresh },
      tertiary: null,
    },
    provider_tested_no_fleet: {
      eyebrow: "Fleet intake",
      title: "Confirm fleet data is arriving",
      body: "The connection is saved, but your fleet has not appeared yet. Check the Provider Vault and refresh once data starts flowing.",
      primary: { label: "Open Provider Vault", href: "/admin/providers" },
      secondary: { label: "Refresh Onboarding", onClick: onRefresh },
      tertiary: null,
    },
    fleet_no_recent_location: {
      eyebrow: "Live movement",
      title: "Check live tracking",
      body: "Fleet records are present. Open Live Tracking to confirm fresh movement is arriving.",
      primary: { label: "Open Live Tracking", href: "/tracking/live" },
      secondary: { label: "Refresh Onboarding", onClick: onRefresh },
      tertiary: null,
    },
    live_tracking_ready: {
      eyebrow: "Ready for operations",
      title: "Create your first journey",
      body: "Your live fleet picture is ready. Start the first customer journey and monitor it from Nava.",
      primary: { label: "Create First Journey", href: "/ops/journey/new" },
      secondary: { label: "Open Live Tracking", href: "/tracking/live" },
      tertiary: { label: "Ask Nava Eye", href: "/nava-eye" },
    },
  };

  return steps[state];
}

function NextBestStepCard({ step }: { step: any }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <p className="break-words text-xs font-bold uppercase tracking-[0.14em] text-cyan-700 sm:tracking-[0.18em]">
        {step.eyebrow}
      </p>
      <h2 className="mt-3 text-xl font-semibold">Next best step</h2>
      <h3 className="mt-4 break-words text-2xl font-semibold tracking-normal text-slate-950">
        {step.title}
      </h3>
      <p className="mt-3 text-sm leading-6 text-slate-600">{step.body}</p>

      <div className="mt-5 grid gap-3">
        {step.primary && <ActionButton action={step.primary} primary />}
        {step.secondary && <ActionButton action={step.secondary} />}
        {step.tertiary && <ActionButton action={step.tertiary} />}
      </div>
    </section>
  );
}

function ActionButton({ action, primary = false }: { action: any; primary?: boolean }) {
  const className = primary
    ? "rounded-md bg-slate-950 px-4 py-3 text-center text-sm font-bold text-white hover:bg-slate-800"
    : "rounded-md border border-slate-300 px-4 py-3 text-center text-sm font-semibold hover:bg-slate-50";

  if (action.href) {
    return (
      <Link href={action.href} className={className}>
        {action.label}
      </Link>
    );
  }

  return (
    <button type="button" onClick={action.onClick} className={className}>
      {action.label}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-4 py-3">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-lg font-bold">{value}</span>
    </div>
  );
}
