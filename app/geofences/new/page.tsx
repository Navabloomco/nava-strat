"use client";

import { useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function NewGeofencePage() {
  const [name, setName] = useState("");
  const [type, setType] = useState("client");
  const [mapsLink, setMapsLink] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [radius, setRadius] = useState("200");

  function extractLatLngFromGoogle(link: string) {
    try {
      const regex = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
      const match = link.match(regex);

      if (match) {
        return {
          lat: match[1],
          lng: match[2],
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  function suggestRadius(type: string) {
    switch (type) {
      case "fuel":
        return 150;
      case "border":
        return 1500;
      case "yard":
        return 400;
      case "client":
        return 300;
      default:
        return 200;
    }
  }

  function handleTypeChange(value: string) {
    setType(value);
    setRadius(String(suggestRadius(value)));
  }

  function handleExtract() {
    const result = extractLatLngFromGoogle(mapsLink);

    if (!result) {
      alert("Could not extract coordinates from link");
      return;
    }

    setLatitude(result.lat);
    setLongitude(result.lng);
  }

  async function handleSave(e: any) {
    e.preventDefault();

    const latNum = Number(latitude);
    const lngNum = Number(longitude);
    const radiusNum = Number(radius);

    if (!latNum || !lngNum) {
      alert("Latitude and Longitude required");
      return;
    }

    const { error } = await supabase.from("geofences").insert([
      {
        name: name.trim(),
        type,
        latitude: latNum,
        longitude: lngNum,
        radius_meters: radiusNum,
      },
    ]);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Geofence saved ✅");

    setName("");
    setMapsLink("");
    setLatitude("");
    setLongitude("");
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Create Geofence</h1>
      <p>Nava Eye will use this to detect truck presence automatically.</p>

      <form onSubmit={handleSave}>
        <input
          placeholder="Name e.g. Shell Bonje / GBHL Mombasa"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <br /><br />

        <select value={type} onChange={(e) => handleTypeChange(e.target.value)}>
          <option value="client">Client Site</option>
          <option value="fuel">Fuel Station</option>
          <option value="yard">Yard / Depot</option>
          <option value="border">Border</option>
        </select>

        <br /><br />

        <input
          placeholder="Paste Google Maps link"
          value={mapsLink}
          onChange={(e) => setMapsLink(e.target.value)}
        />

        <button type="button" onClick={handleExtract}>
          Extract Coordinates
        </button>

        <br /><br />

        <input
          placeholder="Latitude"
          value={latitude}
          onChange={(e) => setLatitude(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="Longitude"
          value={longitude}
          onChange={(e) => setLongitude(e.target.value)}
        />

        <br /><br />

        <input
          placeholder="Radius (meters)"
          value={radius}
          onChange={(e) => setRadius(e.target.value)}
        />

        <br /><br />

        <button type="submit">Save Geofence</button>
      </form>
    </main>
  );
}
