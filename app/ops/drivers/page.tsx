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
  can_view_driver_assignments?: boolean;
  can_manage_driver_assignments?: boolean;
};

type EnabledAsset = {
  id: string;
  registration: string | null;
  truck_id: string | null;
  provider_name: string | null;
  status: string | null;
};

type DriverAssignment = {
  id: string;
  asset_id: string | null;
  truck_id: string | null;
  driver_id: string | null;
  driver_name: string | null;
  journey_id: string | null;
  assigned_from: string | null;
  assigned_to: string | null;
  assignment_status: string;
  created_at: string | null;
  ended_at: string | null;
  asset_registration: string | null;
  asset_provider_name: string | null;
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

function emptyAssignmentForm() {
  return {
    driver_id: "",
    asset_id: "",
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

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [assignments, setAssignments] = useState<DriverAssignment[]>([]);
  const [enabledAssets, setEnabledAssets] = useState<EnabledAsset[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [createForm, setCreateForm] = useState(emptyForm());
  const [assignmentForm, setAssignmentForm] = useState(emptyAssignmentForm());
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
      const [driverRes, assignmentRes] = await Promise.all([
        fetch("/api/drivers", {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
        fetch("/api/driver-assignments", {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
      ]);
      const json = await driverRes.json();
      const assignmentJson = await assignmentRes.json();

      if (!driverRes.ok || !json.success) {
        throw new Error(json.error || "Failed to load drivers.");
      }
      if (!assignmentRes.ok || !assignmentJson.success) {
        throw new Error(
          assignmentJson.error || "Failed to load driver assignments."
        );
      }

      setDrivers(json.drivers || []);
      setAssignments(assignmentJson.assignments || []);
      setEnabledAssets(assignmentJson.enabled_assets || []);
      setCapabilities({
        ...(json.capabilities || {}),
        ...(assignmentJson.capabilities || {}),
      });
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

  async function handleCreateAssignment(e: any) {
    e.preventDefault();
    setAssignmentSaving(true);
    setError("");
    setMessage("");

    const token = await getAccessToken();
    if (!token) {
      setAssignmentSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/driver-assignments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(assignmentForm),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to assign driver.");
      }

      setAssignmentForm(emptyAssignmentForm());
      setMessage("Driver assigned to asset.");
      await loadDrivers();
    } catch (err: any) {
      setError(err.message || "Failed to assign driver.");
    } finally {
      setAssignmentSaving(false);
    }
  }

  async function endAssignment(assignmentId: string) {
    setAssignmentSaving(true);
    setError("");
    setMessage("");

    const token = await getAccessToken();
    if (!token) {
      setAssignmentSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/driver-assignments/${assignmentId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "end" }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to end assignment.");
      }

      setMessage("Driver assignment ended.");
      await loadDrivers();
    } catch (err: any) {
      setError(err.message || "Failed to end assignment.");
    } finally {
      setAssignmentSaving(false);
    }
  }

  function startEditing(driver: Driver) {
    setEditingId(driver.id);
    setEditForm(emptyForm(driver));
    setMessage("");
    setError("");
  }

  const canManageDrivers = Boolean(capabilities.can_manage_drivers);
  const canManageAssignments = Boolean(capabilities.can_manage_driver_assignments);
  const activeCount = drivers.filter((driver) => driver.status === "active").length;
  const inactiveCount = drivers.length - activeCount;
  const activeDrivers = drivers.filter((driver) => driver.status === "active");
  const activeAssignments = assignments.filter(
    (assignment) =>
      assignment.assignment_status === "active" && !assignment.assigned_to
  );
  const assignedAssetIds = new Set(
    activeAssignments.map((assignment) => assignment.asset_id).filter(Boolean)
  );
  const assignedTruckIds = new Set(
    activeAssignments
      .map((assignment) => String(assignment.truck_id || "").toLowerCase())
      .filter(Boolean)
  );
  const assignableAssets = enabledAssets.filter(
    (asset) =>
      !assignedAssetIds.has(asset.id) &&
      !assignedTruckIds.has(String(asset.truck_id || "").toLowerCase())
  );
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
          body="Keep driver names consistent before they are used in trips, alerts, and fleet answers."
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
                  <StatusPill tone={canManageDrivers ? "success" : "info"}>
                    {canManageDrivers ? "Can manage" : "View only"}
                  </StatusPill>
                </div>
              </Panel>
            </section>

            <Panel dark className="mt-8 p-6">
              <div className="grid gap-6">
                <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
                  <div>
                    <h2 className="text-lg font-semibold text-white">
                      Current vehicle assignments
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      This driver stays assigned to the vehicle until you end the assignment. Nava uses this for alerts, fuel risk, and fleet answers.
                    </p>
                  </div>
                  <StatusPill tone={canManageAssignments ? "success" : "info"}>
                    {canManageAssignments ? "Assignment controls" : "View only"}
                  </StatusPill>
                </div>

                {canManageAssignments && (
                  <form
                    onSubmit={handleCreateAssignment}
                    className="grid gap-4 rounded-lg border border-white/10 bg-slate-950/50 p-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end"
                  >
                    <FormField label="Driver" dark>
                      <select
                        value={assignmentForm.driver_id}
                        onChange={(e) =>
                          setAssignmentForm({
                            ...assignmentForm,
                            driver_id: e.target.value,
                          })
                        }
                        className={inputClass}
                        disabled={assignmentSaving || activeDrivers.length === 0}
                        required
                      >
                        <option value="">Select active driver</option>
                        {activeDrivers.map((driver) => (
                          <option key={driver.id} value={driver.id}>
                            {driver.full_name || "Unnamed driver"}
                            {driver.employee_code ? ` · ${driver.employee_code}` : ""}
                          </option>
                        ))}
                      </select>
                    </FormField>

                    <FormField label="Enabled asset" dark>
                      <select
                        value={assignmentForm.asset_id}
                        onChange={(e) =>
                          setAssignmentForm({
                            ...assignmentForm,
                            asset_id: e.target.value,
                          })
                        }
                        className={inputClass}
                        disabled={assignmentSaving || assignableAssets.length === 0}
                        required
                      >
                        <option value="">Select enabled asset</option>
                        {assignableAssets.map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {assetLabel(asset)}
                          </option>
                        ))}
                      </select>
                    </FormField>

                    <PrimaryButton
                      type="submit"
                      disabled={
                        assignmentSaving ||
                        activeDrivers.length === 0 ||
                        assignableAssets.length === 0
                      }
                      className="w-full lg:w-auto"
                    >
                      {assignmentSaving ? "Assigning..." : "Assign driver"}
                    </PrimaryButton>
                  </form>
                )}

                {canManageAssignments && enabledAssets.length === 0 && (
                  <div className="rounded-md border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-6 text-amber-50">
                    No enabled assets are available yet. Assets must be reviewed before drivers can be assigned.
                  </div>
                )}

                {canManageAssignments &&
                  enabledAssets.length > 0 &&
                  assignableAssets.length === 0 && (
                    <div className="rounded-md border border-cyan-200/20 bg-cyan-300/10 p-4 text-sm leading-6 text-cyan-50">
                      All enabled assets already have active driver assignments.
                    </div>
                  )}

                {activeAssignments.length === 0 ? (
                  <EmptyState
                    dark
                    title="No current vehicle assignments"
                    body="Assign drivers to enabled vehicles once, then Nava can reuse that responsibility context until the assignment is ended."
                  />
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {activeAssignments.map((assignment) => (
                      <AssignmentCard
                        key={assignment.id}
                        assignment={assignment}
                        canManage={canManageAssignments}
                        saving={assignmentSaving}
                        onEnd={() => endAssignment(assignment.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </Panel>

            {canManageDrivers && (
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
                  body="Add drivers once so trips and alerts can use consistent driver names."
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
                            canManage={canManageDrivers}
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

function AssignmentCard({
  assignment,
  canManage,
  saving,
  onEnd,
}: {
  assignment: DriverAssignment;
  canManage: boolean;
  saving: boolean;
  onEnd: () => void;
}) {
  const assetName =
    assignment.asset_registration ||
    assignment.truck_id ||
    "Assigned asset";

  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold text-white">
            {assignment.driver_name || "Assigned driver"}
          </h3>
          <p className="mt-1 break-words text-sm text-slate-400">
            {assetName}
          </p>
        </div>
        <StatusPill tone="success">
          {labelize(assignment.assignment_status || "active")}
        </StatusPill>
      </div>

      <div className="mt-5 grid gap-3 text-sm">
        <Detail label="Truck ID" value={assignment.truck_id || "Not available"} />
        <Detail
          label="Provider"
          value={assignment.asset_provider_name || "Not available"}
        />
        <Detail
          label="Assigned from"
          value={formatDateTime(assignment.assigned_from)}
        />
      </div>

      {canManage && (
        <div className="mt-5">
          <SecondaryButton
            type="button"
            disabled={saving}
            onClick={onEnd}
            className="w-full sm:w-auto"
          >
            {saving ? "Ending..." : "End assignment"}
          </SecondaryButton>
        </div>
      )}
    </article>
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

function assetLabel(asset: EnabledAsset) {
  const registration = asset.registration || "Unregistered asset";
  const truck = asset.truck_id ? ` · ${asset.truck_id}` : "";
  const provider = asset.provider_name ? ` · ${asset.provider_name}` : "";
  return `${registration}${truck}${provider}`;
}
