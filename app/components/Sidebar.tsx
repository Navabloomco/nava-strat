"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "../../lib/supabase";

const EMPTY_ROLES = {
  hasCompanyAccess: false,
  isOps: false,
  isFinance: false,
  isManagement: false,
  isAdmin: false,
  isPlatformOwner: false,
};

type NavItem = {
  name: string;
  href: string;
  show: boolean;
};

type NavSection = {
  key: string;
  label?: string;
  collapsible?: boolean;
  items: NavItem[];
};

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sectionOpenOverrides, setSectionOpenOverrides] = useState<
    Record<string, boolean>
  >({});

  const [roles, setRoles] = useState(EMPTY_ROLES);

  function normalizeRole(role: any) {
    return String(role || "").trim().toLowerCase();
  }

  function buildRolesFromCompaniesPayload(json: any) {
    const activeRoles = new Set([
      ...((json.roles || []).map(normalizeRole) as string[]),
      ...((json.memberships || []).map((membership: any) =>
        normalizeRole(membership.role)
      ) as string[]),
    ]);
    const isPlatformOwner =
      json.is_platform_owner === true || activeRoles.has("platform_owner");
    const isAdminRole =
      isPlatformOwner || activeRoles.has("owner") || activeRoles.has("admin");
    const hasCompanyAccess =
      isPlatformOwner ||
      (json.companies || []).length > 0 ||
      (json.memberships || []).length > 0;

    return {
      hasCompanyAccess,
      isOps: isAdminRole || activeRoles.has("ops"),
      isFinance: isAdminRole || activeRoles.has("finance"),
      isManagement: isAdminRole || activeRoles.has("management"),
      isAdmin: isAdminRole,
      isPlatformOwner,
    };
  }

  useEffect(() => {
    async function checkRoles(accessToken?: string) {
      const {
        data: { session },
      } = accessToken
        ? { data: { session: { access_token: accessToken } } }
        : await supabase.auth.getSession();

      if (!session?.access_token) {
        setRoles(EMPTY_ROLES);
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
        setRoles(EMPTY_ROLES);
        return;
      }

      setRoles(buildRolesFromCompaniesPayload(json));
    }

    checkRoles().catch(() => {
      setRoles(EMPTY_ROLES);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      checkRoles(session?.access_token).catch(() => {
        setRoles(EMPTY_ROLES);
      });
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const navSections: NavSection[] = [
    {
      key: "primary",
      items: [
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
          name: "Admin",
          href: "/admin",
          show: roles.isAdmin,
        },
      ],
    },
    {
      key: "platform",
      label: "Platform",
      collapsible: true,
      items: [
        {
          name: "Platform Health",
          href: "/admin/health",
          show: roles.isPlatformOwner,
        },
        {
          name: "Tenant Billing",
          href: "/admin/tenants",
          show: roles.isPlatformOwner,
        },
        {
          name: "Pilot Readiness",
          href: "/admin/pilot-readiness",
          show: roles.isPlatformOwner,
        },
      ],
    },
    {
      key: "providers",
      label: "Providers",
      collapsible: true,
      items: [
        {
          name: "Provider Requests",
          href: "/admin/provider-requests",
          show: roles.isPlatformOwner,
        },
        {
          name: "Provider Onboarding",
          href: "/admin/providers",
          show: roles.isAdmin,
        },
        {
          name: "Provider Playbook",
          href: "/admin/provider-playbook",
          show: roles.isPlatformOwner,
        },
      ],
    },
    {
      key: "company-admin",
      label: "Company Admin",
      collapsible: true,
      items: [
        {
          name: "Asset Review",
          href: "/admin/assets",
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
      ],
    },
    {
      key: "fleet",
      label: "Fleet",
      collapsible: true,
      items: [
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
          name: "Spares",
          href: "/spares",
          show:
            roles.isOps || roles.isFinance || roles.isManagement || roles.isAdmin,
        },
      ],
    },
    {
      key: "business",
      label: "Business",
      collapsible: true,
      items: [
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
      ],
    },
  ];
  const visibleNavSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.show),
    }))
    .filter((section) => section.items.length > 0);

  function navLinkClass(active: boolean) {
    return active
      ? "block rounded-md border border-cyan-200/20 bg-cyan-300/10 px-3 py-2.5 text-sm font-bold text-cyan-100"
      : "block rounded-md px-3 py-2.5 text-sm font-medium text-slate-400 transition hover:bg-white/[0.05] hover:text-white";
  }

  function isNavItemActive(item: NavItem) {
    if (item.href === "/admin") return pathname === "/admin";
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  function sectionHasActiveItem(section: NavSection) {
    return section.items.some(isNavItemActive);
  }

  function defaultSectionOpen(section: NavSection) {
    if (!section.collapsible) return true;
    if (sectionHasActiveItem(section)) return true;
    if (
      roles.isPlatformOwner &&
      pathname.startsWith("/admin") &&
      ["platform", "providers", "company-admin"].includes(section.key)
    ) {
      return true;
    }
    return false;
  }

  function isSectionOpen(section: NavSection) {
    if (!section.collapsible) return true;
    return sectionOpenOverrides[section.key] ?? defaultSectionOpen(section);
  }

  function toggleSection(sectionKey: string) {
    setSectionOpenOverrides((current) => {
      const section = visibleNavSections.find((item) => item.key === sectionKey);
      const currentOpen = section
        ? current[section.key] ?? defaultSectionOpen(section)
        : current[sectionKey] ?? true;

      return {
        ...current,
        [sectionKey]: !currentOpen,
      };
    });
  }

  function sectionHeaderClass(first: boolean, interactive: boolean) {
    const spacing = first ? "" : "mt-2";
    const base = `${spacing} flex w-full items-center justify-between rounded-md px-3 py-1 text-left text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500`;
    return interactive
      ? `${base} transition hover:bg-white/[0.04] hover:text-slate-300`
      : base;
  }

  function renderNavSection(section: NavSection, sectionIndex: number, mobile: boolean) {
    const open = isSectionOpen(section);

    return (
      <div key={section.key} className="grid gap-1.5">
        {section.label && section.collapsible && (
          <button
            type="button"
            onClick={() => toggleSection(section.key)}
            className={sectionHeaderClass(sectionIndex === 0, true)}
            aria-expanded={open}
          >
            <span>{section.label}</span>
            <span className="text-xs text-slate-400">{open ? "-" : "+"}</span>
          </button>
        )}

        {section.label && !section.collapsible && (
          <div className={sectionHeaderClass(sectionIndex === 0, false)}>
            <span>{section.label}</span>
          </div>
        )}

        {open &&
          section.items.map((item) => {
            const active = isNavItemActive(item);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={mobile ? () => setMobileOpen(false) : undefined}
                className={`${navLinkClass(active)} whitespace-normal break-words`}
              >
                {item.name}
              </Link>
            );
          })}
      </div>
    );
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
            {visibleNavSections.map((section, sectionIndex) =>
              renderNavSection(section, sectionIndex, true)
            )}
          </nav>
        )}
      </div>

      <aside className="fixed left-0 top-0 hidden h-screen w-[240px] flex-col overflow-hidden border-r border-slate-800 bg-slate-950 px-4 py-5 text-slate-100 lg:flex">
        <div className="mb-5 shrink-0 rounded-lg border border-cyan-200/10 bg-white/[0.04] px-4 py-4">
          <div className="text-lg font-semibold tracking-normal text-white">
            Nava Strat
          </div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200/70">
            Fleet Intelligence
          </div>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
          {visibleNavSections.map((section, sectionIndex) =>
            renderNavSection(section, sectionIndex, false)
          )}
        </nav>
      </aside>
    </>
  );
}
