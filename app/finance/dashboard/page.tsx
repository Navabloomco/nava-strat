"use client";

import FinancialEvidenceUploader from "../../components/FinancialEvidenceUploader";

export default function FinanceDashboard() {
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
            marginBottom: 8
          }}
        >
          Finance Intelligence Center
        </h1>

        <p
          style={{
            color: "#64748b",
            fontSize: 14
          }}
        >
          Financial evidence, verification, reconciliation and audit workflows.
        </p>
      </header>

      <FinancialEvidenceUploader />
    </main>
  );
}
