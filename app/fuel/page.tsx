"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function FuelControlPage() {
  const [fuelLogs, setFuelLogs] = useState<any[]>([]);
  const [journeys, setJourneys] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const { data: fuelData } = await supabase
      .from("fuel_logs")
      .select("*")
      .order("created_at", { ascending: false });

    const { data: journeyData } = await supabase
      .from("journeys")
      .select("*");

    setFuelLogs(fuelData || []);
    setJourneys(journeyData || []);
  }

  function findJourney(journeyId: string | null) {
    if (!journeyId) return null;
    return journeys.find((j) => j.id === journeyId) || null;
  }

  // 🔥 Detect duplicate fueling (same truck + same liters within 1 hour)
  function isDuplicateFuel(fuel: any) {
    return fuelLogs.filter((f) => {
      const sameTruck = f.truck_text === fuel.truck_text;
      const sameLiters = f.liters === fuel.liters;

      const timeDiff =
        Math.abs(
          new Date(f.created_at).getTime() -
            new Date(fuel.created_at).getTime()
        ) < 1000 * 60 * 60; // 1 hour

      return sameTruck && sameLiters && timeDiff;
    }).length > 1;
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Fuel Control</h1>
      <p>Allocated vs unallocated fuel + duplicate detection.</p>

      <br />

      <table border={1} cellPadding={10}>
        <thead>
          <tr>
            <th>Truck</th>
            <th>Liters</th>
            <th>Cost</th>
            <th>Fuel Provider</th>
            <th>Client</th>
            <th>Route</th>
            <th>Status</th>
            <th>Notes</th>
            <th>Date</th>
          </tr>
        </thead>

        <tbody>
          {fuelLogs.map((fuel) => {
            const journey = findJourney(fuel.journey_id);
            const duplicate = isDuplicateFuel(fuel);

            return (
              <tr
                key={fuel.id}
                style={{
                  backgroundColor: duplicate ? "#ffcccc" : "white",
                }}
              >
                <td>{fuel.truck_text || "—"}</td>

                <td>{fuel.liters || "—"}</td>

                <td>
                  {fuel.total_cost
                    ? Number(fuel.total_cost).toLocaleString()
                    : "—"}
                </td>

                <td>{fuel.vendor || "—"}</td>

                <td>{journey ? journey.client_name || "—" : "—"}</td>

                <td>
                  {journey
                    ? `${journey.from_location || "—"} → ${
                        journey.to_location || "—"
                      }`
                    : "—"}
                </td>

                {/* 🔥 Allocated vs Unallocated */}
                <td
                  style={{
                    color: fuel.journey_id ? "green" : "red",
                    fontWeight: "bold",
                  }}
                >
                  {fuel.journey_id ? "Allocated" : "UNALLOCATED ⚠️"}
                </td>

                <td>{fuel.notes || "—"}</td>

                <td>
                  {fuel.created_at
                    ? new Date(fuel.created_at).toLocaleString()
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
