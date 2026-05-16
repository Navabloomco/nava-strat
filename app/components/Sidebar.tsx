"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function Sidebar() {
  const pathname = usePathname();

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
      name: "Live Tracking",
      href: "/tracking/live",
      show: roles.isOps || roles.isAdmin,
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
      href: "/expenses/new",
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
      name: "Provider Requests",
      href: "/admin/provider-requests",
      show: roles.isPlatformOwner,
    },
  ];

  return (
    <aside style={sidebarStyle}>
      <div style={logoStyle}>Nava Strat</div>

      <nav style={navGroup}>
        {navItems
          .filter((item) => item.show)
          .map((item) => {
            const active = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  ...linkStyle,
                  backgroundColor: active ? "#e2e8f0" : "transparent",
                  fontWeight: active ? 700 : 500,
                  color: active ? "#0f172a" : "#475569",
                }}
              >
                {item.name}
              </Link>
            );
          })}
      </nav>
    </aside>
  );
}

const sidebarStyle = {
  width: 240,
  backgroundColor: "#fff",
  borderRight: "1px solid #e2e8f0",
  height: "100vh",
  padding: 20,
  position: "fixed" as const,
  left: 0,
  top: 0,
  boxSizing: "border-box" as const,
};

const logoStyle = {
  fontSize: 20,
  fontWeight: 800,
  marginBottom: 40,
  color: "#1e293b",
};

const navGroup = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 8,
};

const linkStyle = {
  padding: "10px 14px",
  borderRadius: 8,
  textDecoration: "none",
  fontSize: 14,
  transition: "background-color 0.2s ease, color 0.2s ease",
};
