"use client";

import { useEffect, useState } from "react";
import { requirePermission } from "../../../lib/hooks/requirePermission"; 
// Note the ../../../ to get back to your lib folder

export default function OpsDashboard() {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    async function check() {
      // Hardcoded bridge for now
      const result = await requirePermission(
        "contact@navabloomco.com",
        "ops"
      );

      setAllowed(result.allowed);
    }

    check();
  }, []);

  if (allowed === null) {
    return <main style={{ padding: 40 }}>Checking operations clearance...</main>;
  }

  if (!allowed) {
    return (
      <main style={{ padding: 40 }}>
        <h1 style={{ color: "#dc2626" }}>Access Denied</h1>
        <p>You do not have Operations clearance.</p>
      </main>
    );
  }

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
        <h1 style={{ fontSize: 32, fontWeight: "bold", color: "#1e293b" }}>
          Operations Control
        </h1>
        <p style={{ color: "#64748b", fontSize: 14 }}>
          Fleet status, journey tracking, and fuel management.
        </p>
      </header>

      <section>
        {/* PASTE YOUR EXISTING TRUCK GRID / OPS COMPONENTS HERE 
        */}
        <div style={{ padding: 20, background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0" }}>
            Fleet data is now secured.
        </div>
      </section>
    </main>
  );
}
