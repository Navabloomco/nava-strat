"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function NewFuelPage() {
  const [journeys, setJourneys] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);

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
    const { data, error } = await supabase
      .from("journeys")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (!error) setJourneys(data || []);
  }

  async function loadProviders() {
    const { data, error } = await supabase
      .from("fuel_providers")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (!error) setProviders(data || []);
  }

  async function updateFuelProfile(truckValue: string, journeyIdValue: string) {
    const cleanTruck = truckValue.trim().toUpperCase();

    const { data: journey, error: journeyError } = await supabase
      .from("journeys")
      .select("*")
      .eq("id", journeyIdValue)
      .single();

    if (journeyError || !journey) return;

    const { data: fuelLogs, error: fuelError } = await supabase
      .from("fuel_logs")
      .select("*")
      .eq("journey_id", journeyIdValue);

    if (fuelError || !fuelLogs) return;

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
        request_status: approved ? "approved" : "approved",
        approval_required: approved,
      },
    ]);

    if (error) {
      alert(error.message);
      console.error(error);
      return;
    }

    if (journeyId) {
      await updateFuelProfile(cleanTruck, journeyId);
    }

    alert("Fuel saved ✅");

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
        <input
          placeholder="Truck e.g. KBJ123A"
          value={truck}
          onChange={(e) => setTruck(e.target.value.toUpperCase())}
          required
        />

        <br />
        <br />

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
                setPricePerLiter(
                  provider.current_price_per_liter.toString()
                );
              }
            }
          }}
        >
          <option value="">Select fuel provider or type manually</option>

          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name} — {provider.location || "No location"}
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

        <select
          value={journeyId}
          onChange={(e) => setJourneyId(e.target.value)}
        >
          <option value="">No journey yet / unallocated fuel</option>

          {journeys.map((journey) => (
            <option key={journey.id} value={journey.id}>
              {journey.client_name || "NO CLIENT"} — {journey.truck} —{" "}
              {journey.from_location} → {journey.to_location}
            </option>
          ))}
        </select>

        <br />
        <br />

        <label>
          <input
            type="checkbox"
            checked={approved}
            onChange={(e) => setApproved(e.target.checked)}
          />
          {" "}Approve extra fuel / second fueling
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
          placeholder="Notes e.g. Mpesa, invoice, top-up"
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
