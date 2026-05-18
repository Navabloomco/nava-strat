"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import {
  FormField,
  PageHeader,
  Panel,
  PrimaryButton,
  SecondaryButton,
} from "../../components/ui/Primitives";

const geofenceTypes = [
  { value: "depot", label: "Depot", radius: 400 },
  { value: "yard", label: "Yard", radius: 400 },
  { value: "port", label: "Port", radius: 1200 },
  { value: "customer_site", label: "Customer site", radius: 300 },
  { value: "loading_zone", label: "Loading zone", radius: 250 },
  { value: "offloading_zone", label: "Offloading zone", radius: 250 },
  { value: "border_point", label: "Border point", radius: 1500 },
  { value: "restricted_area", label: "Restricted area", radius: 800 },
  { value: "risk_zone", label: "Risk zone", radius: 800 },
  { value: "service_area", label: "Service area", radius: 150 },
  { value: "other", label: "Other", radius: 200 },
];

const inputClass =
  "w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300";

export default function NewGeofencePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState("customer_site");
  const [mapsLink, setMapsLink] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [radius, setRadius] = useState("300");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function extractLatLngFromGoogle(link: string) {
    try {
      const atMatch = link.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
      if (atMatch) {
        return {
          lat: atMatch[1],
          lng: atMatch[2],
        };
      }

      const qMatch = link.match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
      if (qMatch) {
        return {
          lat: qMatch[1],
          lng: qMatch[2],
        };
      }

      const markerMatch = link.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
      if (markerMatch) {
        return {
          lat: markerMatch[1],
          lng: markerMatch[2],
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  function handleTypeChange(value: string) {
    setType(value);
    const selected = geofenceTypes.find((item) => item.value === value);
    setRadius(String(selected?.radius || 200));
  }

  function handleExtract() {
    const result = extractLatLngFromGoogle(mapsLink);

    if (!result) {
      setError("Could not extract coordinates from that link. You can enter latitude and longitude manually.");
      return;
    }

    setError("");
    setLatitude(result.lat);
    setLongitude(result.lng);
  }

  async function handleSave(e: any) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return;
    }

    try {
      const res = await fetch("/api/geofences", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          type,
          latitude,
          longitude,
          radius_meters: radius,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to create geofence.");
      }

      setMessage("Geofence created.");
      router.push("/geofences");
    } catch (err: any) {
      setError(err.message || "Failed to create geofence.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          dark
          eyebrow="Operations"
          title="Create geofence"
          body="Add a place Nava should understand, such as a depot, customer site, loading zone, port, or risk area."
          actions={
            <Link href="/geofences">
              <SecondaryButton type="button" className="w-full sm:w-auto">
                Back to geofences
              </SecondaryButton>
            </Link>
          }
        />

        {error && (
          <Panel dark className="mt-8 border-rose-300/30 bg-rose-500/10 p-4">
            <div className="text-sm text-rose-100">{error}</div>
          </Panel>
        )}

        {message && (
          <Panel dark className="mt-8 border-cyan-200/20 bg-cyan-300/10 p-4">
            <div className="text-sm text-cyan-50">{message}</div>
          </Panel>
        )}

        <Panel dark className="mt-8 p-6">
          <form onSubmit={handleSave} className="grid gap-5">
            <FormField label="Geofence name" dark>
              <input
                placeholder="Example: Mombasa depot or Bamburi loading zone"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                required
              />
            </FormField>

            <div className="grid gap-5 md:grid-cols-2">
              <FormField label="Type" dark>
                <select
                  value={type}
                  onChange={(e) => handleTypeChange(e.target.value)}
                  className={inputClass}
                >
                  {geofenceTypes.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Radius meters" dark>
                <input
                  placeholder="Radius in meters"
                  value={radius}
                  onChange={(e) => setRadius(e.target.value)}
                  className={inputClass}
                  required
                />
              </FormField>
            </div>

            <Panel dark className="border-cyan-200/20 bg-cyan-300/10 p-4">
              <h2 className="text-sm font-semibold text-cyan-50">
                Optional coordinate helper
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Paste a Google Maps link to extract coordinates, or enter latitude
                and longitude manually below.
              </p>
              <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
                <input
                  placeholder="Paste Google Maps link"
                  value={mapsLink}
                  onChange={(e) => setMapsLink(e.target.value)}
                  className={inputClass}
                />
                <SecondaryButton
                  type="button"
                  onClick={handleExtract}
                  className="w-full lg:w-auto"
                >
                  Extract coordinates
                </SecondaryButton>
              </div>
            </Panel>

            <div className="grid gap-5 md:grid-cols-2">
              <FormField label="Latitude" dark>
                <input
                  placeholder="-1.29210"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  className={inputClass}
                  required
                />
              </FormField>

              <FormField label="Longitude" dark>
                <input
                  placeholder="36.82190"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  className={inputClass}
                  required
                />
              </FormField>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <PrimaryButton
                type="submit"
                disabled={saving}
                className="w-full sm:w-auto"
              >
                {saving ? "Creating..." : "Create geofence"}
              </PrimaryButton>
              <Link href="/geofences">
                <SecondaryButton type="button" className="w-full sm:w-auto">
                  Back to geofences
                </SecondaryButton>
              </Link>
            </div>
          </form>
        </Panel>
      </div>
    </main>
  );
}
