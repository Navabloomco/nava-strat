"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { requirePermission } from "../../lib/hooks/requirePermission";

export default function Sidebar() {
  const pathname = usePathname();

  const [roles, setRoles] = useState({
    isOps: false,
    isFinance: false,
    isManagement: false,
    isAdmin: false,
  });

  useEffect(() => {
    async function checkRoles() {
      // Current bridge email for the Super Admin
      const userEmail = "contact@navabloomco.com";

      const ops = await requirePermission(userEmail, "ops");
      const finance = await requirePermission(userEmail, "finance");
      const management = await requirePermission(userEmail, "management");
      const admin = await requirePermission(userEmail, "admin");

      setRoles({
        isOps: ops.allowed,
        isFinance: finance.allowed,
        isManagement: management.allowed,
        isAdmin: admin.allowed,
      });
    }

    checkRoles();
  }, []);

  const navItems = [
    {
      name: "Nava Eye",
      href: "/nava-eye",
      show: true, // Always accessible for general AI queries
    },
    {
      name: "Operations",
      href: "/ops/dashboard",
      show: roles.isOps || roles.isAdmin,
    },
    {
      name: "Finance",
      href: "/finance/dashboard",
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
      href: "/onboarding",
      show: roles.isAdmin,
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
};
