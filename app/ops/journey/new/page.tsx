"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function NewJourneyPage() {
  const [truck, setTruck] = useState("");
  const [driver, setDriver] = useState("");
  const [route, setRoute] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.from("journeys").insert([
      {
        truck,
        driver,
        route,
      },
    ]);

    console.log("DATA:", data);
    console.log("ERROR:", error);

    if (error) {
      alert("Error saving journey ❌");
    } else {
      alert("Journey saved ✅");
      setTruck("");
      setDriver("");
      setRoute("");
    }

    setLoading(false);
  };

  return (
    <div style={{ padding: 20 }}>
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
          placeholder="Route (e.g. Mombasa → Kampala)"
          value={route}
          onChange={(e) => setRoute(e.target.value)}
        />
        <br /><br />

        <button type="submit" disabled={loading}>
          {loading ? "Saving..." : "Save Journey"}
        </button>
      </form>
    </div>
  );
}
