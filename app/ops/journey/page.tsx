"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function JourneyList() {
  const [journeys, setJourneys] = useState<any[]>([]);

  async function fetchJourneys() {
    const { data, error } = await supabase
      .from("journeys")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error) setJourneys(data || []);
  }

  useEffect(() => {
    fetchJourneys();
  }, []);

  return (
    <main style={{ padding: 40 }}>
      <h1>Journeys</h1>

      <table border={1} cellPadding={10}>
        <thead>
          <tr>
            <th>Truck</th>
            <th>Client</th>
            <th>Route</th>
            <th>Revenue</th>
          </tr>
        </thead>

        <tbody>
          {journeys.map((j) => (
            <tr key={j.id}>
              <td>{j.truck_text}</td>
              <td>{j.client_name}</td>
              <td>{j.from_location} → {j.to_location}</td>
              <td>{j.revenue}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
