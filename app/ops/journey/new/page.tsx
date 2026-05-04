"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function NewJourneyPage() {
  const [truck, setTruck] = useState("");
  const [driver, setDriver] = useState("");
  const [route, setRoute] = useState("");

  const handleSubmit = async (e: any) => {
    e.preventDefault();

    const { error } = await supabase.from("journeys").insert([
      {
        truck,
        driver,
        route,
      },
    ]);

    if (error) {
      alert("Error saving journey");
      console.error(error);
    } else {
      alert("Journey saved ✅");
      setTruck("");
      setDriver("");
      setRoute("");
    }
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
          placeholder="Route"
          value={route}
          onChange={(e) => setRoute(e.target.value)}
        />
        <br /><br />

        <button type="submit">Save Journey</button>
      </form>
    </div>
  );
}
