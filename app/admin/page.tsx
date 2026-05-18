"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import {
  EmptyState,
  PageHeader,
  Panel,
  PrimaryButton,
  StatusPill,
} from "../components/ui/Primitives";

const platformCards = [
  {
    title: "Provider Requests",
    body: "Review client requests for provider setup.",
    href: "/admin/provider-requests",
  },
  {
    title: "Provider Vault",
    body: "Manage secure provider connections and testing.",
    href: "/admin/providers",
  },
  {
    title: "Asset Review",
    body: "Review imported provider assets waiting to become Nava intelligence vehicles.",
    href: "/admin/assets",
  },
  {
    title: "Client Visibility",
    body: "Create and manage secure customer-facing delivery links.",
    href: "/admin/client-visibility",
  },
  {
    title: "Company Settings",
    body: "Keep company operating context aligned with real workflows.",
    href: "/admin/company",
  },
  {
    title: "Geofences",
    body: "Manage depots, customer sites, loading zones, and risk areas.",
    href: "/geofences",
  },
  {
    title: "Live Tracking",
    body: "Check enabled fleet assets with fresh location status.",
    href: "/tracking/live",
  },
];

const companyCards = [
  {
    title: "Provider Vault",
    body: "Connect, test, and monitor fleet data providers.",
    href: "/admin/providers",
  },
  {
    title: "Asset Review",
    body: "Review imported provider assets waiting to become Nava intelligence vehicles.",
    href: "/admin/assets",
  },
  {
    title: "Client Visibility",
    body: "Create secure portal links for selected customers.",
    href: "/admin/client-visibility",
  },
  {
    title: "Company Settings",
    body: "Update operating context for better review suggestions and answers.",
    href: "/admin/company",
  },
  {
    title: "Geofences",
    body: "Create the places Nava should understand in daily operations.",
    href: "/geofences",
  },
];

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);

  useEffect(() => {
    loadAdminAccess();
  }, []);

  async function loadAdminAccess() {
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
        throw new Error(json.error || "Unable to load admin access.");
      }

      setRoles(
        (json.roles || []).map((role: string) => String(role).toLowerCase())
      );
      setCompanies(json.companies || []);
      setIsPlatformOwner(Boolean(json.is_platform_owner));
    } catch (err: any) {
      setError(err.message || "Unable to load admin access.");
    } finally {
      setLoading(false);
    }
  }

  const roleSet = new Set(roles);
  const isCompanyAdmin =
    isPlatformOwner || roleSet.has("platform_owner") || roleSet.has("owner") || roleSet.has("admin");
  const cards = isPlatformOwner ? platformCards : companyCards;
  const primaryCompany = companies[0];

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Loading admin tools...</div>
        </Panel>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="border-rose-300/30 bg-rose-500/10 p-6">
          <h1 className="text-2xl font-semibold text-rose-100">
            Admin tools unavailable
          </h1>
          <p className="mt-3 text-sm leading-6 text-rose-100">{error}</p>
          <div className="mt-5">
            <Link href="/dashboard">
              <PrimaryButton type="button">Back to Dashboard</PrimaryButton>
            </Link>
          </div>
        </Panel>
      </main>
    );
  }

  if (!isCompanyAdmin) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <div className="mx-auto max-w-4xl">
          <EmptyState
            dark
            title="Admin tools are for owners and admins."
            body="Your current role can use the operational workspace, but admin setup tools are reserved for company owners and admins."
            action={
              <Link href="/dashboard">
                <PrimaryButton type="button">Back to Dashboard</PrimaryButton>
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
          eyebrow={isPlatformOwner ? "Platform administration" : "Company administration"}
          title={isPlatformOwner ? "Platform Admin Hub" : "Company Admin Hub"}
          body={
            isPlatformOwner
              ? "Review platform setup work, provider operations, asset readiness, and customer visibility from one place."
              : "Manage the setup tools for your company workspace: providers, assets, customer links, settings, and geofences."
          }
          actions={
            <Link href="/dashboard">
              <PrimaryButton type="button" className="w-full sm:w-auto">
                Open Dashboard
              </PrimaryButton>
            </Link>
          }
        />

        <Panel dark className="mt-6 border-cyan-200/20 bg-cyan-300/10 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-cyan-50">
              {isPlatformOwner
                ? "Platform owner access"
                : primaryCompany?.name || "Company workspace"}
            </span>
            {roles.map((role) => (
              <StatusPill key={role} tone="info">
                {role}
              </StatusPill>
            ))}
          </div>
        </Panel>

        <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <Link key={card.href} href={card.href} className="group block">
              <Panel
                dark
                className="h-full p-5 transition group-hover:border-cyan-200/40 group-hover:bg-cyan-300/10"
              >
                <h2 className="text-lg font-semibold text-white">{card.title}</h2>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  {card.body}
                </p>
                <div className="mt-5 text-sm font-semibold text-cyan-100">
                  Open
                </div>
              </Panel>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}
