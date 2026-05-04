"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function JourneyListPage() {
  const [journeys, setJourneys] = useState<any[]>([]);

  async function fetchJourneys() {
    const { data, error } = await supabase
      .from("journeys")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      alert(error.message);
      console.error(error);
      return;
    }

    setJourneys(data || []);
  }

  useEffect(() => {
    fetchJourneys();
  }, []);

  return (
    <main style={{ padding: 40 }}>
      <h1>Journeys</h1>
      <p>Saved journeys from operations.</p>

      <br />

      {journeys.length === 0 ? (
        <p>No journeys yet.</p>
      ) : (
        <table border={1} cellPadding={10}>
          <thead>
            <tr>
              <th>Client</th>
              <th>Truck</th>
              <th>Driver</th>
              <th>From</th>
              <th>To</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>

          <tbody>
            {journeys.map((journey) => (
              <tr key={journey.id}>
                <td>{journey.client_name || "—"}</td>
                <td>{journey.truck || "—"}</td>
                <td>{journey.driver || "—"}</td>
                <td>{journey.from_location || "—"}</td>
                <td>{journey.to_location || "—"}</td>
                <td>{journey.status || "—"}</td>
                <td>
                  {journey.created_at
                    ? new Date(journey.created_at).toLocaleString()
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
