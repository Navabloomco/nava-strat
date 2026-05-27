"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import {
  FormField,
  PageHeader,
  Panel,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
} from "../../../components/ui/Primitives";

const inputClass =
  "w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300";

const expenseTypes = [
  "per_diem",
  "toll",
  "weighbridge",
  "parking",
  "permit",
  "border_fee",
  "clearing",
  "loading",
  "offloading",
  "county_fee",
  "security",
  "driver_advance",
  "maintenance",
  "other",
];

export default function TripDetailPage() {
  const params = useParams<{ id: string }>();
  const tripId = params?.id;
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [errorDetail, setErrorDetail] = useState("");

  const [status, setStatus] = useState("active");
  const [driverId, setDriverId] = useState("");
  const [driverText, setDriverText] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [expectedFuel, setExpectedFuel] = useState("");

  const [loadedQuantity, setLoadedQuantity] = useState("");
  const [offloadedQuantity, setOffloadedQuantity] = useState("");
  const [rateAmount, setRateAmount] = useState("");
  const [rateCurrency, setRateCurrency] = useState("KES");
  const [rateType, setRateType] = useState("per_tonne");
  const [fxRate, setFxRate] = useState("");
  const [revenueNotes, setRevenueNotes] = useState("");

  const [fuelLogId, setFuelLogId] = useState("");
  const [allocatedLiters, setAllocatedLiters] = useState("");
  const [allocatedCost, setAllocatedCost] = useState("");
  const [allocationNotes, setAllocationNotes] = useState("");

  const [expenseType, setExpenseType] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseVendor, setExpenseVendor] = useState("");
  const [expensePaymentMethod, setExpensePaymentMethod] = useState("");
  const [expenseReference, setExpenseReference] = useState("");
  const [expenseNotes, setExpenseNotes] = useState("");

  useEffect(() => {
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  async function loadDetail(nextMessage = "") {
    if (!tripId) return;
    setLoading(true);
    setErrorDetail("");
    if (nextMessage) setMessage(nextMessage);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return;
    }

    const query = new URLSearchParams();
    const companyId = new URLSearchParams(window.location.search).get("companyId");
    if (companyId) query.set("companyId", companyId);

    const res = await fetch(
      `/api/journeys/${tripId}${query.toString() ? `?${query.toString()}` : ""}`,
      {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.access_token}` },
      }
    );
    const json = await res.json();

    if (!res.ok || !json.success) {
      setErrorDetail(friendlyError(res.status, json.error));
      setLoading(false);
      return;
    }

    setData(json);
    primeForms(json.journey || {});
    setLoading(false);
  }

  function primeForms(journey: any) {
    setStatus(journey.status || "active");
    setDriverId(journey.driver_id || "");
    setDriverText(journey.driver || "");
    setStartTime(toDateTimeLocalValue(journey.start_time));
    setEndTime(toDateTimeLocalValue(journey.end_time));
    setExpectedFuel(valueOrEmpty(journey.expected_fuel_liters));
    setLoadedQuantity(valueOrEmpty(journey.loaded_quantity));
    setOffloadedQuantity(valueOrEmpty(journey.offloaded_quantity));
    setRateAmount(valueOrEmpty(journey.rate_amount));
    setRateCurrency(journey.rate_currency || "KES");
    setRateType(journey.rate_type || "per_tonne");
    setFxRate(valueOrEmpty(journey.fx_rate || (journey.rate_currency === "KES" ? 1 : "")));
    setRevenueNotes(journey.revenue_notes || "");
  }

  async function getToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  async function saveOperationalDetails(e: any) {
    e.preventDefault();
    setMessage("Saving trip details...");
    const token = await getToken();
    if (!token) {
      setMessage("Session expired. Please log in again.");
      return;
    }

    const selectedDriver = (data?.drivers || []).find((driver: any) => driver.id === driverId);
    const res = await fetch(`/api/journeys/${tripId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        companyId: currentCompanyId(),
        status,
        driver_id: driverId || null,
        driver: driverId ? selectedDriver?.full_name || driverText : driverText,
        manual_driver_text: driverId ? null : driverText,
        start_time: startTime || null,
        end_time: endTime || null,
        expected_fuel_liters: expectedFuel ? Number(expectedFuel) : null,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      setMessage(json.error || "Failed to save trip details.");
      return;
    }
    await loadDetail("Trip details saved.");
  }

  async function saveRevenue(e: any) {
    e.preventDefault();
    setMessage("Saving revenue...");
    const token = await getToken();
    if (!token) {
      setMessage("Session expired. Please log in again.");
      return;
    }

    const res = await fetch("/api/finance/revenue", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        companyId: currentCompanyId(),
        journeyId: tripId,
        loaded_quantity: loadedQuantity ? Number(loadedQuantity) : 0,
        offloaded_quantity: offloadedQuantity ? Number(offloadedQuantity) : 0,
        rate_type: rateType,
        rate_amount: Number(rateAmount || 0),
        rate_currency: rateCurrency,
        fx_rate: rateCurrency === "KES" ? 1 : Number(fxRate || 1),
        revenue_notes: revenueNotes,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      setMessage(json.error || "Failed to save revenue.");
      return;
    }
    await loadDetail("Revenue saved. Trip Intelligence will use linked revenue on refresh.");
  }

  async function addFuelAllocation(e: any) {
    e.preventDefault();
    setMessage("Saving fuel allocation...");
    const token = await getToken();
    if (!token) {
      setMessage("Session expired. Please log in again.");
      return;
    }

    const res = await fetch("/api/fuel/allocations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        companyId: currentCompanyId(),
        fuel_log_id: fuelLogId,
        journey_id: tripId,
        truck_text: data?.journey?.truck || "",
        allocated_liters: Number(allocatedLiters || 0),
        allocated_cost: allocatedCost ? Number(allocatedCost) : undefined,
        allocation_status: "allocated",
        allocation_basis: "manual",
        notes: allocationNotes,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      setMessage(json.error || "Failed to save fuel allocation.");
      return;
    }
    setFuelLogId("");
    setAllocatedLiters("");
    setAllocatedCost("");
    setAllocationNotes("");
    await loadDetail("Fuel allocation saved. This is allocation evidence, not actual burn proof.");
  }

  async function addExpense(e: any) {
    e.preventDefault();
    setMessage("Saving expense...");
    const token = await getToken();
    if (!token) {
      setMessage("Session expired. Please log in again.");
      return;
    }

    const res = await fetch("/api/expenses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        companyId: currentCompanyId(),
        journey_id: tripId,
        truck: data?.journey?.truck || "",
        expense_type: expenseType,
        amount: Number(expenseAmount || 0),
        vendor: expenseVendor,
        payment_method: expensePaymentMethod,
        reference_number: expenseReference,
        trip_reference: data?.journey?.internal_trip_id || "",
        notes: expenseNotes,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      setMessage(json.error || "Failed to save expense.");
      return;
    }
    setExpenseType("");
    setExpenseAmount("");
    setExpenseVendor("");
    setExpensePaymentMethod("");
    setExpenseReference("");
    setExpenseNotes("");
    await loadDetail("Expense linked to trip.");
  }

  const journey = data?.journey || {};
  const capabilities = data?.capabilities || {};
  const trip = data?.trip_intelligence?.trip || null;
  const missingData = trip?.missing_data || [];
  const flags = trip?.management_flags || [];
  const driverEvidence = trip?.driver_evidence || {};
  const finance = trip?.finance_evidence || {};
  const movement = trip?.movement_evidence || {};
  const fuel = data?.fuel || {};
  const tripAllocations = fuel?.trip_allocations || [];
  const expenses = data?.expenses || [];
  const fuelIssueSummaries = fuel?.fuel_issue_summaries || {};
  const fuelTotals = useMemo(() => summarizeTripAllocations(tripAllocations), [tripAllocations]);
  const expenseTotal = expenses.reduce(
    (sum: number, expense: any) => sum + Number(expense.amount || 0),
    0
  );
  const displayDriver = journey.driver || driverEvidence.driver_name || "Missing";
  const companyIdParam = currentCompanyId();
  const companyQuery = companyIdParam
    ? `?companyId=${encodeURIComponent(companyIdParam)}`
    : "";
  const efficiencyQuery = companyIdParam
    ? `?range=today&companyId=${encodeURIComponent(companyIdParam)}`
    : "?range=today";

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Loading trip detail...</div>
        </Panel>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          dark
          eyebrow="Operations"
          title={journey.internal_trip_id || "Trip detail"}
          body="Complete the links that make Trip Intelligence useful: driver, revenue, fuel allocation, expenses, and evidence readiness."
          actions={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link href={`/ops/journey${companyQuery}`}>
                <SecondaryButton type="button" className="w-full sm:w-auto">
                  Back to trips
                </SecondaryButton>
              </Link>
              <Link href={`/ops/efficiency${efficiencyQuery}`}>
                <PrimaryButton type="button" className="w-full sm:w-auto">
                  Efficiency view
                </PrimaryButton>
              </Link>
            </div>
          }
        />

        {errorDetail ? (
          <Panel dark className="mt-8 border-rose-300/30 bg-rose-500/10 p-5">
            <div className="text-sm text-rose-100">{errorDetail}</div>
          </Panel>
        ) : (
          <>
            {message && (
              <Panel dark className="mt-8 border-cyan-200/20 bg-cyan-300/10 p-4">
                <div className="whitespace-pre-wrap text-sm text-cyan-50">{message}</div>
              </Panel>
            )}

            <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Status" value={humanize(journey.status || "unknown")} />
              <MetricCard
                label="Readiness"
                value={readinessLabel(trip?.profitability_readiness)}
                tone={readinessTone(trip?.profitability_readiness?.status)}
              />
              <MetricCard
                label="Allocated fuel"
                value={`${formatNumber(fuelTotals.liters)} L`}
                detail={`KES ${formatMoney(fuelTotals.cost)}`}
              />
              <MetricCard
                label="Linked expenses"
                value={`KES ${formatMoney(expenseTotal)}`}
                detail={`${formatNumber(expenses.length)} expense record(s)`}
              />
            </section>

            <section className="mt-8 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <Panel dark className="p-5">
                <SectionTitle
                  title="Trip"
                  subtitle="The product object is Trip; the database still stores these records in journeys."
                />
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <Detail label="Truck / provider asset" value={journey.truck || "Missing"} />
                  <Detail label="Client" value={journey.client_name || "Missing"} />
                  <Detail label="Route" value={routeLabel(journey)} />
                  <Detail label="Driver" value={displayDriver} />
                  <Detail label="Start" value={formatDateTime(journey.start_time)} />
                  <Detail label="End" value={formatDateTime(journey.end_time)} />
                </div>
              </Panel>

              <Panel dark className="p-5">
                <SectionTitle
                  title="Trip Intelligence"
                  subtitle="Deterministic readiness, not guessed profit."
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  <StatusPill tone={readinessTone(trip?.profitability_readiness?.status)}>
                    {readinessLabel(trip?.profitability_readiness)}
                  </StatusPill>
                  <StatusPill tone="info">
                    {movement.distance_source || "distance unavailable"}
                  </StatusPill>
                  {finance.fuel_cost_source && (
                    <StatusPill tone="info">
                      Fuel: {humanize(finance.fuel_cost_source)}
                    </StatusPill>
                  )}
                </div>

                {Array.isArray(trip?.profitability_readiness?.supporting_notes) &&
                  trip.profitability_readiness.supporting_notes.length > 0 && (
                    <div className="mt-4 rounded-md border border-cyan-200/15 bg-cyan-300/10 p-3 text-sm leading-6 text-cyan-50">
                      {trip.profitability_readiness.supporting_notes.join(". ")}.
                    </div>
                  )}

                <div className="mt-5 grid gap-3">
                  <EvidenceLine
                    label="Driver evidence"
                    value={
                      driverEvidence.driver_name
                        ? `${driverEvidence.driver_name} (${humanize(driverEvidence.evidence_label)})`
                        : "Unavailable"
                    }
                  />
                  <EvidenceLine
                    label="Distance"
                    value={
                      movement.distance_km
                        ? `${formatNumber(movement.distance_km)} km (${movement.distance_source})`
                        : "Unavailable"
                    }
                  />
                  <EvidenceLine
                    label="Revenue"
                    value={
                      capabilities.can_view_finance
                        ? `KES ${formatMoney(finance.revenue_kes)}`
                        : "Hidden by role"
                    }
                  />
                  <EvidenceLine
                    label="Linked variable costs"
                    value={
                      capabilities.can_view_finance
                        ? `KES ${formatMoney(finance.linked_variable_costs_kes)}`
                        : "Hidden by role"
                    }
                  />
                </div>

                {missingData.length > 0 && (
                  <div className="mt-5">
                    <div className="text-xs font-bold uppercase tracking-[0.12em] text-amber-100">
                      Missing links
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {missingData.map((item: string) => (
                        <StatusPill key={item} tone="warning">
                          {missingDataLabel(item)}
                        </StatusPill>
                      ))}
                    </div>
                  </div>
                )}

                {flags.length > 0 && (
                  <div className="mt-5">
                    <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                      Management flags
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {flags.map((flag: string) => (
                        <StatusPill key={flag} tone="neutral">
                          {humanize(flag)}
                        </StatusPill>
                      ))}
                    </div>
                  </div>
                )}
              </Panel>
            </section>

            <section className="mt-8 grid gap-6 xl:grid-cols-2">
              <Panel dark className="p-5">
                <SectionTitle
                  title="Driver & timing"
                  subtitle="Ops can complete operational links without touching finance."
                />
                {capabilities.can_edit_journey ? (
                  <form onSubmit={saveOperationalDetails} className="mt-5 grid gap-5">
                    <div className="grid gap-5 md:grid-cols-2">
                      <FormField label="Status" dark>
                        <select
                          value={status}
                          onChange={(event) => setStatus(event.target.value)}
                          className={inputClass}
                        >
                          <option value="active">Active</option>
                          <option value="planned">Planned</option>
                          <option value="loading">Loading</option>
                          <option value="completed">Completed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </FormField>

                      <FormField label="Driver" dark>
                        <select
                          value={driverId}
                          onChange={(event) => {
                            const nextId = event.target.value;
                            setDriverId(nextId);
                            const nextDriver = (data?.drivers || []).find(
                              (driver: any) => driver.id === nextId
                            );
                            if (nextDriver?.full_name) setDriverText(nextDriver.full_name);
                          }}
                          className={inputClass}
                        >
                          <option value="">Manual / unassigned</option>
                          {(data?.drivers || [])
                            .filter((driver: any) => String(driver.status || "").toLowerCase() === "active")
                            .map((driver: any) => (
                              <option key={driver.id} value={driver.id}>
                                {driver.full_name || "Unnamed driver"}
                              </option>
                            ))}
                        </select>
                      </FormField>
                    </div>

                    <FormField label="Manual driver text" dark>
                      <input
                        value={driverText}
                        onChange={(event) => {
                          setDriverId("");
                          setDriverText(event.target.value.toUpperCase());
                        }}
                        placeholder="Driver name if not in directory"
                        className={inputClass}
                      />
                    </FormField>

                    <div className="grid gap-5 md:grid-cols-2">
                      <FormField label="Start time" dark>
                        <input
                          type="datetime-local"
                          value={startTime}
                          onChange={(event) => setStartTime(event.target.value)}
                          className={inputClass}
                        />
                      </FormField>
                      <FormField label="End time optional" dark>
                        <input
                          type="datetime-local"
                          value={endTime}
                          onChange={(event) => setEndTime(event.target.value)}
                          className={inputClass}
                        />
                      </FormField>
                    </div>

                    <FormField label="Expected fuel optional" dark>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={expectedFuel}
                        onChange={(event) => setExpectedFuel(event.target.value)}
                        placeholder="Route standard, not actual burn"
                        className={inputClass}
                      />
                    </FormField>

                    <PrimaryButton type="submit" className="w-full sm:w-auto">
                      Save trip details
                    </PrimaryButton>
                  </form>
                ) : (
                  <ReadOnlyNotice text="You can view this trip, but your role cannot edit operational trip details." />
                )}
              </Panel>

              <Panel dark className="p-5">
                <SectionTitle
                  title="Revenue"
                  subtitle="Revenue is required before contribution can be calculated."
                />
                {capabilities.can_edit_finance ? (
                  <form onSubmit={saveRevenue} className="mt-5 grid gap-5">
                    <div className="grid gap-5 md:grid-cols-2">
                      <FormField label="Loaded quantity" dark>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={loadedQuantity}
                          onChange={(event) => setLoadedQuantity(event.target.value)}
                          className={inputClass}
                        />
                      </FormField>
                      <FormField label="Offloaded / billing quantity" dark>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={offloadedQuantity}
                          onChange={(event) => setOffloadedQuantity(event.target.value)}
                          className={inputClass}
                        />
                      </FormField>
                    </div>
                    <div className="grid gap-5 md:grid-cols-3">
                      <FormField label="Rate amount" dark>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={rateAmount}
                          onChange={(event) => setRateAmount(event.target.value)}
                          className={inputClass}
                          required
                        />
                      </FormField>
                      <FormField label="Currency" dark>
                        <select
                          value={rateCurrency}
                          onChange={(event) => setRateCurrency(event.target.value)}
                          className={inputClass}
                        >
                          <option value="KES">KES</option>
                          <option value="USD">USD</option>
                        </select>
                      </FormField>
                      <FormField label="Rate basis" dark>
                        <select
                          value={rateType}
                          onChange={(event) => setRateType(event.target.value)}
                          className={inputClass}
                        >
                          <option value="per_tonne">Per tonne</option>
                          <option value="per_truck">Per truck</option>
                        </select>
                      </FormField>
                    </div>
                    {rateCurrency !== "KES" && (
                      <FormField label="FX rate to KES" dark>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={fxRate}
                          onChange={(event) => setFxRate(event.target.value)}
                          className={inputClass}
                        />
                      </FormField>
                    )}
                    <FormField label="Revenue notes optional" dark>
                      <textarea
                        value={revenueNotes}
                        onChange={(event) => setRevenueNotes(event.target.value)}
                        rows={3}
                        className={inputClass}
                      />
                    </FormField>
                    <PrimaryButton type="submit" className="w-full sm:w-auto">
                      Save revenue
                    </PrimaryButton>
                  </form>
                ) : capabilities.can_view_finance ? (
                  <div className="mt-5 grid gap-3">
                    <EvidenceLine label="Revenue" value={`KES ${formatMoney(journey.revenue_kes)}`} />
                    <EvidenceLine label="Rate" value={`${formatMoney(journey.rate_amount)} ${journey.rate_currency || "KES"} · ${humanize(journey.rate_type)}`} />
                    <ReadOnlyNotice text="Your role can view finance values but cannot edit revenue." />
                  </div>
                ) : (
                  <ReadOnlyNotice text="Revenue values are hidden for this role." />
                )}
              </Panel>
            </section>

            <section className="mt-8 grid gap-6 xl:grid-cols-2">
              <Panel dark className="p-5">
                <SectionTitle
                  title="Fuel allocation"
                  subtitle="Allocated fuel is trip cost evidence. It is not actual burn, theft, or tank balance proof."
                />

                {!capabilities.can_view_fuel ? (
                  <ReadOnlyNotice text="Fuel allocation evidence is hidden for this role." />
                ) : (
                  <>
                    <div className="mt-5 grid gap-3">
                      {tripAllocations.length === 0 ? (
                        <InlineEmpty
                          title="No fuel allocation linked"
                          body="Trip Intelligence will keep fuel allocation missing until fuel is assigned to this trip."
                        />
                      ) : (
                        tripAllocations.map((allocation: any) => {
                          const fuelLog = (fuel?.available_fuel_logs || []).find(
                            (item: any) => item.id === allocation.fuel_log_id
                          );
                          const issueSummary = fuelIssueSummaries[allocation.fuel_log_id] || null;
                          return (
                            <EvidenceCard key={allocation.id}>
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-white">
                                    {formatNumber(allocation.allocated_liters)} L · KES {formatMoney(allocation.allocated_cost)}
                                  </div>
                                  <div className="mt-1 text-xs leading-5 text-slate-400">
                                    Source issue {fuelLog?.truck_text || allocation.truck_text || journey.truck || "truck"} · {fuelLog?.vendor || "vendor unavailable"}
                                  </div>
                                </div>
                                <StatusPill tone="info">
                                  {humanize(allocation.allocation_status)}
                                </StatusPill>
                              </div>
                              {issueSummary && (
                                <div className="mt-3 text-xs leading-5 text-slate-300">
                                  Issue balance: {formatNumber(issueSummary.remaining_liters)} L unallocated, {formatNumber(issueSummary.carried_forward_liters)} L carried forward.
                                </div>
                              )}
                            </EvidenceCard>
                          );
                        })
                      )}
                    </div>

                    {capabilities.can_edit_fuel ? (
                      <details className="mt-5 rounded-md border border-white/10 bg-white/[0.04] p-4">
                        <summary className="cursor-pointer text-sm font-semibold text-white">
                          Add fuel allocation
                        </summary>
                        <form onSubmit={addFuelAllocation} className="mt-5 grid gap-5">
                          <FormField label="Fuel issue" dark>
                            <select
                              value={fuelLogId}
                              onChange={(event) => setFuelLogId(event.target.value)}
                              className={inputClass}
                              required
                            >
                              <option value="">Choose fuel issue</option>
                              {(fuel?.available_fuel_logs || []).map((fuelLog: any) => {
                                const summary = fuelIssueSummaries[fuelLog.id] || {};
                                return (
                                  <option key={fuelLog.id} value={fuelLog.id}>
                                    {fuelLog.truck_text || "Truck"} · {formatNumber(fuelLog.liters)} L · remaining {formatNumber(summary.remaining_liters)} L
                                  </option>
                                );
                              })}
                            </select>
                          </FormField>
                          <div className="grid gap-5 md:grid-cols-2">
                            <FormField label="Allocated litres" dark>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={allocatedLiters}
                                onChange={(event) => setAllocatedLiters(event.target.value)}
                                className={inputClass}
                                required
                              />
                            </FormField>
                            <FormField label="Allocated cost optional" dark>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={allocatedCost}
                                onChange={(event) => setAllocatedCost(event.target.value)}
                                placeholder="Auto-estimated if blank"
                                className={inputClass}
                              />
                            </FormField>
                          </div>
                          <FormField label="Allocation notes optional" dark>
                            <textarea
                              value={allocationNotes}
                              onChange={(event) => setAllocationNotes(event.target.value)}
                              rows={3}
                              className={inputClass}
                            />
                          </FormField>
                          <PrimaryButton type="submit" className="w-full sm:w-auto">
                            Save fuel allocation
                          </PrimaryButton>
                        </form>
                      </details>
                    ) : (
                      <ReadOnlyNotice text="Your role can view fuel allocation evidence but cannot add allocations." />
                    )}
                  </>
                )}
              </Panel>

              <Panel dark className="p-5">
                <SectionTitle
                  title="Trip expenses"
                  subtitle="Expenses stay separate from fuel and only count when linked to this trip."
                />

                {!capabilities.can_view_expenses ? (
                  <ReadOnlyNotice text="Expense values are hidden for this role." />
                ) : (
                  <>
                    <div className="mt-5 grid gap-3">
                      {expenses.length === 0 ? (
                        <InlineEmpty
                          title="No expenses linked"
                          body="Trip Intelligence will keep linked expenses missing until costs are assigned to this trip."
                        />
                      ) : (
                        expenses.map((expense: any) => (
                          <EvidenceCard key={expense.id}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-white">
                                  KES {formatMoney(expense.amount)} · {humanize(expense.expense_type)}
                                </div>
                                <div className="mt-1 text-xs leading-5 text-slate-400">
                                  {expense.vendor || "Vendor unavailable"} · {expense.reference_number || "No reference"}
                                </div>
                              </div>
                              <StatusPill tone="neutral">
                                {formatDate(expense.created_at)}
                              </StatusPill>
                            </div>
                          </EvidenceCard>
                        ))
                      )}
                    </div>

                    {data?.capabilities?.can_edit_expenses ? (
                      <details className="mt-5 rounded-md border border-white/10 bg-white/[0.04] p-4">
                        <summary className="cursor-pointer text-sm font-semibold text-white">
                          Add trip expense
                        </summary>
                        <form onSubmit={addExpense} className="mt-5 grid gap-5">
                          <div className="grid gap-5 md:grid-cols-2">
                            <FormField label="Expense type" dark>
                              <select
                                value={expenseType}
                                onChange={(event) => setExpenseType(event.target.value)}
                                className={inputClass}
                                required
                              >
                                <option value="">Choose type</option>
                                {expenseTypes.map((type) => (
                                  <option key={type} value={type}>
                                    {humanize(type)}
                                  </option>
                                ))}
                              </select>
                            </FormField>
                            <FormField label="Amount" dark>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={expenseAmount}
                                onChange={(event) => setExpenseAmount(event.target.value)}
                                className={inputClass}
                                required
                              />
                            </FormField>
                          </div>
                          <div className="grid gap-5 md:grid-cols-2">
                            <FormField label="Payment method" dark>
                              <select
                                value={expensePaymentMethod}
                                onChange={(event) => setExpensePaymentMethod(event.target.value)}
                                className={inputClass}
                                required
                              >
                                <option value="">Choose method</option>
                                <option value="mpesa">M-Pesa</option>
                                <option value="bank">Bank</option>
                                <option value="cash">Cash</option>
                                <option value="fuel_card">Fuel card</option>
                                <option value="credit">Credit</option>
                                <option value="other">Other</option>
                              </select>
                            </FormField>
                            <FormField label="Reference" dark>
                              <input
                                value={expenseReference}
                                onChange={(event) => setExpenseReference(event.target.value)}
                                className={inputClass}
                                required
                              />
                            </FormField>
                          </div>
                          <FormField label="Vendor optional" dark>
                            <input
                              value={expenseVendor}
                              onChange={(event) => setExpenseVendor(event.target.value.toUpperCase())}
                              className={inputClass}
                            />
                          </FormField>
                          <FormField label="Notes optional" dark>
                            <textarea
                              value={expenseNotes}
                              onChange={(event) => setExpenseNotes(event.target.value)}
                              rows={3}
                              className={inputClass}
                            />
                          </FormField>
                          <PrimaryButton type="submit" className="w-full sm:w-auto">
                            Save expense
                          </PrimaryButton>
                        </form>
                      </details>
                    ) : (
                      <ReadOnlyNotice text="Your role can view expenses but cannot add trip expenses." />
                    )}
                  </>
                )}
              </Panel>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const valueClass =
    tone === "success"
      ? "text-emerald-100"
      : tone === "warning"
        ? "text-amber-100"
        : tone === "danger"
          ? "text-rose-100"
          : "text-white";
  return (
    <Panel dark className="p-5">
      <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </div>
      <div className={`mt-3 break-words text-2xl font-semibold ${valueClass}`}>{value}</div>
      {detail && <div className="mt-2 text-xs leading-5 text-slate-400">{detail}</div>}
    </Panel>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 break-words text-sm text-slate-200">{value}</div>
    </div>
  );
}

function EvidenceLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-white/10 bg-white/[0.04] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </span>
      <span className="break-words text-sm font-semibold text-slate-100">{value}</span>
    </div>
  );
}

function EvidenceCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
      {children}
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {subtitle && <p className="mt-2 text-sm leading-6 text-slate-400">{subtitle}</p>}
    </div>
  );
}

function InlineEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
      <div className="text-sm font-semibold text-white">{title}</div>
      <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
    </div>
  );
}

function ReadOnlyNotice({ text }: { text: string }) {
  return (
    <div className="mt-5 rounded-md border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
      {text}
    </div>
  );
}

function summarizeTripAllocations(allocations: any[]) {
  return allocations
    .filter((allocation) => String(allocation.allocation_status || "allocated") === "allocated")
    .reduce(
      (total, allocation) => ({
        liters: total.liters + Number(allocation.allocated_liters || 0),
        cost: total.cost + Number(allocation.allocated_cost || 0),
      }),
      { liters: 0, cost: 0 }
    );
}

function routeLabel(journey: any) {
  const from = journey.from_location || "Unknown origin";
  const to = journey.to_location || "Unknown destination";
  return `${from} → ${to}`;
}

function valueOrEmpty(value: any) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function currentCompanyId() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("companyId");
}

function toDateTimeLocalValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not captured";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not captured";
  return date.toLocaleString();
}

function formatDate(value?: string | null) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleDateString();
}

function formatNumber(value: any) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString(undefined, {
    maximumFractionDigits: number % 1 === 0 ? 0 : 2,
  });
}

function formatMoney(value: any) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString(undefined, {
    maximumFractionDigits: number % 1 === 0 ? 0 : 2,
  });
}

function humanize(value: any) {
  const text = String(value || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Unavailable";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function readinessTone(status: string): "neutral" | "success" | "warning" | "danger" {
  if (status === "calculable") return "success";
  if (status === "partially_linked") return "warning";
  if (status === "not_enough_linked_data") return "danger";
  return "neutral";
}

function readinessLabel(readiness: any) {
  if (readiness?.label || readiness?.customer_label) {
    return readiness.label || readiness.customer_label;
  }
  if (readiness?.status === "calculable") return "Contribution review ready";
  return humanize(readiness?.status || "not_enough_linked_data");
}

function missingDataLabel(value: any) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "missing distance") return "Distance evidence missing";
  if (key === "missing linked expenses") return "Other expenses missing";
  if (key === "missing linked cost evidence") return "Linked cost evidence missing";
  if (key === "fuel allocation missing") return "Fuel allocation missing";
  return humanize(value);
}

function friendlyError(status: number, error?: string) {
  if (status === 401 || status === 403) {
    return "You do not have access to this trip for this company.";
  }
  return error || "Unable to load trip detail right now.";
}
