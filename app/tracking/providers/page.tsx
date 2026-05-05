"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

const PROVIDER_TEMPLATES = [
  {
    name: "Nava Pulse",
    slug: "nava_pulse",
    description: "Nava-native tracking, fuel, CANBUS, and sensor intelligence.",
    auth_type: "api_key",
    base_url: "",
    login_url: "",
    fleet_url: "",
    is_nava_pulse: true,
    field_mapping: {
      truck: "truck",
      latitude: "latitude",
      longitude: "longitude",
      speed: "speed",
      fuel_level: "fuel_level",
      ignition: "ignition",
      recorded_at: "recorded_at",
    },
  },
  {
    name: "Bluetrax",
    slug: "bluetrax",
    description: "Popular fleet tracking provider in Kenya.",
    auth_type: "username_key",
    base_url: "https://public-api.bluetrax.co.ke",
    login_url: "https://public-api.bluetrax.co.ke/api/Login/Login",
    fleet_url:
      "https://public-api.bluetrax.co.ke/api/Public/fleet_current_locations",
    is_nava_pulse: false,
    field_mapping: {
      truck: "reg_no",
      latitude: "lat",
      longitude: "lng",
      speed: "speed",
      fuel_level: "fuellevel",
      ignition: "ignition",
      recorded_at: "fixtime",
    },
  },
  {
    name: "FleetTrack",
    slug: "fleettrack",
    description: "Widely used logistics GPS system.",
    auth_type: "api_hash",
    base_url: "https://fleettrack.africa/api",
    login_url: "",
    fleet_url: "https://fleettrack.africa/api/get_devices",
    is_nava_pulse: false,
    field_mapping: {
      truck: "name",
      latitude: "lat",
      longitude: "lng",
      speed: "speed",
      fuel_level: "fuel",
      ignition: "ignition",
      recorded_at: "time",
    },
  },
  {
    name: "Other GPS Provider",
    slug: "custom",
    description: "Connect any supported GPS provider using API details.",
    auth_type: "api_key",
    base_url: "",
    login_url: "",
    fleet_url: "",
    is_nava_pulse: false,
    field_mapping: {
      truck: "reg_no",
      latitude: "lat",
      longitude: "lng",
      speed: "speed",
      fuel_level: "fuel_level",
      ignition: "ignition",
      recorded_at: "time",
    },
  },
];

