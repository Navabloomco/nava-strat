"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function LinkTrackingPage() {
  const [trucks, setTrucks] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const { data: trucksData } = await supabase.from("trucks").select("*");
    const { data: providersData } = await supabase
      .from("tracking_providers")
      .select("*")
      .eq("is_active", true);

    setTrucks(trucksData || []);
    setProviders(providersData || []);
  }

  async function saveLink(truckId: string, providerId: string, externalId: string) {
    const { error } = await supabase
      .from("trucks")
      .update({
        tracking_provider_id: providerId,
        external_vehicle_id: externalId,
      })
      .eq("id", truckId);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Linked successfully ✅");
    loadData();
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Link Trucks to Tracking</h1>
      <p>Connect each truck to its GPS provider and vehicle ID.</p>

      {message && <p>{message}</p>}

      {trucks.map((truck) => (
        <div
          key={truck.id}
          style={{
            border: "1px solid #ddd",
            padding: 20,
            marginBottom: 10,
          }}
        >
          <strong>{truck.registration}</strong>

          <div style={{ marginTop: 10 }}>
            <select
              defaultValue={truck.tracking_provider_id || ""}
              onChange={(e) =>
                (truck.selectedProvider = e.target.value)
              }
            >
              <option value="">Select Provider</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.provider_name}
                </option>
              ))}
            </select>

            <input
              placeholder="External Vehicle ID"
              defaultValue={truck.external_vehicle_id || ""}
              onChange={(e) =>
                (truck.externalId = e.target.value)
              }
              style={{ marginLeft: 10 }}
            />

            <button
              onClick={() =>
                saveLink(
                  truck.id,
                  truck.selectedProvider,
                  truck.externalId
                )
              }
              style={{ marginLeft: 10 }}
            >
              Save
            </button>
          </div>
        </div>
      ))}
    </main>
  );
}
