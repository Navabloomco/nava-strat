"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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

export default function NavaEyeChatPage() {
  const [question, setQuestion] = useState("");
  const [errorDetail, setErrorDetail] = useState("");
  const [setupRequired, setSetupRequired] = useState("");
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [openConversations, setOpenConversations] = useState<NavaEyeConversation[]>([]);
  const [closedConversations, setClosedConversations] = useState<NavaEyeConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [conversationStatusTab, setConversationStatusTab] =
    useState<ConversationStatusTab>("open");
  const [messages, setMessages] = useState<NavaEyeMessage[]>([]);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const pendingConversationIdRef = useRef("");

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
    const requestedStatus = normalizeConversationStatus(
      params.get("status")
    );
    pendingConversationIdRef.current = requestedConversationId;
    setCompanies(nextCompanies);
    setIsPlatformOwner(Boolean(json.is_platform_owner));
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
    await createConversation();
  }

  async function askNavaEye(e: FormEvent) {
    e.preventDefault();
    const nextQuestion = question.trim();
    if (!nextQuestion || !selectedCompanyId || selectedConversation?.status === "closed") return;

    setLoading(true);
    setErrorDetail("");
    setSetupRequired("");

    const token = await getAccessToken();
    if (!token) {
      setErrorDetail("Session expired. Please log in again.");
      setLoading(false);
      return;
    }

    let conversationId = selectedConversationId;
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
    const closingConversationId = selectedConversationId;
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

    const lists = await loadConversationLists(selectedCompanyId, {
      skipSelectionUpdate: true,
    });
    const nextOpen = (lists?.open || []).find(
      (conversation: NavaEyeConversation) =>
        conversation.id !== closingConversationId
    );
    if (nextOpen) {
      setConversationStatusTab("open");
      await loadConversation(nextOpen.id);
    } else {
      setConversationStatusTab("open");
      setSelectedConversationId("");
      setMessages([]);
    }
    setCloseConfirmOpen(false);
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
    const nextUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", nextUrl);
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
  const suggestedQuestions = [
    "Which trucks are live right now?",
    "Which assets have stale locations?",
    "Where is KCW 103Z?",
    "Is KDQ265 siphoning fuel?",
    "Why is KDQ265 always stopping?",
  ];
  const visibleConversations =
    conversationStatusTab === "open" ? openConversations : closedConversations;
  const selectedConversationHasAssistantMessage = messages.some(
    (message) => message.sender === "assistant"
  );

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
      <div className="mx-auto max-w-7xl">
        <PageHeader
          dark
          eyebrow="Nava Eye"
          title="Investigation threads"
          body="Start a short company-scoped investigation, follow the thread, then close it when the answer is handled."
          actions={
            selectedCompany ? (
              <StatusPill tone="info">{selectedCompany.name}</StatusPill>
            ) : undefined
          }
        />

        <div className="mt-8 grid min-w-0 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Panel dark className="min-w-0 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">
                  Conversations
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Your investigation threads only.
                </p>
              </div>
              <SecondaryButton type="button" onClick={startNewConversation} disabled={!selectedCompanyId || loading}>
                New
              </SecondaryButton>
            </div>

            {showCompanySelector && (
              <div className="mt-5">
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
              </div>
            )}

            {conversationLoading && (
              <p className="mt-5 text-sm text-slate-400">Loading conversations...</p>
            )}

            <div className="mt-5 grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-1">
              {(["open", "closed"] as ConversationStatusTab[]).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setConversationStatusTab(status)}
                  className={`rounded-md px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] transition ${
                    conversationStatusTab === status
                      ? "bg-cyan-300/15 text-cyan-100"
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
            />
          </Panel>

          <Panel dark className="flex min-h-[75vh] min-w-0 flex-col overflow-hidden p-0 lg:min-h-[640px]">
            <div className="flex flex-col gap-3 border-b border-white/10 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">
                  Thread
                </p>
                <h2 className="mt-2 truncate text-xl font-semibold text-white">
                  {selectedConversation?.title || "New investigation"}
                </h2>
                {selectedConversation?.status === "closed" && (
                  <p className="mt-1 text-sm text-slate-400">Conversation closed. This thread is read-only.</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedConversation?.status === "open" && (
                  <SecondaryButton type="button" onClick={requestCloseConversation} disabled={loading}>
                    Close conversation
                  </SecondaryButton>
                )}
                {selectedConversation?.status === "closed" && (
                  <StatusPill tone="neutral">Closed</StatusPill>
                )}
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
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
                <EmptyState
                  dark
                  title="Start a Nava Eye conversation"
                  body="Ask a direct fleet, journey, fuel, provider, or profitability question. Nava Eye will keep the short follow-up context inside this thread."
                />
              )}

              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`min-w-0 rounded-lg border p-4 ${
                    message.sender === "user"
                      ? "border-cyan-300/20 bg-cyan-300/10"
                      : "border-white/10 bg-white/[0.04]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                      {message.sender === "user" ? "You" : "Nava Eye"}
                    </p>
                    <p className="text-xs text-slate-500">{formatMessageTime(message.created_at)}</p>
                  </div>
                  <pre className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-100">
                    {message.content}
                  </pre>
                </div>
              ))}

              {loading && (
                <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm text-cyan-100">
                  Nava Eye is checking the current company data...
                </div>
              )}

              {selectedConversation?.status === "open" &&
                selectedConversationHasAssistantMessage && (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-sm text-slate-300">
                      Done with this investigation?
                    </p>
                    <SecondaryButton
                      type="button"
                      onClick={requestCloseConversation}
                      disabled={loading}
                      className="mt-3 w-full sm:w-auto"
                    >
                      Close conversation
                    </SecondaryButton>
                  </div>
                )}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={askNavaEye} className="border-t border-white/10 p-4 sm:p-5">
              <FormField label="Message" dark>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={
                    selectedConversation?.status === "closed"
                      ? "This conversation is closed."
                      : "Type here..."
                  }
                  disabled={selectedConversation?.status === "closed" || loading || Boolean(setupRequired)}
                  className="min-h-[104px] w-full resize-y rounded-md border border-white/10 bg-slate-900 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[120px]"
                />
              </FormField>

              <div className="mt-4 flex flex-wrap gap-2">
                {suggestedQuestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setQuestion(suggestion)}
                    disabled={selectedConversation?.status === "closed" || loading || Boolean(setupRequired)}
                    className="max-w-full whitespace-normal break-words rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-left text-xs font-medium leading-5 text-slate-300 hover:border-cyan-200/30 hover:bg-cyan-300/10 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                <PrimaryButton
                  type="submit"
                  disabled={
                    loading ||
                    !question.trim() ||
                    !selectedCompanyId ||
                    selectedConversation?.status === "closed" ||
                    Boolean(setupRequired)
                  }
                  className="w-full sm:w-auto"
                >
                  {loading ? "Checking..." : "Send"}
                </PrimaryButton>
                {question && (
                  <SecondaryButton
                    type="button"
                    onClick={() => {
                      setQuestion("");
                      setErrorDetail("");
                    }}
                    className="w-full sm:w-auto"
                  >
                    Clear
                  </SecondaryButton>
                )}
                <span className="text-sm text-slate-400">
                  Current role permissions are checked on every message.
                </span>
              </div>
            </form>
          </Panel>
        </div>
      </div>
      {closeConfirmOpen && (
        <CloseConversationDialog
          loading={loading}
          onCancel={() => setCloseConfirmOpen(false)}
          onConfirm={closeConversation}
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
}: {
  title: string;
  emptyText: string;
  conversations: NavaEyeConversation[];
  selectedConversationId: string;
  onSelect: (conversationId: string) => void;
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
            <button
              key={conversation.id}
              type="button"
              onClick={() => onSelect(conversation.id)}
              className={`w-full rounded-lg border p-3 text-left transition ${
                active
                  ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-50"
                  : "border-white/10 bg-white/[0.04] text-slate-300 hover:border-cyan-200/30 hover:bg-cyan-300/10"
              }`}
            >
              <span className="block truncate text-sm font-semibold">{conversation.title}</span>
              <span className="mt-1 block text-xs text-slate-500">
                {conversation.last_intent || conversation.status} · {formatMessageTime(conversation.updated_at)}
              </span>
            </button>
          );
        })}
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
