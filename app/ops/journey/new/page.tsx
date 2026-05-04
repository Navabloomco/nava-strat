"use client";

import { useState } from "react";
import { supabase } from "../../../../lib/supabase";

export default function NewJourneyPage() {
  const [truck, setTruck] = useState("");
  const [driver, setDriver] = useState("");
  const [route, setRoute] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: any) {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.from("journeys").insert([
      {
        truck,
        driver,
        route,
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
      setRoute("");
    }

    setLoading(false);
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Create Journey</h1>

      <form onSubmit={handleSubmit}>
        <input
          placeholder="Truck"
          value={truck}
          onChange={(e) => setTruck(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="Driver"
          value={driver}
          onChange={(e) => setDriver(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="Route e.g. Mombasa → Kampala"
          value={route}
          onChange={(e) => setRoute(e.target.value)}
        />

        <br /><br />

        <button type="submit" disabled={loading}>
          {loading ? "Saving..." : "Save Journey"}
        </button>
      </form>
    </main>
  );
}
