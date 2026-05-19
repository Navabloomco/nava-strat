"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
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

const onboardingModes = [
  {
    title: "Standard self-serve provider setup",
    body: "For providers with clean fleet APIs, documented auth, stable vehicle identifiers, and a single live fleet feed.",
  },
  {
    title: "Assisted onboarding",
    body: "For providers that need Nava to inspect safe diagnostics, configure mappings, or add supplemental enrichment feeds.",
  },
  {
    title: "Paid onboarding",
    body: "For providers that split key data across reports, require provider-specific IDs, or need implementation support.",
  },
  {
    title: "Custom provider integration",
    body: "For providers without reusable APIs, with unusual auth flows, or with enrichment data that needs custom normalization.",
  },
];

const checklist = [
  "Confirm company context",
  "Add provider credentials",
  "Test primary fleet feed",
  "Verify vehicle count",
  "Inspect raw safe keys and diagnostics",
  "Configure supplemental enrichment feeds if needed",
  "Map fuel, odometer, engine hours, driver, and temperature fields",
  "Run provider test",
  "Confirm rows found",
  "Confirm matches found",
  "Confirm mapped fields merged",
  "Run sync",
  "Verify telemetry_logs",
  "Review imported assets",
  "Enable intelligence vehicles",
  "Test Live Tracking",
  "Ask Nava Eye about a known truck",
];

const dataTypes = [
  {
    name: "Primary feed",
    includes: "Location, speed, status, mileage",
    purpose: "Creates and updates fleet assets and location telemetry.",
  },
  {
    name: "Enrichment feed",
    includes: "Fuel, odometer, engine hours, battery, temperature, driver",
    purpose: "Adds operational fields that the primary feed may not include.",
  },
  {
    name: "Event feed",
    includes: "Idling, overspeed, panic, harsh braking, geofence events",
    purpose: "Supports alerting, risk context, and exception investigation.",
  },
  {
    name: "Document/export feed",
    includes: "Reports, invoices, compliance files",
    purpose: "Supports later workflows where providers expose data as reports.",
  },
];

const diagnostics = [
  {
    state: "0 supplemental feeds configured",
    meaning: "Nava only has the primary feed. Add a report/API URL if enrichment data is missing.",
  },
  {
    state: "Feed configured but 0 attempted",
    meaning: "A required macro or config value is missing before Nava can call the feed.",
  },
  {
    state: "Attempted but 0 rows",
    meaning: "The endpoint, payload, report type, date range, or auth context likely needs adjustment.",
  },
  {
    state: "Rows found but 0 matches",
    meaning: "The report returned rows, but match keys do not line up with primary vehicles.",
  },
  {
    state: "Matches found but field not merged",
    meaning: "The vehicle matched, but mapped provider keys are wrong or values are empty/invalid.",
  },
  {
    state: "Field merged",
    meaning: "Run sync, then verify the normalized field in telemetry_logs.",
  },
];

const safetyRules = [
  "Never store provider passwords in visible UI.",
  "Never paste cookies, tokens, or passwords into chat.",
  "Never expose raw provider payloads to the client portal.",
  "Block localhost and private network supplemental URLs.",
  "Test before enabling billing.",
  "Keep advanced provider config platform_owner-only.",
  "Do not use browser scraping unless explicitly approved.",
];

const templateFields = [
  "Provider name",
  "Country or region",
  "Primary feed URL",
  "Login/auth method",
  "Vehicle path",
  "Primary field mapping",
  "Supplemental feed URLs",
  "Required macros",
  "Match keys",
  "Mapped fields",
  "Known limitations",
  "Test result notes",
];

const blueTraxConfig = `{
  "analytics_user_id": "PROVIDER_SPECIFIC_USER_ID",
  "supplemental_feeds": [
    {
      "name": "fleet_current_status",
      "url": "https://api.bluetrax.co.ke/rest/analytics/vehicle",
      "method": "POST",
      "vehicle_paths": ["items"],
      "match_keys": ["vehicle", "unitId", "registration", "truck_id"],
      "mapping": {
        "fuel_level": "currentFuelLevel",
        "odometer": "endOdometer",
        "mileage": "mileage",
        "driver_name": "driver"
      },
      "payload": {
        "pageIndex": 1,
        "pageSize": 15000,
        "channel": 1,
        "request": {
          "startDate": "{{now_minus_24h_iso}}",
          "endDate": "{{now_plus_1h_iso}}",
          "userId": "{{analytics_user_id}}",
          "reportType": "FleetCurrentStatus",
          "nightStart": "20:00",
          "nightEnd": "05:00",
          "stopDuration": 30,
          "refillThreshold": 10,
          "siphonThreshold": 10,
          "categories": [],
          "assets": []
        }
      }
    }
  ]
}`;

