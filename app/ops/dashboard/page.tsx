"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function Dashboard() {
  const [fuelLogs, setFuelLogs] = useState<any[]>([]);

  useEffect(() => {
    fetchFuel();
  }, []);

  const fetchFuel = async () => {
    const { data, error } = await supabase
      .from("fuel_logs")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
    } else {
      setFuelLogs(data || []);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>Ops Dashboard</h1>

      {fuelLogs.map((f, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          {f.truck} — {f.litres}L — {f.vendor}
        </div>
      ))}
    </div>
  );
}
