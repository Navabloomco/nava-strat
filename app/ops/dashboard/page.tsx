"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function OpsDashboard() {
  const [fuelLogs, setFuelLogs] = useState<any[]>([]);
  const [journeys, setJourneys] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [trackingPoints, setTrackingPoints] = useState<any[]>([]);
  const [fuelDrops, setFuelDrops] = useState<any[]>([]);
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

    const { data: trackingData } = await supabase
      .from("tracking_points")
      .select("*")
      .order("recorded_at", { ascending: false });

    const { data: fuelDropData } = await supabase
      .from("fuel_drop_events")
      .select("*")
      .order("recorded_at", { ascending: false });

    setFuelLogs(fuelData || []);
    setJourneys(journeyData || []);
    setExpenses(expenseData || []);
    setTrackingPoints(trackingData || []);
    setFuelDrops(fuelDropData || []);
    setLoading(false);
  }

  function totalFuelLitersForJourney(journeyId: string) {
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

  function marginForJourney(journey: any) {
    const revenue = Number(journey.revenue || 0);
    const fuelCost = totalFuelCostForJourney(journey.id);
    const expenseTotal = totalExpensesForJourney(journey.id);
    const totalCost = fuelCost + expenseTotal;
    const margin = revenue - totalCost;
    const marginPct = revenue > 0 ? (margin / revenue) * 100 : null;

    return {
      revenue,
      fuelCost,
      expenseTotal,
      totalCost,
      margin,
      marginPct,
    };
  }

  function latestTrackingForTruck(truck: string) {
    return (
      trackingPoints.find(
        (point) =>
          (point.truck_text || "").toUpperCase() ===
          (truck || "").toUpperCase()
      ) || null
    );
  }

  function fuelDropCountForJourney(journeyId: string) {
    return fuelDrops.filter((drop) => drop.journey_id === journeyId).length;
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

        const actual = totalFuelLitersForJourney(journey.id);
        const variance = actual - expected;

        if (variance > 50) {
          return {
            ...journey,
            actual,
            expected,
            variance,
          };
        }

        return null;
      })
      .filter(Boolean);
  }, [journeys, fuelLogs]);

  const lossMakingJourneys = useMemo(() => {
    return journeys.filter((journey) => {
      const m = marginForJourney(journey);
      return m.revenue > 0 && m.margin < 0;
    });
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
      <p>Fuel, tracking, expenses, and contribution margin.</p>

      <h2>🚨 Nava Eye Alerts</h2>

      <p>Unallocated Fuel: {unallocatedFuel.length}</p>
      <p>Duplicate Fuel Events: {duplicateFuel.length}</p>
      <p>Pending Approvals: {pendingApprovals.length}</p>
      <p>Fuel Variance Issues: {varianceIssues.length}</p>
      <p>Possible Fuel Drop Events: {fuelDrops.length}</p>
      <p>Loss-Making Journeys: {lossMakingJourneys.length}</p>

      <br />

      <h3>Loss-Making Journeys</h3>

      {lossMakingJourneys.length === 0 ? (
        <p>No loss-making journeys with revenue recorded.</p>
      ) : (
        lossMakingJourneys.map((journey: any) => {
          const m = marginForJourney(journey);

          return (
            <div
              key={journey.id}
              style={{
                border: "1px solid red",
                padding: 12,
                marginBottom: 10,
              }}
            >
              <strong>
                {journey.truck} — {journey.client_name}
              </strong>
              <br />
              Route: {journey.from_location} → {journey.to_location}
              <br />
              Revenue: {m.revenue.toLocaleString()}
              <br />
              Fuel: {m.fuelCost.toLocaleString()} | Expenses:{" "}
              {m.expenseTotal.toLocaleString()}
              <br />
              <strong style={{ color: "red" }}>
                Margin: {m.margin.toLocaleString()} (
                {m.marginPct?.toFixed(1)}%)
              </strong>
            </div>
          );
        })
      )}

      <br />

      <h3>Fuel Variance</h3>

      {varianceIssues.length === 0 ? (
        <p>No major fuel variance issues.</p>
      ) : (
        varianceIssues.map((journey: any) => {
          const m = marginForJourney(journey);

          return (
            <div
              key={journey.id}
              style={{
                border: "1px solid orange",
                padding: 12,
                marginBottom: 10,
              }}
            >
              <strong>
                {journey.truck} — {journey.client_name}
              </strong>
              <br />
              Route: {journey.from_location} → {journey.to_location}
              <br />
              Expected Fuel: {journey.expected}L | Actual Fuel:{" "}
              {journey.actual}L
              <br />
              <strong style={{ color: "red" }}>
                Variance: +{journey.variance}L 🚨
              </strong>
              <br />
              Fuel Cost: {m.fuelCost.toLocaleString()}
              <br />
              Expenses: {m.expenseTotal.toLocaleString()}
              <br />
              Revenue:{" "}
              {m.revenue ? m.revenue.toLocaleString() : "Pending finance"}
              <br />
              Margin:{" "}
              {m.revenue ? m.margin.toLocaleString() : "Pending revenue"}
            </div>
          );
        })
      )}

      <br />

      <h3>Pending Fuel Approvals</h3>

      {pendingApprovals.length === 0 ? (
        <p>No pending fuel approvals.</p>
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

      <h2>Active Operations</h2>

      {Object.keys(grouped).length === 0 ? (
        <p>No active journeys.</p>
      ) : (
        Object.keys(grouped).map((client) => (
          <div key={client}>
            <h3>{client}</h3>

            {Object.keys(grouped[client]).map((route) => (
              <div key={route} style={{ marginLeft: 20, marginBottom: 16 }}>
                <strong>
                  {route} ({grouped[client][route].length} trucks)
                </strong>

                <ul>
                  {grouped[client][route].map((journey: any) => {
                    const m = marginForJourney(journey);
                    const latest = latestTrackingForTruck(journey.truck);
                    const drops = fuelDropCountForJourney(journey.id);

                    let marginLabel = "Revenue pending";
                    let marginColor = "black";

                    if (m.revenue > 0) {
                      marginLabel = `${m.margin.toLocaleString()} (${m.marginPct?.toFixed(
                        1
                      )}%)`;

                      if (m.margin < 0) marginColor = "red";
                      else if ((m.marginPct || 0) < 15) marginColor = "orange";
                      else marginColor = "green";
                    }

                    return (
                      <li key={journey.id} style={{ marginBottom: 12 }}>
                        <strong>{journey.truck}</strong> —{" "}
                        {journey.driver || "NO DRIVER"}
                        <br />
                        Location:{" "}
                        {latest
                          ? latest.interpreted_location ||
                            latest.location_text ||
                            "Location needs review"
                          : "No tracking yet"}
                        <br />
                        Status: {latest?.movement_status || "No tracking"}
                        {" | "}
                        Risk: {latest?.risk_level || "normal"}
                        <br />
                        Fuel Cost: {m.fuelCost.toLocaleString()} | Expenses:{" "}
                        {m.expenseTotal.toLocaleString()} | Revenue:{" "}
                        {m.revenue
                          ? m.revenue.toLocaleString()
                          : "Pending finance"}
                        <br />
                        Margin:{" "}
                        <strong style={{ color: marginColor }}>
                          {marginLabel}
                        </strong>
                        {drops > 0 && (
                          <>
                            <br />
                            <strong style={{ color: "red" }}>
                              Fuel drop events: {drops} 🚨
                            </strong>
                          </>
                        )}
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
