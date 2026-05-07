"use client";

import RoleManager from "../components/admin/RoleManager";

export default function AdminPage() {
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
        <p
          style={{
            color: "#64748b",
            fontSize: 14
          }}
        >
          Manage organizational roles, access levels, and user security.
        </p>
      </header>

      {/* Access Control Section */}
      <section>
        <RoleManager />
      </section>

      <footer style={{ marginTop: 40, color: "#94a3b8", fontSize: "12px" }}>
        Nava Strat Security Protocol v1.0 — Logged in as SUPER_ADMIN
      </footer>
    </main>
  );
}
