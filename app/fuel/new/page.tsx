"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function NewFuelPage() {
  const [journeys, setJourneys] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);

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
    loadJourneys();
    loadProviders();
  }, []);

  async function loadJourneys() {
    const { data } = await supabase
      .from("journeys")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false });

    setJourneys(data || []);
  }

  async function loadProviders() {
    const { data } = await supabase
      .from("fuel_providers")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    setProviders(data || []);
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

  async function updateFuelProfile(truckValue: string, journeyIdValue: string) {
    const cleanTruck = truckValue.trim().toUpperCase();

    const { data: journey } = await supabase
      .from("journeys")
      .select("*")
      .eq("id", journeyIdValue)
      .single();

    if (!journey) return;

    const { data: fuelLogs } = await supabase
      .from("fuel_logs")
      .select("*")
      .eq("journey_id", journeyIdValue);

    if (!fuelLogs) return;

    const totalFuel = fuelLogs.reduce(
      (sum, fuel) => sum + Number(fuel.liters || 0),
      0
    );

    const { data: existing } = await supabase
      .from("truck_route_fuel_profiles")
      .select("*")
      .eq("truck", cleanTruck)
      .eq("from_location", journey.from_location)
      .eq("to_location", journey.to_location)
      .maybeSingle();

    if (!existing) {
      await supabase.from("truck_route_fuel_profiles").insert([
        {
          truck: cleanTruck,
          client_name: journey.client_name,
          from_location: journey.from_location,
          to_location: journey.to_location,
          avg_fuel_liters: totalFuel,
          trip_count: 1,
        },
      ]);

      return;
    }

    const newCount = Number(existing.trip_count || 0) + 1;

    const newAverage =
      (Number(existing.avg_fuel_liters || 0) *
        Number(existing.trip_count || 0) +
        totalFuel) /
      newCount;

    await supabase
      .from("truck_route_fuel_profiles")
      .update({
        avg_fuel_liters: newAverage,
        trip_count: newCount,
        last_updated: new Date().toISOString(),
      })
      .eq("id", existing.id);
  }

  async function handleSubmit(e: any) {
    e.preventDefault();

    const cleanTruck = truck.trim().toUpperCase();
    const litersNum = Number(liters);
    const priceNum = pricePerLiter ? Number(pricePerLiter) : 0;

    if (!cleanTruck || !litersNum) {
      alert("Truck and liters are required.");
      return;
    }

    if (journeyId) {
      const { data: existingFuel } = await supabase
        .from("fuel_logs")
        .select("id")
        .eq("journey_id", journeyId);

      if (existingFuel && existingFuel.length > 0 && !approved) {
        alert(
          "🚨 Fuel already exists for this journey. Approval is required to add more fuel."
        );
        return;
      }

      if (approved && !approvalReason.trim()) {
        alert("Please enter a reason for approved extra fuel.");
        return;
      }
    }

    const { error } = await supabase.from("fuel_logs").insert([
      {
        truck_text: cleanTruck,
        liters: litersNum,
        price_per_liter: priceNum,
        total_cost: litersNum * priceNum,
        vendor: vendor.trim().toUpperCase(),
        notes,
        journey_id: journeyId || null,
        allocation_status: journeyId ? "allocated" : "unallocated",
        fuel_source: "manual",
        approved_extra_fuel: approved,
        approval_reason: approved ? approvalReason : null,
        request_status: "approved",
        approval_required: approved,
      },
    ]);

    if (error) {
      alert(error.message);
      return;
    }

    if (journeyId) {
      await updateFuelProfile(cleanTruck, journeyId);
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
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Add Fuel</h1>

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
