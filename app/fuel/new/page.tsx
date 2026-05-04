"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function NewFuelPage() {
  const [journeys, setJourneys] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);

  const [truck, setTruck] = useState("");
  const [liters, setLiters] = useState("");
  const [pricePerLiter, setPricePerLiter] = useState("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [journeyId, setJourneyId] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");

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

    async function loadProviders() {
      const { data, error } = await supabase
        .from("fuel_providers")
        .select("*")
        .eq("is_active", true);

      if (error) {
        console.error(error);
        return;
      }

      setProviders(data || []);
    }

    loadJourneys();
    loadProviders();
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

    // reset
    setTruck("");
    setLiters("");
    setPricePerLiter("");
    setVendor("");
    setNotes("");
    setJourneyId("");
    setSelectedProviderId("");
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Add Fuel</h1>

      <form onSubmit={handleSubmit}>
        {/* TRUCK */}
        <input
          placeholder="Truck e.g. KBJ123A"
          value={truck}
          onChange={(e) => setTruck(e.target.value)}
          required
        />

        <br /><br />

        {/* LITERS */}
        <input
          placeholder="Liters e.g. 480"
          value={liters}
          onChange={(e) => setLiters(e.target.value)}
          required
        />

        <br /><br />

        {/* PROVIDER DROPDOWN (AUTO-FILL MAGIC) */}
        <select
          value={selectedProviderId}
          onChange={(e) => {
            const id = e.target.value;
            setSelectedProviderId(id);

            const provider = providers.find(p => p.id === id);

            if (provider) {
              setVendor(provider.name);

              // 🔥 AUTO FILL PRICE
              if (provider.current_price_per_liter) {
                setPricePerLiter(
                  provider.current_price_per_liter.toString()
                );
              }
            }
          }}
        >
          <option value="">Select fuel provider (or manual)</option>

          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.location || "No location"}
            </option>
          ))}
        </select>

        <br /><br />

        {/* PRICE (AUTO OR MANUAL OVERRIDE) */}
        <input
          placeholder="Price per liter e.g. 197"
          value={pricePerLiter}
          onChange={(e) => setPricePerLiter(e.target.value)}
        />

        <br /><br />

        {/* JOURNEY LINK */}
        <select
          value={journeyId}
          onChange={(e) => setJourneyId(e.target.value)}
        >
          <option value="">No journey yet / unallocated fuel</option>

          {journeys.map((j) => (
            <option key={j.id} value={j.id}>
              {j.client_name || "No client"} — {j.truck} —{" "}
              {j.from_location} → {j.to_location}
            </option>
          ))}
        </select>

        <br /><br />

        {/* NOTES */}
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
