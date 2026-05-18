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

type SparePart = {
  id: string;
  name: string | null;
  category: string | null;
  brand: string | null;
  model: string | null;
  part_number: string | null;
  default_unit: string | null;
  expected_life_km: number | null;
  expected_life_days: number | null;
  retreadable: boolean;
  max_retreads: number | null;
  is_active: boolean;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type Capabilities = {
  can_manage_spares_parts?: boolean;
};

const categories = [
  { value: "tyre", label: "Tyre" },
  { value: "battery", label: "Battery" },
  { value: "brake", label: "Brake" },
  { value: "filter", label: "Filter" },
  { value: "engine", label: "Engine" },
  { value: "transmission", label: "Transmission" },
  { value: "suspension", label: "Suspension" },
  { value: "electrical", label: "Electrical" },
  { value: "body", label: "Body" },
  { value: "consumable", label: "Consumable" },
  { value: "other", label: "Other" },
];

const inputClass =
  "w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300";

const emptyForm = {
  name: "",
  category: "other",
  brand: "",
  model: "",
  part_number: "",
  default_unit: "",
  expected_life_km: "",
  expected_life_days: "",
  retreadable: false,
  max_retreads: "",
  is_active: true,
  notes: "",
};

export default function SparePartsPage() {
  const [parts, setParts] = useState<SparePart[]>([]);
  const [company, setCompany] = useState<any>(null);
  const [capabilities, setCapabilities] = useState<Capabilities>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState({ ...emptyForm });

  useEffect(() => {
    loadParts();
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

  async function loadParts() {
    setLoading(true);
    setError("");

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/spares/parts", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load parts catalog.");
      }

      setParts(json.parts || []);
      setCompany(json.company || null);
      setCapabilities(json.capabilities || {});
    } catch (err: any) {
      setError(err.message || "Failed to load parts catalog.");
    } finally {
      setLoading(false);
    }
  }

  function updateForm(updates: Partial<typeof emptyForm>) {
    setForm((current) => ({ ...current, ...updates }));
  }

  function startEdit(part: SparePart) {
    setEditingId(part.id);
    setForm({
      name: part.name || "",
      category: part.category || "other",
      brand: part.brand || "",
      model: part.model || "",
      part_number: part.part_number || "",
      default_unit: part.default_unit || "",
      expected_life_km:
        part.expected_life_km === null || part.expected_life_km === undefined
          ? ""
          : String(part.expected_life_km),
      expected_life_days:
        part.expected_life_days === null || part.expected_life_days === undefined
          ? ""
          : String(part.expected_life_days),
      retreadable: Boolean(part.retreadable),
      max_retreads:
        part.max_retreads === null || part.max_retreads === undefined
          ? ""
          : String(part.max_retreads),
      is_active: part.is_active !== false,
      notes: part.notes || "",
    });
    setMessage("");
    setError("");
  }

  function resetForm() {
    setEditingId("");
    setForm({ ...emptyForm });
  }

  function buildPayload() {
    return {
      name: form.name,
      category: form.category,
      brand: form.brand || null,
      model: form.model || null,
      part_number: form.part_number || null,
      default_unit: form.default_unit || null,
      expected_life_km: form.expected_life_km ? Number(form.expected_life_km) : null,
      expected_life_days: form.expected_life_days ? Number(form.expected_life_days) : null,
      retreadable: form.retreadable,
      max_retreads: form.max_retreads ? Number(form.max_retreads) : null,
      is_active: form.is_active,
      notes: form.notes || null,
    };
  }

  async function handleSubmit(event: any) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    const token = await getAccessToken();
    if (!token) {
      setSaving(false);
      return;
    }

    try {
      const url = editingId
        ? `/api/spares/parts/${editingId}`
        : "/api/spares/parts";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildPayload()),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to save part.");
      }

      setMessage(editingId ? "Part updated." : "Part saved.");
      resetForm();
      await loadParts();
    } catch (err: any) {
      setError(err.message || "Failed to save part.");
    } finally {
      setSaving(false);
    }
  }

  const canManage = Boolean(capabilities.can_manage_spares_parts);
  const filteredParts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return parts;

    return parts.filter((part) =>
      [
        part.name,
        part.category,
        part.brand,
        part.model,
        part.part_number,
        part.notes,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [parts, search]);

  const summary = useMemo(() => {
    const categoriesCount = new Set(
      parts.map((part) => part.category).filter(Boolean)
    ).size;

    return {
      total: parts.length,
      active: parts.filter((part) => part.is_active).length,
      retreadable: parts.filter((part) => part.retreadable).length,
      categories: categoriesCount,
    };
  }, [parts]);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          dark
          eyebrow={`Spares setup · ${company?.name || "Company workspace"}`}
          title="Parts Catalog"
          body="Save common spare names and specifications so repair records are faster and future lifespan analysis is cleaner."
          actions={
            <Link href="/spares">
              <SecondaryButton type="button" className="w-full sm:w-auto">
                Back to Spares
              </SecondaryButton>
            </Link>
          }
        />

        {loading && (
          <Panel dark className="mt-8 p-6">
            <div className="text-sm text-slate-300">Loading parts catalog...</div>
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
            <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Metric label="Total parts" value={summary.total.toLocaleString()} />
              <Metric label="Active parts" value={summary.active.toLocaleString()} />
              <Metric label="Retreadable parts" value={summary.retreadable.toLocaleString()} />
              <Metric label="Categories" value={summary.categories.toLocaleString()} />
            </section>

            {canManage && (
              <Panel dark className="mt-8 p-6">
                <form onSubmit={handleSubmit} className="grid gap-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-white">
                        {editingId ? "Edit part" : "Add part"}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-slate-300">
                        Keep it lightweight. Inventory counts and serial tracking come later.
                      </p>
                    </div>
                    {editingId && (
                      <SecondaryButton
                        type="button"
                        onClick={resetForm}
                        className="w-full sm:w-auto"
                      >
                        Cancel edit
                      </SecondaryButton>
                    )}
                  </div>

                  <div className="grid gap-5 md:grid-cols-2">
                    <FormField label="Part name" dark>
                      <input
                        value={form.name}
                        onChange={(event) => updateForm({ name: event.target.value })}
                        placeholder="e.g. Tyre 315/80R22.5, battery, brake pads"
                        className={inputClass}
                        required
                      />
                    </FormField>

                    <FormField label="Category" dark>
                      <select
                        value={form.category}
                        onChange={(event) => updateForm({ category: event.target.value })}
                        className={inputClass}
                        required
                      >
                        {categories.map((category) => (
                          <option key={category.value} value={category.value}>
                            {category.label}
                          </option>
                        ))}
                      </select>
                    </FormField>
                  </div>

                  <div className="grid gap-5 md:grid-cols-3">
                    <FormField label="Brand optional" dark>
                      <input
                        value={form.brand}
                        onChange={(event) => updateForm({ brand: event.target.value })}
                        placeholder="Brand"
                        className={inputClass}
                      />
                    </FormField>

                    <FormField label="Model optional" dark>
                      <input
                        value={form.model}
                        onChange={(event) => updateForm({ model: event.target.value })}
                        placeholder="Model/spec"
                        className={inputClass}
                      />
                    </FormField>

                    <FormField label="Part number optional" dark>
                      <input
                        value={form.part_number}
                        onChange={(event) => updateForm({ part_number: event.target.value })}
                        placeholder="Part number"
                        className={inputClass}
                      />
                    </FormField>
                  </div>

                  <div className="grid gap-5 md:grid-cols-4">
                    <FormField label="Default unit optional" dark>
                      <input
                        value={form.default_unit}
                        onChange={(event) => updateForm({ default_unit: event.target.value })}
                        placeholder="each, set, pair"
                        className={inputClass}
                      />
                    </FormField>

                    <FormField label="Expected life KM optional" dark>
                      <input
                        value={form.expected_life_km}
                        onChange={(event) => updateForm({ expected_life_km: event.target.value })}
                        inputMode="decimal"
                        placeholder="KM"
                        className={inputClass}
                      />
                    </FormField>

                    <FormField label="Expected life days optional" dark>
                      <input
                        value={form.expected_life_days}
                        onChange={(event) => updateForm({ expected_life_days: event.target.value })}
                        inputMode="numeric"
                        placeholder="Days"
                        className={inputClass}
                      />
                    </FormField>

                    <FormField label="Max retreads optional" dark>
                      <input
                        value={form.max_retreads}
                        onChange={(event) => updateForm({ max_retreads: event.target.value })}
                        inputMode="numeric"
                        placeholder="0"
                        className={inputClass}
                      />
                    </FormField>
                  </div>

                  <label className="flex items-center gap-3 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={form.retreadable}
                      onChange={(event) => updateForm({ retreadable: event.target.checked })}
                      className="h-4 w-4 rounded border-white/20 bg-slate-900"
                    />
                    Retreadable part
                  </label>

                  <label className="flex items-center gap-3 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(event) => updateForm({ is_active: event.target.checked })}
                      className="h-4 w-4 rounded border-white/20 bg-slate-900"
                    />
                    Active in catalog
                  </label>

                  <FormField label="Notes optional" dark>
                    <textarea
                      value={form.notes}
                      onChange={(event) => updateForm({ notes: event.target.value })}
                      placeholder="Warranty notes, fitment notes, supplier notes, or preferred use."
                      className={`${inputClass} min-h-24`}
                    />
                  </FormField>

                  <div>
                    <PrimaryButton type="submit" disabled={saving}>
                      {saving ? "Saving..." : editingId ? "Update part" : "Save part"}
                    </PrimaryButton>
                  </div>
                </form>
              </Panel>
            )}

            <Panel dark className="mt-8 p-5">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, category, brand, model, part number, or notes"
                className={inputClass}
              />
            </Panel>

            <section className="mt-8">
              {parts.length === 0 ? (
                <EmptyState
                  dark
                  title="No saved parts yet"
                  body="Save common parts so repair records are faster and future lifespan analysis is cleaner."
                />
              ) : filteredParts.length === 0 ? (
                <EmptyState
                  dark
                  title="No matching parts"
                  body="Try another part name, category, brand, model, part number, or note."
                />
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {filteredParts.map((part) => (
                    <Panel key={part.id} dark className="p-5">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="min-w-0 break-words text-lg font-semibold text-white">
                              {part.name || "Part"}
                            </h2>
                            <StatusPill tone={part.is_active ? "success" : "neutral"}>
                              {part.is_active ? "Active" : "Inactive"}
                            </StatusPill>
                          </div>
                          <div className="mt-2 text-sm text-slate-400">
                            {categoryLabel(part.category)}
                          </div>
                        </div>
                        {canManage && (
                          <SecondaryButton
                            type="button"
                            onClick={() => startEdit(part)}
                            className="w-full sm:w-auto"
                          >
                            Edit
                          </SecondaryButton>
                        )}
                      </div>

                      <div className="mt-5 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
                        <Detail label="Brand / model" value={formatBrandModel(part)} />
                        <Detail label="Part number" value={part.part_number || "—"} />
                        <Detail label="Expected life" value={formatExpectedLife(part)} />
                        <Detail label="Retreadable" value={formatRetread(part)} />
                      </div>

                      {part.notes && (
                        <div className="mt-5 text-sm leading-6 text-slate-300">
                          {part.notes}
                        </div>
                      )}
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Panel dark className="p-5">
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
    </Panel>
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

function categoryLabel(value?: string | null) {
  return (
    categories.find((category) => category.value === value)?.label || "Other"
  );
}

function formatBrandModel(part: SparePart) {
  return [part.brand, part.model].filter(Boolean).join(" / ") || "—";
}

function formatExpectedLife(part: SparePart) {
  const bits = [];
  if (part.expected_life_km) bits.push(`${part.expected_life_km.toLocaleString()} km`);
  if (part.expected_life_days) bits.push(`${part.expected_life_days.toLocaleString()} days`);
  return bits.join(" / ") || "—";
}

function formatRetread(part: SparePart) {
  if (!part.retreadable) return "No";
  if (part.max_retreads === null || part.max_retreads === undefined) return "Yes";
  return `Yes · max ${part.max_retreads}`;
}

