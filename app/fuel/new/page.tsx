"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function NewFuelPage() {
  const [journeys, setJourneys] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const [client, setClient] = useState("");
  const [truck, setTruck] = useState("");
  const [liters, setLiters] = useState("");
  const [pricePerLiter, setPricePerLiter] = useState("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [journeyId, setJourneyId] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");

  const [approved, setApproved] = useState(false);
  const [approvalReason, setApprovalReason] = useState("");

  useEffect(() => {
    loadFuelData();
  }, []);

  async function loadFuelData() {
    setLoading(true);
    setMessage("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return;
    }

    const res = await fetch("/api/fuel", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setMessage(json.error || "Failed to load fuel data.");
      setLoading(false);
      return;
    }

    setJourneys(
      (json.journeys || []).filter(
        (journey: any) => String(journey.status || "").toLowerCase() === "active"
      )
    );
    setProviders(json.fuel_providers || []);
    setLoading(false);
  }

  const clients = useMemo(() => {
    return Array.from(
      new Set(journeys.map((j) => j.client_name).filter(Boolean))
    );
  }, [journeys]);

  const suggestedJourneys = useMemo(() => {
    return journeys.filter((j) => {
      const matchesClient = client ? j.client_name === client : true;
      const matchesTruck = truck
        ? (j.truck || "").toUpperCase().includes(truck.toUpperCase())
        : true;

      return matchesClient && matchesTruck;
    });
  }, [journeys, client, truck]);

  async function handleSubmit(e: any) {
    e.preventDefault();
    setMessage("");

    const cleanTruck = truck.trim().toUpperCase();
    const litersNum = Number(liters);
    const priceNum = pricePerLiter ? Number(pricePerLiter) : 0;

    if (!cleanTruck || !litersNum) {
      alert("Truck and liters are required.");
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setMessage("Session expired. Please log in again.");
      return;
    }

    const res = await fetch("/api/fuel", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        truck_text: cleanTruck,
        liters: litersNum,
        price_per_liter: priceNum,
        vendor: vendor.trim().toUpperCase(),
        notes,
        journey_id: journeyId || null,
        fuel_source: "manual",
        approved_extra_fuel: approved,
        approval_reason: approved ? approvalReason : null,
      }),
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setMessage(json.error || "Failed to save fuel.");
      return;
    }

    alert("Fuel saved ✅");

    setClient("");
    setTruck("");
    setLiters("");
    setPricePerLiter("");
    setVendor("");
    setNotes("");
    setJourneyId("");
    setSelectedProviderId("");
    setApproved(false);
    setApprovalReason("");
    loadFuelData();
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Add Fuel</h1>

      {loading && <p>Loading fuel data...</p>}
      {message && <pre style={{ background: "#f4f4f4", padding: 12 }}>{message}</pre>}

      <form onSubmit={handleSubmit}>
        <select
          value={client}
          onChange={(e) => {
            setClient(e.target.value);
            setJourneyId("");
          }}
        >
          <option value="">Select client optional</option>
          {clients.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <br />
        <br />

        <input
          placeholder="Truck e.g. KBJ123A"
          value={truck}
          onChange={(e) => {
            setTruck(e.target.value.toUpperCase());
            setJourneyId("");
          }}
          required
        />

        <br />
        <br />

        <div
          style={{
            border: "1px solid #ddd",
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          <strong>Nava Eye Suggestions</strong>
          <p>
            {suggestedJourneys.length === 0
              ? "No matching active journey. Fuel can be saved as unallocated."
              : `${suggestedJourneys.length} matching active journey/journeys found.`}
          </p>

          {suggestedJourneys.length > 0 && (
            <select
              value={journeyId}
              onChange={(e) => setJourneyId(e.target.value)}
            >
              <option value="">Choose matching journey or leave unallocated</option>

              {suggestedJourneys.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.internal_trip_id ? `${j.internal_trip_id} — ` : ""}
                  {j.client_name || "NO CLIENT"} — {j.truck} —{" "}
                  {j.from_location} → {j.to_location}
                </option>
              ))}
            </select>
          )}
        </div>

        <input
          placeholder="Liters e.g. 480"
          value={liters}
          onChange={(e) => setLiters(e.target.value)}
          required
        />

        <br />
        <br />

        <select
          value={selectedProviderId}
          onChange={(e) => {
            const id = e.target.value;
            setSelectedProviderId(id);

            const provider = providers.find((p) => p.id === id);

            if (provider) {
              setVendor(provider.name || "");

              if (provider.current_price_per_liter) {
                setPricePerLiter(provider.current_price_per_liter.toString());
              }
            }
          }}
        >
          <option value="">Select fuel provider or type manually</option>

          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name} — {provider.location || "NO LOCATION"}
            </option>
          ))}
        </select>

        <br />
        <br />

        <input
          placeholder="Fuel provider / station"
          value={vendor}
          onChange={(e) => setVendor(e.target.value.toUpperCase())}
        />

        <br />
        <br />

        <input
          placeholder="Price per liter e.g. 197"
          value={pricePerLiter}
          onChange={(e) => setPricePerLiter(e.target.value)}
        />

        <br />
        <br />

        <label>
          <input
            type="checkbox"
            checked={approved}
            onChange={(e) => setApproved(e.target.checked)}
          />{" "}
          Approve extra fuel / second fueling
        </label>

        <br />
        <br />

        {approved && (
          <>
            <input
              placeholder="Approval reason e.g. emergency top-up"
              value={approvalReason}
              onChange={(e) => setApprovalReason(e.target.value)}
              required
            />

            <br />
            <br />
          </>
        )}

        <input
          placeholder="Notes e.g. MPesa, invoice, top-up"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <br />
        <br />

        <button type="submit">Save Fuel</button>
      </form>
    </main>
  );
}
