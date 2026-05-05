"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

const PROVIDER_TEMPLATES = [
  {
    name: "Bluetrax",
    slug: "bluetrax",
    description: "Popular fleet tracking provider in Kenya.",
    auth_type: "username_key",
    base_url: "https://public-api.bluetrax.co.ke",
    login_url: "https://public-api.bluetrax.co.ke/api/Login/Login",
    fleet_url:
      "https://public-api.bluetrax.co.ke/api/Public/fleet_current_locations",
  },
  {
    name: "FleetTrack",
    slug: "fleettrack",
    description: "Widely used logistics GPS system.",
    auth_type: "api_hash",
    base_url: "https://fleettrack.africa/api",
    fleet_url: "https://fleettrack.africa/api/get_devices",
  },
  {
    name: "Other GPS Provider",
    slug: "custom",
    description: "Connect your provider using API or credentials.",
    auth_type: "api_key",
    base_url: "",
    fleet_url: "",
  },
];

export default function ProvidersPage() {
  const [selected, setSelected] = useState<any>(null);

  const [form, setForm] = useState({
    provider_name: "",
    base_url: "",
    login_url: "",
    fleet_url: "",
    username: "",
    password: "",
    api_key: "",
    api_hash: "",
  });

  const handleTemplate = (tpl: any) => {
    setSelected(tpl);
    setForm({
      provider_name: tpl.name,
      base_url: tpl.base_url || "",
      login_url: tpl.login_url || "",
      fleet_url: tpl.fleet_url || "",
      username: "",
      password: "",
      api_key: "",
      api_hash: "",
    });
  };

  const handleSave = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("Not logged in");
      return;
    }

    // fetch tenant
    const { data: tenantRow } = await supabase
      .from("user_tenants")
      .select("tenant_id")
      .eq("user_id", user.id)
      .single();

    if (!tenantRow) {
      alert("No tenant found");
      return;
    }

    const { error } = await supabase.from("tracking_providers").insert({
      tenant_id: tenantRow.tenant_id,
      provider_name: form.provider_name,
      base_url: form.base_url,
      username: form.username,
      password: form.password,
      api_key: form.api_key,
      api_hash: form.api_hash,
      auth_type: selected?.auth_type || "api_key",
    });

    if (error) {
      console.error(error);
      alert("Failed to save provider");
    } else {
      alert("Provider saved ✅");
    }
  };

  return (
    <div style={{ padding: 40 }}>
      <h1>Tracking Providers</h1>
      <p>
        Connect your GPS system. Nava will automatically translate data into
        Nava Eye.
      </p>

      <h2>Choose Provider</h2>

      <div style={{ display: "flex", gap: 16 }}>
        {PROVIDER_TEMPLATES.map((tpl) => (
          <div
            key={tpl.slug}
            onClick={() => handleTemplate(tpl)}
            style={{
              border: "1px solid #ccc",
              padding: 16,
              cursor: "pointer",
              width: 220,
              background:
                selected?.slug === tpl.slug ? "#eef" : "transparent",
            }}
          >
            <strong>{tpl.name}</strong>
            <p>{tpl.description}</p>
          </div>
        ))}
      </div>

      <hr style={{ margin: "30px 0" }} />

      <h2>Connection Details</h2>

      <input
        placeholder="Provider name"
        value={form.provider_name}
        onChange={(e) =>
          setForm({ ...form, provider_name: e.target.value })
        }
      />

      <br />
      <input
        placeholder="Base URL"
        value={form.base_url}
        onChange={(e) =>
          setForm({ ...form, base_url: e.target.value })
        }
      />

      <br />
      <input
        placeholder="Login URL"
        value={form.login_url}
        onChange={(e) =>
          setForm({ ...form, login_url: e.target.value })
        }
      />

      <br />
      <input
        placeholder="Fleet endpoint"
        value={form.fleet_url}
        onChange={(e) =>
          setForm({ ...form, fleet_url: e.target.value })
        }
      />

      <br />
      <input
        placeholder="Username"
        value={form.username}
        onChange={(e) =>
          setForm({ ...form, username: e.target.value })
        }
      />

      <br />
      <input
        placeholder="Password"
        type="password"
        value={form.password}
        onChange={(e) =>
          setForm({ ...form, password: e.target.value })
        }
      />

      <br />
      <input
        placeholder="API Key"
        value={form.api_key}
        onChange={(e) =>
          setForm({ ...form, api_key: e.target.value })
        }
      />

      <br />
      <input
        placeholder="API Hash"
        value={form.api_hash}
        onChange={(e) =>
          setForm({ ...form, api_hash: e.target.value })
        }
      />

      <br />
      <br />

      <button onClick={handleSave}>Save Provider</button>
    </div>
  );
}
