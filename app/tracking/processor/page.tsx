"use client";

import { useEffect, useState } from "react";
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
    for (const field of fields) {
      if (obj[field] !== undefined && obj[field] !== null && obj[field] !== "") {
        return obj[field];
      }
    }
    return null;
  }

  function normalizeIgnition(value: any) {
    if (
      value === true ||
      value === "true" ||
      value === "TRUE" ||
      value === "ON" ||
      value === "On" ||
      value === "on" ||
      value === 1 ||
      value === "1"
    ) {
      return "ON";
    }

    if (
      value === false ||
      value === "false" ||
      value === "FALSE" ||
      value === "OFF" ||
      value === "Off" ||
      value === "off" ||
      value === 0 ||
      value === "0"
    ) {
      return "OFF";
    }

    return "UNKNOWN";
  }

  function distanceMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ) {
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
    if (isNaN(lat) || isNaN(lng) || geofences.length === 0) return null;

    let matched = null;
    let closestDistance = Infinity;

    for (const geofence of geofences) {
      const distance = distanceMeters(
        lat,
        lng,
        Number(geofence.latitude),
        Number(geofence.longitude)
      );

      if (
        distance <= Number(geofence.radius_meters || 200) &&
        distance < closestDistance
      ) {
        matched = {
          ...geofence,
          distance_meters: distance,
        };
        closestDistance = distance;
      }
    }

    return matched;
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

      return {
        readable: data.readable_location || data.full_location || null,
        area: data.area || null,
        city: data.city || null,
        region: data.region || null,
        country: data.country || null,
        full: data.full_location || null,
      };
    } catch {
      return {
        readable: null,
        area: null,
        city: null,
        region: null,
        country: null,
        full: null,
      };
    }
  }

  function interpretMovement(speed: number | null, ignitionStatus: string) {
    if (speed !== null && speed > 5) return "MOVING";
    if (ignitionStatus === "ON") return "IDLE";
    if (ignitionStatus === "OFF") return "STOPPED";
    return speed !== null && speed <= 5 ? "STOPPED" : "UNKNOWN";
  }

  function buildRisk(
    speed: number | null,
    fuelLevel: number | null,
    ignitionStatus: string,
    journeyLinked: boolean
  ) {
    if (fuelLevel !== null && fuelLevel < 15) return "medium";
    if (speed !== null && speed > 80) return "medium";
    if (!journeyLinked) return "medium";
    if (ignitionStatus === "ON" && speed !== null && speed <= 5) return "medium";
    return "normal";
  }

  async function findActiveJourneyForTruck(truck: string) {
    const cleanTruck = truck.toString().trim().toUpperCase();

    const { data, error } = await supabase
      .from("journeys")
      .select("*")
      .eq("truck", cleanTruck)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) return null;

    return data[0];
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

        const cleanTruck = truck.toString().trim().toUpperCase();

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

        const ignitionRaw = getValue(vehicle, [
          "ignition",
          "ignition_status",
          "engine_status",
          "engine",
          "acc",
          "ACC",
          "power",
          "sensors_ignition",
        ]);

        const ignitionStatus = normalizeIgnition(ignitionRaw);

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

        const geofence = detectGeofence(latitude, longitude);

        let locationInfo = {
          readable: providerLocation,
          area: null as string | null,
          city: null as string | null,
          region: null as string | null,
          country: null as string | null,
          full: providerLocation,
        };

        if (!geofence && !providerLocation && !isNaN(latitude) && !isNaN(longitude)) {
          locationInfo = await reverseGeocode(latitude, longitude);
        }

        const interpretedLocation = geofence
          ? `${geofence.name} (${geofence.type || "geofence"})`
          : locationInfo.readable || providerLocation || "Location needs review";

        const activeJourney = await findActiveJourneyForTruck(cleanTruck);
        const journeyId = activeJourney?.id || null;

        const movement = interpretMovement(speed, ignitionStatus);
        let risk = buildRisk(speed, fuelLevel, ignitionStatus, !!activeJourney);

        let alert = "";

        if (!activeJourney) {
          alert = "⚠️ No active journey linked.";
        }

        if (fuelLevel !== null && fuelLevel < 15) {
          alert = "⛽ Low fuel risk.";
        }

        if (speed !== null && speed > 80) {
          alert = "⚠️ Overspeed risk.";
        }

        if (ignitionStatus === "ON" && speed !== null && speed <= 5) {
          alert = "⚠️ Ignition on while stationary.";
        }

        if (geofence && geofence.type === "fuel") {
          alert = alert || "⛽ At fuel location.";
        }

        const journeyText = activeJourney
          ? `Journey: ${activeJourney.client_name || "NO CLIENT"} — ${
              activeJourney.from_location || "—"
            } → ${activeJourney.to_location || "—"}.`
          : "No active journey found.";

        const ignitionText =
          ignitionStatus === "UNKNOWN"
            ? "Ignition: unknown."
            : `Ignition: ${ignitionStatus}.`;

        const summary = `${cleanTruck} is ${movement.toLowerCase()} at ${interpretedLocation}. ${journeyText} ${ignitionText} Speed: ${
          speed ?? "unknown"
        } km/h. Fuel: ${fuelLevel ?? "unknown"}.${alert ? " " + alert : ""}`;

        rows.push({
          truck_text: cleanTruck,
          latitude: isNaN(latitude) ? null : latitude,
          longitude: isNaN(longitude) ? null : longitude,
          speed,
          fuel_level: fuelLevel,
          odometer,
          ignition_status: ignitionStatus,
          location_text: providerLocation,
          interpreted_location: interpretedLocation,
          nearest_town: locationInfo.city || interpretedLocation,
          nearest_geofence: geofence?.name || null,
          location_area: locationInfo.area,
          location_city: locationInfo.city,
          location_region: locationInfo.region,
          location_country: locationInfo.country,
          movement_status: movement,
          risk_level: risk,
          nava_eye_summary: summary,
          journey_id: journeyId,
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
      <h1>Nava Eye Processor</h1>
      <p>
        Paste raw GPS/provider response. Nava Eye detects location, geofences,
        ignition, risks, and active journeys.
      </p>

      <textarea
        placeholder='Paste raw JSON here e.g. [{"reg_no":"KBJ123A","lat":-1.3032,"lng":36.7073,"speed":0,"fuellevel":55,"ignition":"ON"}]'
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
