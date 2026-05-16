"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import {
  EmptyState,
  FormField,
  PageHeader,
  Panel,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
} from "../../components/ui/Primitives";

const expiryOptions = [
  { value: "7_days", label: "7 days" },
  { value: "30_days", label: "30 days" },
  { value: "90_days", label: "90 days" },
  { value: "6_months", label: "6 months" },
  { value: "12_months", label: "12 months" },
  { value: "custom_date", label: "Custom date" },
  { value: "active_until_revoked", label: "Active until revoked" },
];

export default function ClientVisibilityPage() {
  const [links, setLinks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [oneTimeUrl, setOneTimeUrl] = useState("");
  const [form, setForm] = useState({
    client_name: "",
    display_name: "",
    expiry_mode: "12_months",
    custom_expires_at: "",
  });

  useEffect(() => {
    loadLinks();
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

  async function loadLinks() {
    setError("");
    setLoading(true);

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/client-visibility-links", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load client visibility links.");
      }

      setLinks(json.links || []);
    } catch (err: any) {
      setError(err.message || "Failed to load client visibility links.");
    } finally {
      setLoading(false);
    }
  }

  async function createLink(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    setOneTimeUrl("");

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/client-visibility-links", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_name: form.client_name,
          display_name: form.display_name || null,
          expiry_mode: form.expiry_mode,
          custom_expires_at:
            form.expiry_mode === "custom_date"
              ? form.custom_expires_at
              : null,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to create client visibility link.");
      }

      setLinks((current) => [json.link, ...current]);
      setOneTimeUrl(json.public_url || "");
      setMessage("Client visibility link created. Copy it now; it will not be shown again.");
      setForm({
        client_name: "",
        display_name: "",
        expiry_mode: "12_months",
        custom_expires_at: "",
      });
    } catch (err: any) {
      setError(err.message || "Failed to create client visibility link.");
    } finally {
      setSaving(false);
    }
  }

  async function patchLink(id: string, body: Record<string, any>) {
    setActionId(id);
    setError("");
    setMessage("");
    setOneTimeUrl("");

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch(`/api/client-visibility-links/${id}`, {
        method: "PATCH",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to update client visibility link.");
      }

      if (body.action === "regenerate") {
        setLinks((current) =>
          [json.link, ...current.map((link) =>
            link.id === id
              ? { ...link, revoked_at: new Date().toISOString() }
              : link
          )]
        );
        setOneTimeUrl(json.public_url || "");
        setMessage("New client visibility link generated. Copy it now; it will not be shown again.");
      } else {
        setLinks((current) =>
          current.map((link) => (link.id === id ? json.link : link))
        );
        setMessage(
          body.action === "revoke"
            ? "Client visibility link revoked."
            : "Client visibility link updated."
        );
      }
    } catch (err: any) {
      setError(err.message || "Failed to update client visibility link.");
    } finally {
      setActionId("");
    }
  }

  async function copyOneTimeUrl() {
    if (!oneTimeUrl) return;
    await navigator.clipboard.writeText(oneTimeUrl);
    setMessage("Link copied.");
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-8 py-10 text-white">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">
            Loading client visibility links...
          </div>
        </Panel>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-8 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          dark
          eyebrow="Client visibility"
          title="Client visibility links"
          body="Create secure client-facing portal links for selected customers. Public tracking pages are not enabled in this phase."
        />

        {error && (
          <Panel dark className="mt-6 border-rose-300/30 bg-rose-500/10 p-4">
            <div className="text-sm text-rose-100">{error}</div>
          </Panel>
        )}

        {message && (
          <Panel dark className="mt-6 border-cyan-200/20 bg-cyan-300/10 p-4">
            <div className="text-sm text-cyan-50">{message}</div>
          </Panel>
        )}

        {oneTimeUrl && (
          <Panel dark className="mt-6 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">
              One-time link
            </p>
            <div className="mt-3 break-all rounded-md border border-white/10 bg-slate-900 p-3 text-sm text-slate-100">
              {oneTimeUrl}
            </div>
            <SecondaryButton
              type="button"
              onClick={copyOneTimeUrl}
              className="mt-4"
            >
              Copy link
            </SecondaryButton>
          </Panel>
        )}

        <section className="mt-8 grid gap-6 xl:grid-cols-[380px_1fr]">
          <Panel dark className="p-6">
            <h2 className="text-xl font-semibold">Create visibility link</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Enter the client name exactly as used on journeys. Nava stores the
              link token securely and only shows the public URL once.
            </p>

            <form onSubmit={createLink} className="mt-6 grid gap-4">
              <FormField label="Client name" dark>
                <input
                  value={form.client_name}
                  onChange={(e) =>
                    setForm({ ...form, client_name: e.target.value })
                  }
                  className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300"
                  placeholder="Client name"
                  required
                />
              </FormField>

              <FormField label="Display name optional" dark>
                <input
                  value={form.display_name}
                  onChange={(e) =>
                    setForm({ ...form, display_name: e.target.value })
                  }
                  className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300"
                  placeholder="Client-facing label"
                />
              </FormField>

              <FormField label="Expiry" dark>
                <select
                  value={form.expiry_mode}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      expiry_mode: e.target.value,
                      custom_expires_at: "",
                    })
                  }
                  className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300"
                >
                  {expiryOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormField>

              {form.expiry_mode === "custom_date" && (
                <FormField label="Custom expiry date" dark>
                  <input
                    type="date"
                    value={form.custom_expires_at}
                    onChange={(e) =>
                      setForm({ ...form, custom_expires_at: e.target.value })
                    }
                    className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300"
                    required
                  />
                </FormField>
              )}

              <PrimaryButton type="submit" disabled={saving}>
                {saving ? "Creating..." : "Create link"}
              </PrimaryButton>
            </form>
          </Panel>

          <Panel dark className="p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">Existing links</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Metadata only. Raw public URLs are shown only after create or
                  regenerate.
                </p>
              </div>
              <SecondaryButton type="button" onClick={loadLinks}>
                Refresh
              </SecondaryButton>
            </div>

            {links.length === 0 ? (
              <div className="mt-6">
                <EmptyState
                  dark
                  title="No client visibility links yet"
                  body="Create a link when a customer needs external journey visibility."
                />
              </div>
            ) : (
              <div className="mt-6 grid gap-4">
                {links.map((link) => (
                  <article
                    key={link.id}
                    className="rounded-lg border border-white/10 bg-white/[0.04] p-5"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-200">
                          {link.client_name}
                        </div>
                        <h3 className="mt-2 text-lg font-semibold">
                          {link.display_name || link.client_name}
                        </h3>
                        <p className="mt-2 text-sm text-slate-400">
                          Created {formatDate(link.created_at)}
                        </p>
                      </div>
                      <StatusPill tone={getStatusTone(link)}>
                        {getStatusLabel(link)}
                      </StatusPill>
                    </div>

                    <div className="mt-5 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                      <Detail label="Expires" value={formatExpiry(link)} />
                      <Detail label="Last accessed" value={formatDate(link.last_accessed_at)} />
                      <Detail label="Access count" value={String(link.access_count || 0)} />
                      <Detail label="Updated" value={formatDate(link.updated_at)} />
                    </div>

                    <div className="mt-5 flex flex-wrap gap-3">
                      {!link.revoked_at && (
                        <>
                          <SecondaryButton
                            type="button"
                            onClick={() => patchLink(link.id, { action: "revoke" })}
                            disabled={actionId === link.id}
                          >
                            Revoke
                          </SecondaryButton>
                          <PrimaryButton
                            type="button"
                            onClick={() =>
                              patchLink(link.id, { action: "regenerate" })
                            }
                            disabled={actionId === link.id}
                          >
                            Regenerate
                          </PrimaryButton>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Panel>
        </section>
      </div>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-slate-200">{value}</div>
    </div>
  );
}

function getStatusLabel(link: any) {
  if (link.revoked_at) return "Revoked";
  if (isExpired(link)) return "Expired";
  return "Active";
}

function getStatusTone(link: any): "success" | "warning" | "danger" | "info" {
  if (link.revoked_at) return "danger";
  if (isExpired(link)) return "warning";
  if (link.active_until_revoked) return "info";
  return "success";
}

function isExpired(link: any) {
  if (link.active_until_revoked || !link.expires_at) return false;
  return new Date(link.expires_at).getTime() < Date.now();
}

function formatExpiry(link: any) {
  if (link.active_until_revoked) return "Until revoked";
  return formatDate(link.expires_at);
}

function formatDate(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleString();
}
