"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function RevenuePage() {
  const [journeys, setJourneys] = useState<any[]>([]);
  const [journeyId, setJourneyId] = useState("");
  const [revenue, setRevenue] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    loadJourneys();
  }, []);

  async function loadJourneys() {
    const { data, error } = await supabase
      .from("journeys")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      alert(error.message);
      return;
    }

    setJourneys(data || []);
  }

  async function handleSubmit(e: any) {
    e.preventDefault();

    const { error } = await supabase
      .from("journeys")
      .update({
        revenue: Number(revenue),
        revenue_reference: reference.trim(),
        revenue_notes: notes.trim(),
      })
      .eq("id", journeyId);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Revenue saved ✅");

    setJourneyId("");
    setRevenue("");
    setReference("");
    setNotes("");

    loadJourneys();
  }

  const selectedJourney = journeys.find((j) => j.id === journeyId);

  return (
    <main style={{ padding: 40 }}>
      <h1>Add Journey Revenue</h1>
      <p>Finance-side revenue entry for contribution margin.</p>

      <form onSubmit={handleSubmit}>
        <select
          value={journeyId}
          onChange={(e) => setJourneyId(e.target.value)}
          required
        >
          <option value="">Select journey</option>

          {journeys.map((j) => (
            <option key={j.id} value={j.id}>
              {j.internal_trip_id ? `${j.internal_trip_id} — ` : ""}
              {j.client_name || "NO CLIENT"} — {j.truck} —{" "}
              {j.from_location} → {j.to_location}
            </option>
          ))}
        </select>

        <br /><br />

        {selectedJourney && (
          <div style={{ border: "1px solid #ddd", padding: 12 }}>
            <strong>Selected Journey</strong>
            <p>
              {selectedJourney.client_name} — {selectedJourney.truck} —{" "}
              {selectedJourney.from_location} → {selectedJourney.to_location}
            </p>
          </div>
        )}

        <br />

        <input
          placeholder="Revenue amount e.g. 180000"
          value={revenue}
          onChange={(e) => setRevenue(e.target.value)}
          required
        />

        <br /><br />

        <input
          placeholder="Revenue reference e.g. Invoice no."
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <br /><br />

        <button type="submit">Save Revenue</button>
      </form>
    </main>
  );
}
