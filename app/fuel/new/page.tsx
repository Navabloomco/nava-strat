"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import JourneyPicker from "../../components/JourneyPicker";
import {
  FormField,
  PageHeader,
  Panel,
  PrimaryButton,
} from "../../components/ui/Primitives";

const inputClass =
  "w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300";

export default function NewFuelPage() {
  const [journeys, setJourneys] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [canViewFinance, setCanViewFinance] = useState(false);

  const [client, setClient] = useState("");
  const [truck, setTruck] = useState("");
  const [liters, setLiters] = useState("");
  const [pricePerLiter, setPricePerLiter] = useState("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [journeyId, setJourneyId] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");

  const [approved, setApproved] = useState(false);
  const [approvalReason, setApprovalReason] = useState("");

  useEffect(() => {
    loadFuelData();
  }, []);

  async function loadFuelData() {
    setLoading(true);
    setMessage("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return;
    }

    const res = await fetch("/api/fuel", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setMessage(json.error || "Failed to load fuel data.");
      setLoading(false);
      return;
    }

    setJourneys(
      (json.journeys || []).filter(
        (journey: any) => String(journey.status || "").toLowerCase() === "active"
      )
    );
    setProviders(json.fuel_providers || []);
    setCanViewFinance(Boolean(json.capabilities?.can_view_finance));
    setLoading(false);
  }

  const clients = useMemo(() => {
    return Array.from(
      new Set(journeys.map((j) => j.client_name).filter(Boolean))
    );
  }, [journeys]);

  const suggestedJourneys = useMemo(() => {
    return journeys.filter((j) => {
      const matchesClient = client ? j.client_name === client : true;
      const matchesTruck = truck
        ? (j.truck || "").toUpperCase().includes(truck.toUpperCase())
        : true;

      return matchesClient && matchesTruck;
    });
  }, [journeys, client, truck]);

  async function handleSubmit(e: any) {
    e.preventDefault();
    setMessage("");

    const cleanTruck = truck.trim().toUpperCase();
    const litersNum = Number(liters);
    const priceNum = canViewFinance && pricePerLiter ? Number(pricePerLiter) : 0;

    if (!cleanTruck || !litersNum) {
      alert("Truck and liters are required.");
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setMessage("Session expired. Please log in again.");
      return;
    }

    const res = await fetch("/api/fuel", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        truck_text: cleanTruck,
        liters: litersNum,
        ...(canViewFinance ? { price_per_liter: priceNum } : {}),
        vendor: vendor.trim().toUpperCase(),
        notes,
        journey_id: journeyId || null,
        fuel_source: "manual",
        approved_extra_fuel: approved,
        approval_reason: approved ? approvalReason : null,
      }),
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setMessage(json.error || "Failed to save fuel.");
      return;
    }

    alert("Fuel saved ✅");

    setClient("");
    setTruck("");
    setLiters("");
    setPricePerLiter("");
    setVendor("");
    setNotes("");
    setJourneyId("");
    setSelectedProviderId("");
    setApproved(false);
    setApprovalReason("");
    loadFuelData();
  }

  return (
    <main className="min-h-screen bg-slate-950 px-8 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          dark
          eyebrow="Finance control"
          title="Add Fuel"
          body="Capture a fuel entry and optionally allocate it to an active journey."
        />

        {loading && (
          <Panel dark className="mt-8 p-6">
            <div className="text-sm text-slate-300">Loading fuel data...</div>
          </Panel>
        )}
        {message && (
          <Panel dark className="mt-8 border-cyan-200/20 bg-cyan-300/10 p-4">
            <div className="whitespace-pre-wrap text-sm text-cyan-50">{message}</div>
          </Panel>
        )}

        <Panel dark className="mt-8 p-6">
          <form onSubmit={handleSubmit} className="grid gap-5">
            <div className="grid gap-5 md:grid-cols-2">
              <FormField label="Client optional" dark>
                <select
                  value={client}
                  onChange={(e) => {
                    setClient(e.target.value);
                    setJourneyId("");
                  }}
                  className={inputClass}
                >
                  <option value="">Select client optional</option>
                  {clients.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Truck" dark>
                <input
                  placeholder="Enter vehicle registration"
                  value={truck}
                  onChange={(e) => {
                    setTruck(e.target.value.toUpperCase());
                    setJourneyId("");
                  }}
                  className={inputClass}
                  required
                />
              </FormField>
            </div>

            <Panel dark className="border-cyan-200/20 bg-cyan-300/10 p-4">
              <h2 className="text-sm font-semibold text-cyan-50">
                Nava Eye Suggestions
              </h2>
              <p className="mt-2 text-sm text-slate-300">
                {suggestedJourneys.length === 0
                  ? "No matching active trip. Fuel can be saved as unallocated."
                  : `${suggestedJourneys.length} matching active trip(s) found.`}
              </p>

              {suggestedJourneys.length > 0 && (
                <div className="mt-4">
                  <JourneyPicker
                    journeys={suggestedJourneys}
                    value={journeyId}
                    onChange={(nextJourneyId) => setJourneyId(nextJourneyId)}
                    allowUnallocated
                    placeholder="Search matching trips by reference, truck, client, route, or status"
                  />
                </div>
              )}
            </Panel>

            <div className="grid gap-5 md:grid-cols-2">
              <FormField label="Liters" dark>
                <input
                  placeholder="Liters e.g. 480"
                  value={liters}
                  onChange={(e) => setLiters(e.target.value)}
                  className={inputClass}
                  required
                />
              </FormField>

              <FormField label="Fuel provider optional" dark>
                <select
                  value={selectedProviderId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedProviderId(id);

                    const provider = providers.find((p) => p.id === id);

                    if (provider) {
                      setVendor(provider.name || "");

                      if (canViewFinance && provider.current_price_per_liter) {
                        setPricePerLiter(provider.current_price_per_liter.toString());
                      }
                    }
                  }}
                  className={inputClass}
                >
                  <option value="">Select fuel provider or type manually</option>

                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name} — {provider.location || "NO LOCATION"}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <FormField label="Fuel provider / station" dark>
                <input
                  placeholder="Fuel provider / station"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value.toUpperCase())}
                  className={inputClass}
                />
              </FormField>

              {canViewFinance ? (
                <FormField label="Price per liter" dark>
                  <input
                    placeholder="Price per liter"
                    value={pricePerLiter}
                    onChange={(e) => setPricePerLiter(e.target.value)}
                    className={inputClass}
                  />
                </FormField>
              ) : (
                <Panel dark className="border-white/10 bg-slate-950/60 p-4">
                  <div className="text-sm font-semibold text-white">
                    Fuel cost is restricted.
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Save litres, truck, supplier, and operational notes. Finance roles can add or review fuel cost fields.
                  </p>
                </Panel>
              )}
            </div>

            <label className="flex items-center gap-3 rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
                className="h-4 w-4 accent-cyan-300"
              />{" "}
              Approve extra fuel / second fueling
            </label>

            {approved && (
              <FormField label="Approval reason" dark>
                <input
                  placeholder="Approval reason e.g. emergency top-up"
                  value={approvalReason}
                  onChange={(e) => setApprovalReason(e.target.value)}
                  className={inputClass}
                  required
                />
              </FormField>
            )}

            <FormField label="Notes" dark>
              <input
                placeholder="Notes e.g. MPesa, invoice, top-up"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={inputClass}
              />
            </FormField>

            <div>
              <PrimaryButton type="submit">Save Fuel</PrimaryButton>
            </div>
          </form>
        </Panel>
      </div>
    </main>
  );
}
