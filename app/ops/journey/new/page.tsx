"use client";

import { useState } from "react";
import { supabase } from "../../../../lib/supabase";

export default function NewJourneyPage() {
  const [truck, setTruck] = useState("");
  const [driver, setDriver] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: any) {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.from("journeys").insert([
      {
        truck,
        driver,
        from_location: from,
        to_location: to,
        route: `${from} → ${to}`,
        status: "active",
      },
    ]);

    if (error) {
      alert(error.message);
      console.error(error);
    } else {
      alert("Journey saved ✅");
      setTruck("");
      setDriver("");
      setFrom("");
      setTo("");
    }

    setLoading(false);
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Create Journey</h1>

      <form onSubmit={handleSubmit}>
        <input
          placeholder="Truck (e.g. KBJ123A)"
          value={truck}
          onChange={(e) => setTruck(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="Driver (e.g. Kariuki)"
          value={driver}
          onChange={(e) => setDriver(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="From (e.g. Mombasa)"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="To (e.g. Nairobi)"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />

        <br /><br />

        <button type="submit" disabled={loading}>
          {loading ? "Saving..." : "Save Journey"}
        </button>
      </form>
    </main>
  );
}
