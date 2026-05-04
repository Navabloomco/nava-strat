"use client";

import { useState } from "react";
import { supabase } from "../../../../lib/supabase";

export default function NewJourneyPage() {
  const [client, setClient] = useState("");
  const [truck, setTruck] = useState("");
  const [driver, setDriver] = useState("");
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [expectedFuel, setExpectedFuel] = useState("");

  function makeTripId() {
    const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");

    return `${truck}-${client}-${fromLocation}-${toLocation}-${today}`
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/[^A-Z0-9-]/g, "");
  }

  async function handleSubmit(e: any) {
    e.preventDefault();

    const tripId = makeTripId();

    const { error } = await supabase.from("journeys").insert([
      {
        internal_trip_id: tripId,
        client_name: client.trim().toUpperCase(),
        truck: truck.trim().toUpperCase(),
        driver: driver.trim().toUpperCase(),
        from_location: fromLocation.trim().toUpperCase(),
        to_location: toLocation.trim().toUpperCase(),
        status: "active",
        expected_fuel_liters: expectedFuel ? Number(expectedFuel) : null,
      },
    ]);

    if (error) {
      alert(error.message);
      return;
    }

    alert(`Journey saved ✅\nTrip ID: ${tripId}`);

    setClient("");
    setTruck("");
    setDriver("");
    setFromLocation("");
    setToLocation("");
    setExpectedFuel("");
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Create Journey</h1>

      <form onSubmit={handleSubmit}>
        <input placeholder="Client e.g. ENGAANO" value={client} onChange={(e) => setClient(e.target.value.toUpperCase())} required />
        <br /><br />

        <input placeholder="Truck e.g. KBJ123A" value={truck} onChange={(e) => setTruck(e.target.value.toUpperCase())} required />
        <br /><br />

        <input placeholder="Driver e.g. KARIUKI" value={driver} onChange={(e) => setDriver(e.target.value.toUpperCase())} />
        <br /><br />

        <input placeholder="From e.g. MOMBASA" value={fromLocation} onChange={(e) => setFromLocation(e.target.value.toUpperCase())} />
        <br /><br />

        <input placeholder="To e.g. JINJA" value={toLocation} onChange={(e) => setToLocation(e.target.value.toUpperCase())} />
        <br /><br />

        <input placeholder="Default route fuel optional e.g. 480" value={expectedFuel} onChange={(e) => setExpectedFuel(e.target.value)} />
        <br /><br />

        <p>
          Nava Eye Trip ID preview:{" "}
          <strong>{truck && client && fromLocation && toLocation ? makeTripId() : "Fill journey details"}</strong>
        </p>

        <button type="submit">Save Journey</button>
      </form>
    </main>
  );
}
