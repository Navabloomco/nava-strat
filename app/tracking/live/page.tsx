"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function LiveTrackingPage() {
  const [points, setPoints] = useState<any[]>([]);

  useEffect(() => {
    loadData();

    const interval = setInterval(loadData, 10000);
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

    const latest: Record<string, any> = {};

    (data || []).forEach((row) => {
      if (!latest[row.truck_text]) {
        latest[row.truck_text] = row;
      }
    });

    setPoints(Object.values(latest));
  }

  function readableLocation(point: any) {
    if (point.nearest_town) {
      return `Near ${point.nearest_town}`;
    }

    if (point.interpreted_location) {
      return point.interpreted_location;
    }

    if (point.location_text) {
      return point.location_text;
    }

    return "Unknown location";
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Live Tracking — Nava Eye</h1>
      <p>Human-readable fleet intelligence. No raw GPS nonsense.</p>

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
              <th>Nava Eye Summary</th>
              <th>Last Update</th>
            </tr>
          </thead>

          <tbody>
            {points.map((point) => (
              <tr key={point.id}>
                <td>{point.truck_text}</td>

                <td>
                  <strong>{point.movement_status || "UNKNOWN"}</strong>
                </td>

                <td>{readableLocation(point)}</td>

                <td>{point.speed ?? "—"}</td>

                <td>{point.fuel_level ?? "—"}</td>

                <td
                  style={{
                    color:
                      point.risk_level === "high"
                        ? "red"
                        : point.risk_level === "medium"
                        ? "orange"
                        : "green",
                    fontWeight: "bold",
                  }}
                >
                  {point.risk_level || "normal"}
                </td>

                <td>{point.nava_eye_summary || "—"}</td>

                <td>
                  {point.recorded_at
                    ? new Date(point.recorded_at).toLocaleString()
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
