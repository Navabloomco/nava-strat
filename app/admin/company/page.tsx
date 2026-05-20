"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import {
  FormField,
  PageHeader,
  Panel,
  PrimaryButton,
  SecondaryButton,
} from "../../components/ui/Primitives";

const businessTypeOptions = [
  { value: "long_haul_transport", label: "Long-haul transport" },
  { value: "passenger_transport", label: "Passenger transport" },
  { value: "courier_delivery", label: "Courier / delivery" },
  { value: "field_service", label: "Field service" },
  { value: "construction_equipment", label: "Construction equipment" },
  { value: "sales_fleet", label: "Sales fleet" },
  { value: "mixed_fleet", label: "Mixed fleet" },
  { value: "other", label: "Other" },
];

const primaryAssetTypeOptions = [
  { value: "truck", label: "Truck" },
  { value: "trailer", label: "Trailer" },
  { value: "bus", label: "Bus" },
  { value: "van", label: "Van" },
  { value: "pickup", label: "Pickup" },
  { value: "car", label: "Car" },
  { value: "motorcycle", label: "Motorcycle" },
  { value: "equipment", label: "Equipment" },
  { value: "other", label: "Other" },
];

const billingUnitOptions = [
  { value: "trip", label: "Trip" },
  { value: "tonne", label: "Tonne" },
  { value: "passenger", label: "Passenger" },
  { value: "delivery", label: "Delivery" },
  { value: "hour", label: "Hour" },
  { value: "day", label: "Day" },
  { value: "asset", label: "Asset" },
  { value: "other", label: "Other" },
];

const inputClass =
  "w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300";

export default function CompanySettingsPage() {
  const [company, setCompany] = useState<any>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
  const [businessType, setBusinessType] = useState("long_haul_transport");
  const [primaryAssetTypes, setPrimaryAssetTypes] = useState<string[]>([]);
  const [mainBillingUnit, setMainBillingUnit] = useState("trip");
  const [operatingRegions, setOperatingRegions] = useState("");
  const [primaryUseCase, setPrimaryUseCase] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const companyId = companyIdFromLocation();
    setSelectedCompanyId(companyId);
    loadSettings(companyId);
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

  function applyContext(json: any) {
    const context = json.operating_context || {};
    setCompany(json.company || null);
    setIsPlatformOwner(Boolean(json.is_platform_owner));
    setBusinessType(context.business_type || "long_haul_transport");
    setPrimaryAssetTypes(context.primary_asset_types || []);
    setMainBillingUnit(context.main_billing_unit || "trip");
    setOperatingRegions((context.operating_regions || []).join(", "));
    setPrimaryUseCase(context.primary_use_case || "");
  }

  async function loadSettings(companyId = selectedCompanyId) {
    setLoading(true);
    setError("");
    setMessage("");

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch(`/api/company-settings${companyQuery(companyId)}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load company settings.");
      }

      applyContext(json);
    } catch (err: any) {
      setError(err.message || "Failed to load company settings.");
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings(e: any) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/company-settings", {
        method: "PATCH",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          business_type: businessType,
          primary_asset_types: primaryAssetTypes,
          main_billing_unit: mainBillingUnit,
          operating_regions: operatingRegions,
          primary_use_case: primaryUseCase,
          ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to save company settings.");
      }

      applyContext(json);
      setMessage("Company settings updated.");
    } catch (err: any) {
      setError(err.message || "Failed to save company settings.");
    } finally {
      setSaving(false);
    }
  }

  function togglePrimaryAssetType(value: string) {
    setPrimaryAssetTypes((current) => {
      if (current.includes(value)) {
        return current.filter((item) => item !== value);
      }
      return [...current, value];
    });
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Loading company settings...</div>
        </Panel>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          dark
          eyebrow="Company"
          title="Company Settings"
          body="Keep Nava aligned with how your operation actually works. This helps review suggestions, trip defaults, and fleet answers stay relevant."
          actions={
            <SecondaryButton type="button" onClick={() => loadSettings()}>
              Refresh
            </SecondaryButton>
          }
        />

        {selectedCompanyId && isPlatformOwner && company && (
          <Panel dark className="mt-6 border-cyan-200/20 bg-cyan-300/10 p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-100">
                  Platform tenant context
                </div>
                <div className="mt-1 text-sm text-cyan-50">
                  Viewing tenant: <span className="font-semibold">{company.name}</span>
                </div>
              </div>
              <div className="text-sm font-semibold text-cyan-100">{company.slug}</div>
            </div>
          </Panel>
        )}

        {company && (
          <Panel dark className="mt-8 p-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                  Workspace
                </div>
                <div className="mt-2 text-xl font-semibold text-white">
                  {company.name}
                </div>
              </div>
              <div className="text-sm text-slate-400">{company.slug}</div>
            </div>
          </Panel>
        )}

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

        <Panel dark className="mt-8 p-6">
          <form onSubmit={saveSettings} className="grid gap-6">
            <FormField label="Business type" dark>
              <select
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value)}
                className={inputClass}
              >
                {businessTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormField>

            <div>
              <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-300">
                Primary asset types
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {primaryAssetTypeOptions.map((option) => {
                  const selected = primaryAssetTypes.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => togglePrimaryAssetType(option.value)}
                      className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                        selected
                          ? "border-cyan-200/30 bg-cyan-300/15 text-cyan-100"
                          : "border-white/10 bg-slate-900 text-slate-300 hover:bg-white/10"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <FormField label="Main billing unit" dark>
              <select
                value={mainBillingUnit}
                onChange={(e) => setMainBillingUnit(e.target.value)}
                className={inputClass}
              >
                {billingUnitOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Operating regions" dark>
              <input
                value={operatingRegions}
                onChange={(e) => setOperatingRegions(e.target.value)}
                placeholder="Kenya, Uganda, Tanzania"
                className={inputClass}
              />
            </FormField>

            <FormField label="Primary use case" dark>
              <textarea
                value={primaryUseCase}
                onChange={(e) => setPrimaryUseCase(e.target.value)}
                placeholder="Example: Cement deliveries, field service, passenger routes"
                className={`${inputClass} min-h-28 resize-y`}
              />
            </FormField>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <PrimaryButton type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save settings"}
              </PrimaryButton>
              <SecondaryButton type="button" onClick={() => loadSettings()}>
                Cancel changes
              </SecondaryButton>
            </div>
          </form>
        </Panel>
      </div>
    </main>
  );
}

function companyIdFromLocation() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("companyId") || "";
}

function companyQuery(companyId: string) {
  return companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
}
