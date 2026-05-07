"use client";

import { useEffect, useState } from "react";
import RoleManager from "../components/admin/RoleManager";
import { requirePermission } from "../../lib/hooks/requirePermission";

export default function AdminPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    async function check() {
      // Hardcoded bridge until we wire up Supabase Auth Session
      const result = await requirePermission(
        "contact@navabloomco.com", 
        "admin"
      );

      setAllowed(result.allowed);
    }

    check();
  }, []);

  // 1. LOADING STATE
  if (allowed === null) {
    return <main style={{ padding: 40 }}>Checking access credentials...</main>;
  }

  // 2. DENIED STATE
  if (!allowed) {
    return (
      <main style={{ padding: 40 }}>
        <h1 style={{ color: "#dc2626" }}>Access Denied</h1>
        <p>You do not have the required SUPER_ADMIN clearance to view System Administration.</p>
      </main>
    );
  }

  // 3. AUTHORIZED STATE
  return (
    <main
      style={{
        padding: 40,
        background: "#f8fafc",
        minHeight: "100vh",
        fontFamily: "sans-serif"
      }}
    >
      <header style={{ marginBottom: 30 }}>
        <h1
          style={{
            fontSize: 32,
            fontWeight: "bold",
            marginBottom: 8,
            color: "#1e293b"
          }}
        >
          System Administration
        </h1>

        <p style={{ color: "#64748b", fontSize: 14 }}>
          Manage organizational roles, access levels, and user security.
        </p>
      </header>

      <section>
        <RoleManager />
      </section>

      <footer style={{ marginTop: 40, color: "#94a3b8", fontSize: 12 }}>
        Nava Strat Security Protocol v1.0
      </footer>
    </main>
  );
}
