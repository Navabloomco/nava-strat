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

const tripEvidenceTypes = [
  { value: "delivery_note", label: "Delivery note" },
  { value: "weighbridge", label: "Weighbridge ticket" },
  { value: "invoice", label: "Invoice" },
  { value: "receipt", label: "General trip receipt" },
  { value: "other", label: "Other trip document" },
];

const expenseEvidenceTypes = [
  { value: "receipt", label: "Receipt" },
  { value: "mpesa_screenshot", label: "M-Pesa proof" },
  { value: "invoice", label: "Invoice" },
  { value: "payment_proof", label: "Payment proof" },
  { value: "other", label: "Other" },
];

function emptyExpenseEvidenceForm() {
  return {
    evidenceType: "receipt",
    file: null as File | null,
    textContent: "",
    notes: "",
  };
}

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
  const [newExpenseEvidenceType, setNewExpenseEvidenceType] = useState("receipt");
  const [newExpenseEvidenceFile, setNewExpenseEvidenceFile] = useState<File | null>(null);
  const [newExpenseProofText, setNewExpenseProofText] = useState("");
  const [newExpenseEvidenceNotes, setNewExpenseEvidenceNotes] = useState("");

  const [tripEvidenceType, setTripEvidenceType] = useState("delivery_note");
  const [tripEvidenceFile, setTripEvidenceFile] = useState<File | null>(null);
  const [tripEvidenceNotes, setTripEvidenceNotes] = useState("");
  const [tripEvidenceUploading, setTripEvidenceUploading] = useState(false);
  const [expenseEvidenceForms, setExpenseEvidenceForms] = useState<Record<string, any>>({});
  const [expenseEvidenceUploadingId, setExpenseEvidenceUploadingId] = useState("");

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

    const evidence = await loadEvidenceBundle(
      session.access_token,
      companyId,
      json.expenses || []
    );
    setData({ ...json, evidence });
    primeForms(json.journey || {});
    setLoading(false);
  }

  async function loadEvidenceBundle(token: string, companyId: string | null, expenses: any[]) {
    if (!tripId) return { trip: { attachments: [] }, expenses: {} };

    const tripEvidence = await loadEvidenceForRecord(token, companyId, "trip", tripId);
    const expenseEvidenceEntries = await Promise.all(
      (expenses || [])
        .filter((expense: any) => expense?.id)
        .map(async (expense: any) => [
          expense.id,
          await loadEvidenceForRecord(token, companyId, "expense", expense.id),
        ])
    );

    return {
      trip: tripEvidence,
      expenses: Object.fromEntries(expenseEvidenceEntries),
      setup_required: tripEvidence.setup_required,
      error: tripEvidence.error,
    };
  }

  async function loadEvidenceForRecord(
    token: string,
    companyId: string | null,
    relatedType: string,
    relatedId: string
  ) {
    if (!relatedId) return { attachments: [] };

    const query = new URLSearchParams({
      relatedType,
      relatedId,
    });
    if (companyId) query.set("companyId", companyId);

    try {
      const res = await fetch(`/api/evidence?${query.toString()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          attachments: [],
          setup_required: Boolean(json.setup_required),
          error: json.error || "Evidence is not available yet.",
        };
      }
      return {
        attachments: json.attachments || [],
        guardrails: json.guardrails || {},
        related: json.related || null,
      };
    } catch (err: any) {
      return {
        attachments: [],
        error: err.message || "Evidence is not available yet.",
      };
    }
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

    const createdExpense = json.expense || {};
    let nextMessage = "Expense linked to trip.";
    if (createdExpense.id && (newExpenseEvidenceFile || newExpenseProofText.trim())) {
      const proofResult = await uploadExpenseProof(createdExpense.id, token, {
        evidenceType: newExpenseEvidenceType,
        file: newExpenseEvidenceFile,
        textContent: newExpenseProofText,
        notes: newExpenseEvidenceNotes,
      });
      nextMessage = proofResult.success
        ? "Expense linked to trip with proof attached."
        : `Expense saved, but proof upload failed. You can attach proof from the expense card.\n${proofResult.error}`;
    }

    setExpenseType("");
    setExpenseAmount("");
    setExpenseVendor("");
    setExpensePaymentMethod("");
    setExpenseReference("");
    setExpenseNotes("");
    setNewExpenseEvidenceType("receipt");
    setNewExpenseEvidenceFile(null);
    setNewExpenseProofText("");
    setNewExpenseEvidenceNotes("");
    const proofFileInput = document.getElementById("new-expense-proof-file") as HTMLInputElement | null;
    if (proofFileInput) proofFileInput.value = "";
    await loadDetail(nextMessage);
  }

  async function uploadTripEvidence(e: any) {
    e.preventDefault();
    if (!tripEvidenceFile) {
      setMessage("Choose a delivery note, weighbridge ticket, PDF, or trip document first.");
      return;
    }

    setTripEvidenceUploading(true);
    setMessage("Uploading general trip evidence...");
    const token = await getToken();
    if (!token) {
      setMessage("Session expired. Please log in again.");
      setTripEvidenceUploading(false);
      return;
    }

    const formData = new FormData();
    const companyId = currentCompanyId();
    if (companyId) formData.append("companyId", companyId);
    formData.append("relatedType", "trip");
    formData.append("relatedId", tripId || "");
    formData.append("evidenceType", tripEvidenceType);
    formData.append("notes", tripEvidenceNotes);
    formData.append("file", tripEvidenceFile);

    const res = await fetch("/api/evidence", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });
    const json = await res.json();
    setTripEvidenceUploading(false);
    if (!res.ok || !json.success) {
      setMessage(json.error || "Failed to upload trip evidence.");
      return;
    }

    setTripEvidenceFile(null);
    setTripEvidenceType("delivery_note");
    setTripEvidenceNotes("");
    const fileInput = document.getElementById("trip-evidence-file") as HTMLInputElement | null;
    if (fileInput) fileInput.value = "";
    await loadDetail("General trip evidence uploaded.");
  }

  async function uploadExpenseEvidence(e: any, expenseId: string) {
    e.preventDefault();
    const form = expenseEvidenceForm(expenseId);
    if (!form.file && !String(form.textContent || "").trim()) {
      setMessage("Choose a proof document or paste proof text first.");
      return;
    }

    setExpenseEvidenceUploadingId(expenseId);
    setMessage("Uploading expense proof...");
    const token = await getToken();
    if (!token) {
      setMessage("Session expired. Please log in again.");
      setExpenseEvidenceUploadingId("");
      return;
    }

    const proofResult = await uploadExpenseProof(expenseId, token, {
      evidenceType: form.evidenceType || "receipt",
      file: form.file || null,
      textContent: form.textContent || "",
      notes: form.notes || "",
    });
    setExpenseEvidenceUploadingId("");
    if (!proofResult.success) {
      setMessage(proofResult.error || "Failed to upload expense proof.");
      return;
    }

    setExpenseEvidenceForms((current) => ({
      ...current,
      [expenseId]: emptyExpenseEvidenceForm(),
    }));
    const fileInput = document.getElementById(
      `expense-evidence-file-${expenseId}`
    ) as HTMLInputElement | null;
    if (fileInput) fileInput.value = "";
    await loadDetail("Proof attached to expense.");
  }

  async function uploadExpenseProof(
    expenseId: string,
    token: string,
    proof: {
      evidenceType: string;
      file?: File | null;
      textContent?: string;
      notes?: string;
    }
  ) {
    const textContent = String(proof.textContent || "").trim();
    if (!proof.file && !textContent) return { success: true, skipped: true };

    const formData = new FormData();
    const companyId = currentCompanyId();
    if (companyId) formData.append("companyId", companyId);
    formData.append("relatedType", "expense");
    formData.append("relatedId", expenseId);
    formData.append("evidenceType", proof.evidenceType || "receipt");
    formData.append("notes", proof.notes || "");
    if (textContent) formData.append("textContent", textContent);
    if (proof.file) formData.append("file", proof.file);

    const res = await fetch("/api/evidence", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      return {
        success: false,
        error: json.error || "Failed to attach proof to expense.",
      };
    }

    return { success: true, attachment: json.attachment };
  }

  function expenseEvidenceForm(expenseId: string) {
    return expenseEvidenceForms[expenseId] || emptyExpenseEvidenceForm();
  }

  function updateExpenseEvidenceForm(expenseId: string, patch: Record<string, any>) {
    setExpenseEvidenceForms((current) => ({
      ...current,
      [expenseId]: {
        ...(current[expenseId] || emptyExpenseEvidenceForm()),
        ...patch,
      },
    }));
  }

  const journey = data?.journey || {};
  const capabilities = data?.capabilities || {};
  const canViewFinance = Boolean(capabilities.can_view_finance);
  const canViewTripExpenses = Boolean(
    capabilities.can_view_trip_expenses ?? capabilities.can_view_expenses
  );
  const canEditTripExpenses = Boolean(
    capabilities.can_edit_trip_expenses ?? capabilities.can_edit_expenses
  );
  const trip = data?.trip_intelligence?.trip || null;
  const missingData = trip?.missing_data || [];
  const flags = trip?.management_flags || [];
  const driverEvidence = trip?.driver_evidence || {};
  const finance = trip?.finance_evidence || {};
  const movement = trip?.movement_evidence || {};
  const readiness = trip?.profitability_readiness || {};
  const contributionSummary = readiness?.contribution_summary || {};
  const fuel = data?.fuel || {};
  const tripAllocations = fuel?.trip_allocations || [];
  const expenses = data?.expenses || [];
  const fuelIssueSummaries = fuel?.fuel_issue_summaries || {};
  const evidence = data?.evidence || {};
  const tripEvidence = evidence?.trip || {};
  const tripEvidenceAttachments = tripEvidence?.attachments || [];
  const expenseEvidenceById = evidence?.expenses || {};
  const fuelTotals = useMemo(() => summarizeTripAllocations(tripAllocations), [tripAllocations]);
  const expenseCategoryTotals = useMemo(() => summarizeExpenseCategories(expenses), [expenses]);
  const visibleMissingData = useMemo(
    () => filterMissingDataForRole(missingData, canViewFinance),
    [missingData, canViewFinance]
  );
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
          body="Complete operational records and evidence. Finance roles can review revenue, rates, and contribution separately."
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
                label="Driver"
                value={displayDriver}
                detail={driverEvidence.evidence_label ? humanize(driverEvidence.evidence_label) : undefined}
              />
              <MetricCard
                label="Distance evidence"
                value={movement.distance_km ? `${formatNumber(movement.distance_km)} km` : "Pending"}
                detail={movement.distance_source || "unavailable"}
              />
              {canViewTripExpenses && (
                <MetricCard
                  label="Expense records"
                  value={formatNumber(expenses.length)}
                  detail={canViewFinance ? `KES ${formatMoney(expenseTotal)}` : "Proof entry enabled"}
                />
              )}
              {canViewFinance && (
                <MetricCard
                  label="Contribution readiness"
                  value={readinessLabel(trip?.profitability_readiness)}
                  tone={readinessTone(trip?.profitability_readiness?.status)}
                />
              )}
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
                  title={canViewFinance ? "Management intelligence" : "Operational readiness"}
                  subtitle={
                    canViewFinance
                      ? "Contribution and readiness are deterministic, not guessed profit."
                      : "Operational links for clerks and ops users. Finance values stay hidden."
                  }
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  {canViewFinance && (
                    <StatusPill tone={readinessTone(trip?.profitability_readiness?.status)}>
                      {readinessLabel(trip?.profitability_readiness)}
                    </StatusPill>
                  )}
                  <StatusPill tone="info">
                    {movement.distance_source || "distance unavailable"}
                  </StatusPill>
                  {canViewFinance && finance.fuel_cost_source && (
                    <StatusPill tone="info">
                      Fuel: {humanize(finance.fuel_cost_source)}
                    </StatusPill>
                  )}
                </div>

                {canViewFinance &&
                  Array.isArray(trip?.profitability_readiness?.supporting_notes) &&
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
                  {canViewFinance && (
                    <>
                      <EvidenceLine
                        label="Revenue"
                        value={`KES ${formatMoney(finance.revenue_kes)}`}
                      />
                      <EvidenceLine
                        label="Linked variable costs"
                        value={`KES ${formatMoney(finance.linked_variable_costs_kes)}`}
                      />
                    </>
                  )}
                </div>

                {visibleMissingData.length > 0 && (
                  <div className="mt-5">
                    <div className="text-xs font-bold uppercase tracking-[0.12em] text-amber-100">
                      Missing links
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {visibleMissingData.map((item: string) => (
                        <StatusPill key={item} tone="warning">
                          {missingDataLabel(item)}
                        </StatusPill>
                      ))}
                    </div>
                  </div>
                )}

                {canViewFinance && flags.length > 0 && (
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

            {canViewFinance && (
              <section className="mt-8">
                <Panel dark className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <SectionTitle
                      title="Management intelligence"
                      subtitle="Linked revenue minus allocated fuel and linked trip expenses. This is review-ready contribution, not final audited profit."
                    />
                    <StatusPill tone={readinessTone(readiness.status)}>
                      {readinessLabel(readiness)}
                    </StatusPill>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <ContributionValue
                      label="Revenue"
                      value={formatCurrencyOrPending(contributionSummary.revenue_amount)}
                    />
                    <ContributionValue
                      label="Allocated fuel/cost"
                      value={formatCurrencyOrPending(contributionSummary.linked_fuel_cost)}
                      detail="Fuel allocation evidence only"
                    />
                    <ContributionValue
                      label="Linked expenses"
                      value={formatCurrencyOrPending(contributionSummary.linked_expense_cost)}
                      detail={
                        contributionSummary.extra_expenses_linked
                          ? "Trip expense records linked"
                          : "No additional trip expenses linked yet"
                      }
                    />
                    <ContributionValue
                      label="Linked variable cost"
                      value={formatCurrencyOrPending(contributionSummary.linked_variable_cost)}
                    />
                    <ContributionValue
                      label="Contribution"
                      value={formatCurrencyOrPending(contributionSummary.contribution_amount)}
                      tone="strong"
                    />
                    <ContributionValue
                      label="Contribution margin"
                      value={formatPercentOrPending(contributionSummary.contribution_margin_percent)}
                      tone="strong"
                    />
                    <ContributionValue
                      label={contributionPerKmLabel(contributionSummary)}
                      value={formatCurrencyOrPending(contributionSummary.per_km_contribution)}
                      detail={contributionPerKmDetail(contributionSummary)}
                    />
                    <ContributionValue
                      label="Contribution per tonne"
                      value={formatCurrencyOrPending(contributionSummary.per_tonne_contribution)}
                      detail={contributionPerTonneDetail(contributionSummary)}
                    />
                  </div>

                  {Array.isArray(contributionSummary.caveats) &&
                    contributionSummary.caveats.length > 0 && (
                      <div className="mt-5 flex flex-wrap gap-2">
                        {contributionSummary.caveats.map((note: string) => (
                          <StatusPill key={note} tone="info">
                            {note}
                          </StatusPill>
                        ))}
                      </div>
                    )}
                </Panel>
              </section>
            )}

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

              {canViewFinance && (
                <Panel dark className="p-5">
                  <SectionTitle
                    title="Finance / revenue"
                    subtitle="Revenue, rate, and FX fields are finance-controlled. Clerks should not need confidential pricing to complete operational records."
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
                  ) : (
                    <div className="mt-5 grid gap-3">
                      <EvidenceLine label="Revenue" value={`KES ${formatMoney(journey.revenue_kes)}`} />
                      <EvidenceLine label="Rate" value={`${formatMoney(journey.rate_amount)} ${journey.rate_currency || "KES"} · ${humanize(journey.rate_type)}`} />
                      <ReadOnlyNotice text="Your role can view finance values but cannot edit revenue." />
                    </div>
                  )}
                </Panel>
              )}
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
                  title="Operational expenses & proof"
                  subtitle="Structured supplier, payment, reference, amount, and date details live on the expense record. Receipts support that record; they do not replace it."
                />

                {!canViewTripExpenses ? (
                  <ReadOnlyNotice text="Trip expense entry is not available for this role." />
                ) : (
                  <>
                    <div className="mt-5 rounded-md border border-white/10 bg-slate-950/35 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white">
                            Expense totals by category
                          </div>
                          <div className="mt-1 text-xs leading-5 text-slate-400">
                            Each expense keeps its own proof; these totals roll up linked trip expenses for contribution review.
                          </div>
                        </div>
                        <StatusPill tone="info">
                          Total KES {formatMoney(expenseTotal)}
                        </StatusPill>
                      </div>
                      {expenseCategoryTotals.length === 0 ? (
                        <div className="mt-4 text-sm leading-6 text-slate-400">
                          No linked expense categories yet.
                        </div>
                      ) : (
                        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {expenseCategoryTotals.map((category) => (
                            <ExpenseCategoryTotal key={category.type} category={category} />
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="mt-5 grid gap-3">
                      {expenses.length === 0 ? (
                        <InlineEmpty
                          title="No expenses linked"
                          body="Trip Intelligence will keep linked expenses missing until costs are assigned to this trip."
                        />
                      ) : (
                        expenses.map((expense: any) => {
                          const expenseEvidence = expenseEvidenceById[expense.id] || {};
                          const attachments = expenseEvidence.attachments || [];
                          const form = expenseEvidenceForm(expense.id);
                          const isUploading = expenseEvidenceUploadingId === expense.id;

                          return (
                            <EvidenceCard key={expense.id}>
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-white">
                                    KES {formatMoney(expense.amount)} · {humanize(expense.expense_type)}
                                  </div>
                                  <div className="mt-1 text-xs leading-5 text-slate-400">
                                    Supplier/payee: {expense.vendor || "Not captured"}
                                  </div>
                                </div>
                                <StatusPill tone="neutral">
                                  {formatDate(expense.created_at)}
                                </StatusPill>
                              </div>
                              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                <ExpenseFact
                                  label="Supplier / payee"
                                  value={expense.vendor || "Not captured"}
                                />
                                <ExpenseFact
                                  label="Payment method"
                                  value={humanize(expense.payment_method || "not captured")}
                                />
                                <ExpenseFact
                                  label="Reference"
                                  value={expense.reference_number || "Not captured"}
                                />
                                <ExpenseFact
                                  label="Expense date"
                                  value={formatDate(expense.created_at)}
                                />
                              </div>
                              {expense.notes && (
                                <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                                  {expense.notes}
                                </div>
                              )}

                              <div className="mt-5 rounded-md border border-white/10 bg-slate-950/35 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <div className="text-sm font-semibold text-white">
                                      Expense proof
                                    </div>
                                    <div className="mt-1 text-xs leading-5 text-slate-400">
                                      Attach receipts, invoices, payment proof, screenshots, or pasted proof text to this expense record.
                                    </div>
                                  </div>
                                  <StatusPill tone={attachments.length ? "info" : "neutral"}>
                                    {attachments.length} proof item(s)
                                  </StatusPill>
                                </div>

                                <EvidenceAttachmentList
                                  attachments={attachments}
                                  emptyTitle="No proof attached"
                                  emptyBody="This expense has structured details, but no receipt or payment proof attached yet."
                                />

                                {Number(
                                  expenseEvidence?.guardrails?.hidden_legacy_duplicate_count || 0
                                ) > 0 ? (
                                  <ReadOnlyNotice
                                    text={
                                      expenseEvidence.guardrails.duplicate_pre_hash_note ||
                                      "Duplicate-looking pre-hash evidence hidden."
                                    }
                                  />
                                ) : null}

                                {expenseEvidence?.setup_required ? (
                                  <ReadOnlyNotice text={expenseEvidence.error || "Evidence storage is not set up yet."} />
                                ) : expenseEvidence?.error ? (
                                  <ReadOnlyNotice text={expenseEvidence.error} />
                                ) : null}

                                {canEditTripExpenses ? (
                                  <details className="mt-4 rounded-md border border-white/10 bg-white/[0.04] p-4">
                                    <summary className="cursor-pointer text-sm font-semibold text-white">
                                      Attach proof
                                    </summary>
                                    <form
                                      onSubmit={(event) => uploadExpenseEvidence(event, expense.id)}
                                      className="mt-5 grid gap-5"
                                    >
                                      <div className="grid gap-5 md:grid-cols-2">
                                        <FormField label="Evidence type" dark>
                                          <select
                                            value={form.evidenceType || "receipt"}
                                            onChange={(event) =>
                                              updateExpenseEvidenceForm(expense.id, {
                                                evidenceType: event.target.value,
                                              })
                                            }
                                            className={inputClass}
                                          >
                                            {expenseEvidenceTypes.map((type) => (
                                              <option key={type.value} value={type.value}>
                                                {type.label}
                                              </option>
                                            ))}
                                          </select>
                                        </FormField>
                                        <FormField label="File" dark>
                                          <input
                                            id={`expense-evidence-file-${expense.id}`}
                                            type="file"
                                            accept="image/*,.pdf"
                                            onChange={(event) =>
                                              updateExpenseEvidenceForm(expense.id, {
                                                file: event.target.files?.[0] || null,
                                              })
                                            }
                                            className={inputClass}
                                          />
                                        </FormField>
                                      </div>
                                      <FormField label="Paste payment message or receipt text optional" dark>
                                        <textarea
                                          value={form.textContent || ""}
                                          onChange={(event) =>
                                            updateExpenseEvidenceForm(expense.id, {
                                              textContent: event.target.value,
                                            })
                                          }
                                          rows={4}
                                          placeholder="Paste payment message, receipt text, invoice reference, or other proof details. Nava stores it as evidence only and does not parse or verify it yet."
                                          className={inputClass}
                                        />
                                      </FormField>
                                      <FormField label="Notes optional" dark>
                                        <textarea
                                          value={form.notes || ""}
                                          onChange={(event) =>
                                            updateExpenseEvidenceForm(expense.id, {
                                              notes: event.target.value,
                                            })
                                          }
                                          rows={3}
                                          placeholder="Example: M-Pesa receipt or toll slip reference."
                                          className={inputClass}
                                        />
                                      </FormField>
                                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                        <PrimaryButton
                                          type="submit"
                                          disabled={isUploading || Boolean(expenseEvidence?.setup_required)}
                                          className="w-full sm:w-auto"
                                        >
                                          {isUploading ? "Uploading..." : "Attach proof"}
                                        </PrimaryButton>
                                        <div className="text-xs leading-5 text-slate-400">
                                          Files and pasted messages stay private and attach to this expense, not the general trip.
                                        </div>
                                      </div>
                                    </form>
                                  </details>
                                ) : (
                                  <ReadOnlyNotice text="Your role can view trip expenses but cannot attach expense proof." />
                                )}
                              </div>
                            </EvidenceCard>
                          );
                        })
                      )}
                    </div>

                    {canEditTripExpenses ? (
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
                                onChange={(event) => {
                                  const nextMethod = event.target.value;
                                  setExpensePaymentMethod(nextMethod);
                                  if (nextMethod === "mpesa") {
                                    setNewExpenseEvidenceType("mpesa_screenshot");
                                  }
                                }}
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
                          <FormField label="Supplier / payee optional" dark>
                            <input
                              value={expenseVendor}
                              onChange={(event) => setExpenseVendor(event.target.value.toUpperCase())}
                              placeholder="Vendor, supplier, or payee"
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
                          <div className="rounded-md border border-cyan-200/15 bg-cyan-300/10 p-4">
                            <div className="text-sm font-semibold text-cyan-50">
                              Proof optional
                            </div>
                            <p className="mt-2 text-sm leading-6 text-cyan-100/80">
                              Upload a receipt, invoice, payment proof, or screenshot. You can also paste payment/receipt text. Proof will be attached to this expense.
                            </p>
                            <div className="mt-5 grid gap-5 md:grid-cols-2">
                              <FormField label="Proof type" dark>
                                <select
                                  value={newExpenseEvidenceType}
                                  onChange={(event) => setNewExpenseEvidenceType(event.target.value)}
                                  className={inputClass}
                                >
                                  {expenseEvidenceTypes.map((type) => (
                                    <option key={type.value} value={type.value}>
                                      {type.label}
                                    </option>
                                  ))}
                                </select>
                              </FormField>
                              <FormField label="Upload proof document optional" dark>
                                <input
                                  id="new-expense-proof-file"
                                  type="file"
                                  accept="image/*,.pdf"
                                  onChange={(event) =>
                                    setNewExpenseEvidenceFile(event.target.files?.[0] || null)
                                  }
                                  className={inputClass}
                                />
                              </FormField>
                            </div>
                            <FormField label="Paste payment message or receipt text optional" dark>
                              <textarea
                                value={newExpenseProofText}
                                onChange={(event) => setNewExpenseProofText(event.target.value)}
                                rows={4}
                                placeholder="Paste payment message, receipt text, invoice reference, or other proof details. Nava stores it as evidence only and does not parse or verify it yet."
                                className={inputClass}
                              />
                            </FormField>
                            <FormField label="Proof notes optional" dark>
                              <textarea
                                value={newExpenseEvidenceNotes}
                                onChange={(event) => setNewExpenseEvidenceNotes(event.target.value)}
                                rows={2}
                                placeholder="Any context for this proof."
                                className={inputClass}
                              />
                            </FormField>
                          </div>
                          <PrimaryButton type="submit" className="w-full sm:w-auto">
                            Save expense
                          </PrimaryButton>
                        </form>
                      </details>
                    ) : (
                      <ReadOnlyNotice text="Your role can view trip expenses but cannot add trip expenses." />
                    )}
                  </>
                )}
              </Panel>
            </section>

            <section className="mt-8">
              <Panel dark className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <SectionTitle
                    title="General trip evidence"
                    subtitle="Use this for delivery notes, weighbridge tickets, invoices, and trip-level documents. Expense receipts belong under the matching expense above."
                  />
                  <StatusPill tone="info">Private trip files</StatusPill>
                </div>

                {tripEvidence?.setup_required ? (
                  <ReadOnlyNotice text={tripEvidence.error || "Trip evidence storage is not set up yet. Apply the evidence migration and create the private storage bucket."} />
                ) : tripEvidence?.error ? (
                  <ReadOnlyNotice text={tripEvidence.error} />
                ) : null}

                <EvidenceAttachmentList
                  attachments={tripEvidenceAttachments}
                  emptyTitle="No general trip evidence attached yet"
                  emptyBody="Upload delivery notes, weighbridge tickets, invoices, or other trip-level supporting documents here."
                />

                {Number(tripEvidence?.guardrails?.hidden_legacy_duplicate_count || 0) > 0 ? (
                  <ReadOnlyNotice
                    text={
                      tripEvidence.guardrails.duplicate_pre_hash_note ||
                      "Duplicate-looking pre-hash evidence hidden."
                    }
                  />
                ) : null}

                <form onSubmit={uploadTripEvidence} className="mt-6 grid gap-5">
                  <div className="grid gap-5 md:grid-cols-2">
                    <FormField label="Evidence type" dark>
                      <select
                        value={tripEvidenceType}
                        onChange={(event) => setTripEvidenceType(event.target.value)}
                        className={inputClass}
                      >
                        {tripEvidenceTypes.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="File" dark>
                      <input
                        id="trip-evidence-file"
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(event) => setTripEvidenceFile(event.target.files?.[0] || null)}
                        className={inputClass}
                        required
                      />
                    </FormField>
                  </div>
                  <FormField label="Notes optional" dark>
                    <textarea
                      value={tripEvidenceNotes}
                      onChange={(event) => setTripEvidenceNotes(event.target.value)}
                      rows={3}
                      placeholder="Example: delivery note, weighbridge ticket, or trip invoice reference."
                      className={inputClass}
                    />
                  </FormField>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <PrimaryButton
                      type="submit"
                      disabled={tripEvidenceUploading || Boolean(tripEvidence?.setup_required)}
                      className="w-full sm:w-auto"
                    >
                      {tripEvidenceUploading ? "Uploading..." : "Upload general trip evidence"}
                    </PrimaryButton>
                    <div className="text-xs leading-5 text-slate-400">
                      Accepted: PDF, JPG, PNG, WebP, HEIC up to 4MB. Files are opened through short-lived private links.
                    </div>
                  </div>
                </form>
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

function ContributionValue({
  label,
  value,
  detail,
  tone = "normal",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "normal" | "strong";
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div
        className={`mt-2 break-words text-lg font-semibold ${
          tone === "strong" ? "text-emerald-100" : "text-white"
        }`}
      >
        {value}
      </div>
      {detail && <div className="mt-2 text-xs leading-5 text-slate-400">{detail}</div>}
    </div>
  );
}

function contributionPerKmLabel(summary: any) {
  if (summary?.per_km_distance_source === "gps-estimated") {
    return "GPS-estimated contribution per km";
  }
  return "Contribution per km";
}

function contributionPerKmDetail(summary: any) {
  if (!summary?.distance_based_metrics_available) {
    return "Distance-based metrics pending";
  }
  if (summary?.per_km_distance_source === "gps-estimated") {
    return "Provider distance is still needed for final per-km review";
  }
  if (summary?.per_km_distance_source === "provider-reported") {
    return "Based on provider-reported distance";
  }
  return "Distance evidence available";
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

function EvidenceAttachmentList({
  attachments,
  emptyTitle,
  emptyBody,
}: {
  attachments: any[];
  emptyTitle: string;
  emptyBody: string;
}) {
  return (
    <div className="mt-5 grid gap-3">
      {attachments.length === 0 ? (
        <InlineEmpty title={emptyTitle} body={emptyBody} />
      ) : (
        attachments.map((attachment: any) => (
          <EvidenceCard key={attachment.id}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="break-words text-sm font-semibold text-white">
                  {attachment.original_filename || evidenceAttachmentTitle(attachment)}
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <StatusPill tone="neutral">
                    {evidenceTypeLabel(attachment.evidence_type)}
                  </StatusPill>
                  <StatusPill tone="info">
                    {humanize(attachment.verification_status || "uploaded")}
                  </StatusPill>
                </div>
                <div className="mt-2 text-xs leading-5 text-slate-400">
                  Uploaded {formatDateTime(attachment.uploaded_at)} · {attachment.has_file ? `${attachment.mime_type || "file"} · ${formatFileSize(attachment.file_size_bytes)}` : "pasted text evidence"}
                </div>
                {attachment.text_content && (
                  <div className="mt-3 rounded-md border border-white/10 bg-slate-950/50 p-3">
                    <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                      {pastedEvidenceLabel(attachment)}
                    </div>
                    <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">
                      {attachment.text_content}
                    </div>
                  </div>
                )}
                {attachment.notes && (
                  <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                    {attachment.notes}
                  </div>
                )}
              </div>
              <div className="shrink-0">
                {attachment.signed_url ? (
                  <a
                    href={attachment.signed_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex rounded-md border border-white/15 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10"
                  >
                    Open secure file
                  </a>
                ) : (
                  <span className="text-xs text-slate-400">
                    {attachment.download_error || "Secure file link unavailable"}
                  </span>
                )}
              </div>
            </div>
          </EvidenceCard>
        ))
      )}
    </div>
  );
}

function ExpenseFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-slate-950/40 px-3 py-3">
      <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function ExpenseCategoryTotal({
  category,
}: {
  category: { type: string; amount: number; count: number };
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
      <div className="text-sm font-semibold text-white">{humanize(category.type)}</div>
      <div className="mt-2 text-lg font-semibold text-slate-100">
        KES {formatMoney(category.amount)}
      </div>
      <div className="mt-1 text-xs leading-5 text-slate-400">
        from {formatNumber(category.count)} {category.count === 1 ? "record" : "records"}
      </div>
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

function summarizeExpenseCategories(expenses: any[]) {
  const totals = new Map<string, { type: string; amount: number; count: number }>();
  for (const expense of expenses || []) {
    const type = String(expense?.expense_type || "other").trim() || "other";
    const current = totals.get(type) || { type, amount: 0, count: 0 };
    current.amount += Number(expense?.amount || 0);
    current.count += 1;
    totals.set(type, current);
  }

  return Array.from(totals.values())
    .map((category) => ({
      ...category,
      amount: roundMoney(category.amount),
    }))
    .sort((a, b) => b.amount - a.amount || a.type.localeCompare(b.type));
}

function roundMoney(value: any) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
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

function formatFileSize(value: any) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "Size unavailable";
  if (bytes >= 1024 * 1024) return `${formatNumber(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${formatNumber(bytes / 1024)} KB`;
  return `${formatNumber(bytes)} B`;
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

function formatCurrencyOrPending(value: any) {
  if (value === null || value === undefined || value === "") return "Pending";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Pending";
  return `KES ${formatMoney(number)}`;
}

function formatPercentOrPending(value: any) {
  if (value === null || value === undefined || value === "") return "Pending";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Pending";
  return `${formatNumber(number)}%`;
}

function contributionPerTonneDetail(summary: any) {
  if (hasNumericValue(summary?.per_tonne_contribution)) return undefined;
  if (!hasNumericValue(summary?.billing_quantity)) return "Requires billing quantity";
  return undefined;
}

function hasNumericValue(value: any) {
  if (value === null || value === undefined || value === "") return false;
  const number = Number(value);
  return Number.isFinite(number);
}

function humanize(value: any) {
  const text = String(value || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Unavailable";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function evidenceTypeLabel(value: any) {
  const key = String(value || "").toLowerCase();
  if (key === "receipt") return "Receipt";
  if (key === "mpesa_screenshot") return "M-Pesa proof";
  if (key === "delivery_note") return "Delivery note";
  if (key === "weighbridge") return "Weighbridge ticket";
  if (key === "invoice") return "Invoice";
  if (key === "payment_proof") return "Payment proof";
  if (key === "other") return "Other evidence";
  return humanize(value || "Evidence");
}

function evidenceAttachmentTitle(attachment: any) {
  if (attachment?.has_text_content && !attachment?.has_file) {
    return pastedEvidenceLabel(attachment);
  }
  return evidenceTypeLabel(attachment?.evidence_type);
}

function pastedEvidenceLabel(attachment: any) {
  const key = String(attachment?.evidence_type || "").toLowerCase();
  if (key === "mpesa_screenshot") {
    return "Pasted M-Pesa message evidence";
  }
  if (key === "payment_proof") return "Pasted payment proof";
  if (key === "invoice") return "Pasted invoice/reference evidence";
  return "Pasted proof text";
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

function filterMissingDataForRole(items: any[], canViewFinance: boolean) {
  if (canViewFinance) return items || [];
  const financeTerms = [
    "revenue",
    "expense",
    "expenses",
    "cost",
    "costs",
    "fuel allocation",
    "finance",
    "contribution",
    "profit",
    "rate",
  ];
  return (items || []).filter((item) => {
    const text = String(item || "").toLowerCase();
    return !financeTerms.some((term) => text.includes(term));
  });
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
