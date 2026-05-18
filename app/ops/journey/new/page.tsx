"use client";

import { useEffect, useMemo, useState } from "react";
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

type SavedRoute = {
  id: string;
  name: string | null;
  client_name: string | null;
  from_location: string | null;
  to_location: string | null;
  expected_fuel_liters: number | null;
  is_active: boolean;
};

type Driver = {
  id: string;
  full_name: string | null;
  phone: string | null;
  employee_code: string | null;
  status: string;
};

function routeLabel(route: SavedRoute) {
  return `${route.from_location || "—"} → ${route.to_location || "—"}`;
}

export default function NewJourneyPage() {
  const [client, setClient] = useState("");
  const [truck, setTruck] = useState("");
  const [driver, setDriver] = useState("");
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [expectedFuel, setExpectedFuel] = useState("");
  const [message, setMessage] = useState("");
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [savedRouteSearch, setSavedRouteSearch] = useState("");
  const [selectedSavedRouteId, setSelectedSavedRouteId] = useState("");
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driverSearch, setDriverSearch] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const router = useRouter();

  useEffect(() => {
    loadSavedRoutes();
    loadDrivers();
  }, []);

  async function loadSavedRoutes() {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) return;

    const res = await fetch("/api/journey-templates", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const json = await res.json();

    if (!res.ok || !json.success) return;

    setSavedRoutes(
      (json.templates || []).filter((route: SavedRoute) => route.is_active)
    );
  }

  async function loadDrivers() {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) return;

    const res = await fetch("/api/drivers", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const json = await res.json();

    if (!res.ok || !json.success) return;

    setDrivers(
      (json.drivers || []).filter(
        (item: Driver) => String(item.status || "").toLowerCase() === "active"
      )
    );
  }

  const filteredSavedRoutes = useMemo(() => {
    const query = savedRouteSearch.trim().toLowerCase();

    if (!query) return savedRoutes.slice(0, 6);

    return savedRoutes
      .filter((route) => {
        const haystack = [
          route.name,
          route.client_name,
          route.from_location,
          route.to_location,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(query);
      })
      .slice(0, 8);
  }, [savedRoutes, savedRouteSearch]);

  const filteredDrivers = useMemo(() => {
    const query = driverSearch.trim().toLowerCase();

    const activeDrivers = drivers.slice(0, query ? drivers.length : 6);
    if (!query) return activeDrivers;

    return drivers
      .filter((item) => {
        const haystack = [item.full_name, item.phone, item.employee_code]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(query);
      })
      .slice(0, 8);
  }, [drivers, driverSearch]);

  function applySavedRoute(route: SavedRoute) {
    setSelectedSavedRouteId(route.id);
    setClient((route.client_name || "").toUpperCase());
    setFromLocation((route.from_location || "").toUpperCase());
    setToLocation((route.to_location || "").toUpperCase());

    if (route.expected_fuel_liters) {
      setExpectedFuel(route.expected_fuel_liters.toString());
    }
  }

  function applyDriver(selectedDriver: Driver) {
    setSelectedDriverId(selectedDriver.id);
    setDriver((selectedDriver.full_name || "").toUpperCase());
  }

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
            <Panel dark className="border-cyan-200/20 bg-cyan-300/10 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    Use saved route
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-slate-300">
                    Choose a frequent route to fill the boring parts.
                  </p>
                </div>
                {savedRoutes.length === 0 && (
                  <Link href="/ops/journey/templates">
                    <SecondaryButton type="button" className="w-full sm:w-auto">
                      Create saved route
                    </SecondaryButton>
                  </Link>
                )}
              </div>

              {savedRoutes.length > 0 ? (
                <div className="mt-5 grid gap-4">
                  <input
                    value={savedRouteSearch}
                    onChange={(e) => setSavedRouteSearch(e.target.value)}
                    placeholder="Search by route, client, loading point, or destination"
                    className={inputClass}
                  />

                  <div className="grid gap-3">
                    {filteredSavedRoutes.length === 0 ? (
                      <div className="rounded-md border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300">
                        No saved routes match that search.
                      </div>
                    ) : (
                      filteredSavedRoutes.map((route) => (
                        <button
                          key={route.id}
                          type="button"
                          onClick={() => applySavedRoute(route)}
                          className={`rounded-md border p-4 text-left transition ${
                            selectedSavedRouteId === route.id
                              ? "border-cyan-200 bg-cyan-300/15"
                              : "border-white/10 bg-slate-950/60 hover:border-cyan-200/40 hover:bg-white/10"
                          }`}
                        >
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="break-words text-sm font-semibold text-white">
                                {route.name || routeLabel(route)}
                              </div>
                              <div className="mt-1 text-xs text-slate-400">
                                {route.client_name || "No client"} · {routeLabel(route)}
                              </div>
                            </div>
                            <div className="text-xs font-semibold text-cyan-100">
                              {route.expected_fuel_liters
                                ? `${Number(route.expected_fuel_liters).toLocaleString()} L`
                                : "No fuel estimate"}
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm leading-6 text-slate-300">
                  Saved routes will appear here once your team creates route presets.
                </p>
              )}
            </Panel>

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
                    onChange={(e) => {
                      setSelectedDriverId("");
                      setDriver(e.target.value.toUpperCase());
                    }}
                    className={inputClass}
                  />
                </FormField>
              </div>
            </section>

            <Panel dark className="border-cyan-200/20 bg-cyan-300/10 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    Assign driver
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-slate-300">
                    Select from your driver directory or keep typing manually above.
                  </p>
                </div>
                {drivers.length === 0 && (
                  <Link href="/ops/drivers">
                    <SecondaryButton type="button" className="w-full sm:w-auto">
                      Add driver
                    </SecondaryButton>
                  </Link>
                )}
              </div>

              {drivers.length > 0 ? (
                <div className="mt-5 grid gap-4">
                  <input
                    value={driverSearch}
                    onChange={(e) => setDriverSearch(e.target.value)}
                    placeholder="Search by name, phone, or employee code"
                    className={inputClass}
                  />

                  <div className="grid gap-3">
                    {filteredDrivers.length === 0 ? (
                      <div className="rounded-md border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300">
                        No active drivers match that search.
                      </div>
                    ) : (
                      filteredDrivers.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => applyDriver(item)}
                          className={`rounded-md border p-4 text-left transition ${
                            selectedDriverId === item.id
                              ? "border-cyan-200 bg-cyan-300/15"
                              : "border-white/10 bg-slate-950/60 hover:border-cyan-200/40 hover:bg-white/10"
                          }`}
                        >
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="break-words text-sm font-semibold text-white">
                                {item.full_name || "Unnamed driver"}
                              </div>
                              <div className="mt-1 text-xs text-slate-400">
                                {[item.phone, item.employee_code]
                                  .filter(Boolean)
                                  .join(" · ") || "No phone or employee code"}
                              </div>
                            </div>
                            <div className="text-xs font-semibold text-cyan-100">
                              Use driver
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm leading-6 text-slate-300">
                  Driver directory entries will appear here once your team adds them.
                </p>
              )}
            </Panel>

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
