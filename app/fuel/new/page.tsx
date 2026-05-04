"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function NewFuelPage() {
  const [truckId, setTruckId] = useState("");
  const [litres, setLitres] = useState("");
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveFuel(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const tenantId = "PASTE_JLCL_TENANT_ID_HERE";

    const { error } = await supabase.from("fuel_logs").insert({
      tenant_id: tenantId,
      asset_id: truckId,
      litres: Number(litres),
      amount: amount ? Number(amount) : null,
      vendor,
      allocation_status: "unallocated",
      source: "manual"
    });

    if (error) {
      alert(error.message);
      setSaving(false);
      return;
    }

    alert("Fuel saved ✅");

    setTruckId("");
    setLitres("");
    setAmount("");
    setVendor("");
    setSaving(false);
  }

  return (
    <main style={{ padding: 40, maxWidth: 500 }}>
      <h1>Add Fuel</h1>
      <p>Log fuel even before a trip exists.</p>

      <form onSubmit={saveFuel} style={{ display: "grid", gap: 10 }}>
        <input
          placeholder="Truck ID"
          value={truckId}
          onChange={(e) => setTruckId(e.target.value)}
          required
        />

        <input
          placeholder="Litres"
          value={litres}
          onChange={(e) => setLitres(e.target.value)}
          required
        />

        <input
          placeholder="Amount KES"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <input
          placeholder="Vendor e.g. Shell, Premium, Rubis"
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
        />

        <button disabled={saving} type="submit">
          {saving ? "Saving..." : "Save Fuel"}
        </button>
      </form>
    </main>
  );
}
