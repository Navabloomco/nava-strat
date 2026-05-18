"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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

type FuelProvider = {
  id: string;
  name: string;
  default_price_per_liter: number | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

type Capabilities = {
  can_view_fuel_providers?: boolean;
  can_manage_fuel_providers?: boolean;
};

const inputClass =
  "w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function formatPrice(value: number | null) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }

  return `${Number(value).toLocaleString()} KES/L`;
}

export default function FuelProvidersPage() {
  const [providers, setProviders] = useState<FuelProvider[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    loadProviders();
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

  async function loadProviders() {
    setLoading(true);
    setError("");

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/fuel/providers", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load fuel providers.");
      }

      setProviders(json.fuel_providers || []);
      setCapabilities(json.capabilities || {});
    } catch (err: any) {
      setError(err.message || "Failed to load fuel providers.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: any) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    const token = await getAccessToken();
    if (!token) {
      setSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/fuel/providers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          default_price_per_liter: price ? Number(price) : null,
          is_active: isActive,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to save fuel provider.");
      }

      setName("");
      setPrice("");
      setIsActive(true);
      setMessage("Fuel provider saved.");
      await loadProviders();
    } catch (err: any) {
      setError(err.message || "Failed to save fuel provider.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleProvider(provider: FuelProvider) {
    setSaving(true);
    setError("");
    setMessage("");

    const token = await getAccessToken();
    if (!token) {
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/fuel/providers/${provider.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          is_active: !provider.is_active,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to update fuel provider.");
      }

      setMessage(
        provider.is_active
          ? "Fuel provider disabled."
          : "Fuel provider enabled."
      );
      await loadProviders();
    } catch (err: any) {
      setError(err.message || "Failed to update fuel provider.");
    } finally {
      setSaving(false);
    }
  }

  const canManage = Boolean(capabilities.can_manage_fuel_providers);
  const activeCount = providers.filter((provider) => provider.is_active).length;

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          dark
          eyebrow="Finance setup"
          title="Fuel Providers"
          body="Add common vendors and default prices to speed up fuel entry."
          actions={
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/fuel">
                <SecondaryButton type="button" className="w-full sm:w-auto">
                  Back to fuel ledger
                </SecondaryButton>
              </Link>
              <Link href="/fuel/new">
                <PrimaryButton type="button" className="w-full sm:w-auto">
                  Add fuel
                </PrimaryButton>
              </Link>
            </div>
          }
        />

        {loading && (
          <Panel dark className="mt-8 p-6">
            <div className="text-sm text-slate-300">Loading fuel providers...</div>
          </Panel>
        )}

        {error && (
          <Panel dark className="mt-8 border-rose-300/30 bg-rose-500/10 p-4">
            <div className="text-sm text-rose-100">{error}</div>
          </Panel>
        )}

        {message && (
          <Panel dark className="mt-8 border-cyan-200/20 bg-cyan-300/10 p-4">
            <div className="text-sm text-cyan-50">{message}</div>
          </Panel>
        )}

        {!loading && (
          <>
            <section className="mt-8 grid gap-4 md:grid-cols-3">
              <Panel dark className="p-5">
                <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                  Total providers
                </div>
                <div className="mt-3 text-3xl font-semibold text-white">
                  {providers.length}
                </div>
              </Panel>
              <Panel dark className="p-5">
                <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                  Active
                </div>
                <div className="mt-3 text-3xl font-semibold text-emerald-100">
                  {activeCount}
                </div>
              </Panel>
              <Panel dark className="p-5">
                <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                  Access
                </div>
                <div className="mt-4">
                  <StatusPill tone={canManage ? "success" : "info"}>
                    {canManage ? "Can manage" : "View only"}
                  </StatusPill>
                </div>
              </Panel>
            </section>

            {canManage && (
              <Panel dark className="mt-8 p-6">
                <form onSubmit={handleSubmit} className="grid gap-5">
                  <div>
                    <h2 className="text-lg font-semibold text-white">
                      Add fuel provider
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      Save vendors your team uses often. Default prices can be
                      adjusted on each fuel entry.
                    </p>
                  </div>

                  <div className="grid gap-5 md:grid-cols-2">
                    <FormField label="Provider name" dark>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Provider name"
                        className={inputClass}
                        required
                      />
                    </FormField>

                    <FormField label="Default price per liter optional" dark>
                      <input
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder="KES per liter"
                        className={inputClass}
                        inputMode="decimal"
                      />
                    </FormField>
                  </div>

                  <label className="flex items-center gap-3 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                      className="h-4 w-4 rounded border-white/20 bg-slate-900"
                    />
                    Active provider
                  </label>

                  <div>
                    <PrimaryButton type="submit" disabled={saving}>
                      {saving ? "Saving..." : "Save provider"}
                    </PrimaryButton>
                  </div>
                </form>
              </Panel>
            )}

            <section className="mt-8">
              {providers.length === 0 ? (
                <EmptyState
                  dark
                  title="No fuel providers yet"
                  body="Add common vendors and default prices to speed up fuel entry."
                />
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {providers.map((provider) => (
                    <Panel key={provider.id} dark className="p-5">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="break-words text-lg font-semibold text-white">
                              {provider.name}
                            </h2>
                            <StatusPill tone={provider.is_active ? "success" : "neutral"}>
                              {provider.is_active ? "Active" : "Inactive"}
                            </StatusPill>
                          </div>
                          <p className="mt-3 text-sm text-slate-300">
                            Default price:{" "}
                            <span className="font-semibold text-white">
                              {formatPrice(provider.default_price_per_liter)}
                            </span>
                          </p>
                          <p className="mt-2 text-xs text-slate-500">
                            Created {formatDate(provider.created_at)}
                          </p>
                        </div>

                        {canManage && (
                          <SecondaryButton
                            type="button"
                            disabled={saving}
                            onClick={() => toggleProvider(provider)}
                            className="w-full sm:w-auto"
                          >
                            {provider.is_active ? "Disable" : "Enable"}
                          </SecondaryButton>
                        )}
                      </div>
                    </Panel>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
