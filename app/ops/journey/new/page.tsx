"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import {
  FormField,
  PageHeader,
  Panel,
  PrimaryButton,
  SecondaryButton,
} from "../../../components/ui/Primitives";

const inputClass =
  "w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300";

export default function NewJourneyPage() {
  const [client, setClient] = useState("");
  const [truck, setTruck] = useState("");
  const [driver, setDriver] = useState("");
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [expectedFuel, setExpectedFuel] = useState("");
  const [message, setMessage] = useState("");
  const router = useRouter();

  function makeTripId() {
    const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");

    return `${truck}-${client}-${fromLocation}-${toLocation}-${today}`
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/[^A-Z0-9-]/g, "");
  }

  async function handleSubmit(e: any) {
    e.preventDefault();
    setMessage("Saving journey...");

    const cleanTruck = truck.trim().toUpperCase();
    const tripId = makeTripId();

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) {
      setMessage("You must be signed in to create a journey.");
      return;
    }

    const res = await fetch("/api/journeys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        internal_trip_id: tripId,
        client_name: client.trim().toUpperCase(),
        truck: cleanTruck,
        driver: driver.trim().toUpperCase(),
        from_location: fromLocation.trim().toUpperCase(),
        to_location: toLocation.trim().toUpperCase(),
        status: "active",
        expected_fuel_liters: expectedFuel ? Number(expectedFuel) : null,
      }),
    });

    const json = await res.json();

    if (!json.success) {
      setMessage(json.error || "Failed to save journey.");
      return;
    }

    setMessage(`Journey saved ✅ Trip ID: ${tripId}`);
    router.push("/ops/journey");
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          dark
          eyebrow="Operations"
          title="Create Journey"
          body="One vehicle can only have one active journey at a time, so Nava can keep fuel, expenses, revenue, and progress tied to the right movement."
          actions={
            <Link href="/ops/journey">
              <SecondaryButton type="button">Back to journeys</SecondaryButton>
            </Link>
          }
        />

        {message && (
          <Panel dark className="mt-8 border-cyan-200/20 bg-cyan-300/10 p-4">
            <div className="whitespace-pre-wrap text-sm text-cyan-50">
              {message}
            </div>
          </Panel>
        )}

        <Panel dark className="mt-8 p-6">
          <form onSubmit={handleSubmit} className="grid gap-8">
            <section>
              <h2 className="text-lg font-semibold text-white">
                Client & vehicle
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                Start with the customer, vehicle, and driver assigned to this movement.
              </p>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <FormField label="Client" dark>
                  <input
                    placeholder="Client e.g. ENGAANO"
                    value={client}
                    onChange={(e) => setClient(e.target.value.toUpperCase())}
                    className={inputClass}
                    required
                  />
                </FormField>

                <FormField label="Vehicle" dark>
                  <input
                    placeholder="Vehicle e.g. KBJ123A"
                    value={truck}
                    onChange={(e) => setTruck(e.target.value.toUpperCase())}
                    className={inputClass}
                    required
                  />
                </FormField>

                <FormField label="Driver optional" dark>
                  <input
                    placeholder="Driver e.g. KARIUKI"
                    value={driver}
                    onChange={(e) => setDriver(e.target.value.toUpperCase())}
                    className={inputClass}
                  />
                </FormField>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white">Route</h2>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                Capture where the journey starts and where the customer expects delivery.
              </p>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <FormField label="From" dark>
                  <input
                    placeholder="From e.g. MOMBASA"
                    value={fromLocation}
                    onChange={(e) => setFromLocation(e.target.value.toUpperCase())}
                    className={inputClass}
                    required
                  />
                </FormField>

                <FormField label="To" dark>
                  <input
                    placeholder="To e.g. JINJA"
                    value={toLocation}
                    onChange={(e) => setToLocation(e.target.value.toUpperCase())}
                    className={inputClass}
                    required
                  />
                </FormField>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white">
                Fuel estimate
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                Add an expected fuel amount if you already know the route assumption.
              </p>
              <div className="mt-5">
                <FormField label="Expected fuel optional" dark>
                  <input
                    placeholder="Default route fuel optional e.g. 480"
                    value={expectedFuel}
                    onChange={(e) => setExpectedFuel(e.target.value)}
                    className={inputClass}
                  />
                </FormField>
              </div>
            </section>

            <Panel dark className="border-cyan-200/20 bg-cyan-300/10 p-4">
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-100">
                Trip ID preview
              </div>
              <div className="mt-2 break-words text-sm font-semibold text-white">
                {truck && client && fromLocation && toLocation
                  ? makeTripId()
                  : "Fill journey details"}
              </div>
            </Panel>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <PrimaryButton type="submit" className="w-full sm:w-auto">
                Create journey
              </PrimaryButton>
              <Link href="/ops/journey" className="w-full sm:w-auto">
                <SecondaryButton type="button" className="w-full">
                  Back to journeys
                </SecondaryButton>
              </Link>
            </div>
          </form>
        </Panel>
      </div>
    </main>
  );
}
