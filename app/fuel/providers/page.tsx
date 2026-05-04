"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function FuelProvidersPage() {
  const [providers, setProviders] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [price, setPrice] = useState("");

  useEffect(() => {
    loadProviders();
  }, []);

  async function loadProviders() {
    const { data, error } = await supabase
      .from("fuel_providers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      alert(error.message);
      return;
    }

    setProviders(data || []);
  }

  async function handleSubmit(e: any) {
    e.preventDefault();

    const { error } = await supabase.from("fuel_providers").insert([
      {
        name,
        location,
        current_price_per_liter: price ? Number(price) : null,
        is_active: true,
      },
    ]);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Fuel provider saved ✅");
    setName("");
    setLocation("");
    setPrice("");
    loadProviders();
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Fuel Providers</h1>
      <p>Save stations/providers and their current fuel prices.</p>

      <form onSubmit={handleSubmit}>
        <input
          placeholder="Provider name e.g. Shell Bonje"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <br /><br />

        <input
          placeholder="Location e.g. Bonje, Mombasa"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="Current price per liter e.g. 197"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />

        <br /><br />

        <button type="submit">Save Provider</button>
      </form>

      <br /><br />

      <h2>Saved Providers</h2>

      {providers.length === 0 ? (
        <p>No providers saved yet.</p>
      ) : (
        <table border={1} cellPadding={10}>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Location</th>
              <th>Current Price/Liter</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>

          <tbody>
            {providers.map((provider) => (
              <tr key={provider.id}>
                <td>{provider.name || "—"}</td>
                <td>{provider.location || "—"}</td>
                <td>
                  {provider.current_price_per_liter
                    ? Number(provider.current_price_per_liter).toLocaleString()
                    : "—"}
                </td>
                <td>{provider.is_active ? "Active" : "Inactive"}</td>
                <td>
                  {provider.created_at
                    ? new Date(provider.created_at).toLocaleString()
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
