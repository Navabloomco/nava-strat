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

type EnabledAsset = {
  id: string;
  truck_id: string | null;
  registration: string | null;
  asset_category: string | null;
  provider_name: string | null;
  status: string | null;
  last_seen_at: string | null;
  assigned_driver: {
    id: string;
    driver_id: string | null;
    driver_name: string | null;
    assigned_from: string | null;
  } | null;
};

type CompanyMembership = {
  company_id: string | null;
  role: string | null;
  is_active?: boolean;
};

const FINANCE_VISIBLE_ROLES = new Set([
  "platform_owner",
  "owner",
  "admin",
  "finance",
  "management",
]);

function routeLabel(route: SavedRoute) {
  return `${route.from_location || "—"} → ${route.to_location || "—"}`;
}

function labelize(value: string | null | undefined) {
  if (!value) return null;

  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeRole(role: unknown) {
  return String(role || "").trim().toLowerCase();
}

function canSeeCommercialDetails(input: {
  roles?: string[];
  memberships?: CompanyMembership[];
  companies?: Array<{ id?: string | null }>;
  isPlatformOwner?: boolean;
}) {
  const defaultCompanyId = input.companies?.[0]?.id || "";
  const companyRoles = (input.memberships || [])
    .filter((membership) => !defaultCompanyId || membership.company_id === defaultCompanyId)
    .map((membership) => normalizeRole(membership.role));
  const effectiveRoles = input.isPlatformOwner
    ? [...companyRoles, "platform_owner"]
    : companyRoles.length
      ? companyRoles
      : (input.roles || []).map(normalizeRole);

  return effectiveRoles.some((role) => FINANCE_VISIBLE_ROLES.has(role));
}

function toDateTimeLocalValue(date = new Date()) {
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export default function NewJourneyPage() {
  const [client, setClient] = useState("");
  const [truck, setTruck] = useState("");
  const [driver, setDriver] = useState("");
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [startTime, setStartTime] = useState(() => toDateTimeLocalValue());
  const [endTime, setEndTime] = useState("");
  const [expectedFuel, setExpectedFuel] = useState("");
  const [loadedTonnage, setLoadedTonnage] = useState("");
  const [rateAmount, setRateAmount] = useState("");
  const [rateCurrency, setRateCurrency] = useState("KES");
  const [rateType, setRateType] = useState("per_tonne");
  const [fxRate, setFxRate] = useState("");
  const [message, setMessage] = useState("");
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [savedRouteSearch, setSavedRouteSearch] = useState("");
  const [selectedSavedRouteId, setSelectedSavedRouteId] = useState("");
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driverSearch, setDriverSearch] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [enabledAssets, setEnabledAssets] = useState<EnabledAsset[]>([]);
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [vehicleAssignmentHint, setVehicleAssignmentHint] = useState("");
  const [canManageCommercialDetails, setCanManageCommercialDetails] = useState(false);
  const router = useRouter();

  useEffect(() => {
    loadAccess();
    loadSavedRoutes();
    loadDrivers();
    loadEnabledAssets();
  }, []);

  async function loadAccess() {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) return;

    const res = await fetch("/api/companies", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const json = await res.json();

    if (!res.ok || !json.success) return;

    setCanManageCommercialDetails(
      canSeeCommercialDetails({
        roles: json.roles || [],
        memberships: json.memberships || [],
        companies: json.companies || [],
        isPlatformOwner: Boolean(json.is_platform_owner),
      })
    );
  }

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

  async function loadEnabledAssets() {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) return;

    const res = await fetch("/api/ops/enabled-assets", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const json = await res.json();

    if (!res.ok || !json.success) return;

    setEnabledAssets(json.assets || []);
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

  const filteredVehicles = useMemo(() => {
    const query = vehicleSearch.trim().toLowerCase();

    const assets = enabledAssets.slice(0, query ? enabledAssets.length : 6);
    if (!query) return assets;

    return enabledAssets
      .filter((asset) => {
        const haystack = [
          asset.registration,
          asset.truck_id,
          asset.provider_name,
          asset.asset_category,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(query);
      })
      .slice(0, 8);
  }, [enabledAssets, vehicleSearch]);

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
    setVehicleAssignmentHint("");
  }

  function applyVehicle(asset: EnabledAsset) {
    setSelectedVehicleId(asset.id);
    setTruck((asset.registration || asset.truck_id || "").toUpperCase());

    if (asset.assigned_driver?.driver_name) {
      setSelectedDriverId(asset.assigned_driver.driver_id || "");
      setDriver(asset.assigned_driver.driver_name.toUpperCase());
      setVehicleAssignmentHint("Using current vehicle assignment.");
    } else {
      setVehicleAssignmentHint("");
    }
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
    setMessage("Saving trip...");

    const cleanTruck = truck.trim().toUpperCase();
    const tripId = makeTripId();

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) {
      setMessage("You must be signed in to create a trip.");
      return;
    }

    const payload: Record<string, any> = {
      internal_trip_id: tripId,
      asset_id: selectedVehicleId || null,
      driver_id: selectedDriverId || null,
      client_name: client.trim().toUpperCase(),
      truck: cleanTruck,
      driver: driver.trim().toUpperCase(),
      manual_driver_text: selectedDriverId ? null : driver.trim().toUpperCase(),
      from_location: fromLocation.trim().toUpperCase(),
      to_location: toLocation.trim().toUpperCase(),
      status: "active",
      start_time: startTime || null,
      end_time: endTime || null,
      expected_fuel_liters: expectedFuel ? Number(expectedFuel) : null,
    };

    if (canManageCommercialDetails) {
      payload.loaded_quantity = loadedTonnage ? Number(loadedTonnage) : null;
      payload.loaded_tonnage = loadedTonnage ? Number(loadedTonnage) : null;
      payload.billing_quantity = loadedTonnage ? Number(loadedTonnage) : null;
      payload.billing_unit = rateType === "per_truck" ? "truck" : "tonne";
      payload.rate_type = rateType;
      payload.rate_amount = rateAmount ? Number(rateAmount) : null;
      payload.rate_currency = rateCurrency;
      payload.fx_rate = rateCurrency === "KES" ? 1 : fxRate ? Number(fxRate) : null;
    }

    const res = await fetch("/api/journeys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json();

    if (!json.success) {
      setMessage(json.error || "Failed to save trip.");
      return;
    }

    setMessage(`Trip saved. Trip ID: ${tripId}`);
    if (json.journey?.id) {
      router.push(`/ops/journey/${json.journey.id}`);
    } else {
      router.push("/ops/journey");
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          dark
          eyebrow="Operations"
          title="Create Trip"
          body="Create a production trip so Nava can link movement, driver context, fuel, expenses, revenue review, and proof to the right operation."
          actions={
            <Link href="/ops/journey">
              <SecondaryButton type="button">Back to trips</SecondaryButton>
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
                    placeholder="Enter client name"
                    value={client}
                    onChange={(e) => setClient(e.target.value.toUpperCase())}
                    className={inputClass}
                    required
                  />
                </FormField>

                <FormField label="Vehicle" dark>
                  <input
                    placeholder="Enter vehicle registration"
                    value={truck}
                    onChange={(e) => {
                      setSelectedVehicleId("");
                      setVehicleAssignmentHint("");
                      setTruck(e.target.value.toUpperCase());
                    }}
                    className={inputClass}
                    required
                  />
                </FormField>

                <FormField label="Driver optional" dark>
                  <input
                    placeholder="Enter driver name"
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
                    Choose vehicle
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-slate-300">
                    Select an enabled vehicle to avoid typing registration details manually.
                  </p>
                </div>
                {enabledAssets.length === 0 && (
                  <Link href="/admin/assets">
                    <SecondaryButton type="button" className="w-full sm:w-auto">
                      Review assets
                    </SecondaryButton>
                  </Link>
                )}
              </div>

              {vehicleAssignmentHint && (
                <div className="mt-4 rounded-md border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-sm font-semibold text-emerald-100">
                  {vehicleAssignmentHint}
                </div>
              )}

              {enabledAssets.length > 0 ? (
                <div className="mt-5 grid gap-4">
                  <input
                    value={vehicleSearch}
                    onChange={(e) => setVehicleSearch(e.target.value)}
                    placeholder="Search by registration, truck ID, provider, or category"
                    className={inputClass}
                  />

                  <div className="grid gap-3">
                    {filteredVehicles.length === 0 ? (
                      <div className="rounded-md border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300">
                        No enabled vehicles match that search.
                      </div>
                    ) : (
                      filteredVehicles.map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => applyVehicle(asset)}
                          className={`rounded-md border p-4 text-left transition ${
                            selectedVehicleId === asset.id
                              ? "border-cyan-200 bg-cyan-300/15"
                              : "border-white/10 bg-slate-950/60 hover:border-cyan-200/40 hover:bg-white/10"
                          }`}
                        >
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="break-words text-sm font-semibold text-white">
                                {asset.registration || asset.truck_id || "Unnamed vehicle"}
                              </div>
                              <div className="mt-1 text-xs text-slate-400">
                                {[asset.truck_id, asset.provider_name, labelize(asset.asset_category)]
                                  .filter(Boolean)
                                  .join(" · ") || "Enabled vehicle"}
                              </div>
                              {asset.assigned_driver?.driver_name && (
                                <div className="mt-2 text-xs font-semibold text-emerald-100">
                                  Current driver: {asset.assigned_driver.driver_name}
                                </div>
                              )}
                            </div>
                            <div className="text-xs font-semibold text-cyan-100">
                              Use vehicle
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm leading-6 text-slate-300">
                  Enabled vehicles will appear here once assets have been reviewed.
                </p>
              )}
            </Panel>

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
                Capture where the trip starts and where the customer expects delivery.
              </p>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <FormField label="From" dark>
                  <input
                    placeholder="Enter origin"
                    value={fromLocation}
                    onChange={(e) => setFromLocation(e.target.value.toUpperCase())}
                    className={inputClass}
                    required
                  />
                </FormField>

                <FormField label="To" dark>
                  <input
                    placeholder="Enter destination"
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
                Trip timing
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                Start time anchors Trip Intelligence to the right operating window. End time can stay blank for active trips.
              </p>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <FormField label="Start date and time" dark>
                  <input
                    type="datetime-local"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className={inputClass}
                    required
                  />
                </FormField>

                <FormField label="End date and time optional" dark>
                  <input
                    type="datetime-local"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className={inputClass}
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
                    placeholder="Expected litres, if known"
                    value={expectedFuel}
                    onChange={(e) => setExpectedFuel(e.target.value)}
                    className={inputClass}
                  />
                </FormField>
              </div>
            </section>

            {canManageCommercialDetails ? (
              <Panel dark className="border-white/10 bg-slate-950/60 p-4">
                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-white">
                    Optional commercial details
                  </summary>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Add rate, billing quantity, and FX only when they are already agreed. Trip Intelligence will still show missing-data notes until linked costs are recorded.
                  </p>
                  <div className="mt-5 grid gap-5 md:grid-cols-2">
                    <FormField label="Loaded / billing quantity optional" dark>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Quantity for billing review"
                        value={loadedTonnage}
                        onChange={(e) => setLoadedTonnage(e.target.value)}
                        className={inputClass}
                      />
                    </FormField>

                    <FormField label="Rate amount optional" dark>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Rate amount"
                        value={rateAmount}
                        onChange={(e) => setRateAmount(e.target.value)}
                        className={inputClass}
                      />
                    </FormField>

                    <FormField label="Rate currency" dark>
                      <select
                        value={rateCurrency}
                        onChange={(e) => setRateCurrency(e.target.value)}
                        className={inputClass}
                      >
                        <option value="KES">KES</option>
                        <option value="USD">USD</option>
                      </select>
                    </FormField>

                    <FormField label="Rate basis" dark>
                      <select
                        value={rateType}
                        onChange={(e) => setRateType(e.target.value)}
                        className={inputClass}
                      >
                        <option value="per_tonne">Per tonne</option>
                        <option value="per_truck">Per truck</option>
                      </select>
                    </FormField>

                    {rateCurrency !== "KES" && (
                      <FormField label="FX rate to KES" dark>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          placeholder="Company-approved FX rate"
                          value={fxRate}
                          onChange={(e) => setFxRate(e.target.value)}
                          className={inputClass}
                        />
                      </FormField>
                    )}
                  </div>
                </details>
              </Panel>
            ) : (
              <Panel dark className="border-white/10 bg-slate-950/60 p-4">
                <div className="text-sm font-semibold text-white">
                  Finance details are managed by finance roles.
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  You can create the operational Trip now. Revenue, rate, billing quantity, and FX can be added later by finance or management roles.
                </p>
              </Panel>
            )}

            <Panel dark className="border-cyan-200/20 bg-cyan-300/10 p-4">
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-100">
                Trip ID preview
              </div>
              <div className="mt-2 break-words text-sm font-semibold text-white">
                {truck && client && fromLocation && toLocation
                  ? makeTripId()
                  : "Fill trip details"}
              </div>
            </Panel>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <PrimaryButton type="submit" className="w-full sm:w-auto">
                Create trip
              </PrimaryButton>
              <Link href="/ops/journey" className="w-full sm:w-auto">
                <SecondaryButton type="button" className="w-full">
                  Back to trips
                </SecondaryButton>
              </Link>
            </div>
          </form>
        </Panel>
      </div>
    </main>
  );
}
