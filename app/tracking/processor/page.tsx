"use client";

import { useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function TrackingProcessorPage() {
  const [rawJson, setRawJson] = useState("");
  const [result, setResult] = useState("");

  function getValue(obj: any, possibleFields: string[]) {
    for (const field of possibleFields) {
      if (obj[field] !== undefined && obj[field] !== null && obj[field] !== "") {
        return obj[field];
      }
    }
    return null;
  }

  async function reverseGeocode(latitude: number, longitude: number) {
    try {
      const response = await fetch("/api/reverse-geocode", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ latitude, longitude }),
      });

      const data = await response.json();

      return data.readable_location || data.full_location || null;
    } catch {
      return null;
    }
  }

  function interpretMovement(speed: number | null, ignition: any) {
    if (speed !== null && speed > 5) return "MOVING";
    if (ignition === "ON" || ignition === true || ignition === "on") {
      return "IDLE";
    }
    return "STOPPED";
  }

  function buildRisk(speed: number | null, fuelLevel: number | null) {
    if (fuelLevel !== null && fuelLevel < 15) return "medium";
    if (speed !== null && speed > 80) return "medium";
    return "normal";
  }

  async function processTrackingData() {
    try {
      const parsed = JSON.parse(rawJson);

      let vehicles: any[] = [];

      if (Array.isArray(parsed)) {
        vehicles = parsed;
      } else if (Array.isArray(parsed.data)) {
        vehicles = parsed.data;
      } else if (Array.isArray(parsed.items)) {
        vehicles = parsed.items;
      } else if (parsed.data && Array.isArray(parsed.data.items)) {
        vehicles = parsed.data.items;
      } else {
        vehicles = [parsed];
      }

      const rows = [];

      for (const vehicle of vehicles) {
        const truck =
          getValue(vehicle, [
            "reg_no",
            "registration",
            "registration_number",
            "plate_number",
            "vehicle",
            "Vehicle",
            "name",
            "device_name",
          ]) || "UNKNOWN";

        const latitude = Number(
          getValue(vehicle, ["lat", "latitude", "Latitude", "y"])
        );

        const longitude = Number(
          getValue(vehicle, ["lng", "lon", "longitude", "Longitude", "x"])
        );

        const speedRaw = getValue(vehicle, ["speed", "Speed", "velocity"]);
        const speed = speedRaw !== null ? Number(speedRaw) : null;

        const fuelRaw = getValue(vehicle, [
          "fuel",
          "fuel_level",
          "fuellevel",
          "FuelLevel",
          "CurrentFuelLevel",
          "tank_level",
        ]);

        const fuelLevel = fuelRaw !== null ? Number(fuelRaw) : null;

        const odometerRaw = getValue(vehicle, [
          "odometer",
          "mileage",
          "Mileage",
          "total_distance",
        ]);

        const odometer = odometerRaw !== null ? Number(odometerRaw) : null;

        const ignition = getValue(vehicle, [
          "ignition",
          "ignition_status",
          "engine_status",
        ]);

        const recordedAt =
          getValue(vehicle, [
            "timestamp",
            "time",
            "fixtime",
            "CurrentTime",
            "recorded_at",
          ]) || new Date().toISOString();

        const providerLocation =
          getValue(vehicle, [
            "location",
            "CurrentLocation",
            "address",
            "Location",
          ]) || null;

        let interpretedLocation = providerLocation;

        if (!interpretedLocation && !isNaN(latitude) && !isNaN(longitude)) {
          interpretedLocation = await reverseGeocode(latitude, longitude);
        }

        if (!interpretedLocation) {
          interpretedLocation = "Location needs review";
        }

        const movement = interpretMovement(speed, ignition);
        const risk = buildRisk(speed, fuelLevel);

        let alert = "";

        if (risk === "medium") {
          alert = "⚠️ Review required.";
        }

        if (fuelLevel !== null && fuelLevel < 15) {
          alert = "⛽ Low fuel risk.";
        }

        const summary = `${truck} is ${movement.toLowerCase()} near ${interpretedLocation}. Speed: ${
          speed ?? "unknown"
        } km/h. Fuel: ${fuelLevel ?? "unknown"}.${alert ? " " + alert : ""}`;

        rows.push({
          truck_text: truck.toString().trim().toUpperCase(),
          latitude: isNaN(latitude) ? null : latitude,
          longitude: isNaN(longitude) ? null : longitude,
          speed,
          fuel_level: fuelLevel,
          odometer,
          ignition_status: ignition ? String(ignition).toUpperCase() : null,
          location_text: providerLocation,
          interpreted_location: interpretedLocation,
          nearest_town: interpretedLocation,
          nearest_geofence: null,
          movement_status: movement,
          risk_level: risk,
          nava_eye_summary: summary,
          recorded_at: recordedAt,
          raw_data: vehicle,
        });
      }

      const { error } = await supabase.from("tracking_points").insert(rows);

      if (error) {
        alert(error.message);
        return;
      }

      setResult(`Processed ${rows.length} tracking point(s) ✅`);
    } catch (err: any) {
      alert(err.message || "Invalid JSON");
    }
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Nava Eye Tracking Processor</h1>
      <p>
        Paste raw GPS/provider response. Nava Eye converts coordinates into
        readable locations.
      </p>

      <textarea
        placeholder='Paste raw JSON here e.g. [{"reg_no":"KBJ123A","lat":-3.396,"lng":38.556,"speed":0,"fuellevel":55}]'
        value={rawJson}
        onChange={(e) => setRawJson(e.target.value)}
        style={{ width: "100%", height: 220 }}
      />

      <br />
      <br />

      <button onClick={processTrackingData}>Process with Nava Eye</button>

      <br />
      <br />

      {result && <strong>{result}</strong>}
    </main>
  );
}
