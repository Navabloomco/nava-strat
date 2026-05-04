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
    if (point.location_area && point.location_city) {
      return `${point.location_area}, ${point.location_city}`;
    }

    if (point.location_city) {
      return point.location_city;
    }

    if (
      point.interpreted_location &&
      !point.interpreted_location.toLowerCase().includes("unknown")
    ) {
      return point.interpreted_location;
    }

    if (point.location_text) {
      return point.location_text;
    }

    return "Location needs review";
  }

  function smartSummary(point: any) {
    const location = readableLocation(point);
    const status = point.movement_status || "UNKNOWN";
    const speed = point.speed ?? "unknown";
    const fuel = point.fuel_level ?? "unknown";

    let alert = "";

    if (point.risk_level === "medium") {
      alert = "⚠️ Review required.";
    }

    if (Number(point.fuel_level) < 15) {
      alert = "⛽ Low fuel risk.";
    }

    return `${point.truck_text} is ${status.toLowerCase()} at ${location}. Speed: ${speed} km/h. Fuel: ${fuel}. ${alert}`;
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Live Tracking — Nava Eye</h1>
      <p>Human-readable fleet intelligence. No lazy “near” everywhere.</p>

      {points.length === 0 ? (
        <p>No tracking data yet.</p>
      ) : (
        <table border={1} cellPadding={10}>
          <thead>
            <tr>
              <th>Truck</th>
              <th>Status</th>
              <th>Location</th>
              <th>City / Region</th>
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

                <td>
                  {point.location_city || "—"}
                  {point.location_region ? ` / ${point.location_region}` : ""}
                </td>

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

                <td>{smartSummary(point)}</td>

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
