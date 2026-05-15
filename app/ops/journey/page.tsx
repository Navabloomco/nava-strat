"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function JourneyListPage() {
  const [journeys, setJourneys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorDetail, setErrorDetail] = useState("");

  async function fetchJourneys() {
    setLoading(true);
    setErrorDetail("");

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) {
      setErrorDetail("You must be signed in to view journeys.");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/journeys", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const json = await res.json();

    if (!json.success) {
      setErrorDetail(json.error || "Failed to load journeys");
      setLoading(false);
      return;
    }

    setJourneys(json.journeys || []);
    setLoading(false);
  }

  useEffect(() => {
    fetchJourneys();
  }, []);

  return (
    <main style={{ padding: 40 }}>
      <h1>Journeys</h1>
      <p>Saved journeys from operations.</p>

      <br />

      {loading ? (
        <p>Loading journeys...</p>
      ) : errorDetail ? (
        <pre style={{ background: "#f4f4f4", padding: 12 }}>{errorDetail}</pre>
      ) : journeys.length === 0 ? (
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
