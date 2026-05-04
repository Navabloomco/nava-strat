"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../../lib/supabase";

export default function JourneyTemplatesPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [client, setClient] = useState("");
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [expectedFuel, setExpectedFuel] = useState("");

  useEffect(() => {
    loadTemplates();
  }, []);

  async function loadTemplates() {
    const { data, error } = await supabase
      .from("journey_templates")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      alert(error.message);
      return;
    }

    setTemplates(data || []);
  }

  async function saveTemplate(e: any) {
    e.preventDefault();

    const { error } = await supabase.from("journey_templates").insert([
      {
        client_name: client.trim().toUpperCase(),
        from_location: fromLocation.trim().toUpperCase(),
        to_location: toLocation.trim().toUpperCase(),
        expected_fuel_liters: expectedFuel ? Number(expectedFuel) : null,
      },
    ]);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Template saved ✅");

    setClient("");
    setFromLocation("");
    setToLocation("");
    setExpectedFuel("");
    loadTemplates();
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Journey Templates</h1>
      <p>Save frequent client routes so trips are created faster.</p>

      <form onSubmit={saveTemplate}>
        <input
          placeholder="Client e.g. ENGAANO"
          value={client}
          onChange={(e) => setClient(e.target.value.toUpperCase())}
          required
        />

        <br /><br />

        <input
          placeholder="From e.g. MOMBASA"
          value={fromLocation}
          onChange={(e) => setFromLocation(e.target.value.toUpperCase())}
          required
        />

        <br /><br />

        <input
          placeholder="To e.g. JINJA"
          value={toLocation}
          onChange={(e) => setToLocation(e.target.value.toUpperCase())}
          required
        />

        <br /><br />

        <input
          placeholder="Expected fuel optional e.g. 480"
          value={expectedFuel}
          onChange={(e) => setExpectedFuel(e.target.value)}
        />

        <br /><br />

        <button type="submit">Save Template</button>
      </form>

      <br /><br />

      <h2>Saved Templates</h2>

      <table border={1} cellPadding={10}>
        <thead>
          <tr>
            <th>Client</th>
            <th>Route</th>
            <th>Expected Fuel</th>
          </tr>
        </thead>

        <tbody>
          {templates.map((t) => (
            <tr key={t.id}>
              <td>{t.client_name}</td>
              <td>{t.from_location} → {t.to_location}</td>
              <td>{t.expected_fuel_liters || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
