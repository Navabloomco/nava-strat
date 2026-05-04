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
    const { data: fuelData, error: fuelError } = await supabase
      .from("fuel_logs")
      .select("*")
      .order("created_at", { ascending: false });

    if (fuelError) {
      alert(fuelError.message);
      return;
    }

    const { data: journeyData, error: journeyError } = await supabase
      .from("journeys")
      .select("*");

    if (journeyError) {
      alert(journeyError.message);
      return;
    }

    setFuelLogs(fuelData || []);
    setJourneys(journeyData || []);
  }

  function findJourney(journeyId: string | null) {
    if (!journeyId) return null;
    return journeys.find((j) => j.id === journeyId) || null;
  }

  function isDuplicateFuel(fuel: any) {
    return fuelLogs.filter((f) => {
      const sameTruck = f.truck_text === fuel.truck_text;
      const sameLiters = f.liters === fuel.liters;

      const timeDiff =
        Math.abs(
          new Date(f.created_at).getTime() -
            new Date(fuel.created_at).getTime()
        ) < 1000 * 60 * 60;

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
            <th>Approval</th>
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

                <td
                  style={{
                    color: fuel.journey_id ? "green" : "red",
                    fontWeight: "bold",
                  }}
                >
                  {fuel.journey_id ? "Allocated" : "UNALLOCATED ⚠️"}
                </td>

                <td>
                  {fuel.approved_extra_fuel
                    ? `Approved: ${fuel.approval_reason || "No reason"}`
                    : duplicate
                    ? "Duplicate risk ⚠️"
                    : "—"}
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