export default function TrackingProvidersPage() {
  const [tenantId, setTenantId] = useState("");
  const [providers, setProviders] = useState<any[]>([]);
  const [message, setMessage] = useState("");

  const [providerName, setProviderName] = useState("");
  const [providerSlug, setProviderSlug] = useState("");
  const [providerType, setProviderType] = useState("api");
  const [isNavaPulse, setIsNavaPulse] = useState(false);

  const [baseUrl, setBaseUrl] = useState("");
  const [loginUrl, setLoginUrl] = useState("");
  const [fleetUrl, setFleetUrl] = useState("");

  const [authType, setAuthType] = useState("api_key");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [bearerToken, setBearerToken] = useState("");

  const [tokenExpiryMinutes, setTokenExpiryMinutes] = useState("1440");
  const [tokenRefreshRequired, setTokenRefreshRequired] = useState(false);

  const [fieldMapping, setFieldMapping] = useState(
    JSON.stringify(PROVIDER_TEMPLATES[3].field_mapping, null, 2)
  );

  useEffect(() => {
    init();
  }, []);

  async function init() {
    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      window.location.href = "/login";
      return;
    }

    const { data: tenant } = await supabase.rpc("current_tenant_id");

    if (!tenant) {
      setMessage("No tenant linked to this user.");
      return;
    }

    setTenantId(tenant);
    loadProviders();
  }

  async function loadProviders() {
    const { data, error } = await supabase
      .from("tracking_providers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(error.message);
      return;
    }

    setProviders(data || []);
  }

  function selectTemplate(template: any) {
    setProviderName(template.name);
    setProviderSlug(template.slug);
    setProviderType("api");
    setAuthType(template.auth_type);
    setBaseUrl(template.base_url || "");
    setLoginUrl(template.login_url || "");
    setFleetUrl(template.fleet_url || "");
    setIsNavaPulse(template.is_nava_pulse || false);
    setFieldMapping(JSON.stringify(template.field_mapping || {}, null, 2));
    setMessage(`${template.name} selected. Confirm details and save.`);
  }

  function resetForm() {
    setProviderName("");
    setProviderSlug("");
    setProviderType("api");
    setBaseUrl("");
    setLoginUrl("");
    setFleetUrl("");
    setAuthType("api_key");
    setUsername("");
    setPassword("");
    setApiKey("");
    setApiHash("");
    setBearerToken("");
    setTokenExpiryMinutes("1440");
    setTokenRefreshRequired(false);
    setIsNavaPulse(false);
    setFieldMapping(JSON.stringify(PROVIDER_TEMPLATES[3].field_mapping, null, 2));
  }

  async function saveProvider(e: any) {
    e.preventDefault();

    if (!tenantId) {
      setMessage("Tenant missing. Login again.");
      return;
    }

    let parsedMapping = {};

    try {
      parsedMapping = JSON.parse(fieldMapping || "{}");
    } catch {
      setMessage("Field mapping must be valid JSON.");
      return;
    }

    const { error } = await supabase.from("tracking_providers").insert([
      {
        tenant_id: tenantId,
        provider_name: providerName.trim().toUpperCase(),
        provider_slug: providerSlug || "custom",
        provider_type: providerType,
        base_url: baseUrl.trim() || null,
        login_url: loginUrl.trim() || null,
        fleet_url: fleetUrl.trim() || null,
        auth_type: authType,
        username: username.trim() || null,
        password: password.trim() || null,
        api_key: apiKey.trim() || null,
        api_hash: apiHash.trim() || null,
        bearer_token: bearerToken.trim() || null,
        token_expiry_minutes: Number(tokenExpiryMinutes || 1440),
        token_refresh_required: tokenRefreshRequired,
        field_mapping: parsedMapping,
        last_test_status: "not_tested",
        is_active: true,
        is_nava_pulse: isNavaPulse,
      },
    ]);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Tracking provider saved ✅");
    resetForm();
    loadProviders();
  }

  async function testProvider(provider: any) {
    if (provider.is_nava_pulse) {
      await supabase
        .from("tracking_providers")
        .update({
          last_test_status: "connected",
          last_test_message: "Nava Pulse connection is ready.",
          last_test_at: new Date().toISOString(),
        })
        .eq("id", provider.id);

      setMessage("Nava Pulse ready ✅");
      loadProviders();
      return;
    }

    setMessage(`Testing ${provider.provider_name}...`);

    const response = await fetch("/api/tracking/test-provider", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(provider),
    });

    const result = await response.json();

    await supabase
      .from("tracking_providers")
      .update({
        last_test_status: result.ok ? "connected" : "failed",
        last_test_message: result.message || "No message",
        last_test_at: new Date().toISOString(),
      })
      .eq("id", provider.id);

    setMessage(result.ok ? `Connected ✅` : `Failed ❌ ${result.message}`);
    loadProviders();
  }

  async function toggleProvider(provider: any) {
    await supabase
      .from("tracking_providers")
      .update({ is_active: !provider.is_active })
      .eq("id", provider.id);

    loadProviders();
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Tracking Providers</h1>
      <p>
        Connect GPS systems or activate Nava Pulse. Nava translates tracking,
        fuel, CANBUS, and sensor data into Nava Eye intelligence.
      </p>

      {message && (
        <pre style={{ background: "#f4f4f4", padding: 12 }}>{message}</pre>
      )}

      <h2>Connect Your Tracking System</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {PROVIDER_TEMPLATES.map((template) => (
          <button
            key={template.slug}
            onClick={() => selectTemplate(template)}
            style={{
              textAlign: "left",
              padding: 16,
              border: "1px solid #ddd",
              background: providerSlug === template.slug ? "#f4f4f4" : "white",
              cursor: "pointer",
            }}
          >
            <strong>{template.name}</strong>
            <br />
            <small>{template.description}</small>
          </button>
        ))}
      </div>

      <br />
      <hr />
      <br />

      <h2>Connection Details</h2>

      <form onSubmit={saveProvider}>
        <input
          placeholder="Provider name"
          value={providerName}
          onChange={(e) => setProviderName(e.target.value)}
          required
        />

        <br /><br />

        <select value={providerType} onChange={(e) => setProviderType(e.target.value)}>
          <option value="api">API</option>
          <option value="csv_upload">CSV Upload</option>
          <option value="manual">Manual</option>
        </select>

        <br /><br />

        <select value={authType} onChange={(e) => setAuthType(e.target.value)}>
          <option value="api_key">API Key</option>
          <option value="username_key">Username + Key</option>
          <option value="email_password">Email + Password</option>
          <option value="api_hash">API Hash</option>
          <option value="bearer_token">Bearer Token</option>
          <option value="basic">Basic Auth</option>
          <option value="none">No Auth / Public Endpoint</option>
        </select>

        <br /><br />

        <input placeholder="Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        <br /><br />
        <input placeholder="Login URL optional" value={loginUrl} onChange={(e) => setLoginUrl(e.target.value)} />
        <br /><br />
        <input placeholder="Fleet/current location URL" value={fleetUrl} onChange={(e) => setFleetUrl(e.target.value)} />
        <br /><br />

        {(authType === "username_key" || authType === "email_password" || authType === "basic") && (
          <>
            <input placeholder="Username / Email" value={username} onChange={(e) => setUsername(e.target.value)} />
            <br /><br />
            <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <br /><br />
          </>
        )}

        {(authType === "api_key" || authType === "username_key") && (
          <>
            <input placeholder="API Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            <br /><br />
          </>
        )}

        {authType === "api_hash" && (
          <>
            <input placeholder="API Hash" value={apiHash} onChange={(e) => setApiHash(e.target.value)} />
            <br /><br />
          </>
        )}

        {authType === "bearer_token" && (
          <>
            <input placeholder="Bearer Token" value={bearerToken} onChange={(e) => setBearerToken(e.target.value)} />
            <br /><br />
          </>
        )}

        <label>
          Token expiry minutes
          <br />
          <input value={tokenExpiryMinutes} onChange={(e) => setTokenExpiryMinutes(e.target.value)} />
        </label>

        <br /><br />

        <label>
          <input
            type="checkbox"
            checked={tokenRefreshRequired}
            onChange={(e) => setTokenRefreshRequired(e.target.checked)}
          />
          Token refresh required
        </label>

        <br /><br />

        <label>
          <input
            type="checkbox"
            checked={isNavaPulse}
            onChange={(e) => setIsNavaPulse(e.target.checked)}
          />
          Nava Pulse connection
        </label>

        <br /><br />

        <h3>Field Mapping</h3>
        <textarea
          value={fieldMapping}
          onChange={(e) => setFieldMapping(e.target.value)}
          style={{ width: "100%", height: 180 }}
        />

        <br /><br />

        <button type="submit">Save Provider</button>
      </form>

      <br />
      <hr />
      <br />

      <h2>Saved Providers</h2>

      {providers.length === 0 ? (
        <p>No tracking providers saved yet.</p>
      ) : (
        <table border={1} cellPadding={10}>
          <thead>
            <tr>
              <th>Status</th>
              <th>Provider</th>
              <th>Auth</th>
              <th>Fleet URL</th>
              <th>Last Test</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((provider) => (
              <tr key={provider.id}>
                <td>{provider.is_active ? "Active" : "Inactive"}</td>
                <td>
                  {provider.provider_name}
                  {provider.is_nava_pulse && (
                    <>
                      <br />
                      <strong>Nava Pulse</strong>
                    </>
                  )}
                </td>
                <td>{provider.auth_type}</td>
                <td>{provider.fleet_url || "—"}</td>
                <td>
                  {provider.last_test_status || "not_tested"}
                  <br />
                  <small>{provider.last_test_message || ""}</small>
                </td>
                <td>
                  <button onClick={() => testProvider(provider)}>Test Connection</button>{" "}
                  <button onClick={() => toggleProvider(provider)}>
                    {provider.is_active ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
