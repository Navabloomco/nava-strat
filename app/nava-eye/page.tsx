"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabase";

export default function NavaEyeChatPage() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);

  function isToday(dateString: string) {
    const d = new Date(dateString);
    const now = new Date();

    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  }

  function formatJourney(journey: any) {
    if (!journey) return "No journey linked";

    return `${journey.client_name || "NO CLIENT"} — ${
      journey.from_location || "—"
    } → ${journey.to_location || "—"}`;
  }

  async function askNavaEye(e: any) {
    e.preventDefault();
    setLoading(true);
    setAnswer("");

    const q = question.toLowerCase();

    const { data: fuelLogs } = await supabase
      .from("fuel_logs")
      .select("*")
      .order("created_at", { ascending: false });

    const { data: journeys } = await supabase
      .from("journeys")
      .select("*")
      .order("created_at", { ascending: false });

    const { data: trackingPoints } = await supabase
      .from("tracking_points")
      .select("*")
      .order("recorded_at", { ascending: false });

    const { data: expenses } = await supabase
      .from("expenses")
      .select("*")
      .order("created_at", { ascending: false });

    const fuel = fuelLogs || [];
    const trips = journeys || [];
    const tracking = trackingPoints || [];
    const costs = expenses || [];

    const latestTrackingByTruck: Record<string, any> = {};

    tracking.forEach((p) => {
      if (!latestTrackingByTruck[p.truck_text]) {
        latestTrackingByTruck[p.truck_text] = p;
      }
    });

    function findJourney(id: string | null) {
      if (!id) return null;
      return trips.find((j) => j.id === id) || null;
    }

    function findActiveJourneyByTruck(truck: string) {
      return (
        trips.find(
          (j) =>
            (j.truck || "").toUpperCase() === truck.toUpperCase() &&
            j.status === "active"
        ) || null
      );
    }

    // 1. Fuel today
    if (
      q.includes("fuel") &&
      q.includes("today") &&
      (q.includes("how many") || q.includes("where"))
    ) {
      const todaysFuel = fuel.filter((f) => isToday(f.created_at));
      const uniqueTrucks = Array.from(
        new Set(todaysFuel.map((f) => f.truck_text).filter(Boolean))
      );

      if (todaysFuel.length === 0) {
        setAnswer("No fuel entries have been recorded today.");
        setLoading(false);
        return;
      }

      let response = `${uniqueTrucks.length} truck(s) were fueled today.\n\n`;

      uniqueTrucks.forEach((truck) => {
        const truckFuel = todaysFuel.filter((f) => f.truck_text === truck);
        const totalLiters = truckFuel.reduce(
          (sum, f) => sum + Number(f.liters || 0),
          0
        );

        const linkedJourney =
          findJourney(truckFuel[0]?.journey_id) || findActiveJourneyByTruck(truck);

        response += `• ${truck}: ${totalLiters}L\n`;
        response += `  Going: ${formatJourney(linkedJourney)}\n`;

        const latest = latestTrackingByTruck[truck];
        if (latest) {
          response += `  Last seen: ${
            latest.interpreted_location || latest.location_text || "Location needs review"
          }\n`;
        }

        const unallocated = truckFuel.filter((f) => !f.journey_id).length;
        if (unallocated > 0) {
          response += `  ⚠️ ${unallocated} unallocated fuel entry/entries.\n`;
        }

        response += "\n";
      });

      setAnswer(response);
      setLoading(false);
      return;
    }

    // 2. Where is truck
    if (q.includes("where") && q.includes("truck")) {
      const words = question.toUpperCase().split(/\s+/);
      const possibleTruck = words.find((w) => /^[A-Z]{3}\d{3}[A-Z]?$/.test(w));

      if (!possibleTruck) {
        setAnswer("Tell me the truck registration, e.g. “Where is KBJ123A?”");
        setLoading(false);
        return;
      }

      const latest = latestTrackingByTruck[possibleTruck];

      if (!latest) {
        setAnswer(`I do not have recent tracking data for ${possibleTruck}.`);
        setLoading(false);
        return;
      }

      const journey =
        findJourney(latest.journey_id) || findActiveJourneyByTruck(possibleTruck);

      setAnswer(
        `${possibleTruck} is ${
          latest.movement_status || "UNKNOWN"
        } at ${
          latest.interpreted_location || latest.location_text || "Location needs review"
        }.\n\nJourney: ${formatJourney(journey)}\nSpeed: ${
          latest.speed ?? "unknown"
        } km/h\nFuel: ${latest.fuel_level ?? "unknown"}\nIgnition: ${
          latest.ignition_status || "unknown"
        }\nRisk: ${latest.risk_level || "normal"}`
      );

      setLoading(false);
      return;
    }

    // 3. Problems / alerts
    if (
      q.includes("problem") ||
      q.includes("issue") ||
      q.includes("alert") ||
      q.includes("risk")
    ) {
      const unallocatedFuel = fuel.filter((f) => !f.journey_id);

      const riskyTracking = Object.values(latestTrackingByTruck).filter(
        (p: any) => p.risk_level && p.risk_level !== "normal"
      );

      let response = "";

      response += `Fuel issues:\n`;
      response += `• Unallocated fuel entries: ${unallocatedFuel.length}\n\n`;

      response += `Tracking risks:\n`;

      if (riskyTracking.length === 0) {
        response += `• No major tracking risks currently.\n`;
      } else {
        riskyTracking.forEach((p: any) => {
          response += `• ${p.truck_text}: ${
            p.nava_eye_summary || "Review required"
          }\n`;
        });
      }

      setAnswer(response);
      setLoading(false);
      return;
    }

    // 4. Active trips
    if (q.includes("active") || q.includes("trips") || q.includes("journeys")) {
      const activeTrips = trips.filter((j) => j.status === "active");

      if (activeTrips.length === 0) {
        setAnswer("There are no active journeys right now.");
        setLoading(false);
        return;
      }

      const grouped: Record<string, any[]> = {};

      activeTrips.forEach((j) => {
        const client = j.client_name || "NO CLIENT";
        if (!grouped[client]) grouped[client] = [];
        grouped[client].push(j);
      });

      let response = `${activeTrips.length} active journey/journeys found.\n\n`;

      Object.keys(grouped).forEach((client) => {
        response += `${client}\n`;

        grouped[client].forEach((j) => {
          const latest = latestTrackingByTruck[j.truck];

          response += `• ${j.truck} — ${j.from_location} → ${j.to_location}`;

          if (latest) {
            response += ` — ${latest.interpreted_location || "Location needs review"}`;
          }

          response += "\n";
        });

        response += "\n";
      });

      setAnswer(response);
      setLoading(false);
      return;
    }

    // 5. Expenses today
    if (q.includes("expense") || q.includes("cost")) {
      const todaysExpenses = costs.filter((e) => isToday(e.created_at));
      const total = todaysExpenses.reduce(
        (sum, e) => sum + Number(e.amount || 0),
        0
      );

      let response = `Today's recorded expenses: ${todaysExpenses.length}\nTotal: ${total.toLocaleString()}\n\n`;

      todaysExpenses.forEach((e) => {
        const journey = findJourney(e.journey_id);

        response += `• ${e.truck || "NO TRUCK"} — ${
          e.expense_type || "expense"
        } — ${Number(e.amount || 0).toLocaleString()}\n`;
        response += `  Journey: ${formatJourney(journey)}\n`;
        response += `  Reference: ${e.reference_number || "missing"}\n\n`;
      });

      setAnswer(response);
      setLoading(false);
      return;
    }

    // fallback
    setAnswer(
      `I can answer questions like:\n\n` +
        `• How many trucks were fueled today and where were they going?\n` +
        `• Where is truck KBJ123A?\n` +
        `• What problems do we have?\n` +
        `• Show active trips\n` +
        `• What expenses were recorded today?\n\n` +
        `Ask me one of those and I’ll inspect the system.`
    );

    setLoading(false);
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Nava Eye Chat</h1>
      <p>Ask Nava Eye about fuel, trips, tracking, risks, and expenses.</p>

      <form onSubmit={askNavaEye}>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask: How many trucks were fueled today and where were they going?"
          style={{ width: "100%", height: 120 }}
        />

        <br />
        <br />

        <button type="submit" disabled={loading}>
          {loading ? "Thinking..." : "Ask Nava Eye"}
        </button>
      </form>

      <br />

      {answer && (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            background: "#f4f4f4",
            padding: 20,
            borderRadius: 8,
          }}
        >
          {answer}
        </pre>
      )}
    </main>
  );
}
