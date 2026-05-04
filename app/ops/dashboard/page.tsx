"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function OpsDashboard() {
  const [fuelLogs, setFuelLogs] = useState<any[]>([]);
  const [journeys, setJourneys] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
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

    const { data: expenseData } = await supabase
      .from("expenses")
      .select("*")
      .order("created_at", { ascending: false });

    setFuelLogs(fuelData || []);
    setJourneys(journeyData || []);
    setExpenses(expenseData || []);
    setLoading(false);
  }

  function totalFuelForJourney(journeyId: string) {
    return fuelLogs
      .filter((fuel) => fuel.journey_id === journeyId)
      .reduce((sum, fuel) => sum + Number(fuel.liters || 0), 0);
  }

  function totalFuelCostForJourney(journeyId: string) {
    return fuelLogs
      .filter((fuel) => fuel.journey_id === journeyId)
      .reduce((sum, fuel) => sum + Number(fuel.total_cost || 0), 0);
  }

  function totalExpensesForJourney(journeyId: string) {
    return expenses
      .filter((expense) => expense.journey_id === journeyId)
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  }

  function isDuplicateFuel(fuel: any) {
    return (
      fuelLogs.filter((otherFuel) => {
        const sameTruck = otherFuel.truck_text === fuel.truck_text;
        const sameLiters = otherFuel.liters === fuel.liters;

        const timeDiff =
          Math.abs(
            new Date(otherFuel.created_at).getTime() -
              new Date(fuel.created_at).getTime()
          ) < 1000 * 60 * 60;

        return sameTruck && sameLiters && timeDiff;
      }).length > 1
    );
  }

  const unallocatedFuel = useMemo(
    () => fuelLogs.filter((fuel) => !fuel.journey_id),
    [fuelLogs]
  );

  const duplicateFuel = useMemo(
    () => fuelLogs.filter((fuel) => isDuplicateFuel(fuel)),
    [fuelLogs]
  );

  const pendingApprovals = useMemo(
    () =>
      fuelLogs.filter(
        (fuel) =>
          fuel.approval_required === true &&
          fuel.request_status !== "approved"
      ),
    [fuelLogs]
  );

  const varianceIssues = useMemo(() => {
    return journeys
      .map((journey) => {
        const expected = Number(journey.expected_fuel_liters || 0);
        if (!expected) return null;

        const actual = totalFuelForJourney(journey.id);
        const variance = actual - expected;

        if (variance > 50) {
          return {
            ...journey,
            actual,
            expected,
            variance,
            fuelCost: totalFuelCostForJourney(journey.id),
            expenseTotal: totalExpensesForJourney(journey.id),
          };
        }

        return null;
      })
      .filter(Boolean);
  }, [journeys, fuelLogs, expenses]);

  const grouped = useMemo(() => {
    const map: any = {};

    journeys
      .filter((journey) => journey.status === "active")
      .forEach((journey) => {
        const client = journey.client_name || "NO CLIENT";
        const route = `${journey.from_location || "—"} → ${
          journey.to_location || "—"
        }`;

        if (!map[client]) map[client] = {};
        if (!map[client][route]) map[client][route] = [];

        map[client][route].push(journey);
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

  if (loading) {
    return <main style={{ padding: 40 }}>Loading...</main>;
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Ops Command Center</h1>

      <h2>🚨 Alerts</h2>

      <p>Unallocated Fuel: {unallocatedFuel.length}</p>
      <p>Duplicate Fuel Events: {duplicateFuel.length}</p>
      <p>Pending Approvals: {pendingApprovals.length}</p>
      <p>Fuel Variance Issues: {varianceIssues.length}</p>

      <br />

      <h3>Pending Approvals</h3>

      {pendingApprovals.length === 0 ? (
        <p>No pending approvals.</p>
      ) : (
        pendingApprovals.map((fuel) => (
          <div
            key={fuel.id}
            style={{
              border: "1px solid red",
              padding: 10,
              marginBottom: 10,
            }}
          >
            <strong>{fuel.truck_text}</strong> — {fuel.liters}L
            <br />
            Reason: {fuel.approval_reason || "No reason entered"}
            <br />
            <button onClick={() => approveFuel(fuel.id)}>Approve</button>
          </div>
        ))
      )}

      <br />

      <h3>Fuel Variance</h3>

      {varianceIssues.length === 0 ? (
        <p>No major fuel variance issues.</p>
      ) : (
        varianceIssues.map((journey: any) => (
          <div
            key={journey.id}
            style={{
              border: "1px solid orange",
              padding: 10,
              marginBottom: 10,
            }}
          >
            <strong>
              {journey.truck} — {journey.client_name}
            </strong>
            <br />
            Route: {journey.from_location} → {journey.to_location}
            <br />
            Expected Fuel: {journey.expected}L | Actual Fuel: {journey.actual}L
            <br />
            <strong style={{ color: "red" }}>
              Variance: +{journey.variance}L 🚨
            </strong>
            <br />
            Fuel Cost: {Number(journey.fuelCost || 0).toLocaleString()}
            <br />
            Expenses: {Number(journey.expenseTotal || 0).toLocaleString()}
          </div>
        ))
      )}

      <br />

      <h2>Active Operations</h2>

      {Object.keys(grouped).length === 0 ? (
        <p>No active journeys.</p>
      ) : (
        Object.keys(grouped).map((client) => (
          <div key={client}>
            <h3>{client}</h3>

            {Object.keys(grouped[client]).map((route) => (
              <div key={route} style={{ marginLeft: 20 }}>
                <strong>
                  {route} ({grouped[client][route].length} trucks)
                </strong>

                <ul>
                  {grouped[client][route].map((journey: any) => {
                    const fuelCost = totalFuelCostForJourney(journey.id);
                    const expenseTotal = totalExpensesForJourney(journey.id);

                    return (
                      <li key={journey.id}>
                        {journey.truck} — {journey.driver || "NO DRIVER"} | Fuel
                        Cost: {fuelCost.toLocaleString()} | Expenses:{" "}
                        {expenseTotal.toLocaleString()}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ))
      )}
    </main>
  );
}
