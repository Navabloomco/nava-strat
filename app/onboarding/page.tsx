"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function Onboarding() {
  const [step, setStep] = useState(1);
  const [tenantId, setTenantId] = useState("");
  const [message, setMessage] = useState("");

  const [trucks, setTrucks] = useState<any[]>([]);
  const [geofences, setGeofences] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);

  const [truck, setTruck] = useState("");
  const [driver, setDriver] = useState("");

  const [geoName, setGeoName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");

  const [client, setClient] = useState("");
  const [rate, setRate] = useState("");

  useEffect(() => {
    init();
  }, []);

  async function init() {
    const { data: user } = await supabase.auth.getUser();

    if (!user.user) {
      window.location.href = "/login";
      return;
    }

    const { data: tenant } = await supabase.rpc("current_tenant_id");

    if (!tenant) {
      setMessage("Tenant not linked.");
      return;
    }

    setTenantId(tenant);

    const { data: tenantData } = await supabase
      .from("tenants")
      .select("onboarding_step")
      .eq("id", tenant)
      .single();

    if (tenantData?.onboarding_step) {
      setStep(tenantData.onboarding_step);
    }

    loadData();
  }

  async function loadData() {
    const { data: t } = await supabase.from("trucks").select("*");
    const { data: g } = await supabase.from("geofences").select("*");
    const { data: r } = await supabase.from("client_rate_rules").select("*");

    setTrucks(t || []);
    setGeofences(g || []);
    setRules(r || []);
  }

  async function nextStep() {
    const next = step + 1;

    await supabase
      .from("tenants")
      .update({ onboarding_step: next })
      .eq("id", tenantId);

    setStep(next);
  }

  // STEP 1 — TRUCKS
  async function addTruck(e: any) {
    e.preventDefault();

    await supabase.from("trucks").insert([
      {
        tenant_id: tenantId,
        truck: truck.toUpperCase(),
        driver: driver.toUpperCase(),
      },
    ]);

    setTruck("");
    setDriver("");
    loadData();
  }

  // STEP 2 — GEOFENCE
  async function addGeofence(e: any) {
    e.preventDefault();

    await supabase.from("geofences").insert([
      {
        tenant_id: tenantId,
        name: geoName,
        latitude: Number(lat),
        longitude: Number(lng),
        radius_meters: 300,
      },
    ]);

    setGeoName("");
    setLat("");
    setLng("");
    loadData();
  }

  // STEP 3 — PRICING
  async function addRule(e: any) {
    e.preventDefault();

    await supabase.from("client_rate_rules").insert([
      {
        tenant_id: tenantId,
        client_name: client.toUpperCase(),
        rate_type: "per_tonne",
        billing_unit: "tonne",
        rate_amount: Number(rate),
        rate_currency: "KES",
        fx_rate: 1,
        valid_from: new Date().toISOString().slice(0, 10),
        is_active: true,
      },
    ]);

    setClient("");
    setRate("");
    loadData();
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Setup Nava</h1>

      <p>Step {step} of 3</p>

      {message && <pre>{message}</pre>}

      {/* STEP 1 */}
      {step === 1 && (
        <>
          <h2>Add your trucks</h2>

          <form onSubmit={addTruck}>
            <input
              placeholder="Truck e.g KBJ123A"
              value={truck}
              onChange={(e) => setTruck(e.target.value)}
              required
            />
            <br /><br />
            <input
              placeholder="Driver optional"
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
            />
            <br /><br />
            <button>Add Truck</button>
          </form>

          <p>{trucks.length} trucks added</p>

          {trucks.length > 0 && (
            <button onClick={nextStep}>Next → Locations</button>
          )}
        </>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <>
          <h2>Add key locations</h2>

          <form onSubmit={addGeofence}>
            <input
              placeholder="Name e.g Mombasa Yard"
              value={geoName}
              onChange={(e) => setGeoName(e.target.value)}
              required
            />
            <br /><br />
            <input
              placeholder="Latitude"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              required
            />
            <br /><br />
            <input
              placeholder="Longitude"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              required
            />
            <br /><br />
            <button>Add Location</button>
          </form>

          <p>{geofences.length} locations added</p>

          {geofences.length > 0 && (
            <button onClick={nextStep}>Next → Pricing</button>
          )}
        </>
      )}

      {/* STEP 3 */}
      {step === 3 && (
        <>
          <h2>Set your first client rate</h2>

          <form onSubmit={addRule}>
            <input
              placeholder="Client e.g ENGAANO"
              value={client}
              onChange={(e) => setClient(e.target.value)}
              required
            />
            <br /><br />
            <input
              placeholder="Rate per tonne e.g 45"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              required
            />
            <br /><br />
            <button>Save Rate</button>
          </form>

          <p>{rules.length} pricing rules added</p>

          {rules.length > 0 && (
            <button
              onClick={() => {
                window.location.href = "/ops/dashboard";
              }}
            >
              Finish → Dashboard
            </button>
          )}
        </>
      )}
    </main>
  );
}
