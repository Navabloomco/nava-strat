"use client";

import { useEffect, useMemo, useState } from "react";
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

type Driver = {
  id: string;
  full_name: string | null;
  phone: string | null;
  employee_code: string | null;
  status: string;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type Capabilities = {
  can_view_drivers?: boolean;
  can_manage_drivers?: boolean;
};

const inputClass =
  "w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300";

const statusOptions = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "suspended", label: "Suspended" },
];

function emptyForm(driver?: Driver) {
  return {
    full_name: driver?.full_name || "",
    phone: driver?.phone || "",
    employee_code: driver?.employee_code || "",
    status: driver?.status || "active",
    notes: driver?.notes || "",
  };
}

function statusTone(status: string) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "active") return "success";
  if (normalized === "suspended") return "warning";
  return "neutral";
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString();
}

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [createForm, setCreateForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState("");
  const [editForm, setEditForm] = useState(emptyForm());

  useEffect(() => {
    loadDrivers();
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

  async function loadDrivers() {
    setLoading(true);
    setError("");

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/drivers", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load drivers.");
      }

      setDrivers(json.drivers || []);
      setCapabilities(json.capabilities || {});
    } catch (err: any) {
      setError(err.message || "Failed to load drivers.");
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
      const res = await fetch("/api/drivers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createForm),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to add driver.");
      }

      setCreateForm(emptyForm());
      setMessage("Driver added.");
      await loadDrivers();
    } catch (err: any) {
      setError(err.message || "Failed to add driver.");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(driverId: string) {
    setSaving(true);
    setError("");
    setMessage("");

    const token = await getAccessToken();
    if (!token) {
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/drivers/${driverId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(editForm),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to update driver.");
      }

      setEditingId("");
      setEditForm(emptyForm());
      setMessage("Driver updated.");
      await loadDrivers();
    } catch (err: any) {
      setError(err.message || "Failed to update driver.");
    } finally {
      setSaving(false);
    }
  }

  function startEditing(driver: Driver) {
    setEditingId(driver.id);
    setEditForm(emptyForm(driver));
    setMessage("");
    setError("");
  }

  const canManage = Boolean(capabilities.can_manage_drivers);
  const activeCount = drivers.filter((driver) => driver.status === "active").length;
  const inactiveCount = drivers.length - activeCount;
  const filteredDrivers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return drivers;

    return drivers.filter((driver) =>
      [
        driver.full_name,
        driver.phone,
        driver.employee_code,
        driver.status,
        driver.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [drivers, search]);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          dark
          eyebrow="Operations"
          title="Drivers"
          body="Keep driver names consistent before they are used in journeys, alerts, and fleet answers."
          actions={
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/ops/dashboard">
                <SecondaryButton type="button" className="w-full sm:w-auto">
                  Back to operations
                </SecondaryButton>
              </Link>
              <Link href="/ops/journey/new">
                <PrimaryButton type="button" className="w-full sm:w-auto">
                  Create journey
                </PrimaryButton>
              </Link>
            </div>
          }
        />

        {loading && (
          <Panel dark className="mt-8 p-6">
            <div className="text-sm text-slate-300">Loading drivers...</div>
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
            <section className="mt-8 grid gap-4 md:grid-cols-4">
              <SummaryCard label="Total drivers" value={drivers.length} />
              <SummaryCard label="Active drivers" value={activeCount} accent />
              <SummaryCard label="Inactive / suspended" value={inactiveCount} />
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
                      Add driver
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      Add drivers once so teams use the same name everywhere.
                    </p>
                  </div>

                  <DriverForm
                    form={createForm}
                    setForm={setCreateForm}
                    disabled={saving}
                  />

                  <div>
                    <PrimaryButton type="submit" disabled={saving}>
                      {saving ? "Saving..." : "Add driver"}
                    </PrimaryButton>
                  </div>
                </form>
              </Panel>
            )}

            <Panel dark className="mt-8 p-5">
              <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    Driver directory
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    Search by name, phone, employee code, or status.
                  </p>
                </div>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search drivers"
                  className={`${inputClass} lg:w-80`}
                />
              </div>
            </Panel>

            <section className="mt-6">
              {drivers.length === 0 ? (
                <EmptyState
                  dark
                  title="No drivers yet"
                  body="Add drivers once so journeys and alerts can use consistent driver names."
                />
              ) : filteredDrivers.length === 0 ? (
                <EmptyState
                  dark
                  title="No drivers match that search"
                  body="Try searching by name, phone, employee code, or status."
                />
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {filteredDrivers.map((driver) => {
                    const isEditing = editingId === driver.id;

                    return (
                      <Panel key={driver.id} dark className="p-5">
                        {isEditing ? (
                          <div className="grid gap-4">
                            <DriverForm
                              form={editForm}
                              setForm={setEditForm}
                              disabled={saving}
                            />
                            <div className="flex flex-col gap-3 sm:flex-row">
                              <PrimaryButton
                                type="button"
                                disabled={saving}
                                onClick={() => saveEdit(driver.id)}
                                className="w-full sm:w-auto"
                              >
                                {saving ? "Saving..." : "Save changes"}
                              </PrimaryButton>
                              <SecondaryButton
                                type="button"
                                disabled={saving}
                                onClick={() => {
                                  setEditingId("");
                                  setEditForm(emptyForm());
                                }}
                                className="w-full sm:w-auto"
                              >
                                Cancel
                              </SecondaryButton>
                            </div>
                          </div>
                        ) : (
                          <DriverCard
                            driver={driver}
                            canManage={canManage}
                            onEdit={() => startEditing(driver)}
                          />
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

function SummaryCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <Panel dark className="p-5">
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </div>
      <div className={accent ? "mt-3 text-3xl font-semibold text-cyan-200" : "mt-3 text-3xl font-semibold text-white"}>
        {value}
      </div>
    </Panel>
  );
}

function DriverForm({
  form,
  setForm,
  disabled,
}: {
  form: ReturnType<typeof emptyForm>;
  setForm: (form: ReturnType<typeof emptyForm>) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <FormField label="Full name" dark>
        <input
          value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          placeholder="Driver name"
          className={inputClass}
          disabled={disabled}
          required
        />
      </FormField>

      <FormField label="Status" dark>
        <select
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value })}
          className={inputClass}
          disabled={disabled}
        >
          {statusOptions.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Phone optional" dark>
        <input
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="Phone number"
          className={inputClass}
          disabled={disabled}
        />
      </FormField>

      <FormField label="Employee code optional" dark>
        <input
          value={form.employee_code}
          onChange={(e) => setForm({ ...form, employee_code: e.target.value })}
          placeholder="Employee code"
          className={inputClass}
          disabled={disabled}
        />
      </FormField>

      <div className="md:col-span-2">
        <FormField label="Notes optional" dark>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Short operational note"
            className={`${inputClass} min-h-24`}
            disabled={disabled}
          />
        </FormField>
      </div>
    </div>
  );
}

function DriverCard({
  driver,
  canManage,
  onEdit,
}: {
  driver: Driver;
  canManage: boolean;
  onEdit: () => void;
}) {
  return (
    <article>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="break-words text-lg font-semibold text-white">
            {driver.full_name || "Unnamed driver"}
          </h3>
          <div className="mt-2">
            <StatusPill tone={statusTone(driver.status)}>
              {labelize(driver.status)}
            </StatusPill>
          </div>
        </div>
        {canManage && (
          <SecondaryButton type="button" onClick={onEdit} className="shrink-0 px-3 py-2">
            Edit
          </SecondaryButton>
        )}
      </div>

      <div className="mt-5 grid gap-3 text-sm">
        <Detail label="Phone" value={driver.phone || "Not added"} />
        <Detail label="Employee code" value={driver.employee_code || "Not added"} />
        <Detail label="Created" value={formatDate(driver.created_at)} />
      </div>

      {driver.notes && (
        <div className="mt-5 rounded-md border border-white/10 bg-slate-950/50 p-3 text-sm leading-6 text-slate-300">
          {driver.notes}
        </div>
      )}
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 break-words text-slate-200">{value}</div>
    </div>
  );
}

function labelize(value: string) {
  return String(value || "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
