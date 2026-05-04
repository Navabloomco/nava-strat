"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function Dashboard() {
  const [fuelLogs, setFuelLogs] = useState<any[]>([]);

  async function fetchFuel() {
    const { data, error } = await supabase
      .from("fuel_logs")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
    } else {
      setFuelLogs(data || []);
    }
  }

  useEffect(() => {
    fetchFuel();
  }, []);

  return (
    <main style={{ padding: 40 }}>
      <h1>Fuel Logs</h1>

      {fuelLogs.length === 0 ? (
        <p>No fuel logs yet</p>
      ) : (
        <table border={1} cellPadding={10}>
          <thead>
            <tr>
              <th>Truck</th>
              <th>Liters</th>
              <th>Vendor</th>
              <th>Notes</th>
              <th>Date</th>
            </tr>
          </thead>

          <tbody>
            {fuelLogs.map((log) => (
              <tr key={log.id}>
                <td>{log.truck_text}</td>
                <td>{log.liters}</td>
                <td>{log.vendor}</td>
                <td>{log.notes}</td>
                <td>{new Date(log.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
