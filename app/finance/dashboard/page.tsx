"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import {
  EmptyState,
  PageHeader,
  Panel,
  PrimaryButton,
  StatusPill,
} from "../../components/ui/Primitives";

const financeCards = [
  {
    title: "Client Rates",
    body: "Configure client and route revenue rules controlled by finance.",
    href: "/finance/rate-rules",
  },
  {
    title: "Revenue Review",
    body: "Review Trip quantities, match configured rates, and apply revenue entries.",
    href: "/finance/revenue",
  },
  {
    title: "Fuel Ledger",
    body: "Review fuel records, allocation, and trip-level fuel totals.",
    href: "/fuel",
  },
  {
    title: "Add Fuel",
    body: "Capture a fuel entry and link it to an open trip when available.",
    href: "/fuel/new",
  },
  {
    title: "Add Expense",
    body: "Record trip costs, transaction fees, advances, and operating expenses.",
    href: "/expenses/new",
  },
  {
    title: "Management Dashboard",
    body: "Review contribution, revenue, costs, and client performance.",
    href: "/management/dashboard",
  },
  {
    title: "Create Trip",
    body: "Start a new trip so finance can review quantities and revenue later.",
    href: "/ops/journey/new",
  },
];

const allowedFinanceRoles = new Set([
  "platform_owner",
  "owner",
  "admin",
  "finance",
  "management",
]);

export default function FinanceDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);

  useEffect(() => {
    loadFinanceAccess();
  }, []);

  async function loadFinanceAccess() {
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
        throw new Error(json.error || "Unable to load finance access.");
      }

      setRoles(
        (json.roles || []).map((role: string) => String(role).toLowerCase())
      );
      setCompanies(json.companies || []);
      setIsPlatformOwner(Boolean(json.is_platform_owner));
    } catch (err: any) {
      setError(err.message || "Unable to load finance access.");
    } finally {
      setLoading(false);
    }
  }

  const roleSet = new Set(roles);
  const canUseFinanceHub =
    isPlatformOwner || roles.some((role) => allowedFinanceRoles.has(role));
  const primaryCompany = companies[0];

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Loading finance tools...</div>
        </Panel>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="border-rose-300/30 bg-rose-500/10 p-6">
          <h1 className="text-2xl font-semibold text-rose-100">
            Finance tools unavailable
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

  if (!canUseFinanceHub) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <div className="mx-auto max-w-4xl">
          <EmptyState
            dark
            title="Finance tools are for finance and management roles"
            body="Your current role can use the operational workspace, but finance setup and reporting tools are reserved for finance, management, and company admin roles."
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
          eyebrow="Finance workspace"
          title="Finance Hub"
          body="Manage trip revenue, fuel, expenses, and contribution review from one place."
          actions={
            <Link href="/finance/revenue">
              <PrimaryButton type="button" className="w-full sm:w-auto">
                Open Revenue Review
              </PrimaryButton>
            </Link>
          }
        />

        <Panel dark className="mt-6 border-cyan-200/20 bg-cyan-300/10 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 text-sm text-cyan-50">
              {isPlatformOwner
                ? "Platform owner access"
                : primaryCompany?.name || "Finance workspace"}
            </span>
            {roles.map((role) => (
              <StatusPill key={role} tone={roleSet.has("finance") ? "success" : "info"}>
                {role}
              </StatusPill>
            ))}
          </div>
        </Panel>

        <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {financeCards.map((card) => (
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
