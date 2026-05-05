"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function GeofencesPage() {
  const [data, setData] = useState<any[]>([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data, error } = await supabase
      .from("geofences")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return;

    setData(data || []);
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Geofences</h1>

      {data.length === 0 ? (
        <p>No geofences yet.</p>
      ) : (
        <table border={1} cellPadding={10}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Radius (m)</th>
              <th>Lat</th>
              <th>Lng</th>
            </tr>
          </thead>

          <tbody>
            {data.map((g) => (
              <tr key={g.id}>
                <td>{g.name}</td>
                <td>{g.type}</td>
                <td>{g.radius_meters}</td>
                <td>{g.latitude}</td>
                <td>{g.longitude}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
