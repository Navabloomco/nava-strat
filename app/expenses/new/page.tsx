"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

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
      setMessage(json.error || "Failed to load journeys.");
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
    <main style={{ padding: 40 }}>
      <h1>Add Expense</h1>

      {loading && <p>Loading journeys...</p>}
      {message && <pre style={{ background: "#f4f4f4", padding: 12 }}>{message}</pre>}

      <form onSubmit={handleSubmit}>
        <select value={journeyId} onChange={(e) => handleJourneySelect(e.target.value)}>
          <option value="">Select journey / or leave unallocated</option>

          {journeys.map((j) => (
            <option key={j.id} value={j.id}>
              {j.internal_trip_id || "NO TRIP ID"} — {j.client_name || "NO CLIENT"} — {j.truck} — {j.from_location} → {j.to_location}
            </option>
          ))}
        </select>

        <br /><br />

        <input placeholder="Truck e.g. KBJ123A" value={truck} onChange={(e) => setTruck(e.target.value.toUpperCase())} required />
        <br /><br />

        <input placeholder="Amount e.g. 3000" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <br /><br />

        <select value={type} onChange={(e) => setType(e.target.value)} required>
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

        <br /><br />

        <input placeholder="Paid to / Vendor e.g. KARIUKI, KRA, COUNTY" value={vendor} onChange={(e) => setVendor(e.target.value.toUpperCase())} />
        <br /><br />

        <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} required>
          <option value="">Select payment method</option>
          <option value="mpesa">M-Pesa</option>
          <option value="bank">Bank</option>
          <option value="cash">Cash</option>
          <option value="fuel_card">Fuel Card</option>
          <option value="credit">Credit</option>
          <option value="other">Other</option>
        </select>

        <br /><br />

        <input placeholder="Payment reference e.g. MPESA code / invoice no. / receipt no." value={reference} onChange={(e) => setReference(e.target.value)} required />
        <br /><br />

        <input placeholder="Nava Eye trip ID" value={tripReference} onChange={(e) => setTripReference(e.target.value.toUpperCase())} />
        <br /><br />

        <input placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <br /><br />

        <button type="submit">Save Expense</button>
      </form>
    </main>
  );
}
