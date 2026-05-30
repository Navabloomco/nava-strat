"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  FormField,
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

type CompanyMembership = {
  company_id: string | null;
  role: string | null;
  is_active?: boolean;
};

type NavaEyeConversation = {
  id: string;
  company_id: string;
  title: string;
  status: "open" | "closed";
  last_intent?: string | null;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
};

type NavaEyeMessage = {
  id: string;
  sender: "user" | "assistant" | "system";
  content: string;
  intent?: string | null;
  created_at: string;
};

type ConversationStatusTab = "open" | "closed";

const FINANCE_PROMPT_ROLES = new Set([
  "platform_owner",
  "owner",
  "admin",
  "finance",
  "management",
]);

function normalizeRole(role: unknown) {
  return String(role || "").trim().toLowerCase();
}

export default function NavaEyeChatPage() {
  const [question, setQuestion] = useState("");
  const [errorDetail, setErrorDetail] = useState("");
  const [setupRequired, setSetupRequired] = useState("");
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [memberships, setMemberships] = useState<CompanyMembership[]>([]);
  const [globalRoles, setGlobalRoles] = useState<string[]>([]);
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [queuedPrompt, setQueuedPrompt] = useState("");
  const [openConversations, setOpenConversations] = useState<NavaEyeConversation[]>([]);
  const [closedConversations, setClosedConversations] = useState<NavaEyeConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [conversationStatusTab, setConversationStatusTab] =
    useState<ConversationStatusTab>("open");
  const [messages, setMessages] = useState<NavaEyeMessage[]>([]);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [deleteConversationTarget, setDeleteConversationTarget] =
    useState<NavaEyeConversation | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const pendingConversationIdRef = useRef("");
  const queuedPromptConsumedRef = useRef("");

  useEffect(() => {
    initialize();
  }, []);

  useEffect(() => {
    if (selectedCompanyId) {
      loadConversationLists(selectedCompanyId, {
        preserveSelected: true,
        conversationId: pendingConversationIdRef.current,
      });
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    if (initializing) return;
    syncUrlState();
  }, [initializing, selectedCompanyId, selectedConversationId, conversationStatusTab]);

  useEffect(() => {
    if (initializing || !selectedCompanyId || !queuedPrompt.trim()) return;
    const prompt = queuedPrompt.trim();
    const promptKey = `${selectedCompanyId}:${prompt}`;
    if (queuedPromptConsumedRef.current === promptKey) return;
    queuedPromptConsumedRef.current = promptKey;
    setQueuedPrompt("");
    clearPromptQueryState();
    void submitNavaEyeQuestion(prompt, { forceNewConversation: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initializing, selectedCompanyId, queuedPrompt]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages.length, loading]);

  async function initialize() {
    setInitializing(true);
    setErrorDetail("");

    const token = await getAccessToken();
    if (!token) {
      window.location.href = "/login";
      return;
    }

    const res = await fetch("/api/companies", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setErrorDetail(json.error || "Unable to load companies");
      setInitializing(false);
      return;
    }

    const nextCompanies = json.companies || [];
    const params =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : new URLSearchParams();
    const requestedCompanyId = params.get("companyId") || "";
    const requestedConversationId = params.get("conversationId") || "";
    const requestedPrompt = params.get("prompt") || "";
    const requestedStatus = normalizeConversationStatus(
      params.get("status")
    );
    pendingConversationIdRef.current = requestedConversationId;
    setCompanies(nextCompanies);
    setMemberships(json.memberships || []);
    setGlobalRoles((json.roles || []).map(normalizeRole));
    setIsPlatformOwner(Boolean(json.is_platform_owner));
    setQueuedPrompt(requestedPrompt);
    setConversationStatusTab(requestedStatus || "open");
    setSelectedCompanyId(
      nextCompanies.some((company: CompanyOption) => company.id === requestedCompanyId)
        ? requestedCompanyId
        : nextCompanies[0]?.id || ""
    );
    setInitializing(false);
  }

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  async function loadConversationLists(
    companyId = selectedCompanyId,
    options: {
      preserveSelected?: boolean;
      conversationId?: string;
      skipSelectionUpdate?: boolean;
    } = {}
  ) {
    if (!companyId) return null;
    setConversationLoading(true);
    setSetupRequired("");
    setErrorDetail("");

    const token = await getAccessToken();
    if (!token) {
      setErrorDetail("Session expired. Please log in again.");
      setConversationLoading(false);
      return;
    }

    const [openRes, closedRes] = await Promise.all([
      fetch(`/api/nava-eye/conversations?status=open&companyId=${encodeURIComponent(companyId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`/api/nava-eye/conversations?status=closed&companyId=${encodeURIComponent(companyId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);
    const [openJson, closedJson] = await Promise.all([openRes.json(), closedRes.json()]);

    if (openJson.setup_required || closedJson.setup_required) {
      setSetupRequired(openJson.error || closedJson.error || "Nava Eye conversations need setup.");
      setOpenConversations([]);
      setClosedConversations([]);
      setConversationLoading(false);
      return null;
    }

    if (!openRes.ok || !openJson.success) {
      setErrorDetail(openJson.error || "Unable to load open conversations.");
    } else {
      setOpenConversations(openJson.conversations || []);
    }

    if (!closedRes.ok || !closedJson.success) {
      setErrorDetail(closedJson.error || "Unable to load closed conversations.");
    } else {
      setClosedConversations(closedJson.conversations || []);
    }

    const nextOpen = openRes.ok && openJson.success ? openJson.conversations || [] : [];
    const nextClosed = closedRes.ok && closedJson.success ? closedJson.conversations || [] : [];
    const nextAll = [...nextOpen, ...nextClosed];
    const requestedConversationId = options.conversationId || "";

    if (!options.skipSelectionUpdate) {
      if (requestedConversationId) {
        const requestedConversation = nextAll.find(
          (conversation: NavaEyeConversation) =>
            conversation.id === requestedConversationId
        );
        pendingConversationIdRef.current = "";
        if (requestedConversation) {
          setConversationStatusTab(requestedConversation.status);
          await loadConversation(requestedConversation.id);
        } else if (!options.preserveSelected) {
          setSelectedConversationId("");
          setMessages([]);
        }
      } else if (options.preserveSelected && selectedConversationId) {
        const stillAccessible = nextAll.some(
          (conversation: NavaEyeConversation) =>
            conversation.id === selectedConversationId
        );
        if (!stillAccessible) {
          setSelectedConversationId("");
          setMessages([]);
        }
      }
    }

    setConversationLoading(false);
    return { open: nextOpen, closed: nextClosed };
  }

  async function loadConversation(conversationId: string) {
    setConversationLoading(true);
    setErrorDetail("");
    setSetupRequired("");

    const token = await getAccessToken();
    if (!token) {
      setErrorDetail("Session expired. Please log in again.");
      setConversationLoading(false);
      return;
    }

    const res = await fetch(`/api/nava-eye/conversations/${conversationId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();

    if (json.setup_required) {
      setSetupRequired(json.error || "Nava Eye conversations need setup.");
      setConversationLoading(false);
      return;
    }

    if (!res.ok || !json.success) {
      setErrorDetail(json.error || "Unable to load this conversation.");
      setConversationLoading(false);
      return;
    }

    setSelectedConversationId(conversationId);
    if (json.conversation?.status === "open" || json.conversation?.status === "closed") {
      setConversationStatusTab(json.conversation.status);
    }
    setMessages(json.messages || []);
    setConversationLoading(false);
  }

  async function createConversation(title?: string) {
    const token = await getAccessToken();
    if (!token) {
      setErrorDetail("Session expired. Please log in again.");
      return null;
    }

    const res = await fetch("/api/nava-eye/conversations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        companyId: selectedCompanyId,
        title: title || "New Nava Eye conversation",
      }),
    });
    const json = await res.json();

    if (json.setup_required) {
      setSetupRequired(json.error || "Nava Eye conversations need setup.");
      return null;
    }

    if (!res.ok || !json.success) {
      setErrorDetail(json.error || "Unable to create a Nava Eye conversation.");
      return null;
    }

    await loadConversationLists(selectedCompanyId);
    setSelectedConversationId(json.conversation.id);
    setConversationStatusTab("open");
    setMessages([]);
    return json.conversation as NavaEyeConversation;
  }

  async function startNewConversation() {
    setQuestion("");
    setMessages([]);
    setSelectedConversationId("");
    setConversationStatusTab("open");
    setCloseConfirmOpen(false);
    setDeleteConversationTarget(null);
    await createConversation();
  }

  async function askNavaEye(e: FormEvent) {
    e.preventDefault();
    const nextQuestion = question.trim();
    await submitNavaEyeQuestion(nextQuestion);
  }

  async function submitNavaEyeQuestion(
    nextQuestion: string,
    options: { forceNewConversation?: boolean } = {}
  ) {
    if (!nextQuestion || !selectedCompanyId) return;
    if (!options.forceNewConversation && selectedConversation?.status === "closed") return;

    setLoading(true);
    setErrorDetail("");
    setSetupRequired("");

    const token = await getAccessToken();
    if (!token) {
      setErrorDetail("Session expired. Please log in again.");
      setLoading(false);
      return;
    }

    if (options.forceNewConversation) {
      setSelectedConversationId("");
      setMessages([]);
      setConversationStatusTab("open");
    }

    let conversationId = options.forceNewConversation ? "" : selectedConversationId;
    if (!conversationId) {
      const conversation = await createConversation(nextQuestion);
      conversationId = conversation?.id || "";
    }

    if (!conversationId) {
      setLoading(false);
      return;
    }

    const optimisticUserMessage: NavaEyeMessage = {
      id: `pending-${Date.now()}`,
      sender: "user",
      content: nextQuestion,
      created_at: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimisticUserMessage]);
    setQuestion("");

    const res = await fetch("/api/nava-eye/copilot", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question: nextQuestion,
        companyId: selectedCompanyId,
        conversation_id: conversationId,
      }),
    });
    const json = await res.json();

    if (json.setup_required) {
      setSetupRequired(json.error || "Nava Eye conversations need setup.");
      setLoading(false);
      return;
    }

    if (!res.ok || !json.success) {
      setErrorDetail(json.error || "Nava Eye could not answer that request.");
      setLoading(false);
      return;
    }

    await loadConversation(conversationId);
    await loadConversationLists(selectedCompanyId);
    setLoading(false);
  }

  function requestCloseConversation() {
    if (!selectedConversationId || selectedConversation?.status === "closed") return;
    setCloseConfirmOpen(true);
  }

  async function closeConversation() {
    if (!selectedConversationId || selectedConversation?.status === "closed") return;
    setLoading(true);
    setErrorDetail("");

    const token = await getAccessToken();
    if (!token) {
      setErrorDetail("Session expired. Please log in again.");
      setLoading(false);
      setCloseConfirmOpen(false);
      return;
    }

    const res = await fetch(`/api/nava-eye/conversations/${selectedConversationId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "closed" }),
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setErrorDetail(json.error || "Unable to close this conversation.");
      setLoading(false);
      setCloseConfirmOpen(false);
      return;
    }

    await loadConversationLists(selectedCompanyId, {
      skipSelectionUpdate: true,
    });
    setConversationStatusTab("open");
    setSelectedConversationId("");
    setMessages([]);
    setQuestion("");
    setCloseConfirmOpen(false);
    setLoading(false);
  }

  async function deleteConversation(conversation: NavaEyeConversation | null) {
    if (!conversation) return;
    setLoading(true);
    setErrorDetail("");

    const token = await getAccessToken();
    if (!token) {
      setErrorDetail("Session expired. Please log in again.");
      setLoading(false);
      setDeleteConversationTarget(null);
      return;
    }

    const res = await fetch(`/api/nava-eye/conversations/${conversation.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();

    if (json.setup_required) {
      setSetupRequired(json.error || "Conversation delete needs setup.");
      setLoading(false);
      setDeleteConversationTarget(null);
      return;
    }

    if (!res.ok || !json.success) {
      setErrorDetail(json.error || "Unable to delete this conversation.");
      setLoading(false);
      setDeleteConversationTarget(null);
      return;
    }

    if (selectedConversationId === conversation.id) {
      setSelectedConversationId("");
      setMessages([]);
      setQuestion("");
      setConversationStatusTab("open");
    }

    await loadConversationLists(selectedCompanyId, {
      skipSelectionUpdate: true,
    });
    setDeleteConversationTarget(null);
    setLoading(false);
  }

  function syncUrlState() {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (selectedCompanyId) params.set("companyId", selectedCompanyId);
    else params.delete("companyId");
    if (selectedConversationId) params.set("conversationId", selectedConversationId);
    else params.delete("conversationId");
    params.set("status", conversationStatusTab);
    params.delete("prompt");
    params.delete("contextType");
    params.delete("contextId");
    const nextUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", nextUrl);
  }

  function clearPromptQueryState() {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.delete("prompt");
    params.delete("contextType");
    params.delete("contextId");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }

  const showCompanySelector = isPlatformOwner || companies.length > 1;
  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId),
    [companies, selectedCompanyId]
  );
  const allConversations = useMemo(
    () => [...openConversations, ...closedConversations],
    [openConversations, closedConversations]
  );
  const selectedConversation = useMemo(
    () => allConversations.find((conversation) => conversation.id === selectedConversationId) || null,
    [allConversations, selectedConversationId]
  );
  const canShowFinancePrompt = useMemo(() => {
    if (isPlatformOwner) return true;
    const companyRoles = memberships
      .filter((membership) => membership.company_id === selectedCompanyId)
      .map((membership) => normalizeRole(membership.role));
    const effectiveRoles = companyRoles.length ? companyRoles : globalRoles;
    return effectiveRoles.some((role) => FINANCE_PROMPT_ROLES.has(role));
  }, [globalRoles, isPlatformOwner, memberships, selectedCompanyId]);

  const suggestedQuestions = useMemo(() => {
    const prompts = [
      "What needs attention today?",
      "Which trucks are stale?",
      "What has this truck been up to today?",
      "Which Trips need review?",
    ];

    if (canShowFinancePrompt) {
      prompts.push("What should finance review?");
    }

    return prompts;
  }, [canShowFinancePrompt]);
  const contextualQuestions = useMemo(() => {
    const prompts = [
      "Show timeline",
      "What should I do about it?",
      "How did you calculate that?",
      "Where is it now?",
    ];

    if (canShowFinancePrompt) {
      prompts.push("What should finance review?");
    }

    return prompts;
  }, [canShowFinancePrompt]);
  const emptyPromptGroups = useMemo(() => {
    const groups = [
      {
        title: "Live fleet",
        prompts: [
          "Which trucks are stale?",
          "Which trucks are live right now?",
          "What has this truck been up to today?",
        ],
      },
      {
        title: "Trips",
        prompts: [
          "Which Trips need review?",
          "What is blocking Trip review?",
          "Which expenses need proof?",
        ],
      },
      {
        title: "Provider setup",
        prompts: [
          "What provider setup should I fix first?",
          "Does my tracking provider expose fuel?",
          "Why is distance GPS-derived?",
        ],
      },
    ];

    if (canShowFinancePrompt) {
      groups.splice(2, 0, {
        title: "Finance review",
        prompts: [
          "What should finance review?",
          "Which Trips need revenue review?",
          "Which Trips have no matching rate?",
        ],
      });
    }

    return groups;
  }, [canShowFinancePrompt]);
  const visibleConversations =
    conversationStatusTab === "open" ? openConversations : closedConversations;
  const selectedConversationHasAssistantMessage = messages.some(
    (message) => message.sender === "assistant"
  );
  const composerPrompts = selectedConversationHasAssistantMessage
    ? contextualQuestions
    : suggestedQuestions;

  if (initializing) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <div className="mx-auto flex min-h-[70vh] max-w-5xl items-center justify-center">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-slate-300 shadow-2xl">
            Loading Nava Eye...
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_34rem)] px-3 py-4 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4 lg:min-h-[calc(100vh-2rem)]">
        <header className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-4 shadow-2xl shadow-slate-950/30 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-200">
                Nava Eye
              </p>
              {selectedCompany && <StatusPill tone="info">{selectedCompany.name}</StatusPill>}
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Private fleet intelligence workspace
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Ask source-grounded questions across live fleet, Trips, providers,
              evidence, finance review, and management actions.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SecondaryButton
              type="button"
              onClick={startNewConversation}
              disabled={!selectedCompanyId || loading}
            >
              New conversation
            </SecondaryButton>
            {selectedConversation?.status === "open" && (
              <SecondaryButton
                type="button"
                onClick={requestCloseConversation}
                disabled={loading}
              >
                Close
              </SecondaryButton>
            )}
            {selectedConversation?.status === "closed" && (
              <StatusPill tone="neutral">Closed</StatusPill>
            )}
          </div>
        </header>

        <div className="grid min-w-0 flex-1 gap-4 lg:grid-cols-[290px_minmax(0,1fr)] xl:grid-cols-[310px_minmax(0,1fr)]">
          <aside className="min-w-0 rounded-2xl border border-white/10 bg-slate-900/70 p-3 shadow-xl shadow-slate-950/30 lg:max-h-[calc(100vh-8.5rem)] lg:overflow-y-auto">
            <div className="flex items-center justify-between gap-3 px-1">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">
                  Threads
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Your company-scoped investigations.
                </p>
              </div>
              <button
                type="button"
                onClick={startNewConversation}
                disabled={!selectedCompanyId || loading}
                className="rounded-md border border-cyan-200/25 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-cyan-200/45 hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                New
              </button>
            </div>

            {showCompanySelector && (
              <div className="mt-5">
                <FormField label="Company" dark>
                  <select
                    value={selectedCompanyId}
                    onChange={(e) => setSelectedCompanyId(e.target.value)}
                    className="w-full rounded-md border border-white/10 bg-slate-950/80 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300"
                  >
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
            )}

            {conversationLoading && (
              <p className="mt-5 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-400">
                Loading conversations...
              </p>
            )}

            <div className="mt-5 grid grid-cols-2 gap-1 rounded-full border border-white/10 bg-slate-950/60 p-1">
              {(["open", "closed"] as ConversationStatusTab[]).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setConversationStatusTab(status)}
                  className={`rounded-full px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] transition ${
                    conversationStatusTab === status
                      ? "bg-cyan-300 text-slate-950"
                      : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                  }`}
                >
                  {status === "open" ? "Open" : "Closed"}
                </button>
              ))}
            </div>

            <ConversationGroup
              title={conversationStatusTab === "open" ? "Open conversations" : "Closed conversations"}
              emptyText={
                conversationStatusTab === "open"
                  ? "No open threads yet."
                  : "No closed threads yet."
              }
              conversations={visibleConversations}
              selectedConversationId={selectedConversationId}
              onSelect={loadConversation}
              onDelete={(conversation) => setDeleteConversationTarget(conversation)}
            />
          </aside>

          <section className="flex min-h-[78vh] min-w-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70 shadow-2xl shadow-slate-950/40 lg:min-h-[calc(100vh-8.5rem)]">
            <div className="flex flex-col gap-3 border-b border-white/10 bg-white/[0.035] px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-cyan-200/25 bg-cyan-300/10 px-2.5 py-1 text-xs font-semibold text-cyan-100">
                    {selectedConversation?.status === "closed"
                      ? "Read-only thread"
                      : selectedConversationId
                        ? "Scoped thread"
                        : "New workspace"}
                  </span>
                  {selectedConversationHasAssistantMessage && (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-300">
                      Follow-ups stay in this context
                    </span>
                  )}
                </div>
                <h2 className="mt-2 truncate text-lg font-semibold text-white sm:text-xl">
                  {selectedConversation?.title || "Ask Nava Eye"}
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedConversation?.status === "open" && (
                  <button
                    type="button"
                    onClick={requestCloseConversation}
                    disabled={loading}
                    className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-300 hover:border-cyan-200/35 hover:bg-cyan-300/10 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Close thread
                  </button>
                )}
                {selectedConversation && (
                  <button
                    type="button"
                    onClick={() => setDeleteConversationTarget(selectedConversation)}
                    disabled={loading}
                    className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-400 hover:border-rose-300/30 hover:bg-rose-500/10 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
              <div className="mx-auto flex max-w-4xl flex-col gap-5">
                {setupRequired && (
                  <Panel dark className="border-amber-300/30 bg-amber-500/10 p-5">
                    <p className="text-sm font-semibold text-amber-100">Conversation setup required</p>
                    <p className="mt-2 text-sm leading-6 text-amber-100">{setupRequired}</p>
                  </Panel>
                )}

                {errorDetail && (
                  <Panel dark className="border-rose-300/30 bg-rose-500/10 p-5">
                    <p className="text-sm font-semibold text-rose-100">Nava Eye could not continue</p>
                    <pre className="mt-3 whitespace-pre-wrap text-sm leading-6 text-rose-100">
                      {errorDetail}
                    </pre>
                  </Panel>
                )}

                {!selectedConversationId && !messages.length && !setupRequired && !errorDetail && (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-7">
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-200">
                      Ask Nava Eye
                    </p>
                    <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">
                      Source-grounded answers from your fleet workspace.
                    </h2>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                      Start with a focused question or choose a prompt. Nava Eye
                      will keep the thread context for follow-ups until you close
                      or clear the conversation.
                    </p>
                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                      {emptyPromptGroups.map((group) => (
                        <div
                          key={group.title}
                          className="rounded-xl border border-white/10 bg-slate-950/55 p-4"
                        >
                          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                            {group.title}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {group.prompts.map((prompt) => (
                              <button
                                key={prompt}
                                type="button"
                                onClick={() => setQuestion(prompt)}
                                disabled={loading || Boolean(setupRequired)}
                                className="rounded-full border border-cyan-200/20 bg-cyan-300/10 px-3 py-1.5 text-left text-xs font-semibold leading-5 text-cyan-100 hover:border-cyan-200/45 hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {prompt}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex min-w-0 ${
                      message.sender === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <article
                      className={`w-full max-w-3xl rounded-2xl border px-4 py-3 shadow-lg sm:w-auto sm:px-5 sm:py-4 ${
                        message.sender === "user"
                          ? "border-cyan-200/25 bg-cyan-300/10 text-cyan-50"
                          : "border-white/10 bg-white/[0.045] text-slate-100"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                          {message.sender === "user" ? "You" : "Nava Eye"}
                        </p>
                        <p className="shrink-0 text-xs text-slate-600">
                          {formatMessageTime(message.created_at)}
                        </p>
                      </div>
                      <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-7">
                        {message.content}
                      </pre>
                    </article>
                  </div>
                ))}

                {loading && (
                  <div className="w-full max-w-3xl rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100 sm:w-auto">
                    Nava Eye is checking the current company data...
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            <form
              onSubmit={askNavaEye}
              className="sticky bottom-0 border-t border-white/10 bg-slate-950/95 px-4 py-4 backdrop-blur sm:px-6"
            >
              <div className="mx-auto max-w-4xl">
                <div className="mb-3 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
                  {composerPrompts.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setQuestion(suggestion)}
                      disabled={selectedConversation?.status === "closed" || loading || Boolean(setupRequired)}
                      className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-left text-xs font-semibold leading-5 text-slate-300 hover:border-cyan-200/35 hover:bg-cyan-300/10 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-2 shadow-xl shadow-slate-950/40 focus-within:border-cyan-300/55">
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder={
                      selectedConversation?.status === "closed"
                        ? "This conversation is closed."
                        : "Ask Nava Eye about trucks, Trips, providers, finance review, or what needs attention..."
                    }
                    disabled={selectedConversation?.status === "closed" || loading || Boolean(setupRequired)}
                    className="min-h-[76px] w-full resize-none rounded-xl border-0 bg-transparent px-3 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[92px]"
                  />
                  <div className="flex flex-col gap-3 border-t border-white/10 px-2 pb-1 pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-xs text-slate-500">
                      Role and company permissions are checked on every message.
                    </span>
                    <div className="flex gap-2">
                      {question && (
                        <SecondaryButton
                          type="button"
                          onClick={() => {
                            setQuestion("");
                            setErrorDetail("");
                          }}
                          disabled={loading}
                        >
                          Clear
                        </SecondaryButton>
                      )}
                      <PrimaryButton
                        type="submit"
                        disabled={
                          loading ||
                          !question.trim() ||
                          !selectedCompanyId ||
                          selectedConversation?.status === "closed" ||
                          Boolean(setupRequired)
                        }
                      >
                        {loading ? "Checking..." : "Ask"}
                      </PrimaryButton>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </section>
        </div>
      </div>
      {closeConfirmOpen && (
        <CloseConversationDialog
          loading={loading}
          onCancel={() => setCloseConfirmOpen(false)}
          onConfirm={closeConversation}
        />
      )}
      {deleteConversationTarget && (
        <DeleteConversationDialog
          conversation={deleteConversationTarget}
          loading={loading}
          onCancel={() => setDeleteConversationTarget(null)}
          onConfirm={() => deleteConversation(deleteConversationTarget)}
        />
      )}
    </main>
  );
}

function ConversationGroup({
  title,
  emptyText,
  conversations,
  selectedConversationId,
  onSelect,
  onDelete,
}: {
  title: string;
  emptyText: string;
  conversations: NavaEyeConversation[];
  selectedConversationId: string;
  onSelect: (conversationId: string) => void;
  onDelete: (conversation: NavaEyeConversation) => void;
}) {
  return (
    <div className="mt-6">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{title}</p>
      <div className="mt-3 space-y-2">
        {conversations.length === 0 && (
          <p className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-500">
            {emptyText}
          </p>
        )}
        {conversations.map((conversation) => {
          const active = conversation.id === selectedConversationId;
          return (
            <div
              key={conversation.id}
              className={`w-full rounded-lg border p-3 text-left transition ${
                active
                  ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-50"
                  : "border-white/10 bg-white/[0.04] text-slate-300 hover:border-cyan-200/30 hover:bg-cyan-300/10"
              }`}
            >
              <div className="flex min-w-0 items-start gap-2">
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm font-semibold">{conversation.title}</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {conversation.last_intent || conversation.status} · {formatMessageTime(conversation.updated_at)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(conversation);
                  }}
                  className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-xs font-semibold text-slate-400 hover:border-rose-300/30 hover:bg-rose-500/10 hover:text-rose-100"
                  aria-label={`Delete ${conversation.title}`}
                  title="Delete conversation"
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DeleteConversationDialog({
  conversation,
  loading,
  onCancel,
  onConfirm,
}: {
  conversation: NavaEyeConversation;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 px-4 py-5 sm:items-center">
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-slate-900 p-5 shadow-2xl">
        <h2 className="text-lg font-semibold text-white">Delete this conversation?</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          This removes the thread from your Nava Eye conversation list. It does
          not delete other users&apos; conversations.
        </p>
        <p className="mt-3 truncate rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
          {conversation.title}
        </p>
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <SecondaryButton
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="w-full sm:w-auto"
          >
            Cancel
          </SecondaryButton>
          <PrimaryButton
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="w-full bg-rose-500 text-white hover:bg-rose-400 sm:w-auto"
          >
            {loading ? "Deleting..." : "Delete conversation"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function CloseConversationDialog({
  loading,
  onCancel,
  onConfirm,
}: {
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 px-4 py-5 sm:items-center">
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-slate-900 p-5 shadow-2xl">
        <h2 className="text-lg font-semibold text-white">Close this conversation?</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          This removes it from your active conversations. You can still find it
          under Closed conversations.
        </p>
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <SecondaryButton
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="w-full sm:w-auto"
          >
            Cancel
          </SecondaryButton>
          <PrimaryButton
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="w-full sm:w-auto"
          >
            {loading ? "Closing..." : "Close conversation"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function formatMessageTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-KE", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function normalizeConversationStatus(value: string | null): ConversationStatusTab | null {
  const status = String(value || "").trim().toLowerCase();
  if (status === "open" || status === "closed") return status;
  return null;
}
