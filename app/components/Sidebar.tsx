"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const [roles, setRoles] = useState({
    hasCompanyAccess: false,
    isOps: false,
    isFinance: false,
    isManagement: false,
    isAdmin: false,
    isPlatformOwner: false,
  });

  useEffect(() => {
    async function checkRoles() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setRoles({
          hasCompanyAccess: false,
          isOps: false,
          isFinance: false,
          isManagement: false,
          isAdmin: false,
          isPlatformOwner: false,
        });
        return;
      }

      const res = await fetch("/api/companies", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        setRoles({
          hasCompanyAccess: false,
          isOps: false,
          isFinance: false,
          isManagement: false,
          isAdmin: false,
          isPlatformOwner: false,
        });
        return;
      }

      const activeRoles = new Set(
        (json.roles || []).map((role: string) => String(role).toLowerCase())
      );
      const isAdminRole =
        Boolean(json.is_platform_owner) ||
        activeRoles.has("platform_owner") ||
        activeRoles.has("owner") ||
        activeRoles.has("admin");
      const isPlatformOwner =
        Boolean(json.is_platform_owner) || activeRoles.has("platform_owner");

      setRoles({
        hasCompanyAccess: (json.companies || []).length > 0,
        isOps: isAdminRole || activeRoles.has("ops"),
        isFinance: isAdminRole || activeRoles.has("finance"),
        isManagement: isAdminRole || activeRoles.has("management"),
        isAdmin: isAdminRole,
        isPlatformOwner,
      });
    }

    checkRoles().catch(() => {
      setRoles({
        hasCompanyAccess: false,
        isOps: false,
        isFinance: false,
        isManagement: false,
        isAdmin: false,
        isPlatformOwner: false,
      });
    });
  }, []);

  const navItems = [
    {
      name: "Dashboard",
      href: "/dashboard",
      show: roles.hasCompanyAccess,
    },
    {
      name: "Nava Eye",
      href: "/nava-eye",
      show: roles.hasCompanyAccess,
    },
    {
      name: "Operations",
      href: "/ops/dashboard",
      show: roles.isOps || roles.isAdmin,
    },
    {
      name: "Journeys",
      href: "/ops/journey",
      show: roles.isOps || roles.isAdmin,
    },
    {
      name: "Drivers",
      href: "/ops/drivers",
      show:
        roles.isOps || roles.isFinance || roles.isManagement || roles.isAdmin,
    },
    {
      name: "Live Tracking",
      href: "/tracking/live",
      show: roles.isOps || roles.isAdmin,
    },
    {
      name: "Geofences",
      href: "/geofences",
      show: roles.isOps || roles.isManagement || roles.isAdmin,
    },
    {
      name: "Finance",
      href: "/finance/dashboard",
      show: roles.isFinance || roles.isAdmin,
    },
    {
      name: "Fuel",
      href: "/fuel",
      show: roles.isFinance || roles.isAdmin,
    },
    {
      name: "Expenses",
      href: "/expenses",
      show: roles.isFinance || roles.isAdmin,
    },
    {
      name: "Revenue",
      href: "/finance/revenue",
      show: roles.isFinance || roles.isAdmin,
    },
    {
      name: "Management",
      href: "/management/dashboard",
      show: roles.isManagement || roles.isAdmin,
    },
    {
      name: "Admin",
      href: "/admin",
      show: roles.isAdmin,
    },
    {
      name: "Provider Onboarding",
      href: "/admin/providers", // Corrected path to the Admin Vault
      show: roles.isAdmin,
    },
    {
      name: "Company Settings",
      href: "/admin/company",
      show: roles.isAdmin,
    },
    {
      name: "Client Visibility",
      href: "/admin/client-visibility",
      show: roles.isAdmin,
    },
    {
      name: "Asset Review",
      href: "/admin/assets",
      show: roles.isAdmin,
    },
    {
      name: "Provider Requests",
      href: "/admin/provider-requests",
      show: roles.isPlatformOwner,
    },
  ];
  const visibleNavItems = navItems.filter((item) => item.show);

  function navLinkClass(active: boolean) {
    return active
      ? "rounded-md border border-cyan-200/20 bg-cyan-300/10 px-3 py-2.5 text-sm font-bold text-cyan-100"
      : "rounded-md px-3 py-2.5 text-sm font-medium text-slate-400 transition hover:bg-white/[0.05] hover:text-white";
  }

  return (
    <>
      <div className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 px-4 py-3 text-slate-100 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold tracking-normal text-white">
              Nava Strat
            </div>
            <div className="mt-0.5 hidden truncate text-[9px] font-bold uppercase tracking-[0.16em] text-cyan-200/70 min-[360px]:block">
              Fleet Intelligence
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMobileOpen((current) => !current)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nava-nav"
            className="shrink-0 rounded-md border border-cyan-200/20 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-300/10"
          >
            {mobileOpen ? "Close" : "Menu"}
          </button>
        </div>

        {mobileOpen && (
          <nav
            id="mobile-nava-nav"
            className="mt-3 grid max-h-[70vh] gap-1.5 overflow-y-auto rounded-lg border border-white/10 bg-slate-900 p-2 shadow-2xl shadow-black/30"
          >
            {visibleNavItems.map((item) => {
              const active = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`${navLinkClass(active)} whitespace-normal break-words`}
                >
                  {item.name}
                </Link>
              );
            })}
          </nav>
        )}
      </div>

      <aside className="fixed left-0 top-0 hidden h-screen w-[240px] border-r border-slate-800 bg-slate-950 px-4 py-5 text-slate-100 lg:block">
        <div className="mb-7 rounded-lg border border-cyan-200/10 bg-white/[0.04] px-4 py-4">
          <div className="text-lg font-semibold tracking-normal text-white">
            Nava Strat
          </div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200/70">
            Fleet Intelligence
          </div>
        </div>

        <nav className="flex flex-col gap-1.5">
          {visibleNavItems.map((item) => {
            const active = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={navLinkClass(active)}
              >
                {item.name}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
