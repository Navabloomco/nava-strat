"use client";

import { useState } from "react";
import { supabase } from "../../../../lib/supabase";

export default function NewJourneyPage() {
  const [client, setClient] = useState("");
  const [truck, setTruck] = useState("");
  const [driver, setDriver] = useState("");
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");

  const handleSubmit = async (e: any) => {
    e.preventDefault();

    const { error } = await supabase.from("journeys").insert([
      {
        client_name: client,
        truck,
        driver,
        from_location: fromLocation,
        to_location: toLocation,
        status: "active",
      },
    ]);

    if (error) {
      alert(error.message);
      console.error(error);
    } else {
      alert("Journey saved ✅");

      // reset form
      setClient("");
      setTruck("");
      setDriver("");
      setFromLocation("");
      setToLocation("");
    }
  };

  return (
    <main style={{ padding: 40 }}>
      <h1>Create Journey</h1>

      <form onSubmit={handleSubmit}>
        <input
          placeholder="Client (e.g. Engaano)"
          value={client}
          onChange={(e) => setClient(e.target.value)}
          required
        />
        <br /><br />

        <input
          placeholder="Truck (e.g. KBJ123A)"
          value={truck}
          onChange={(e) => setTruck(e.target.value)}
          required
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
          value={fromLocation}
          onChange={(e) => setFromLocation(e.target.value)}
        />
        <br /><br />

        <input
          placeholder="To (e.g. Nairobi)"
          value={toLocation}
          onChange={(e) => setToLocation(e.target.value)}
        />
        <br /><br />

        <button type="submit">Save Journey</button>
      </form>
    </main>
  );
}
