"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import {
  EmptyState,
  FormField,
  PageHeader,
  Panel,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
} from "../../../components/ui/Primitives";

type SavedRoute = {
  id: string;
  name: string | null;
  client_name: string | null;
  from_location: string | null;
  to_location: string | null;
  expected_fuel_liters: number | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

type Capabilities = {
  can_view_journey_templates?: boolean;
  can_manage_journey_templates?: boolean;
};

const inputClass =
  "w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function routeLabel(route: SavedRoute) {
  return `${route.from_location || "—"} → ${route.to_location || "—"}`;
}

function initialEditForm(route?: SavedRoute) {
  return {
    name: route?.name || "",
    client_name: route?.client_name || "",
    from_location: route?.from_location || "",
    to_location: route?.to_location || "",
    expected_fuel_liters: route?.expected_fuel_liters?.toString() || "",
  };
}

export default function JourneyTemplatesPage() {
  const [templates, setTemplates] = useState<SavedRoute[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [expectedFuel, setExpectedFuel] = useState("");

  const [editingId, setEditingId] = useState("");
  const [editForm, setEditForm] = useState(initialEditForm());

  useEffect(() => {
    loadTemplates();
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

  async function loadTemplates() {
    setLoading(true);
    setError("");

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/journey-templates", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load saved routes.");
      }

      setTemplates(json.templates || []);
      setCapabilities(json.capabilities || {});
    } catch (err: any) {
      setError(err.message || "Failed to load saved routes.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: any) {
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
      const res = await fetch("/api/journey-templates", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          client_name: client,
          from_location: fromLocation,
          to_location: toLocation,
          expected_fuel_liters: expectedFuel ? Number(expectedFuel) : null,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to save route.");
      }

      setName("");
      setClient("");
      setFromLocation("");
      setToLocation("");
      setExpectedFuel("");
      setMessage("Saved route created.");
      await loadTemplates();
    } catch (err: any) {
      setError(err.message || "Failed to save route.");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(routeId: string) {
    setSaving(true);
    setError("");
    setMessage("");

    const token = await getAccessToken();
    if (!token) {
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/journey-templates/${routeId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...editForm,
          expected_fuel_liters: editForm.expected_fuel_liters
            ? Number(editForm.expected_fuel_liters)
            : null,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to update route.");
      }

      setEditingId("");
      setEditForm(initialEditForm());
      setMessage("Saved route updated.");
      await loadTemplates();
    } catch (err: any) {
      setError(err.message || "Failed to update route.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleRoute(route: SavedRoute) {
    setSaving(true);
    setError("");
    setMessage("");

    const token = await getAccessToken();
    if (!token) {
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/journey-templates/${route.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          is_active: !route.is_active,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to update route.");
      }

      setMessage(route.is_active ? "Saved route disabled." : "Saved route enabled.");
      await loadTemplates();
    } catch (err: any) {
      setError(err.message || "Failed to update route.");
    } finally {
      setSaving(false);
    }
  }

  const canManage = Boolean(capabilities.can_manage_journey_templates);
  const activeCount = templates.filter((template) => template.is_active).length;

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          dark
          eyebrow="Operations setup"
          title="Saved Routes"
          body="Save frequent client routes so trip creation takes seconds, not minutes."
          actions={
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/ops/journey">
                <SecondaryButton type="button" className="w-full sm:w-auto">
                  Back to trips
                </SecondaryButton>
              </Link>
              <Link href="/ops/journey/new">
                <PrimaryButton type="button" className="w-full sm:w-auto">
                  Create trip
                </PrimaryButton>
              </Link>
            </div>
          }
        />

        {loading && (
          <Panel dark className="mt-8 p-6">
            <div className="text-sm text-slate-300">Loading saved routes...</div>
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
                  Saved routes
                </div>
                <div className="mt-3 text-3xl font-semibold text-white">
                  {templates.length}
                </div>
              </Panel>
              <Panel dark className="p-5">
                <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                  Active presets
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
                <form onSubmit={handleCreate} className="grid gap-5">
                  <div>
                    <h2 className="text-lg font-semibold text-white">
                      Add saved route
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      Create a route preset your team can use when starting repeat trips.
                    </p>
                  </div>

                  <div className="grid gap-5 md:grid-cols-2">
                    <FormField label="Route name optional" dark>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Client · From → To"
                        className={inputClass}
                      />
                    </FormField>

                    <FormField label="Client" dark>
                      <input
                        value={client}
                        onChange={(e) => setClient(e.target.value.toUpperCase())}
                        placeholder="Client"
                        className={inputClass}
                        required
                      />
                    </FormField>

                    <FormField label="From" dark>
                      <input
                        value={fromLocation}
                        onChange={(e) => setFromLocation(e.target.value.toUpperCase())}
                        placeholder="Loading point"
                        className={inputClass}
                        required
                      />
                    </FormField>

                    <FormField label="To" dark>
                      <input
                        value={toLocation}
                        onChange={(e) => setToLocation(e.target.value.toUpperCase())}
                        placeholder="Offloading point"
                        className={inputClass}
                        required
                      />
                    </FormField>
                  </div>

                  <FormField label="Expected fuel optional" dark>
                    <input
                      value={expectedFuel}
                      onChange={(e) => setExpectedFuel(e.target.value)}
                      placeholder="Liters"
                      className={inputClass}
                      inputMode="decimal"
                    />
                  </FormField>

                  <div>
                    <PrimaryButton type="submit" disabled={saving}>
                      {saving ? "Saving..." : "Save route"}
                    </PrimaryButton>
                  </div>
                </form>
              </Panel>
            )}

            <section className="mt-8">
              {templates.length === 0 ? (
                <EmptyState
                  dark
                  title="No saved routes yet"
                  body="Save frequent client routes so journey creation takes seconds, not minutes."
                />
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {templates.map((template) => {
                    const isEditing = editingId === template.id;

                    return (
                      <Panel key={template.id} dark className="p-5">
                        {isEditing ? (
                          <div className="grid gap-4">
                            <div className="grid gap-4 md:grid-cols-2">
                              <FormField label="Route name optional" dark>
                                <input
                                  value={editForm.name}
                                  onChange={(e) =>
                                    setEditForm((current) => ({
                                      ...current,
                                      name: e.target.value,
                                    }))
                                  }
                                  className={inputClass}
                                />
                              </FormField>
                              <FormField label="Client" dark>
                                <input
                                  value={editForm.client_name}
                                  onChange={(e) =>
                                    setEditForm((current) => ({
                                      ...current,
                                      client_name: e.target.value.toUpperCase(),
                                    }))
                                  }
                                  className={inputClass}
                                />
                              </FormField>
                              <FormField label="From" dark>
                                <input
                                  value={editForm.from_location}
                                  onChange={(e) =>
                                    setEditForm((current) => ({
                                      ...current,
                                      from_location: e.target.value.toUpperCase(),
                                    }))
                                  }
                                  className={inputClass}
                                />
                              </FormField>
                              <FormField label="To" dark>
                                <input
                                  value={editForm.to_location}
                                  onChange={(e) =>
                                    setEditForm((current) => ({
                                      ...current,
                                      to_location: e.target.value.toUpperCase(),
                                    }))
                                  }
                                  className={inputClass}
                                />
                              </FormField>
                            </div>
                            <FormField label="Expected fuel optional" dark>
                              <input
                                value={editForm.expected_fuel_liters}
                                onChange={(e) =>
                                  setEditForm((current) => ({
                                    ...current,
                                    expected_fuel_liters: e.target.value,
                                  }))
                                }
                                className={inputClass}
                                inputMode="decimal"
                              />
                            </FormField>
                            <div className="flex flex-col gap-3 sm:flex-row">
                              <PrimaryButton
                                type="button"
                                disabled={saving}
                                onClick={() => saveEdit(template.id)}
                              >
                                Save changes
                              </PrimaryButton>
                              <SecondaryButton
                                type="button"
                                onClick={() => {
                                  setEditingId("");
                                  setEditForm(initialEditForm());
                                }}
                              >
                                Cancel
                              </SecondaryButton>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-5">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h2 className="break-words text-lg font-semibold text-white">
                                    {template.name || routeLabel(template)}
                                  </h2>
                                  <StatusPill tone={template.is_active ? "success" : "neutral"}>
                                    {template.is_active ? "Active" : "Inactive"}
                                  </StatusPill>
                                </div>
                                <p className="mt-3 text-sm text-slate-300">
                                  Client:{" "}
                                  <span className="font-semibold text-white">
                                    {template.client_name || "—"}
                                  </span>
                                </p>
                                <p className="mt-2 text-sm text-slate-300">
                                  Route:{" "}
                                  <span className="font-semibold text-white">
                                    {routeLabel(template)}
                                  </span>
                                </p>
                                <p className="mt-2 text-sm text-slate-300">
                                  Expected fuel:{" "}
                                  <span className="font-semibold text-white">
                                    {template.expected_fuel_liters
                                      ? `${Number(template.expected_fuel_liters).toLocaleString()} L`
                                      : "—"}
                                  </span>
                                </p>
                                <p className="mt-2 text-xs text-slate-500">
                                  Created {formatDate(template.created_at)}
                                </p>
                              </div>
                            </div>

                            {canManage && (
                              <div className="flex flex-col gap-3 sm:flex-row">
                                <SecondaryButton
                                  type="button"
                                  disabled={saving}
                                  onClick={() => {
                                    setEditingId(template.id);
                                    setEditForm(initialEditForm(template));
                                  }}
                                >
                                  Edit route
                                </SecondaryButton>
                                <SecondaryButton
                                  type="button"
                                  disabled={saving}
                                  onClick={() => toggleRoute(template)}
                                >
                                  {template.is_active ? "Disable" : "Enable"}
                                </SecondaryButton>
                              </div>
                            )}
                          </div>
                        )}
                      </Panel>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
