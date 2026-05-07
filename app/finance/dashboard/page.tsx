"use client";

import FinancialEvidenceUploader from "../../components/FinancialEvidenceUploader";
import FinanceVerificationQueue from "../../components/FinanceVerificationQueue";

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
            marginBottom: 8,
            color: "#1e293b"
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

      {/* STEP 1: DATA INTAKE */}
      <section style={{ marginBottom: 40 }}>
        <FinancialEvidenceUploader />
      </section>

      <hr style={{ border: "0", borderTop: "1px solid #e2e8f0", margin: "40px 0" }} />

      {/* STEP 2: AUDIT & VERIFICATION */}
      <section>
        <header style={{ marginBottom: 15 }}>
          <h2 style={{ fontSize: 20, fontWeight: "bold", color: "#1e293b" }}>
            Audit & Verification
          </h2>
          <p style={{ color: "#64748b", fontSize: 13 }}>
            Review pending evidence and approve for financial reconciliation.
          </p>
        </header>
        
        <FinanceVerificationQueue />
      </section>
    </main>
  );
}
