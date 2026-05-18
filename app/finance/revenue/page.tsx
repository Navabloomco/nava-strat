"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import JourneyPicker from "../../components/JourneyPicker";
import {
  EmptyState,
  FormField,
  PageHeader,
  Panel,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
} from "../../components/ui/Primitives";

const inputClass =
  "w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300";

export default function RevenuePage() {
  const [journeys, setJourneys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [client, setClient] = useState("");
  const [route, setRoute] = useState("");
  const [quickJourneyId, setQuickJourneyId] = useState("");

  const [rateType, setRateType] = useState("per_tonne");
  const [rateAmount, setRateAmount] = useState("");
  const [rateCurrency, setRateCurrency] = useState("KES");
  const [fxRate, setFxRate] = useState("1");

  useEffect(() => {
    loadJourneys();
  }, []);

  async function loadJourneys() {
    setLoading(true);
    setMessage("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return;
    }

    const res = await fetch("/api/finance/revenue", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setMessage(json.error || "Failed to load revenue data.");
      setLoading(false);
      return;
    }

    setJourneys(
      (json.journeys || []).filter(
        (journey: any) => String(journey.status || "").toLowerCase() === "active"
      )
    );
    setLoading(false);
  }

  const clients = useMemo(() => {
    return Array.from(
      new Set(journeys.map((j) => j.client_name).filter(Boolean))
    );
  }, [journeys]);

  const routes = useMemo(() => {
    return Array.from(
      new Set(
        journeys
          .filter((j) => (client ? j.client_name === client : true))
          .map((j) => `${j.from_location} → ${j.to_location}`)
      )
    );
  }, [journeys, client]);

  const selectedJourneys = journeys.filter((j) => {
    const journeyRoute = `${j.from_location} → ${j.to_location}`;

    return (
      (client ? j.client_name === client : true) &&
      (route ? journeyRoute === route : true)
    );
  });

  function calculatePreview(journey: any) {
    const rate = Number(rateAmount || journey.rate_amount || 0);
    const fx = rateCurrency === "KES" ? 1 : Number(fxRate || journey.fx_rate || 1);
    const qty = Number(journey.offloaded_quantity || 0);

    let revenueOriginal = 0;

    if (rateType === "per_truck") {
      revenueOriginal = rate;
    } else {
      revenueOriginal = rate * qty;
    }

    return {
      revenueOriginal,
      revenueKes: rateCurrency === "KES" ? revenueOriginal : revenueOriginal * fx,
    };
  }

  async function applyRateToSelected(e: any) {
    e.preventDefault();

    if (!client || !route) {
      alert("Select client and route.");
      return;
    }

    if (!rateAmount) {
      alert("Enter rate amount.");
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setMessage("Session expired. Please log in again.");
      return;
    }

    const res = await fetch("/api/finance/revenue", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        journeyIds: selectedJourneys.map((journey) => journey.id),
        rate_type: rateType,
        rate_amount: Number(rateAmount),
        rate_currency: rateCurrency,
        fx_rate: rateCurrency === "KES" ? 1 : Number(fxRate || 1),
      }),
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setMessage(json.error || "Failed to apply rate.");
      return;
    }

    alert(`Rate applied to ${selectedJourneys.length} journey/journeys ✅`);
    loadJourneys();
  }

  async function saveQuantities(journeyId: string) {
    const journey = journeys.find((item) => item.id === journeyId);
    const loadedInput = document.getElementById(
      `loaded-${journeyId}`
    ) as HTMLInputElement;

    const offloadedInput = document.getElementById(
      `offloaded-${journeyId}`
    ) as HTMLInputElement;

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setMessage("Session expired. Please log in again.");
      return;
    }

    const res = await fetch("/api/finance/revenue", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        journeyId,
        loaded_quantity: Number(loadedInput.value || 0),
        offloaded_quantity: Number(offloadedInput.value || 0),
        rate_type: rateType,
        rate_amount: Number(rateAmount || journey?.rate_amount || 0),
        rate_currency: rateCurrency || journey?.rate_currency || "KES",
        fx_rate:
          rateCurrency === "KES"
            ? 1
            : Number(fxRate || journey?.fx_rate || 1),
      }),
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setMessage(json.error || "Failed to save quantity.");
      return;
    }

    alert("Quantity saved ✅");
    loadJourneys();
  }

  return (
    <main className="min-h-screen bg-slate-950 px-8 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          dark
          eyebrow="Finance control"
          title="Revenue Engine"
          body="Set pricing by client and route, then enter loaded and offloaded quantity per truck."
        />

        {loading && (
          <Panel dark className="mt-8 p-6">
            <div className="text-sm text-slate-300">Loading revenue data...</div>
          </Panel>
        )}
        {message && (
          <Panel dark className="mt-8 border-cyan-200/20 bg-cyan-300/10 p-4">
            <div className="whitespace-pre-wrap text-sm text-cyan-50">{message}</div>
          </Panel>
        )}

        {!loading && journeys.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              dark
              title="No active journeys to price"
              body="Create a journey first, then return here to set rates, quantities, and revenue."
              action={
                <Link href="/ops/journey/new">
                  <PrimaryButton type="button">Create journey</PrimaryButton>
                </Link>
              }
            />
          </div>
        ) : (
          <>
            <Panel dark className="mt-8 p-6">
              <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-semibold">Rate setup</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Apply a rate to the selected client and route.
                  </p>
                </div>
                <StatusPill tone="info">
                  {selectedJourneys.length} matching journey/journeys
                </StatusPill>
              </div>

              <form onSubmit={applyRateToSelected} className="grid gap-5">
                <Panel dark className="border-cyan-200/20 bg-cyan-300/10 p-4">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-cyan-50">
                      Find a trip fast
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-slate-300">
                      Search by trip, truck, client, or route. Selecting a trip only sets the client and route filters below.
                    </p>
                  </div>
                  <JourneyPicker
                    journeys={journeys}
                    value={quickJourneyId}
                    onChange={(journeyId, journey) => {
                      setQuickJourneyId(journeyId);
                      if (!journey) return;
                      setClient(journey.client_name || "");
                      setRoute(`${journey.from_location} → ${journey.to_location}`);
                    }}
                    placeholder="Search active trips by truck, client, route, or reference"
                  />
                </Panel>

                <div className="grid gap-5 md:grid-cols-2">
                  <FormField label="Client" dark>
                    <select
                      value={client}
                      onChange={(e) => {
                        setClient(e.target.value);
                        setRoute("");
                      }}
                      className={inputClass}
                      required
                    >
                      <option value="">Select client</option>
                      {clients.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </FormField>

                  <FormField label="Route" dark>
                    <select
                      value={route}
                      onChange={(e) => setRoute(e.target.value)}
                      className={inputClass}
                      required
                    >
                      <option value="">Select route</option>
                      {routes.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </FormField>
                </div>

                <div className="grid gap-5 md:grid-cols-3">
                  <FormField label="Rate type" dark>
                    <select
                      value={rateType}
                      onChange={(e) => setRateType(e.target.value)}
                      className={inputClass}
                    >
                      <option value="per_tonne">Per Tonne</option>
                      <option value="per_truck">Per Truck</option>
                      <option value="per_box">Per Box</option>
                      <option value="per_bag">Per Bag</option>
                      <option value="per_crate">Per Crate</option>
                      <option value="per_pallet">Per Pallet</option>
                      <option value="per_litre">Per Litre</option>
                      <option value="per_km">Per KM</option>
                      <option value="custom">Custom Unit</option>
                    </select>
                  </FormField>

                  <FormField label="Rate amount" dark>
                    <input
                      placeholder="Rate amount e.g. 45"
                      value={rateAmount}
                      onChange={(e) => setRateAmount(e.target.value)}
                      className={inputClass}
                      required
                    />
                  </FormField>

                  <FormField label="Currency" dark>
                    <select
                      value={rateCurrency}
                      onChange={(e) => {
                        setRateCurrency(e.target.value);
                        if (e.target.value === "KES") setFxRate("1");
                      }}
                      className={inputClass}
                    >
                      <option value="KES">KES</option>
                      <option value="USD">USD</option>
                      <option value="UGX">UGX</option>
                      <option value="TZS">TZS</option>
                      <option value="RWF">RWF</option>
                      <option value="EUR">EUR</option>
                      <option value="GBP">GBP</option>
                      <option value="ZAR">ZAR</option>
                    </select>
                  </FormField>
                </div>

                {rateCurrency !== "KES" && (
                  <FormField label="FX rate to KES" dark>
                    <input
                      placeholder="FX rate to KES e.g. 129"
                      value={fxRate}
                      onChange={(e) => setFxRate(e.target.value)}
                      className={inputClass}
                      required
                    />
                  </FormField>
                )}

                <div>
                  <PrimaryButton type="submit">
                    Apply Rate to Client/Route
                  </PrimaryButton>
                </div>
              </form>
            </Panel>

            <Panel dark className="mt-8 overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Matching Active Journeys</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Enter loaded and offloaded quantities, then save each truck.
                  </p>
                </div>
                <SecondaryButton type="button" onClick={loadJourneys}>
                  Refresh
                </SecondaryButton>
              </div>

              {selectedJourneys.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    dark
                    title="Select client and route"
                    body="Matching active journeys will appear once both filters are selected."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-white/10 text-left text-sm">
                    <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.12em] text-slate-400">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Truck</th>
                        <th className="px-4 py-3 font-semibold">Driver</th>
                        <th className="px-4 py-3 font-semibold">Loaded Quantity</th>
                        <th className="px-4 py-3 font-semibold">Offloaded Quantity</th>
                        <th className="px-4 py-3 font-semibold">Rate</th>
                        <th className="px-4 py-3 font-semibold">Revenue</th>
                        <th className="px-4 py-3 font-semibold">Save Quantity</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-white/10 text-slate-200">
                      {selectedJourneys.map((j) => {
                        const preview = calculatePreview(j);

                        return (
                          <tr key={j.id} className="hover:bg-white/[0.03]">
                            <td className="px-4 py-4 font-semibold text-white">{j.truck}</td>
                            <td className="px-4 py-4">{j.driver || "—"}</td>

                            <td className="px-4 py-4">
                              <input
                                id={`loaded-${j.id}`}
                                defaultValue={j.loaded_quantity || ""}
                                placeholder="Loaded"
                                className={inputClass}
                              />
                            </td>

                            <td className="px-4 py-4">
                              <input
                                id={`offloaded-${j.id}`}
                                defaultValue={j.offloaded_quantity || ""}
                                placeholder="Offloaded"
                                className={inputClass}
                              />
                            </td>

                            <td className="px-4 py-4">
                              {rateCurrency} {rateAmount || j.rate_amount || 0} /{" "}
                              {rateType.replace("per_", "")}
                            </td>

                            <td className="px-4 py-4">
                              <div>{preview.revenueOriginal.toLocaleString()} {rateCurrency}</div>
                              <strong className="text-cyan-100">
                                {preview.revenueKes.toLocaleString()} KES
                              </strong>
                            </td>

                            <td className="px-4 py-4">
                              <SecondaryButton
                                type="button"
                                onClick={() => saveQuantities(j.id)}
                              >
                                Save
                              </SecondaryButton>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </>
        )}
      </div>
    </main>
  );
}
