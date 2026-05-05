"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function OnboardingPage() {
  const [userEmail, setUserEmail] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [message, setMessage] = useState("");

  const [trucks, setTrucks] = useState<any[]>([]);
  const [geofences, setGeofences] = useState<any[]>([]);
  const [trackingProviders, setTrackingProviders] = useState<any[]>([]);
  const [rateRules, setRateRules] = useState<any[]>([]);

  const [truck, setTruck] = useState("");
  const [driver, setDriver] = useState("");

  const [geoName, setGeoName] = useState("");
  const [geoType, setGeoType] = useState("client");
  const [mapsLink, setMapsLink] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [radius, setRadius] = useState("300");

  const [providerName, setProviderName] = useState("");
  const [providerType, setProviderType] = useState("GPS");
  const [authType, setAuthType] = useState("api_key");
  const [loginUrl, setLoginUrl] = useState("");
  const [fleetUrl, setFleetUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [clientName, setClientName] = useState("");
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [rateType, setRateType] = useState("per_tonne");
  const [billingUnit, setBillingUnit] = useState("tonne");
  const [rateAmount, setRateAmount] = useState("");
  const [rateCurrency, setRateCurrency] = useState("KES");
  const [fxRate, setFxRate] = useState("1");

  useEffect(() => {
    initialize();
  }, []);

  async function initialize() {
    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setMessage("Please login first.");
      window.location.href = "/login";
      return;
    }

    setUserEmail(userData.user.email || "");

    const { data: tenantResult, error: tenantError } = await supabase.rpc(
      "current_tenant_id"
    );

    if (tenantError || !tenantResult) {
      setMessage("No tenant found for this user. Link user to tenant first.");
      return;
    }

    setTenantId(tenantResult);
    loadData();
  }

  async function loadData() {
    const { data: truckData } = await supabase
      .from("trucks")
      .select("*")
      .order("created_at", { ascending: false });

    const { data: geofenceData } = await supabase
      .from("geofences")
      .select("*")
      .order("created_at", { ascending: false });

    const { data: providerData } = await supabase
      .from("tracking_providers")
      .select("*")
      .order("created_at", { ascending: false });

    const { data: ruleData } = await supabase
      .from("client_rate_rules")
      .select("*")
      .order("created_at", { ascending: false });

    setTrucks(truckData || []);
    setGeofences(geofenceData || []);
    setTrackingProviders(providerData || []);
    setRateRules(ruleData || []);
  }

  function suggestRadius(type: string) {
    if (type === "fuel") return "150";
    if (type === "border") return "1500";
    if (type === "yard") return "500";
    if (type === "depot") return "500";
    if (type === "client") return "300";
    return "300";
  }

  function handleGeoTypeChange(value: string) {
    setGeoType(value);
    setRadius(suggestRadius(value));
  }

  function extractLatLngFromGoogleMaps(link: string) {
    const atMatch = link.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);

    if (atMatch) {
      setLatitude(atMatch[1]);
      setLongitude(atMatch[2]);
      return;
    }

    const queryMatch = link.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);

    if (queryMatch) {
      setLatitude(queryMatch[1]);
      setLongitude(queryMatch[2]);
      return;
    }

    alert("Could not extract coordinates. Paste latitude/longitude manually.");
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
        status: "active",
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

    const lat = Number(latitude);
    const lng = Number(longitude);

    if (!geoName || isNaN(lat) || isNaN(lng)) {
      alert("Name, latitude, and longitude are required.");
      return;
    }

    const { error } = await supabase.from("geofences").insert([
      {
        tenant_id: tenantId,
        name: geoName.trim(),
        type: geoType,
        latitude: lat,
        longitude: lng,
        radius_meters: Number(radius || 300),
      },
    ]);

    if (error) {
      alert(error.message);
      return;
    }

    setGeoName("");
    setMapsLink("");
    setLatitude("");
    setLongitude("");
    setRadius(suggestRadius(geoType));
    loadData();
  }

  async function addTrackingProvider(e: any) {
    e.preventDefault();

    if (!providerName) {
      alert("Provider name required.");
      return;
    }

    const { error } = await supabase.from("tracking_providers").insert([
      {
        tenant_id: tenantId,
        provider_name: providerName.trim().toUpperCase(),
        provider_type: providerType.trim().toUpperCase(),
        auth_type: authType,
        login_url: loginUrl.trim() || null,
        fleet_url: fleetUrl.trim() || null,
        api_key: apiKey.trim() || null,
        api_hash: apiHash.trim() || null,
        username: username.trim() || null,
        password: password.trim() || null,
        is_active: true,
        token_refresh_required: true,
      },
    ]);

    if (error) {
      alert(error.message);
      return;
    }

    setProviderName("");
    setLoginUrl("");
    setFleetUrl("");
    setApiKey("");
    setApiHash("");
    setUsername("");
    setPassword("");
    loadData();
  }

  async function addRateRule(e: any) {
    e.preventDefault();

    if (!clientName || !rateAmount) {
      alert("Client and rate are required.");
      return;
    }

    const { error } = await supabase.from("client_rate_rules").insert([
      {
        tenant_id: tenantId,
        client_name: clientName.trim().toUpperCase(),
        from_location: fromLocation.trim().toUpperCase() || null,
        to_location: toLocation.trim().toUpperCase() || null,
        rate_type: rateType,
        billing_unit: billingUnit,
        rate_amount: Number(rateAmount || 0),
        rate_currency: rateCurrency,
        fx_rate: rateCurrency === "KES" ? 1 : Number(fxRate || 1),
      },
    ]);

    if (error) {
      alert(error.message);
      return;
    }

    setClientName("");
    setFromLocation("");
    setToLocation("");
    setRateAmount("");
    loadData();
  }

  async function finishOnboarding() {
    const { error } = await supabase
      .from("tenants")
      .update({ onboarding_completed: true })
      .eq("id", tenantId);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Onboarding completed ✅");
    window.location.href = "/ops/dashboard";
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Nava Setup</h1>
      <p>
        Logged in as <strong>{userEmail}</strong>
      </p>

      {message && (
        <pre style={{ background: "#f4f4f4", padding: 12 }}>{message}</pre>
      )}

      <hr />

      <h2>1. Add Trucks</h2>

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

      <p>Saved trucks: {trucks.length}</p>

      {trucks.length > 0 && (
        <ul>
          {trucks.slice(0, 5).map((t) => (
            <li key={t.id}>
              {t.truck} {t.driver ? `— ${t.driver}` : ""}
            </li>
          ))}
        </ul>
      )}

      <hr />

      <h2>2. Add Business Locations / Geofences</h2>
      <p>Nava Eye uses these to understand yards, clients, borders, and fuel stations.</p>

      <form onSubmit={addGeofence}>
        <input
          placeholder="Name e.g. Shell Bonje / GBHL Mombasa"
          value={geoName}
          onChange={(e) => setGeoName(e.target.value)}
          required
        />

        <br />
        <br />

        <select value={geoType} onChange={(e) => handleGeoTypeChange(e.target.value)}>
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
          placeholder="Paste Google Maps link optional"
          value={mapsLink}
          onChange={(e) => setMapsLink(e.target.value)}
        />

        <button
          type="button"
          onClick={() => extractLatLngFromGoogleMaps(mapsLink)}
        >
          Extract Coordinates
        </button>

        <br />
        <br />

        <input
          placeholder="Latitude"
          value={latitude}
          onChange={(e) => setLatitude(e.target.value)}
          required
        />

        <br />
        <br />

        <input
          placeholder="Longitude"
          value={longitude}
          onChange={(e) => setLongitude(e.target.value)}
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

        <button type="submit">Add Geofence</button>
      </form>

      <p>Saved geofences: {geofences.length}</p>

      <hr />

      <h2>3. Connect Tracking Provider</h2>
      <p>
        For now, save provider details. Auto-ingestion will use these later.
      </p>

      <form onSubmit={addTrackingProvider}>
        <input
          placeholder="Provider e.g. BLUETRAX / MEITRACK / FLEETTRACK"
          value={providerName}
          onChange={(e) => setProviderName(e.target.value.toUpperCase())}
          required
        />

        <br />
        <br />

        <input
          placeholder="Provider type e.g. GPS / CANBUS / FUEL_ROD"
          value={providerType}
          onChange={(e) => setProviderType(e.target.value.toUpperCase())}
        />

        <br />
        <br />

        <select value={authType} onChange={(e) => setAuthType(e.target.value)}>
          <option value="api_key">API Key</option>
          <option value="username_key">Username + Key</option>
          <option value="email_password">Email + Password</option>
          <option value="api_hash">API Hash</option>
          <option value="bearer_token">Bearer Token</option>
        </select>

        <br />
        <br />

        <input
          placeholder="Login URL optional"
          value={loginUrl}
          onChange={(e) => setLoginUrl(e.target.value)}
        />

        <br />
        <br />

        <input
          placeholder="Fleet/current location URL"
          value={fleetUrl}
          onChange={(e) => setFleetUrl(e.target.value)}
        />

        <br />
        <br />

        <input
          placeholder="Username / Email"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />

        <br />
        <br />

        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <br />
        <br />

        <input
          placeholder="API Key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />

        <br />
        <br />

        <input
          placeholder="API Hash"
          value={apiHash}
          onChange={(e) => setApiHash(e.target.value)}
        />

        <br />
        <br />

        <button type="submit">Save Tracking Provider</button>
      </form>

      <p>Saved tracking providers: {trackingProviders.length}</p>

      <hr />

      <h2>4. Add Client Pricing Rule</h2>
      <p>Set the rate once. Nava uses it later to calculate journey revenue.</p>

      <form onSubmit={addRateRule}>
        <input
          placeholder="Client e.g. ENGAANO"
          value={clientName}
          onChange={(e) => setClientName(e.target.value.toUpperCase())}
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
        />

        <br />
        <br />

        <input
          placeholder="Rate amount e.g. 45"
          value={rateAmount}
          onChange={(e) => setRateAmount(e.target.value)}
          required
        />

        <br />
        <br />

        <select
          value={rateCurrency}
          onChange={(e) => {
            setRateCurrency(e.target.value);
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

        {rateCurrency !== "KES" && (
          <>
            <input
              placeholder="FX to KES e.g. 129"
              value={fxRate}
              onChange={(e) => setFxRate(e.target.value)}
            />

            <br />
            <br />
          </>
        )}

        <button type="submit">Save Pricing Rule</button>
      </form>

      <p>Saved pricing rules: {rateRules.length}</p>

      <hr />

      <h2>Finish</h2>

      <p>
        Minimum recommended setup: trucks + at least one geofence + pricing rule.
        Tracking provider can be completed later if API details are not ready.
      </p>

      <button onClick={finishOnboarding}>Finish Setup</button>
    </main>
  );
}
