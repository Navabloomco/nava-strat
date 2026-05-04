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

  useEffect(() => {
    async function loadJourneys() {
      const { data, error } = await supabase
        .from("journeys")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: false });

      if (error) {
        console.error(error);
        return;
      }

      setJourneys(data || []);
    }

    loadJourneys();
  }, []);

  async function handleSubmit(e: any) {
    e.preventDefault();

    const litersNum = Number(liters);
    const priceNum = pricePerLiter ? Number(pricePerLiter) : 0;

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
      },
    ]);

    if (error) {
      alert(error.message);
      console.error(error);
      return;
    }

    alert("Fuel saved ✅");

    setTruck("");
    setLiters("");
    setPricePerLiter("");
    setVendor("");
    setNotes("");
    setJourneyId("");
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
          placeholder="Price per liter e.g. 197"
          value={pricePerLiter}
          onChange={(e) => setPricePerLiter(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="Fuel provider / station"
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
        />

        <br /><br />

        <select value={journeyId} onChange={(e) => setJourneyId(e.target.value)}>
          <option value="">No journey yet / unallocated fuel</option>
          {journeys.map((j) => (
            <option key={j.id} value={j.id}>
              {j.client_name || "No client"} — {j.truck} — {j.from_location} → {j.to_location}
            </option>
          ))}
        </select>

        <br /><br />

        <input
          placeholder="Notes e.g. Mpesa, invoice, top-up"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <br /><br />

        <button type="submit">Save Fuel</button>
      </form>
    </main>
  );
}
