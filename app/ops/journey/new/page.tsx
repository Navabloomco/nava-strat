"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";

export default function NewJourneyPage() {
  const [client, setClient] = useState("");
  const [truck, setTruck] = useState("");
  const [driver, setDriver] = useState("");
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [expectedFuel, setExpectedFuel] = useState("");
  const [message, setMessage] = useState("");
  const router = useRouter();

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
    setMessage("Saving journey...");

    const cleanTruck = truck.trim().toUpperCase();
    const tripId = makeTripId();

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) {
      setMessage("You must be signed in to create a journey.");
      return;
    }

    const res = await fetch("/api/journeys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        internal_trip_id: tripId,
        client_name: client.trim().toUpperCase(),
        truck: cleanTruck,
        driver: driver.trim().toUpperCase(),
        from_location: fromLocation.trim().toUpperCase(),
        to_location: toLocation.trim().toUpperCase(),
        status: "active",
        expected_fuel_liters: expectedFuel ? Number(expectedFuel) : null,
      }),
    });

    const json = await res.json();

    if (!json.success) {
      setMessage(json.error || "Failed to save journey.");
      return;
    }

    setMessage(`Journey saved ✅ Trip ID: ${tripId}`);
    router.push("/ops/journey");
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Create Journey</h1>
      <p>One truck can only have one active journey at a time.</p>

      <form onSubmit={handleSubmit}>
        <input
          placeholder="Client e.g. ENGAANO"
          value={client}
          onChange={(e) => setClient(e.target.value.toUpperCase())}
          required
        />

        <br /><br />

        <input
          placeholder="Truck e.g. KBJ123A"
          value={truck}
          onChange={(e) => setTruck(e.target.value.toUpperCase())}
          required
        />

        <br /><br />

        <input
          placeholder="Driver e.g. KARIUKI"
          value={driver}
          onChange={(e) => setDriver(e.target.value.toUpperCase())}
        />

        <br /><br />

        <input
          placeholder="From e.g. MOMBASA"
          value={fromLocation}
          onChange={(e) => setFromLocation(e.target.value.toUpperCase())}
          required
        />

        <br /><br />

        <input
          placeholder="To e.g. JINJA"
          value={toLocation}
          onChange={(e) => setToLocation(e.target.value.toUpperCase())}
          required
        />

        <br /><br />

        <input
          placeholder="Default route fuel optional e.g. 480"
          value={expectedFuel}
          onChange={(e) => setExpectedFuel(e.target.value)}
        />

        <br /><br />

        <p>
          Nava Eye Trip ID preview:{" "}
          <strong>
            {truck && client && fromLocation && toLocation
              ? makeTripId()
              : "Fill journey details"}
          </strong>
        </p>

        <button type="submit">Save Journey</button>
      </form>

      <br />

      {message && (
        <pre style={{ background: "#f4f4f4", padding: 12 }}>
          {message}
        </pre>
      )}
    </main>
  );
}
