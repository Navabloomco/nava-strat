"use client";

import { useEffect, useState } from "react";
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

export default function NewExpensePage() {
  const [journeys, setJourneys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const [truck, setTruck] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState("");
  const [vendor, setVendor] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [reference, setReference] = useState("");
  const [tripReference, setTripReference] = useState("");
  const [notes, setNotes] = useState("");
  const [journeyId, setJourneyId] = useState("");

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

    const res = await fetch("/api/expenses", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setMessage(json.error || "Failed to load trips.");
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

  function handleJourneySelect(id: string) {
    setJourneyId(id);

    const journey = journeys.find((j) => j.id === id);

    if (journey) {
      setTruck(journey.truck || "");
      setTripReference(
        journey.internal_trip_id ||
          `${journey.truck}-${journey.client_name}-${journey.from_location}-${journey.to_location}`
            .toUpperCase()
            .replace(/\s+/g, "")
      );
    }
  }

  async function handleSubmit(e: any) {
    e.preventDefault();
    setMessage("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setMessage("Session expired. Please log in again.");
      return;
    }

    const res = await fetch("/api/expenses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        journey_id: journeyId || null,
        truck: truck.trim().toUpperCase(),
        expense_type: type,
        amount: Number(amount),
        vendor: vendor.trim().toUpperCase(),
        payment_method: paymentMethod,
        reference_number: reference.trim(),
        trip_reference: tripReference.trim().toUpperCase(),
        notes,
      }),
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setMessage(json.error || "Failed to save expense.");
      return;
    }

    alert("Expense saved ✅");

    setTruck("");
    setAmount("");
    setType("");
    setVendor("");
    setPaymentMethod("");
    setReference("");
    setTripReference("");
    setNotes("");
    setJourneyId("");
  }

  return (
    <main className="min-h-screen bg-slate-950 px-8 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          dark
          eyebrow="Finance control"
          title="Add Expense"
          body="Capture operational costs and optionally allocate them to an active trip."
        />

        {loading && (
          <Panel dark className="mt-8 p-6">
            <div className="text-sm text-slate-300">Loading trips...</div>
          </Panel>
        )}
        {message && (
          <Panel dark className="mt-8 border-cyan-200/20 bg-cyan-300/10 p-4">
            <div className="whitespace-pre-wrap text-sm text-cyan-50">{message}</div>
          </Panel>
        )}

        <Panel dark className="mt-8 p-6">
          <form onSubmit={handleSubmit} className="grid gap-5">
            <FormField label="Trip optional" dark>
              <JourneyPicker
                journeys={journeys}
                value={journeyId}
                onChange={(nextJourneyId) => handleJourneySelect(nextJourneyId)}
                allowUnallocated
                placeholder="Search open trips by reference, truck, client, route, or status"
              />
            </FormField>

            <div className="grid gap-5 md:grid-cols-2">
              <FormField label="Truck" dark>
                <input
                  placeholder="Enter vehicle registration"
                  value={truck}
                  onChange={(e) => setTruck(e.target.value.toUpperCase())}
                  className={inputClass}
                  required
                />
              </FormField>

              <FormField label="Amount" dark>
                <input
                  placeholder="Amount e.g. 3000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={inputClass}
                  required
                />
              </FormField>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <FormField label="Expense type" dark>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className={inputClass}
                  required
                >
                  <option value="">Select expense type</option>
                  <option value="per_diem">Per Diem</option>
                  <option value="toll">Toll</option>
                  <option value="mobile_money_fee">Mobile Money Fee</option>
                  <option value="bank_charge">Bank Charge</option>
                  <option value="transaction_cost">Transaction Cost / Bank or M-Pesa Fee</option>
                  <option value="weighbridge">Weighbridge</option>
                  <option value="parking">Parking</option>
                  <option value="permit">Permit</option>
                  <option value="border_fee">Border Fee</option>
                  <option value="clearing">Clearing</option>
                  <option value="loading">Loading</option>
                  <option value="offloading">Offloading</option>
                  <option value="county_fee">County Fee</option>
                  <option value="security">Security</option>
                  <option value="driver_advance">Driver Advance</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="salary">Salary</option>
                  <option value="insurance">Insurance</option>
                  <option value="fuel">Fuel</option>
                  <option value="other">Other</option>
                </select>
              </FormField>

              <FormField label="Payment method" dark>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className={inputClass}
                  required
                >
                  <option value="">Select payment method</option>
                  <option value="mpesa">M-Pesa</option>
                  <option value="bank">Bank</option>
                  <option value="cash">Cash</option>
                  <option value="fuel_card">Fuel Card</option>
                  <option value="credit">Credit</option>
                  <option value="other">Other</option>
                </select>
              </FormField>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <FormField label="Paid to / vendor" dark>
                <input
                  placeholder="Enter payee or vendor"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value.toUpperCase())}
                  className={inputClass}
                />
              </FormField>

              <FormField label="Payment reference" dark>
                <input
                  placeholder="Payment reference e.g. MPESA code / invoice no. / receipt no."
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className={inputClass}
                  required
                />
              </FormField>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <FormField label="Nava Eye trip ID" dark>
                <input
                  placeholder="Nava Eye trip ID"
                  value={tripReference}
                  onChange={(e) => setTripReference(e.target.value.toUpperCase())}
                  className={inputClass}
                />
              </FormField>

              <FormField label="Notes" dark>
                <input
                  placeholder="Notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={inputClass}
                />
              </FormField>
            </div>

            <div>
              <PrimaryButton type="submit">Save Expense</PrimaryButton>
            </div>
          </form>
        </Panel>
      </div>
    </main>
  );
}
