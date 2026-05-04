"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function TrackingProvidersPage() {
  const [providers, setProviders] = useState<any[]>([]);

  const [providerName, setProviderName] = useState("");
  const [providerType, setProviderType] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [loginUrl, setLoginUrl] = useState("");
  const [fleetUrl, setFleetUrl] = useState("");
  const [authType, setAuthType] = useState("api_key");

  const [username, setUsername] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [password, setPassword] = useState("");
  const [apiHash, setApiHash] = useState("");

  const [latitudeField, setLatitudeField] = useState("lat");
  const [longitudeField, setLongitudeField] = useState("lng");
  const [vehicleField, setVehicleField] = useState("registration");
  const [speedField, setSpeedField] = useState("speed");
  const [fuelField, setFuelField] = useState("fuel_level");
  const [odometerField, setOdometerField] = useState("odometer");

  useEffect(() => {
    loadProviders();
  }, []);

  async function loadProviders() {
    const { data, error } = await supabase
      .from("tracking_providers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      alert(error.message);
      return;
    }

    setProviders(data || []);
  }

  async function saveProvider(e: any) {
    e.preventDefault();

    const { error } = await supabase.from("tracking_providers").insert([
      {
        provider_name: providerName.trim().toUpperCase(),
        provider_type: providerType.trim().toUpperCase(),
        base_url: baseUrl.trim(),
        login_url: loginUrl.trim(),
        fleet_url: fleetUrl.trim(),
        auth_type: authType,
        username: username.trim(),
        api_key: apiKey.trim(),
        password: password.trim(),
        api_hash: apiHash.trim(),
        latitude_field: latitudeField.trim(),
        longitude_field: longitudeField.trim(),
        vehicle_field: vehicleField.trim(),
        speed_field: speedField.trim(),
        fuel_field: fuelField.trim(),
        odometer_field: odometerField.trim(),
        token_refresh_required: true,
        is_active: true,
      },
    ]);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Tracking provider saved ✅");

    setProviderName("");
    setProviderType("");
    setBaseUrl("");
    setLoginUrl("");
    setFleetUrl("");
    setAuthType("api_key");
    setUsername("");
    setApiKey("");
    setPassword("");
    setApiHash("");
    setLatitudeField("lat");
    setLongitudeField("lng");
    setVehicleField("registration");
    setSpeedField("speed");
    setFuelField("fuel_level");
    setOdometerField("odometer");

    loadProviders();
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Tracking Providers</h1>
      <p>
        Connect GPS providers. Nava Eye normalizes all provider data into one
        tracking layer.
      </p>

      <form onSubmit={saveProvider}>
        <h2>Provider Details</h2>

        <input
          placeholder="Provider name e.g. BLUETRAX"
          value={providerName}
          onChange={(e) => setProviderName(e.target.value.toUpperCase())}
          required
        />

        <br /><br />

        <input
          placeholder="Provider type e.g. GPS, CANBUS, FUEL_ROD"
          value={providerType}
          onChange={(e) => setProviderType(e.target.value.toUpperCase())}
        />

        <br /><br />

        <input
          placeholder="Base URL"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="Login URL"
          value={loginUrl}
          onChange={(e) => setLoginUrl(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="Fleet / current locations URL"
          value={fleetUrl}
          onChange={(e) => setFleetUrl(e.target.value)}
        />

        <br /><br />

        <h2>Authentication</h2>

        <select value={authType} onChange={(e) => setAuthType(e.target.value)}>
          <option value="api_key">API Key</option>
          <option value="username_key">Username + Key</option>
          <option value="email_password">Email + Password</option>
          <option value="api_hash">API Hash</option>
          <option value="bearer_token">Bearer Token</option>
        </select>

        <br /><br />

        <input
          placeholder="Username / Email"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="API Key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="API Hash"
          value={apiHash}
          onChange={(e) => setApiHash(e.target.value)}
        />

        <br /><br />

        <h2>Field Mapping</h2>
        <p>Tell Nava Eye what each provider calls the important fields.</p>

        <input
          placeholder="Latitude field e.g. lat"
          value={latitudeField}
          onChange={(e) => setLatitudeField(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="Longitude field e.g. lng"
          value={longitudeField}
          onChange={(e) => setLongitudeField(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="Vehicle field e.g. reg_no, name, plate_number"
          value={vehicleField}
          onChange={(e) => setVehicleField(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="Speed field e.g. speed"
          value={speedField}
          onChange={(e) => setSpeedField(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="Fuel field e.g. fuellevel, CurrentFuelLevel"
          value={fuelField}
          onChange={(e) => setFuelField(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="Odometer field e.g. mileage, odometer"
          value={odometerField}
          onChange={(e) => setOdometerField(e.target.value)}
        />

        <br /><br />

        <button type="submit">Save Tracking Provider</button>
      </form>

      <br /><br />

      <h2>Saved Providers</h2>

      {providers.length === 0 ? (
        <p>No tracking providers saved yet.</p>
      ) : (
        <table border={1} cellPadding={10}>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Type</th>
              <th>Auth</th>
              <th>Fleet URL</th>
              <th>Vehicle Field</th>
              <th>Lat/Lng Fields</th>
              <th>Fuel Field</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {providers.map((provider) => (
              <tr key={provider.id}>
                <td>{provider.provider_name}</td>
                <td>{provider.provider_type || "—"}</td>
                <td>{provider.auth_type || "—"}</td>
                <td>{provider.fleet_url || "—"}</td>
                <td>{provider.vehicle_field || "—"}</td>
                <td>
                  {provider.latitude_field || "—"} /{" "}
                  {provider.longitude_field || "—"}
                </td>
                <td>{provider.fuel_field || "—"}</td>
                <td>{provider.is_active ? "Active" : "Inactive"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
