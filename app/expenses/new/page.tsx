"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function NewExpensePage() {
  const [journeys, setJourneys] = useState<any[]>([]);

  const [truck, setTruck] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState("");
  const [vendor, setVendor] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [journeyId, setJourneyId] = useState("");

  useEffect(() => {
    loadJourneys();
  }, []);

  async function loadJourneys() {
    const { data } = await supabase
      .from("journeys")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false });

    setJourneys(data || []);
  }

  async function handleSubmit(e: any) {
    e.preventDefault();

    const cleanTruck = truck.trim().toUpperCase();

    const { error } = await supabase.from("expenses").insert([
      {
        journey_id: journeyId || null,
        truck: cleanTruck,
        expense_type: type,
        amount: Number(amount),
        vendor: vendor.toUpperCase(),
        reference_number: reference,
        notes,
      },
    ]);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Expense saved ✅");

    setTruck("");
    setAmount("");
    setType("");
    setVendor("");
    setReference("");
    setNotes("");
    setJourneyId("");
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Add Expense</h1>

      <form onSubmit={handleSubmit}>
        <input
          placeholder="Truck e.g. KBJ123A"
          value={truck}
          onChange={(e) => setTruck(e.target.value.toUpperCase())}
          required
        />

        <br /><br />

        <input
          placeholder="Amount e.g. 5000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />

        <br /><br />

        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Select expense type</option>
          <option value="PER_DIEM">Per Diem</option>
          <option value="CESS">Cess</option>
          <option value="ROAD_USER">Road User</option>
          <option value="PARKING">Parking</option>
          <option value="REPAIR">Repair</option>
          <option value="OTHER">Other</option>
        </select>

        <br /><br />

        <input
          placeholder="Vendor / Paid to"
          value={vendor}
          onChange={(e) => setVendor(e.target.value.toUpperCase())}
        />

        <br /><br />

        <input
          placeholder="Reference (Mpesa / invoice)"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />

        <br /><br />

        <select value={journeyId} onChange={(e) => setJourneyId(e.target.value)}>
          <option value="">No journey / unallocated</option>

          {journeys.map((j) => (
            <option key={j.id} value={j.id}>
              {j.client_name} — {j.truck} — {j.from_location} → {j.to_location}
            </option>
          ))}
        </select>

        <br /><br />

        <input
          placeholder="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <br /><br />

        <button type="submit">Save Expense</button>
      </form>
    </main>
  );
}
