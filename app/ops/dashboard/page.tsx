"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function OpsDashboard() {
  const [fuelLogs, setFuelLogs] = useState<any[]>([]);
  const [journeys, setJourneys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);

    const { data: fuelData } = await supabase
      .from("fuel_logs")
      .select("*")
      .order("created_at", { ascending: false });

    const { data: journeyData } = await supabase
      .from("journeys")
      .select("*")
      .order("created_at", { ascending: false });

    setFuelLogs(fuelData || []);
    setJourneys(journeyData || []);
    setLoading(false);
  }

  function totalFuelForJourney(journeyId: string) {
    return fuelLogs
      .filter((f) => f.journey_id === journeyId)
      .reduce((sum, f) => sum + Number(f.liters || 0), 0);
  }

  // 🔴 Unallocated fuel
  const unallocatedFuel = useMemo(
    () => fuelLogs.filter((f) => !f.journey_id),
    [fuelLogs]
  );

  // 🔴 Duplicate fuel (same truck + liters within 1 hour)
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

  const duplicateFuel = useMemo(
    () => fuelLogs.filter((f) => isDuplicateFuel(f)),
    [fuelLogs]
  );

  // 🔴 Needs approval (requested but not approved)
  const pendingApprovals = useMemo(
    () =>
      fuelLogs.filter(
        (f) =>
          f.approval_required === true &&
          f.request_status !== "approved"
      ),
    [fuelLogs]
  );

  // 🔴 Variance (expected vs actual)
  const varianceIssues = useMemo(() => {
    return journeys
      .map((j) => {
        const expected = Number(j.expected_fuel_liters || 0);
        if (!expected) return null;

        const actual = totalFuelForJourney(j.id);
        const variance = actual - expected;

        if (variance > 50) {
          return {
            ...j,
            actual,
            expected,
            variance,
          };
        }

        return null;
      })
      .filter(Boolean);
  }, [journeys, fuelLogs]);

  // 🟢 Group: Client → Route → Trucks
  const grouped = useMemo(() => {
    const map: any = {};

    journeys
      .filter((j) => j.status === "active")
      .forEach((j) => {
        const client = j.client_name || "No client";
        const route = `${j.from_location || "—"} → ${j.to_location || "—"}`;

        if (!map[client]) map[client] = {};
        if (!map[client][route]) map[client][route] = [];

        map[client][route].push(j);
      });

    return map;
  }, [journeys]);

  async function approveFuel(id: string) {
    await supabase
      .from("fuel_logs")
      .update({
        request_status: "approved",
        approved_extra_fuel: true,
      })
      .eq("id", id);

    load();
  }

  if (loading) return <main style={{ padding: 40 }}>Loading...</main>;

  return (
    <main style={{ padding: 40 }}>
      <h1>Ops Command Center</h1>

      {/* 🚨 ALERTS */}
      <h2>🚨 Alerts</h2>

      <p>Unallocated Fuel: {unallocatedFuel.length}</p>
      <p>Duplicate Fuel Events: {duplicateFuel.length}</p>
      <p>Pending Approvals: {pendingApprovals.length}</p>
      <p>Fuel Variance Issues: {varianceIssues.length}</p>

      <br />

      {/* 🔴 Pending Approvals */}
      <h3>Pending Approvals</h3>
      {pendingApprovals.map((f) => (
        <div key={f.id} style={{ border: "1px solid red", padding: 10 }}>
          {f.truck_text} — {f.liters}L
          <button onClick={() => approveFuel(f.id)}>
            Approve
          </button>
        </div>
      ))}

      <br />

      {/* 🔴 Variance */}
      <h3>Fuel Variance</h3>
      {varianceIssues.map((j: any) => (
        <div key={j.id} style={{ border: "1px solid orange", padding: 10 }}>
          {j.truck} — {j.client_name}
          <br />
          Expected: {j.expected}L | Actual: {j.actual}L
          <br />
          <b style={{ color: "red" }}>
            +{j.variance}L 🚨
          </b>
        </div>
      ))}

      <br />

      {/* 🟢 ACTIVE OPS */}
      <h2>Active Operations</h2>

      {Object.keys(grouped).map((client) => (
        <div key={client}>
          <h3>{client}</h3>

          {Object.keys(grouped[client]).map((route) => (
            <div key={route} style={{ marginLeft: 20 }}>
              <b>
                {route} ({grouped[client][route].length} trucks)
              </b>

              <ul>
                {grouped[client][route].map((j: any) => (
                  <li key={j.id}>
                    {j.truck} — {j.driver || "No driver"}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </main>
  );
}
