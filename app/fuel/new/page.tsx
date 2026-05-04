"use client";

import { useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function NewFuelPage() {
  const [truck, setTruck] = useState("");
  const [liters, setLiters] = useState("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");

  async function handleSubmit(e: any) {
    e.preventDefault();

    const { error } = await supabase.from("fuel_logs").insert([
      {
        truck_text: truck,
        liters: Number(liters),
        vendor: vendor,
        allocation_status: "unallocated",
        fuel_source: "manual",
        notes: notes,
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
    setVendor("");
    setNotes("");
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Add Fuel</h1>
      <p>Log fuel even before a trip exists.</p>

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
          placeholder="Vendor e.g. Shell Bonje"
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="Notes e.g. top-up, MPesa, invoice"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <br /><br />

        <button type="submit">Save Fuel</button>
      </form>
    </main>
  );
}
