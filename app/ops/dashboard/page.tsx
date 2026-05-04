"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function OpsDashboard() {
  const [fuelLogs, setFuelLogs] = useState<any[]>([]);

  useEffect(() => {
    fetchFuelLogs();
  }, []);

  async function fetchFuelLogs() {
    const { data, error } = await supabase
      .from("fuel_logs")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      alert("Error loading fuel logs");
      return;
    }

    setFuelLogs(data || []);
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Ops Dashboard</h1>
      <p>Fuel entries and operational alerts will appear here.</p>

      <h2>Recent Fuel Logs</h2>

      {fuelLogs.length === 0 ? (
        <p>No fuel logs yet.</p>
      ) : (
        fuelLogs.map((fuel) => (
          <div
            key={fuel.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: 12,
              marginBottom: 10,
            }}
          >
            <strong>Truck:</strong> {fuel.truck || fuel.asset_id || "Unknown"}
            <br />
            <strong>Litres:</strong> {fuel.litres || "Not entered"}
            <br />
            <strong>Vendor:</strong> {fuel.vendor || "Not entered"}
            <br />
            <strong>Status:</strong>{" "}
            {fuel.allocation_status || "unallocated"}
          </div>
        ))
      )}
    </main>
  );
}
