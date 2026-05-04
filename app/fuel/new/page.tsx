"use client";

import { useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function NewFuelPage() {
  const [truck, setTruck] = useState("");
  const [litres, setLitres] = useState("");
  const [vendor, setVendor] = useState("");

  const handleSubmit = async (e: any) => {
    e.preventDefault();

    const { error } = await supabase.from("fuel_logs").insert([
      {
        truck,
        litres: Number(litres),
        vendor,
      },
    ]);

    if (error) {
      alert("Error saving fuel");
      console.error(error);
    } else {
      alert("Fuel saved ✅");
      setTruck("");
      setLitres("");
      setVendor("");
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>Add Fuel</h1>

      <form onSubmit={handleSubmit}>
        <input
          placeholder="Truck"
          value={truck}
          onChange={(e) => setTruck(e.target.value)}
        />
        <br /><br />

        <input
          placeholder="Litres"
          value={litres}
          onChange={(e) => setLitres(e.target.value)}
        />
        <br /><br />

        <input
          placeholder="Vendor"
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
        />
        <br /><br />

        <button type="submit">Save</button>
      </form>
    </div>
  );
}
