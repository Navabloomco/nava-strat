"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function FuelControlPage() {
  const [fuelLogs, setFuelLogs] = useState<any[]>([]);
  const [journeys, setJourneys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorDetail, setErrorDetail] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setErrorDetail("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return;
    }

    const res = await fetch("/api/fuel", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setErrorDetail(json.error || "Failed to load fuel data");
      setLoading(false);
      return;
    }

    setFuelLogs(json.fuel_logs || []);
    setJourneys(json.journeys || []);
    setLoading(false);
  }

  function findJourney(journeyId: string | null) {
    if (!journeyId) return null;
    return journeys.find((j) => j.id === journeyId) || null;
  }

  function isDuplicateFuel(fuel: any) {
    return (
      fuelLogs.filter((f) => {
        const sameTruck = f.truck_text === fuel.truck_text;
        const sameLiters = f.liters === fuel.liters;

        const timeDiff =
          Math.abs(
            new Date(f.created_at).getTime() -
              new Date(fuel.created_at).getTime()
          ) < 1000 * 60 * 60;

        return sameTruck && sameLiters && timeDiff;
      }).length > 1
    );
  }

  function totalFuelForJourney(journeyId: string) {
    return fuelLogs
      .filter((f) => f.journey_id === journeyId)
      .reduce((sum, f) => sum + Number(f.liters || 0), 0);
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Fuel Control</h1>
      <p>
        Allocated vs unallocated fuel, duplicate detection, and optional
        expected fuel variance.
      </p>

      <br />

      {loading ? (
        <p>Loading fuel data...</p>
      ) : errorDetail ? (
        <p style={{ color: "red" }}>{errorDetail}</p>
      ) : (
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
            <th>Fuel Variance</th>
            <th>Approval</th>
            <th>Notes</th>
            <th>Date</th>
          </tr>
        </thead>

        <tbody>
          {fuelLogs.map((fuel) => {
            const journey = findJourney(fuel.journey_id);
            const duplicate = isDuplicateFuel(fuel);

            const journeyFuel = journey ? totalFuelForJourney(journey.id) : 0;
            const expected =
              journey && journey.expected_fuel_liters !== null
                ? Number(journey.expected_fuel_liters)
                : null;

            const variance =
              expected !== null ? journeyFuel - expected : null;

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
                  {variance !== null ? (
                    <span
                      style={{
                        color: variance > 0 ? "red" : "green",
                        fontWeight: "bold",
                      }}
                    >
                      {variance > 0 ? `+${variance}L 🚨` : `${variance}L`}
                    </span>
                  ) : (
                    "—"
                  )}
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
      )}
    </main>
  );
}
