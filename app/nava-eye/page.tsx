"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  EmptyState,
  FormField,
  PageHeader,
  Panel,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
} from "../components/ui/Primitives";

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
  const suggestedQuestions = [
    "Which trucks are live right now?",
    "Which client is least profitable?",
    "Which assets have stale locations?",
    "Which route is bleeding money?",
    "What profit would I make at 4,500 per tonne with 28 tonnes, fuel 42,000 and per diem 3,000?",
  ];

  if (initializing) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Loading Nava Eye...</div>
        </Panel>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          dark
          eyebrow="Nava Eye"
          title="Fleet intelligence copilot"
          body="Ask questions about fleet health, journeys, fuel risk, truck status, providers, and operating performance."
          actions={
            selectedCompany ? (
              <StatusPill tone="info">{selectedCompany.name}</StatusPill>
            ) : undefined
          }
        />

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
          <Panel dark className="p-6">
            <form onSubmit={askNavaEye}>
              {showCompanySelector && (
                <FormField label="Company" dark>
                  <select
                    value={selectedCompanyId}
                    onChange={(e) => setSelectedCompanyId(e.target.value)}
                    className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300"
                  >
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                </FormField>
              )}

              <div className={showCompanySelector ? "mt-5" : ""}>
                <FormField label="Question" dark>
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ask Nava Eye about live fleet status, active journeys, offline assets, fuel risk, or profitability."
                    className="min-h-[150px] w-full resize-y rounded-md border border-white/10 bg-slate-900 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
                  />
                </FormField>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {suggestedQuestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setQuestion(suggestion)}
                    className="max-w-full whitespace-normal break-words rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-left text-xs font-medium leading-5 text-slate-300 hover:border-cyan-200/30 hover:bg-cyan-300/10 hover:text-cyan-100"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                <PrimaryButton type="submit" disabled={loading || !question.trim()} className="w-full sm:w-auto">
                  {loading ? "Thinking..." : "Ask Nava Eye"}
                </PrimaryButton>
                {question && (
                  <SecondaryButton
                    type="button"
                    onClick={() => {
                      setQuestion("");
                      setAnswer("");
                      setErrorDetail("");
                    }}
                    className="w-full sm:w-auto"
                  >
                    Clear
                  </SecondaryButton>
                )}
                {!answer && !errorDetail && (
                  <span className="text-sm text-slate-400">
                    Answers use only data available in your workspace.
                  </span>
                )}
              </div>
            </form>
          </Panel>

          <Panel dark className="p-6">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">
              Operating context
            </p>
            <h2 className="mt-3 text-xl font-semibold">Ask like an operator</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Nava Eye works best with direct operational questions about location,
              freshness, fuel, journey progress, client margin, and provider health.
            </p>
            <div className="mt-5 grid gap-3 text-sm text-slate-300">
              <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
                “Which trucks have not reported recently?”
              </div>
              <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
                “Which client should we renegotiate with?”
              </div>
              <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
                “Show fuel risk by active journey.”
              </div>
            </div>
          </Panel>
        </div>

        <div className="mt-6">
          {errorDetail && (
            <Panel dark className="border-rose-300/30 bg-rose-500/10 p-5">
              <p className="text-sm font-semibold text-rose-100">Nava Eye could not answer</p>
              <pre className="mt-3 whitespace-pre-wrap text-sm leading-6 text-rose-100">
                {errorDetail}
              </pre>
            </Panel>
          )}

          {answer && (
            <Panel dark className="p-6">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">
                Answer
              </p>
              <pre className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-100">
                {answer}
              </pre>
            </Panel>
          )}

          {!answer && !errorDetail && !loading && (
            <EmptyState
              dark
              title="No question asked yet"
              body="Start with a direct fleet, journey, fuel, provider, or profitability question."
            />
          )}
        </div>
      </div>
    </main>
  );
}
