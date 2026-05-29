"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

type Checklist = {
  company_created: boolean;
  tracking_provider_connected: boolean;
  provider_tested_successfully: boolean;
  fleet_assets_received: boolean;
  intelligence_vehicles_enabled: boolean;
  recent_telemetry_received: boolean;
  ready_to_create_first_journey: boolean;
};

type OnboardingState =
  | "no_company"
  | "no_provider"
  | "provider_request_submitted"
  | "provider_connected_not_tested"
  | "provider_tested_no_fleet"
  | "assets_imported_not_enabled"
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
    label: "Provider assets imported",
    detail: "Nava has received assets from your provider.",
  },
  {
    key: "intelligence_vehicles_enabled",
    label: "Intelligence vehicles enabled",
    detail: "Review imported assets and enable the vehicles Nava should use.",
  },
  {
    key: "recent_telemetry_received",
    label: "Recent telemetry received",
    detail: "Nava has received recent live location data.",
  },
  {
    key: "ready_to_create_first_journey",
    label: "Ready to create first Trip",
    detail: "Provider, fleet, and telemetry checks are green.",
  },
];

const businessTypeOptions = [
  { value: "long_haul_transport", label: "Long-haul transport" },
  { value: "passenger_transport", label: "Passenger transport" },
  { value: "courier_delivery", label: "Courier / delivery" },
  { value: "field_service", label: "Field service" },
  { value: "construction_equipment", label: "Construction equipment" },
  { value: "sales_fleet", label: "Sales fleet" },
  { value: "mixed_fleet", label: "Mixed fleet" },
  { value: "other", label: "Other" },
];

const primaryAssetTypeOptions = [
  { value: "truck", label: "Truck" },
  { value: "trailer", label: "Trailer" },
  { value: "bus", label: "Bus" },
  { value: "van", label: "Van" },
  { value: "pickup", label: "Pickup" },
  { value: "car", label: "Car" },
  { value: "motorcycle", label: "Motorcycle" },
  { value: "equipment", label: "Equipment" },
  { value: "other", label: "Other" },
];

const billingUnitOptions = [
  { value: "trip", label: "Trip" },
  { value: "tonne", label: "Tonne" },
  { value: "passenger", label: "Passenger" },
  { value: "delivery", label: "Delivery" },
  { value: "hour", label: "Hour" },
  { value: "day", label: "Day" },
  { value: "asset", label: "Asset" },
  { value: "other", label: "Other" },
];

export default function Onboarding() {
  const [companyName, setCompanyName] = useState("");
  const [subscriptionPlan, setSubscriptionPlan] = useState("starter");
  const [businessType, setBusinessType] = useState("long_haul_transport");
  const [primaryAssetTypes, setPrimaryAssetTypes] = useState<string[]>(["truck"]);
  const [mainBillingUnit, setMainBillingUnit] = useState("trip");
  const [operatingRegions, setOperatingRegions] = useState("");
  const [primaryUseCase, setPrimaryUseCase] = useState("");
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
        business_type: businessType,
        primary_asset_types: primaryAssetTypes,
        main_billing_unit: mainBillingUnit,
        operating_regions: operatingRegions,
        primary_use_case: primaryUseCase,
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
    setOperatingRegions("");
    setPrimaryUseCase("");
    setSaving(false);
  }

  function togglePrimaryAssetType(value: string) {
    setPrimaryAssetTypes((current) => {
      if (current.includes(value)) {
        const next = current.filter((item) => item !== value);
        return next.length > 0 ? next : current;
      }
      return [...current, value];
    });
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
                Create the company workspace, connect a real tracking provider,
                review imported assets, and enable vehicles before creating the
                first operational Trip.
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

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">
                  Operating context
                </h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  This helps Nava tailor asset review suggestions and future workflow defaults.
                </p>

                <div className="mt-4 grid gap-4">
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">
                      Business type
                    </span>
                    <select
                      value={businessType}
                      onChange={(e) => setBusinessType(e.target.value)}
                      className="mt-2 w-full rounded-md border border-slate-300 px-4 py-3 outline-none focus:border-cyan-600"
                    >
                      {businessTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div>
                    <div className="text-sm font-semibold text-slate-700">
                      Primary asset types
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {primaryAssetTypeOptions.map((option) => {
                        const selected = primaryAssetTypes.includes(option.value);
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => togglePrimaryAssetType(option.value)}
                            className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                              selected
                                ? "border-cyan-600 bg-cyan-50 text-cyan-800"
                                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">
                      Default billing / work unit
                    </span>
                    <select
                      value={mainBillingUnit}
                      onChange={(e) => setMainBillingUnit(e.target.value)}
                      className="mt-2 w-full rounded-md border border-slate-300 px-4 py-3 outline-none focus:border-cyan-600"
                    >
                      {billingUnitOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      This is only the company default. Actual billing can vary by client,
                      route, Trip, or cargo terms.
                    </p>
                  </label>

                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">
                      Operating regions
                    </span>
                    <input
                      value={operatingRegions}
                      onChange={(e) => setOperatingRegions(e.target.value)}
                      placeholder="Kenya, Uganda, Tanzania"
                      className="mt-2 w-full rounded-md border border-slate-300 px-4 py-3 outline-none focus:border-cyan-600"
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">
                      Primary use case
                    </span>
                    <input
                      value={primaryUseCase}
                      onChange={(e) => setPrimaryUseCase(e.target.value)}
                      placeholder="Example: Cement deliveries, field service, passenger routes"
                      className="mt-2 w-full rounded-md border border-slate-300 px-4 py-3 outline-none focus:border-cyan-600"
                    />
                  </label>
                </div>
              </div>

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
                  <h2 className="text-xl font-semibold">Go-live readiness checklist</h2>
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
                  <Metric label="Imported assets" value={status.counts?.imported_assets || status.counts?.fleet_assets || 0} />
                  <Metric
                    label="Enabled vehicles"
                    value={status.counts?.enabled_intelligence_assets || 0}
                  />
                  <Metric label="Unreviewed assets" value={status.counts?.unreviewed_assets || 0} />
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

  if (!checklist.intelligence_vehicles_enabled) {
    return "assets_imported_not_enabled";
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
    assets_imported_not_enabled: {
      eyebrow: "Asset review",
      title: "Review imported assets",
      body: "Fleet records have arrived. Review imported assets and enable the operational vehicles Nava should use in live tracking, operations, and intelligence.",
      primary: { label: "Review Assets", href: "/admin/assets" },
      secondary: { label: "Refresh Onboarding", onClick: onRefresh },
      tertiary: null,
    },
    fleet_no_recent_location: {
      eyebrow: "Live movement",
      title: "Check live tracking",
      body: "Enabled vehicles are ready. Open Live Tracking to confirm fresh movement is arriving.",
      primary: { label: "Open Live Tracking", href: "/tracking/live" },
      secondary: { label: "Refresh Onboarding", onClick: onRefresh },
      tertiary: null,
    },
    live_tracking_ready: {
      eyebrow: "Ready for operations",
      title: "Create your first Trip",
      body: "Your live fleet picture is ready. Start the first operational Trip and monitor it from Nava.",
      primary: { label: "Create First Trip", href: "/ops/journey/new" },
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
