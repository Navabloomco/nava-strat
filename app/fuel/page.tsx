"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function NewFuelPage() {
  const [journeys, setJourneys] = useState<any[]>([]);
  const [truck, setTruck] = useState("");
  const [liters, setLiters] = useState("");
  const [pricePerLiter, setPricePerLiter] = useState("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [journeyId, setJourneyId] = useState("");
  const [approved, setApproved] = useState(false);
  const [approvalReason, setApprovalReason] = useState("");

  useEffect(() => {
    async function loadJourneys() {
      const { data, error } = await supabase
        .from("journeys")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: false });

      if (!error) setJourneys(data || []);
    }

    loadJourneys();
  }, []);

  async function handleSubmit(e: any) {
    e.preventDefault();

    const litersNum = Number(liters);
    const priceNum = pricePerLiter ? Number(pricePerLiter) : 0;

    // 🚨 CHECK EXISTING FUEL FOR THIS JOURNEY
    if (journeyId) {
      const { data: existingFuel } = await supabase
        .from("fuel_logs")
        .select("id")
        .eq("journey_id", journeyId);

      if (existingFuel && existingFuel.length > 0 && !approved) {
        alert(
          "🚨 Fuel already logged for this journey.\nApproval required to add more."
        );
        return;
      }
    }

    const { error } = await supabase.from("fuel_logs").insert([
      {
        truck_text: truck,
        liters: litersNum,
        price_per_liter: priceNum,
        total_cost: litersNum * priceNum,
        vendor,
        notes,
        journey_id: journeyId || null,
        allocation_status: journeyId ? "allocated" : "unallocated",
        fuel_source: "manual",
        approved_extra_fuel: approved,
        approval_reason: approved ? approvalReason : null,
      },
    ]);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Fuel saved ✅");

    setTruck("");
    setLiters("");
    setPricePerLiter("");
    setVendor("");
    setNotes("");
    setJourneyId("");
    setApproved(false);
    setApprovalReason("");
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Add Fuel</h1>

      <form onSubmit={handleSubmit}>
        <input
          placeholder="Truck e.g. KBJ123A"
          value={truck}
          onChange={(e) => setTruck(e.target.value)}
          required
        />

        <br /><br />

        <input
          placeholder="Liters e.g. 480"
          value={liters}
          onChange={(e) => setLiters(e.target.value)}
          required
        />

        <br /><br />

        <input
          placeholder="Price per liter"
          value={pricePerLiter}
          onChange={(e) => setPricePerLiter(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="Fuel station"
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
        />

        <br /><br />

        <select
          value={journeyId}
          onChange={(e) => setJourneyId(e.target.value)}
        >
          <option value="">No journey / unallocated</option>
          {journeys.map((j) => (
            <option key={j.id} value={j.id}>
              {j.client_name || "No client"} — {j.truck} —{" "}
              {j.from_location} → {j.to_location}
            </option>
          ))}
        </select>

        <br /><br />

        <label>
          <input
            type="checkbox"
            checked={approved}
            onChange={(e) => setApproved(e.target.checked)}
          />
          Allow extra fuel (requires explanation)
        </label>

        <br /><br />

        {approved && (
          <>
            <input
              placeholder="Reason for extra fuel"
              value={approvalReason}
              onChange={(e) => setApprovalReason(e.target.value)}
              required
            />
            <br /><br />
          </>
        )}

        <input
          placeholder="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <br /><br />

        <button type="submit">Save Fuel</button>
      </form>
    </main>
  );
}
