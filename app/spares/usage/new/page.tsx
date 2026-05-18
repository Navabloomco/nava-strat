"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import {
  FormField,
  PageHeader,
  Panel,
  PrimaryButton,
  SecondaryButton,
} from "../../../components/ui/Primitives";

type EnabledAsset = {
  id: string;
  truck_id: string | null;
  registration: string | null;
  asset_category: string | null;
  provider_name: string | null;
  status: string | null;
  last_seen_at: string | null;
};

const eventTypes = [
  { value: "installed", label: "Installed" },
  { value: "removed", label: "Removed" },
  { value: "repaired", label: "Repaired" },
  { value: "retreaded", label: "Retreaded" },
  { value: "transferred", label: "Transferred" },
  { value: "scrapped", label: "Scrapped" },
  { value: "purchased", label: "Purchased" },
  { value: "inspected", label: "Inspected" },
  { value: "returned_to_stock", label: "Returned to stock" },
];

const inputClass =
  "w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300";

export default function NewSpareUsagePage() {
  const router = useRouter();
  const [assets, setAssets] = useState<EnabledAsset[]>([]);
  const [assetSearch, setAssetSearch] = useState("");
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [eventType, setEventType] = useState("installed");
  const [partName, setPartName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [eventAt, setEventAt] = useState("");
  const [assetId, setAssetId] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [mechanicName, setMechanicName] = useState("");
  const [conditionBefore, setConditionBefore] = useState("");
  const [conditionAfter, setConditionAfter] = useState("");
  const [odometer, setOdometer] = useState("");
  const [engineHours, setEngineHours] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [fromAssetId, setFromAssetId] = useState("");
  const [toAssetId, setToAssetId] = useState("");

  useEffect(() => {
    loadAssets();
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

  async function loadAssets() {
    setLoadingAssets(true);

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/ops/enabled-assets", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load enabled vehicles.");
      }

      setAssets(json.assets || []);
    } catch (err: any) {
      setMessage(err.message || "Vehicle list unavailable. You can still record spare usage without a vehicle.");
    } finally {
      setLoadingAssets(false);
    }
  }

  const filteredAssets = useMemo(() => {
    const query = assetSearch.trim().toLowerCase();
    const list = query ? assets : assets.slice(0, 8);

    if (!query) return list;

    return assets.filter((asset) =>
      [
        asset.registration,
        asset.truck_id,
        asset.provider_name,
        asset.asset_category,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [assets, assetSearch]);

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
      const res = await fetch("/api/spares/usage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_type: eventType,
          part_name: partName,
          quantity: Number(quantity),
          event_at: eventAt || null,
          asset_id: assetId || null,
          vendor_name: vendorName,
          mechanic_name: mechanicName,
          condition_before: conditionBefore,
          condition_after: conditionAfter,
          odometer: odometer ? Number(odometer) : null,
          engine_hours: engineHours ? Number(engineHours) : null,
          cost: cost ? Number(cost) : null,
          notes,
          from_asset_id: fromAssetId || null,
          to_asset_id: toAssetId || null,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to record spare usage.");
      }

      setMessage("Spare usage recorded.");
      router.push("/spares");
    } catch (err: any) {
      setError(err.message || "Failed to record spare usage.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          dark
          eyebrow="Lifecycle capture"
          title="Record Spare Usage"
          body="Record a spare event immediately. Inventory, catalog parts, and serial numbers are not required."
          actions={
            <Link href="/spares">
              <SecondaryButton type="button" className="w-full sm:w-auto">
                Back to spares
              </SecondaryButton>
            </Link>
          }
        />

        {message && (
          <Panel dark className="mt-8 border-cyan-200/20 bg-cyan-300/10 p-4">
            <div className="text-sm text-cyan-50">{message}</div>
          </Panel>
        )}

        {error && (
          <Panel dark className="mt-8 border-rose-300/30 bg-rose-500/10 p-4">
            <div className="text-sm text-rose-100">{error}</div>
          </Panel>
        )}

        <Panel dark className="mt-8 p-6">
          <form onSubmit={handleSubmit} className="grid gap-6">
            <div>
              <h2 className="text-lg font-semibold text-white">Spare event</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Capture what happened, who handled it, and which vehicle was involved when known.
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <FormField label="Event type" dark>
                <select
                  value={eventType}
                  onChange={(event) => setEventType(event.target.value)}
                  className={inputClass}
                  required
                >
                  {eventTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Event date optional" dark>
                <input
                  type="datetime-local"
                  value={eventAt}
                  onChange={(event) => setEventAt(event.target.value)}
                  className={inputClass}
                />
              </FormField>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <FormField label="Part name" dark>
                <input
                  value={partName}
                  onChange={(event) => setPartName(event.target.value)}
                  placeholder="e.g. TYRE 315/80R22.5, BATTERY, BRAKE PADS"
                  className={inputClass}
                  required
                />
              </FormField>

              <FormField label="Quantity" dark>
                <input
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  inputMode="decimal"
                  className={inputClass}
                  required
                />
              </FormField>
            </div>

            <Panel dark className="border-cyan-200/20 bg-cyan-300/10 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="text-base font-semibold text-cyan-50">
                    Vehicle optional
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Link an enabled vehicle when possible. You can still save the event without inventory or a serial number.
                  </p>
                </div>
                {assets.length === 0 && !loadingAssets && (
                  <Link href="/admin/assets">
                    <SecondaryButton type="button" className="w-full sm:w-auto">
                      Review assets
                    </SecondaryButton>
                  </Link>
                )}
              </div>

              <div className="mt-4 grid gap-4">
                <input
                  value={assetSearch}
                  onChange={(event) => setAssetSearch(event.target.value)}
                  placeholder="Search enabled vehicles by registration, truck ID, provider, or category"
                  className={inputClass}
                />

                <div className="grid gap-3 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setAssetId("")}
                    className={
                      !assetId
                        ? "rounded-md border border-cyan-200/40 bg-cyan-300/10 px-3 py-3 text-left text-sm font-semibold text-cyan-100"
                        : "rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-left text-sm text-slate-300 hover:bg-white/10"
                    }
                  >
                    No vehicle linked
                  </button>
                  {filteredAssets.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => setAssetId(asset.id)}
                      className={
                        assetId === asset.id
                          ? "rounded-md border border-cyan-200/40 bg-cyan-300/10 px-3 py-3 text-left text-sm text-cyan-50"
                          : "rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-left text-sm text-slate-300 hover:bg-white/10"
                      }
                    >
                      <div className="font-semibold text-white">
                        {asset.registration || asset.truck_id || "Unnamed vehicle"}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        {[asset.truck_id, asset.provider_name, labelize(asset.asset_category)]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </Panel>

            <div className="grid gap-5 md:grid-cols-2">
              <FormField label="Vendor / supplier optional" dark>
                <input
                  value={vendorName}
                  onChange={(event) => setVendorName(event.target.value.toUpperCase())}
                  placeholder="Supplier or vendor"
                  className={inputClass}
                />
              </FormField>

              <FormField label="Mechanic / workshop optional" dark>
                <input
                  value={mechanicName}
                  onChange={(event) => setMechanicName(event.target.value)}
                  placeholder="Mechanic or workshop"
                  className={inputClass}
                />
              </FormField>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <FormField label="Condition before optional" dark>
                <input
                  value={conditionBefore}
                  onChange={(event) => setConditionBefore(event.target.value)}
                  placeholder="e.g. worn, punctured, failed"
                  className={inputClass}
                />
              </FormField>

              <FormField label="Condition after optional" dark>
                <input
                  value={conditionAfter}
                  onChange={(event) => setConditionAfter(event.target.value)}
                  placeholder="e.g. new, repaired, retreaded"
                  className={inputClass}
                />
              </FormField>
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              <FormField label="Odometer optional" dark>
                <input
                  value={odometer}
                  onChange={(event) => setOdometer(event.target.value)}
                  inputMode="decimal"
                  placeholder="KM"
                  className={inputClass}
                />
              </FormField>

              <FormField label="Engine hours optional" dark>
                <input
                  value={engineHours}
                  onChange={(event) => setEngineHours(event.target.value)}
                  inputMode="decimal"
                  placeholder="Hours"
                  className={inputClass}
                />
              </FormField>

              <FormField label="Cost optional" dark>
                <input
                  value={cost}
                  onChange={(event) => setCost(event.target.value)}
                  inputMode="decimal"
                  placeholder="KES"
                  className={inputClass}
                />
              </FormField>
            </div>

            <Panel dark className="p-4">
              <h3 className="text-base font-semibold text-white">
                Transfer details optional
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Use this when a spare moves from one vehicle to another. Leave blank for normal installs, repairs, or removals.
              </p>
              <div className="mt-4 grid gap-5 md:grid-cols-2">
                <FormField label="From vehicle" dark>
                  <select
                    value={fromAssetId}
                    onChange={(event) => setFromAssetId(event.target.value)}
                    className={inputClass}
                  >
                    <option value="">Not selected</option>
                    {assets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {assetLabel(asset)}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField label="To vehicle" dark>
                  <select
                    value={toAssetId}
                    onChange={(event) => setToAssetId(event.target.value)}
                    className={inputClass}
                  >
                    <option value="">Not selected</option>
                    {assets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {assetLabel(asset)}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
            </Panel>

            <FormField label="Notes optional" dark>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Add any useful repair, fitment, warranty, or failure notes."
                className={`${inputClass} min-h-28`}
              />
            </FormField>

            <div className="flex flex-col gap-3 sm:flex-row">
              <PrimaryButton type="submit" disabled={saving} className="w-full sm:w-auto">
                {saving ? "Saving..." : "Record spare usage"}
              </PrimaryButton>
              <Link href="/spares">
                <SecondaryButton type="button" className="w-full sm:w-auto">
                  Cancel
                </SecondaryButton>
              </Link>
            </div>
          </form>
        </Panel>
      </div>
    </main>
  );
}

function labelize(value?: string | null) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function assetLabel(asset: EnabledAsset) {
  return [asset.registration || asset.truck_id || "Vehicle", asset.truck_id]
    .filter(Boolean)
    .join(" · ");
}
