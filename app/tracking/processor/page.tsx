"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

export default function TrackingProcessorPage() {
  const [rawJson, setRawJson] = useState("");
  const [result, setResult] = useState("");
  const [geofences, setGeofences] = useState<any[]>([]);

  useEffect(() => {
    loadGeofences();
  }, []);

  async function loadGeofences() {
    const { data } = await supabase.from("geofences").select("*");
    setGeofences(data || []);
  }

  function getValue(obj: any, fields: string[]) {
    for (const f of fields) {
      if (obj[f] !== undefined && obj[f] !== null && obj[f] !== "") return obj[f];
    }
    return null;
  }

  function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;

    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  function detectGeofence(lat: number, lng: number) {
    if (!lat || !lng || geofences.length === 0) return null;

    for (const g of geofences) {
      const dist = distanceMeters(lat, lng, g.latitude, g.longitude);

      if (dist <= g.radius_meters) {
        return g;
      }
    }

    return null;
  }

  async function reverseGeocode(latitude: number, longitude: number) {
    try {
      const res = await fetch("/api/reverse-geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude, longitude }),
      });

      const data = await res.json();

      return {
        readable: data.readable_location,
        area: data.area,
        city: data.city,
        region: data.region,
      };
    } catch {
      return { readable: null, area: null, city: null, region: null };
    }
  }

  function movement(speed: number | null) {
    if (speed !== null && speed > 5) return "MOVING";
    return "STOPPED";
  }

  async function processTrackingData() {
    try {
      const parsed = JSON.parse(rawJson);
      const vehicles = Array.isArray(parsed)
        ? parsed
        : parsed.data || parsed.items || [parsed];

      const rows = [];

      for (const v of vehicles) {
        const truck =
          getValue(v, [
            "reg_no",
            "registration",
            "vehicle",
            "name",
            "device_name",
          ]) || "UNKNOWN";

        const lat = Number(getValue(v, ["lat", "latitude"]));
        const lng = Number(getValue(v, ["lng", "lon", "longitude"]));
        const speed = Number(getValue(v, ["speed", "velocity"])) || 0;
        const fuel = Number(getValue(v, ["fuel", "fuel_level"])) || null;

        let geo = detectGeofence(lat, lng);

        let locationInfo = null;

        if (!geo) {
          locationInfo = await reverseGeocode(lat, lng);
        }

        const locationText = geo
          ? `${geo.name} (${geo.type})`
          : locationInfo?.readable || "Location needs review";

        let alert = "";

        if (fuel !== null && fuel < 15) alert = "⛽ Low fuel";
        if (speed > 80) alert = "⚠️ Overspeed";

        const summary = `${truck.toUpperCase()} is ${movement(speed).toLowerCase()} at ${locationText}. Speed: ${speed} km/h. Fuel: ${fuel ?? "unknown"}. ${alert}`;

        rows.push({
          truck_text: truck.toUpperCase(),
          latitude: lat,
          longitude: lng,
          speed,
          fuel_level: fuel,
          interpreted_location: locationText,
          nearest_geofence: geo?.name || null,
          movement_status: movement(speed),
          risk_level: alert ? "medium" : "normal",
          nava_eye_summary: summary,
          recorded_at: new Date().toISOString(),
          raw_data: v,
        });
      }

      const { error } = await supabase.from("tracking_points").insert(rows);

      if (error) return alert(error.message);

      setResult(`Processed ${rows.length} tracking point(s) ✅`);
    } catch (err: any) {
      alert(err.message);
    }
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Nava Eye Processor (Geofence Enabled)</h1>

      <textarea
        value={rawJson}
        onChange={(e) => setRawJson(e.target.value)}
        style={{ width: "100%", height: 200 }}
      />

      <br /><br />

      <button onClick={processTrackingData}>
        Process with Nava Eye
      </button>

      <br /><br />

      {result && <strong>{result}</strong>}
    </main>
  );
}
