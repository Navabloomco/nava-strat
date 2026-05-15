"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

type CompanyOption = {
  id: string;
  name: string;
  slug: string;
};

export default function NavaEyeChatPage() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [errorDetail, setErrorDetail] = useState("");
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");

  useEffect(() => {
    initialize();
  }, []);

  async function initialize() {
    setInitializing(true);
    setErrorDetail("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return;
    }

    const res = await fetch("/api/companies", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setErrorDetail(json.error || "Unable to load companies");
      setInitializing(false);
      return;
    }

    const nextCompanies = json.companies || [];
    setCompanies(nextCompanies);
    setIsPlatformOwner(Boolean(json.is_platform_owner));
    setSelectedCompanyId(nextCompanies[0]?.id || "");
    setInitializing(false);
  }

  async function askNavaEye(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;

    setLoading(true);
    setAnswer("");
    setErrorDetail("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setErrorDetail("Session expired. Please log in again.");
      setLoading(false);
      return;
    }

    const payload: Record<string, string> = {
      question: question.trim(),
    };

    if (isPlatformOwner && selectedCompanyId) {
      payload.companyId = selectedCompanyId;
    }

    const res = await fetch("/api/nava-eye/copilot", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setErrorDetail(json.error || "Nava Eye could not answer that request.");
      setLoading(false);
      return;
    }

    setAnswer(json.answer || "Nava Eye returned no answer.");
    setLoading(false);
  }

  const showCompanySelector = isPlatformOwner || companies.length > 1;
  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId),
    [companies, selectedCompanyId]
  );

  if (initializing) {
    return <main style={{ padding: 40 }}>Loading Nava Eye...</main>;
  }

  return (
    <main style={{ padding: 40, maxWidth: 900 }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 30, fontWeight: 800, marginBottom: 8 }}>Nava Eye</h1>
        <p style={{ color: "#64748b", marginBottom: 16 }}>
          Ask company-scoped questions about fleet health, journeys, fuel risk,
          truck status, providers, and operations.
        </p>

        {showCompanySelector && (
          <label style={{ display: "block", maxWidth: 360 }}>
            <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>
              Company
            </span>
            <select
              value={selectedCompanyId}
              onChange={(e) => setSelectedCompanyId(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #cbd5e1",
                borderRadius: 8,
              }}
            >
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {!showCompanySelector && selectedCompany && (
          <p style={{ color: "#64748b", fontSize: 13 }}>
            Company: {selectedCompany.name}
          </p>
        )}
      </header>

      <form onSubmit={askNavaEye}>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask Nava Eye about fleet health, active journeys, trucks in Uganda, offline assets, or fuel risk."
          style={{
            width: "100%",
            height: 130,
            padding: 14,
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            fontSize: 14,
          }}
        />

        <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="submit"
            disabled={loading || !question.trim()}
            style={{
              background: "#0f172a",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "10px 16px",
              fontWeight: 800,
              cursor: loading ? "default" : "pointer",
              opacity: loading || !question.trim() ? 0.7 : 1,
            }}
          >
            {loading ? "Thinking..." : "Ask Nava Eye"}
          </button>
          {!answer && !errorDetail && (
            <span style={{ color: "#64748b", fontSize: 13 }}>
              Answers use authenticated company data only.
            </span>
          )}
        </div>
      </form>

      {errorDetail && (
        <pre style={errorBox}>
          {errorDetail}
        </pre>
      )}

      {answer && (
        <pre style={answerBox}>
          {answer}
        </pre>
      )}
    </main>
  );
}

const answerBox = {
  whiteSpace: "pre-wrap" as const,
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  padding: 20,
  borderRadius: 10,
  marginTop: 24,
  color: "#0f172a",
};

const errorBox = {
  whiteSpace: "pre-wrap" as const,
  background: "#fef2f2",
  border: "1px solid #fecaca",
  padding: 16,
  borderRadius: 10,
  marginTop: 24,
  color: "#991b1b",
};
