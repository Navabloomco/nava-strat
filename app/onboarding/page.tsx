"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function Onboarding() {
  const [step, setStep] = useState(1);
  const [tenantId, setTenantId] = useState("");
  const [message, setMessage] = useState("");

  const [trucks, setTrucks] = useState<any[]>([]);
  const [geofences, setGeofences] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);

  const [truck, setTruck] = useState("");
  const [driver, setDriver] = useState("");

  const [geoSearch, setGeoSearch] = useState("");
  const [geoName, setGeoName] = useState("");
  const [geoType, setGeoType] = useState("client");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState("300");
  const [geoSource, setGeoSource] = useState("");
  const [geoConfidence, setGeoConfidence] = useState("");
  const [searchingPlace, setSearchingPlace] = useState(false);

  const [client, setClient] = useState("");
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [rateType, setRateType] = useState("per_tonne");
  const [billingUnit, setBillingUnit] = useState("tonne");
  const [rate, setRate] = useState("");
  const [currency, setCurrency] = useState("KES");
  const [fxRate, setFxRate] = useState("1");

  useEffect(() => {
    init();
  }, []);

  async function init() {
    const { data: user } = await supabase.auth.getUser();

    if (!user.user) {
      window.location.href = "/login";
      return;
    }

    const { data: tenant } = await supabase.rpc("current_tenant_id");

    if (!tenant) {
      setMessage("Tenant not linked.");
      return;
    }

    setTenantId(tenant);

    const { data: tenantData } = await supabase
      .from("tenants")
      .select("onboarding_step")
      .eq("id", tenant)
      .single();

    if (tenantData?.onboarding_step) {
      setStep(tenantData.onboarding_step);
    }

    loadData();
  }

  async function loadData() {
    const { data: t } = await supabase.from("trucks").select("*");
    const { data: g } = await supabase.from("geofences").select("*");
    const { data: r } = await supabase.from("client_rate_rules").select("*");

    setTrucks(t || []);
    setGeofences(g || []);
    setRules(r || []);
  }

  async function nextStep() {
    const next = step + 1;

    await supabase
      .from("tenants")
      .update({ onboarding_step: next })
      .eq("id", tenantId);

    setStep(next);
  }

  async function previousStep() {
    const prev = Math.max(1, step - 1);

    await supabase
      .from("tenants")
      .update({ onboarding_step: prev })
      .eq("id", tenantId);

    setStep(prev);
  }

  function fallbackRadiusForType(type: string) {
    if (type === "fuel") return "150";
    if (type === "border") return "1500";
    if (type === "yard") return "500";
    if (type === "depot") return "500";
    if (type === "client") return "300";
    return "300";
  }

  async function searchPlace() {
    if (!geoSearch.trim()) {
      alert("Type a place name first.");
      return;
    }

    setSearchingPlace(true);
    setMessage("Nava Eye is searching for the location...");

    try {
      const response = await fetch("/api/place-search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: geoSearch.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Place not found.");
        setSearchingPlace(false);
        return;
      }

      setGeoName(data.name || geoSearch);
      setLat(String(data.latitude));
      setLng(String(data.longitude));
      setGeoType(data.suggested_type || "client");
      setRadius(String(data.suggested_radius || 300));
      setGeoSource(data.source || "search");
      setGeoConfidence(data.confidence || "medium");

      setMessage(
        `Found: ${data.display_name}. Nava suggests ${data.suggested_type} with ${data.suggested_radius}m radius.`
      );
    } catch (err: any) {
      setMessage(err.message || "Search failed.");
    }

    setSearchingPlace(false);
  }

  async function addTruck(e: any) {
    e.preventDefault();

    const cleanTruck = truck.trim().toUpperCase();

    if (!cleanTruck) {
      alert("Truck is required.");
      return;
    }

    const { error } = await supabase.from("trucks").insert([
      {
        tenant_id: tenantId,
        truck: cleanTruck,
        driver: driver.trim().toUpperCase() || null,
      },
    ]);

    if (error) {
      alert(error.message);
      return;
    }

    setTruck("");
    setDriver("");
    loadData();
  }

  async function addGeofence(e: any) {
    e.preventDefault();

    const latitude = Number(lat);
    const longitude = Number(lng);

    if (!geoName.trim() || isNaN(latitude) || isNaN(longitude)) {
      alert("Name, latitude, and longitude are required.");
      return;
    }

    const { error } = await supabase.from("geofences").insert([
      {
        tenant_id: tenantId,
        name: geoName.trim(),
        type: geoType,
        latitude,
        longitude,
        radius_meters: Number(radius || fallbackRadiusForType(geoType)),
        source: geoSource || "manual",
        confidence: geoConfidence || "manual",
        nava_suggested_radius: geoSource ? true : false,
      },
    ]);

    if (error) {
      alert(error.message);
      return;
    }

    setGeoSearch("");
    setGeoName("");
    setGeoType("client");
    setLat("");
    setLng("");
    setRadius("300");
    setGeoSource("");
    setGeoConfidence("");
    setMessage("Location saved ✅");
    loadData();
  }

  async function addRule(e: any) {
    e.preventDefault();

    if (!client.trim() || !rate) {
      alert("Client and rate are required.");
      return;
    }

    const { error } = await supabase.from("client_rate_rules").insert([
      {
        tenant_id: tenantId,
        client_name: client.trim().toUpperCase(),
        from_location: fromLocation.trim()
          ? fromLocation.trim().toUpperCase()
          : null,
        to_location: toLocation.trim() ? toLocation.trim().toUpperCase() : null,
        rate_type: rateType,
        billing_unit: billingUnit.trim().toLowerCase(),
        rate_amount: Number(rate),
        rate_currency: currency,
        fx_rate: currency === "KES" ? 1 : Number(fxRate || 1),
        valid_from: new Date().toISOString().slice(0, 10),
        is_active: true,
      },
    ]);

    if (error) {
      alert(error.message);
      return;
    }

    setClient("");
    setFromLocation("");
    setToLocation("");
    setRateType("per_tonne");
    setBillingUnit("tonne");
    setRate("");
    setCurrency("KES");
    setFxRate("1");
    loadData();
  }

  async function finishOnboarding() {
    await supabase
      .from("tenants")
      .update({
        onboarding_step: 3,
        onboarding_completed: true,
      })
      .eq("id", tenantId);

    window.location.href = "/ops/dashboard";
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Setup Nava</h1>
      <p>Step {step} of 3</p>

      {message && (
        <pre style={{ background: "#f4f4f4", padding: 12 }}>{message}</pre>
      )}

      <br />

      {step > 1 && <button onClick={previousStep}>← Back</button>}

      {step === 1 && (
        <>
          <h2>1. Add your trucks</h2>
          <p>Add the trucks that Nava Eye should monitor.</p>

          <form onSubmit={addTruck}>
            <input
              placeholder="Truck e.g. KBJ123A"
              value={truck}
              onChange={(e) => setTruck(e.target.value.toUpperCase())}
              required
            />

            <br />
            <br />

            <input
              placeholder="Driver optional e.g. Kariuki"
              value={driver}
              onChange={(e) => setDriver(e.target.value.toUpperCase())}
            />

            <br />
            <br />

            <button type="submit">Add Truck</button>
          </form>

          <p>{trucks.length} trucks added</p>

          {trucks.length > 0 && (
            <ul>
              {trucks.slice(0, 8).map((t) => (
                <li key={t.id}>
                  {t.truck} {t.driver ? `— ${t.driver}` : ""}
                </li>
              ))}
            </ul>
          )}

          {trucks.length > 0 && <button onClick={nextStep}>Next → Locations</button>}
        </>
      )}

      {step === 2 && (
        <>
          <h2>2. Add key locations</h2>
          <p>
            Type a known place like Shell Bonje, Busia Border, GBHL Mombasa, or
            your yard. Nava Eye will search coordinates and suggest a radius.
          </p>

          <div style={{ border: "1px solid #ddd", padding: 16 }}>
            <input
              placeholder="Search place e.g. Shell Bonje"
              value={geoSearch}
              onChange={(e) => setGeoSearch(e.target.value)}
              style={{ width: 300 }}
            />

            <button type="button" onClick={searchPlace} disabled={searchingPlace}>
              {searchingPlace ? "Searching..." : "Nava Eye Search"}
            </button>
          </div>

          <br />

          <form onSubmit={addGeofence}>
            <input
              placeholder="Location name"
              value={geoName}
              onChange={(e) => setGeoName(e.target.value)}
              required
            />

            <br />
            <br />

            <select
              value={geoType}
              onChange={(e) => {
                setGeoType(e.target.value);
                setRadius(fallbackRadiusForType(e.target.value));
              }}
            >
              <option value="client">Client Site</option>
              <option value="fuel">Fuel Station</option>
              <option value="yard">Yard</option>
              <option value="depot">Depot</option>
              <option value="border">Border</option>
              <option value="other">Other</option>
            </select>

            <br />
            <br />

            <input
              placeholder="Latitude"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              required
            />

            <br />
            <br />

            <input
              placeholder="Longitude"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              required
            />

            <br />
            <br />

            <input
              placeholder="Radius meters"
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              required
            />

            <br />
            <br />

            {geoConfidence && (
              <p>
                Nava confidence: <strong>{geoConfidence}</strong> | Source:{" "}
                <strong>{geoSource || "manual"}</strong>
              </p>
            )}

            <button type="submit">Save Location</button>
          </form>

          <p>{geofences.length} locations added</p>

          {geofences.length > 0 && (
            <ul>
              {geofences.slice(0, 8).map((g) => (
                <li key={g.id}>
                  {g.name} — {g.type || "location"} — {g.radius_meters}m
                </li>
              ))}
            </ul>
          )}

          {geofences.length > 0 && <button onClick={nextStep}>Next → Pricing</button>}
        </>
      )}

      {step === 3 && (
        <>
          <h2>3. Set your first client rate</h2>
          <p>
            Add a rate once. Later, when prices change, use the Pricing page to
            create a new version without destroying old history.
          </p>

          <form onSubmit={addRule}>
            <input
              placeholder="Client e.g. ENGAANO"
              value={client}
              onChange={(e) => setClient(e.target.value.toUpperCase())}
              required
            />

            <br />
            <br />

            <input
              placeholder="From optional e.g. MOMBASA"
              value={fromLocation}
              onChange={(e) => setFromLocation(e.target.value.toUpperCase())}
            />

            <br />
            <br />

            <input
              placeholder="To optional e.g. JINJA"
              value={toLocation}
              onChange={(e) => setToLocation(e.target.value.toUpperCase())}
            />

            <br />
            <br />

            <select value={rateType} onChange={(e) => setRateType(e.target.value)}>
              <option value="per_tonne">Per Tonne</option>
              <option value="per_truck">Per Truck</option>
              <option value="per_box">Per Box</option>
              <option value="per_bag">Per Bag</option>
              <option value="per_crate">Per Crate</option>
              <option value="per_pallet">Per Pallet</option>
              <option value="per_litre">Per Litre</option>
              <option value="per_km">Per KM</option>
              <option value="custom">Custom Unit</option>
            </select>

            <br />
            <br />

            <input
              placeholder="Billing unit e.g. tonne, box, truck"
              value={billingUnit}
              onChange={(e) => setBillingUnit(e.target.value)}
              required
            />

            <br />
            <br />

            <input
              placeholder="Rate amount e.g. 45"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              required
            />

            <br />
            <br />

            <select
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value);
                if (e.target.value === "KES") setFxRate("1");
              }}
            >
              <option value="KES">KES</option>
              <option value="USD">USD</option>
              <option value="UGX">UGX</option>
              <option value="TZS">TZS</option>
              <option value="RWF">RWF</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="ZAR">ZAR</option>
            </select>

            <br />
            <br />

            {currency !== "KES" && (
              <>
                <input
                  placeholder="FX to KES e.g. 129"
                  value={fxRate}
                  onChange={(e) => setFxRate(e.target.value)}
                  required
                />

                <br />
                <br />
              </>
            )}

            <button type="submit">Save Rate</button>
          </form>

          <p>{rules.length} pricing rules added</p>

          {rules.length > 0 && (
            <ul>
              {rules.slice(0, 8).map((r) => (
                <li key={r.id}>
                  {r.client_name} — {r.from_location || "ANY"} →{" "}
                  {r.to_location || "ANY"} — {r.rate_currency} {r.rate_amount}/
                  {r.billing_unit}
                </li>
              ))}
            </ul>
          )}

          {rules.length > 0 && (
            <button onClick={finishOnboarding}>Finish → Dashboard</button>
          )}
        </>
      )}
    </main>
  );
}
