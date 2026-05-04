"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function LiveTrackingPage() {
  const [points, setPoints] = useState<any[]>([]);

  useEffect(() => {
    loadData();

    const interval = setInterval(loadData, 10000); // refresh every 10s
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    const { data, error } = await supabase
      .from("tracking_points")
      .select("*")
      .order("recorded_at", { ascending: false });

    if (error) {
      console.error(error);
      return;
    }

    // keep latest record per truck
    const latest: Record<string, any> = {};

    (data || []).forEach((row) => {
      if (!latest[row.truck_text]) {
        latest[row.truck_text] = row;
      }
    });

    setPoints(Object.values(latest));
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Live Tracking — Nava Eye</h1>
      <p>Real-time fleet intelligence. No GPS system needed.</p>

      {points.length === 0 ? (
        <p>No tracking data yet.</p>
      ) : (
        <table border={1} cellPadding={10}>
          <thead>
            <tr>
              <th>Truck</th>
              <th>Status</th>
              <th>Location</th>
              <th>Speed</th>
              <th>Fuel</th>
              <th>Risk</th>
              <th>Summary</th>
              <th>Last Update</th>
            </tr>
          </thead>

          <tbody>
            {points.map((p) => (
              <tr key={p.id}>
                <td>{p.truck_text}</td>

                <td>
                  <b>{p.movement_status}</b>
                </td>

                <td>{p.interpreted_location}</td>

                <td>{p.speed ?? "-"}</td>

                <td>{p.fuel_level ?? "-"}</td>

                <td
                  style={{
                    color:
                      p.risk_level === "high"
                        ? "red"
                        : p.risk_level === "medium"
                        ? "orange"
                        : "green",
                  }}
                >
                  {p.risk_level}
                </td>

                <td>{p.nava_eye_summary}</td>

                <td>
                  {p.recorded_at
                    ? new Date(p.recorded_at).toLocaleString()
                    : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
