"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function RevenuePage() {
  const [journeys, setJourneys] = useState<any[]>([]);
  const [client, setClient] = useState("");
  const [route, setRoute] = useState("");

  const [rateType, setRateType] = useState("per_tonne");
  const [rateAmount, setRateAmount] = useState("");
  const [rateCurrency, setRateCurrency] = useState("KES");
  const [fxRate, setFxRate] = useState("1");

  useEffect(() => {
    loadJourneys();
  }, []);

  async function loadJourneys() {
    const { data, error } = await supabase
      .from("journeys")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (error) {
      alert(error.message);
      return;
    }

    setJourneys(data || []);
  }

  const clients = useMemo(() => {
    return Array.from(
      new Set(journeys.map((j) => j.client_name).filter(Boolean))
    );
  }, [journeys]);

  const routes = useMemo(() => {
    return Array.from(
      new Set(
        journeys
          .filter((j) => (client ? j.client_name === client : true))
          .map((j) => `${j.from_location} → ${j.to_location}`)
      )
    );
  }, [journeys, client]);

  const selectedJourneys = journeys.filter((j) => {
    const journeyRoute = `${j.from_location} → ${j.to_location}`;

    return (
      (client ? j.client_name === client : true) &&
      (route ? journeyRoute === route : true)
    );
  });

  function calculatePreview(journey: any) {
    const rate = Number(rateAmount || journey.rate_amount || 0);
    const fx = rateCurrency === "KES" ? 1 : Number(fxRate || journey.fx_rate || 1);
    const qty = Number(journey.offloaded_quantity || 0);

    let revenueOriginal = 0;

    if (rateType === "per_truck") {
      revenueOriginal = rate;
    } else {
      revenueOriginal = rate * qty;
    }

    return {
      revenueOriginal,
      revenueKes: rateCurrency === "KES" ? revenueOriginal : revenueOriginal * fx,
    };
  }

  async function applyRateToSelected(e: any) {
    e.preventDefault();

    if (!client || !route) {
      alert("Select client and route.");
      return;
    }

    if (!rateAmount) {
      alert("Enter rate amount.");
      return;
    }

    for (const journey of selectedJourneys) {
      const { error } = await supabase
        .from("journeys")
        .update({
          rate_type: rateType,
          rate_amount: Number(rateAmount),
          rate_currency: rateCurrency,
          fx_rate: rateCurrency === "KES" ? 1 : Number(fxRate || 1),
        })
        .eq("id", journey.id);

      if (error) {
        alert(error.message);
        return;
      }
    }

    alert(`Rate applied to ${selectedJourneys.length} journey/journeys ✅`);
    loadJourneys();
  }

  async function saveQuantities(journeyId: string) {
    const loadedInput = document.getElementById(
      `loaded-${journeyId}`
    ) as HTMLInputElement;

    const offloadedInput = document.getElementById(
      `offloaded-${journeyId}`
    ) as HTMLInputElement;

    const { error } = await supabase
      .from("journeys")
      .update({
        loaded_quantity: Number(loadedInput.value || 0),
        offloaded_quantity: Number(offloadedInput.value || 0),
        rate_type: rateType,
        rate_amount: Number(rateAmount || 0),
        rate_currency: rateCurrency,
        fx_rate: rateCurrency === "KES" ? 1 : Number(fxRate || 1),
      })
      .eq("id", journeyId);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Quantity saved ✅");
    loadJourneys();
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Revenue Engine</h1>
      <p>Set pricing by client/route, then enter loaded/offloaded quantity per truck.</p>

      <form onSubmit={applyRateToSelected}>
        <select
          value={client}
          onChange={(e) => {
            setClient(e.target.value);
            setRoute("");
          }}
          required
        >
          <option value="">Select client</option>
          {clients.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <br /><br />

        <select value={route} onChange={(e) => setRoute(e.target.value)} required>
          <option value="">Select route</option>
          {routes.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <br /><br />

        <select value={rateType} onChange={(e) => setRateType(e.target.value)}>
          <option value="per_tonne">Per Tonne</option>
          <option value="per_truck">Per Truck</option>
          <option value="per_box">Per Box</option>
          <option value="per_bag">Per Bag</option>
          <option value="per_crate">Per Crate</option>
          <option value="per_pallet">Per Pallet</option>
          <option value="per_litre">Per Litre</option>
          <option value="per_km">Per KM</option>
          <option value="custom">Custom Unit</option>
        </select>

        <br /><br />

        <input
          placeholder="Rate amount e.g. 45"
          value={rateAmount}
          onChange={(e) => setRateAmount(e.target.value)}
          required
        />

        <br /><br />

        <select
          value={rateCurrency}
          onChange={(e) => {
            setRateCurrency(e.target.value);
            if (e.target.value === "KES") setFxRate("1");
          }}
        >
          <option value="KES">KES</option>
          <option value="USD">USD</option>
          <option value="UGX">UGX</option>
          <option value="TZS">TZS</option>
          <option value="RWF">RWF</option>
          <option value="EUR">EUR</option>
          <option value="GBP">GBP</option>
          <option value="ZAR">ZAR</option>
        </select>

        <br /><br />

        {rateCurrency !== "KES" && (
          <>
            <input
              placeholder="FX rate to KES e.g. 129"
              value={fxRate}
              onChange={(e) => setFxRate(e.target.value)}
              required
            />
            <br /><br />
          </>
        )}

        <button type="submit">Apply Rate to Client/Route</button>
      </form>

      <br /><br />

      <h2>Matching Active Journeys</h2>

      {selectedJourneys.length === 0 ? (
        <p>Select client and route.</p>
      ) : (
        <table border={1} cellPadding={10}>
          <thead>
            <tr>
              <th>Truck</th>
              <th>Driver</th>
              <th>Loaded Quantity</th>
              <th>Offloaded Quantity</th>
              <th>Rate</th>
              <th>Revenue</th>
              <th>Save Quantity</th>
            </tr>
          </thead>

          <tbody>
            {selectedJourneys.map((j) => {
              const preview = calculatePreview(j);

              return (
                <tr key={j.id}>
                  <td>{j.truck}</td>
                  <td>{j.driver || "—"}</td>

                  <td>
                    <input
                      id={`loaded-${j.id}`}
                      defaultValue={j.loaded_quantity || ""}
                      placeholder="Loaded"
                    />
                  </td>

                  <td>
                    <input
                      id={`offloaded-${j.id}`}
                      defaultValue={j.offloaded_quantity || ""}
                      placeholder="Offloaded"
                    />
                  </td>

                  <td>
                    {rateCurrency} {rateAmount || j.rate_amount || 0} /{" "}
                    {rateType.replace("per_", "")}
                  </td>

                  <td>
                    {preview.revenueOriginal.toLocaleString()} {rateCurrency}
                    <br />
                    <strong>{preview.revenueKes.toLocaleString()} KES</strong>
                  </td>

                  <td>
                    <button type="button" onClick={() => saveQuantities(j.id)}>
                      Save
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