export default function ProviderPlaybookPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);

  useEffect(() => {
    loadAccess();
  }, []);

  async function loadAccess() {
    setLoading(true);
    setError("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return;
    }

    try {
      const res = await fetch("/api/companies", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Unable to verify platform access.");
      }

      const roles = [
        ...((json.roles || []) as string[]),
        ...((json.memberships || []).map((membership: any) => membership.role) as string[]),
      ].map((role) => String(role || "").trim().toLowerCase());

      setIsPlatformOwner(
        json.is_platform_owner === true || roles.includes("platform_owner")
      );
    } catch (err: any) {
      setError(err.message || "Unable to load provider playbook.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">
            Loading provider setup playbook...
          </div>
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
              Provider playbook unavailable
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

  if (!isPlatformOwner) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <div className="mx-auto max-w-4xl">
          <EmptyState
            dark
            title="Platform owner access required"
            body="Provider setup playbooks are internal Nava platform tools."
            action={
              <Link href="/admin">
                <PrimaryButton type="button">Back to Admin Hub</PrimaryButton>
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
          eyebrow="Internal provider operations"
          title="Provider Setup Playbook"
          body="Repeatable guidance for onboarding GPS and telematics providers without relying on memory, chat history, or messy DevTools sessions."
          actions={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link href="/admin">
                <SecondaryButton type="button" className="w-full sm:w-auto">
                  Back to Admin Hub
                </SecondaryButton>
              </Link>
              <Link href="/admin/providers">
                <PrimaryButton type="button" className="w-full sm:w-auto">
                  Open Provider Vault
                </PrimaryButton>
              </Link>
            </div>
          }
        />

        <Panel dark className="mt-6 border-cyan-200/20 bg-cyan-300/10 p-5">
          <p className="text-sm leading-6 text-cyan-50">
            Some providers expose clean fleet APIs. Others split fuel,
            odometer, diagnostics, and reports across separate endpoints. Nava
            supports both, but complex providers may require assisted
            onboarding.
          </p>
        </Panel>

        <Section title="Provider Onboarding Modes">
          <div className="grid gap-4 md:grid-cols-2">
            {onboardingModes.map((mode) => (
              <Panel key={mode.title} dark className="p-5">
                <h3 className="text-base font-semibold text-white">
                  {mode.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  {mode.body}
                </p>
              </Panel>
            ))}
          </div>
        </Section>

        <Section title="Onboarding Checklist">
          <Panel dark className="p-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {checklist.map((item, index) => (
                <div
                  key={item}
                  className="flex min-w-0 gap-3 rounded-md border border-white/10 bg-white/[0.03] p-3"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-cyan-200/30 text-xs font-semibold text-cyan-100">
                    {index + 1}
                  </span>
                  <span className="min-w-0 break-words text-sm leading-6 text-slate-200">
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </Section>

        <Section title="Provider Data Types">
          <div className="grid gap-4 lg:grid-cols-2">
            {dataTypes.map((type) => (
              <Panel key={type.name} dark className="p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-white">
                    {type.name}
                  </h3>
                  <StatusPill tone="info">Provider data</StatusPill>
                </div>
                <p className="mt-3 text-sm text-slate-200">{type.includes}</p>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  {type.purpose}
                </p>
              </Panel>
            ))}
          </div>
        </Section>

        <Section title="Diagnostics Interpretation">
          <Panel dark className="overflow-hidden">
            <div className="divide-y divide-white/10">
              {diagnostics.map((item) => (
                <div
                  key={item.state}
                  className="grid gap-3 px-5 py-4 md:grid-cols-[280px_1fr]"
                >
                  <div className="min-w-0 font-semibold text-white">
                    {item.state}
                  </div>
                  <div className="min-w-0 break-words text-sm leading-6 text-slate-300">
                    {item.meaning}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </Section>

        <Section title="BlueTrax Kenya Template">
          <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
            <Panel dark className="p-5">
              <div className="grid gap-4">
                <Detail label="Primary fleet URL" value="https://public-api.bluetrax.co.ke/api/Public/fleet_current_location" />
                <Detail label="Analytics report URL" value="https://api.bluetrax.co.ke/rest/analytics/vehicle" />
                <Detail label="Report type" value="FleetCurrentStatus" />
                <Detail label="Row path" value="items" />
                <Detail label="Vehicle key" value="vehicle" />
                <Detail label="Unit key" value="unitId" />
                <Detail label="Fuel key" value="currentFuelLevel" />
                <Detail label="Required config" value="analytics_user_id" />
              </div>
              <p className="mt-5 text-sm leading-6 text-amber-100">
                Do not include real usernames, passwords, tokens, cookies, or
                client secrets here. The analytics_user_id is provider-specific
                and should be copied only from a safe DevTools payload field,
                never from an auth token or cookie.
              </p>
            </Panel>

            <Panel dark className="overflow-hidden">
              <div className="border-b border-white/10 px-5 py-4">
                <h3 className="text-base font-semibold text-white">
                  Example fleet_config
                </h3>
              </div>
              <pre className="max-h-[520px] overflow-auto p-5 text-xs leading-5 text-cyan-50">
                <code>{blueTraxConfig}</code>
              </pre>
            </Panel>
          </div>
        </Section>

        <Section title="Pricing and Commercial Guidance">
          <Panel dark className="p-5">
            <p className="text-lg font-semibold text-white">
              Provider onboarding is implementation work when the provider
              splits data across reports, requires custom IDs, or lacks
              documentation. Charge for it.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {[
                "Self-serve: free or included",
                "Assisted provider setup: chargeable",
                "Complex provider integration: chargeable",
                "Custom enrichment/report work: chargeable",
                "Ongoing provider monitoring/support: monthly add-on",
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-md border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200"
                >
                  {item}
                </div>
              ))}
            </div>
          </Panel>
        </Section>

        <Section title="Safety Rules">
          <Panel dark className="p-5">
            <div className="grid gap-3 md:grid-cols-2">
              {safetyRules.map((rule) => (
                <div
                  key={rule}
                  className="rounded-md border border-amber-200/20 bg-amber-300/10 p-3 text-sm leading-6 text-amber-50"
                >
                  {rule}
                </div>
              ))}
            </div>
          </Panel>
        </Section>

        <Section title="Reusable Provider Template Checklist">
          <Panel dark className="p-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {templateFields.map((field) => (
                <div
                  key={field}
                  className="rounded-md border border-white/10 bg-white/[0.03] p-3"
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Capture
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white">
                    {field}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </Section>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="mb-4 text-xl font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-white/[0.03] p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-semibold text-slate-100">
        {value}
      </div>
    </div>
  );
}
