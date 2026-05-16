"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

const statuses = [
  "new",
  "reviewing",
  "template_in_progress",
  "verified",
  "closed",
];

export default function ProviderRequestsPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadRequests();
  }, []);

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return null;
    }

    return session.access_token;
  }

  async function loadRequests() {
    setError("");
    setLoading(true);

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/providers/setup-requests", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load provider requests.");
      }

      setRequests(json.requests || []);
    } catch (err: any) {
      setError(err.message || "Failed to load provider requests.");
    } finally {
      setLoading(false);
    }
  }

  async function saveRequest(request: any) {
    setSavingId(request.id);
    setError("");

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch(`/api/providers/setup-requests/${request.id}`, {
        method: "PATCH",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: request.status,
          internal_notes: request.internal_notes || null,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to update provider request.");
      }

      setRequests((current) =>
        current.map((item) =>
          item.id === request.id
            ? { ...item, ...json.request, company_name: item.company_name }
            : item
        )
      );
    } catch (err: any) {
      setError(err.message || "Failed to update provider request.");
    } finally {
      setSavingId("");
    }
  }

  function updateRequest(id: string, patch: Record<string, any>) {
    setRequests((current) =>
      current.map((request) =>
        request.id === id ? { ...request, ...patch } : request
      )
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-10 text-slate-950">
        Loading provider requests...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-8 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 rounded-lg border border-slate-200 bg-white p-8">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-700">
            Internal review
          </p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-4xl font-semibold tracking-normal">
                Provider setup requests
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                Review client requests for GPS and telemetry provider setup.
              </p>
            </div>
            <button
              type="button"
              onClick={loadRequests}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>
        </header>

        {error && (
          <section className="mb-6 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {error}
          </section>
        )}

        {requests.length === 0 ? (
          <section className="rounded-lg border border-slate-200 bg-white p-8">
            <h2 className="text-2xl font-semibold">No provider requests yet</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              New client requests will appear here when a provider is not yet
              available in the verified setup list.
            </p>
          </section>
        ) : (
          <section className="grid gap-5">
            {requests.map((request) => (
              <article
                key={request.id}
                className="rounded-lg border border-slate-200 bg-white p-6"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-700">
                      {request.company_name || "Company not labeled"}
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold">
                      {request.provider_name}
                    </h2>
                    <p className="mt-2 text-sm text-slate-500">
                      Submitted {formatDate(request.created_at)}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 lg:min-w-[220px]">
                    <label className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                      Status
                    </label>
                    <select
                      value={request.status || "new"}
                      onChange={(e) =>
                        updateRequest(request.id, { status: e.target.value })
                      }
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      {statuses.map((status) => (
                        <option key={status} value={status}>
                          {labelStatus(status)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <Detail label="Website" value={request.provider_website} />
                  <Detail label="Provider contact" value={request.provider_contact} />
                  <Detail
                    label="Access type known"
                    value={labelAccessType(request.access_type_known)}
                  />
                  <Detail label="Submitted by" value={request.user_id} />
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                      Client notes
                    </div>
                    <div className="mt-2 min-h-[96px] rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                      {request.notes || "No client notes provided."}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                      Internal notes
                    </label>
                    <textarea
                      value={request.internal_notes || ""}
                      onChange={(e) =>
                        updateRequest(request.id, {
                          internal_notes: e.target.value,
                        })
                      }
                      className="mt-2 min-h-[96px] w-full rounded-md border border-slate-300 p-3 text-sm outline-none focus:border-cyan-600"
                      placeholder="Add internal review notes..."
                    />
                  </div>
                </div>

                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => saveRequest(request)}
                    disabled={savingId === request.id}
                    className="rounded-md bg-slate-950 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingId === request.id ? "Saving..." : "Save review"}
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-md border border-slate-200 px-4 py-3">
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 break-words text-sm text-slate-800">
        {value || "Not provided"}
      </div>
    </div>
  );
}

function labelStatus(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function labelAccessType(accessType: string) {
  const labels: Record<string, string> = {
    username_password: "Username/password",
    api_key: "API key",
    token: "Token",
    unsure: "Unsure",
  };

  return labels[accessType] || "Unsure";
}

function formatDate(value?: string | null) {
  if (!value) return "date not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "date not available";
  return date.toLocaleString();
}
