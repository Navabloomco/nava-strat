"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function RevenuePage() {
  const [journeys, setJourneys] = useState<any[]>([]);

  const [client, setClient] = useState("");
  const [route, setRoute] = useState("");
  const [rateAmount, setRateAmount] = useState("");
  const [rateCurrency, setRateCurrency] = useState("USD");
  const [rateType, setRateType] = useState("per_tonne");
  const [fxRate, setFxRate] = useState("129");

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

  function calculateRevenue(journey: any) {
    const rate = Number(rateAmount || 0);
    const fx = rateCurrency === "KES" ? 1 : Number(fxRate || 1);

    if (rateType === "per_tonne") {
      const tonnes = Number(journey.offloaded_tonnage || 0);
      return rate * tonnes * fx;
    }

    if (rateType === "per_truck") {
      return rate * fx;
    }

    return 0;
  }

  async function saveRateToSelectedJourneys(e: any) {
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
      const revenueKes = calculateRevenue(journey);

      const { error } = await supabase
        .from("journeys")
        .update({
          rate_amount: Number(rateAmount),
          rate_currency: rateCurrency,
          rate_type: rateType,
          fx_rate: rateCurrency === "KES" ? 1 : Number(fxRate || 1),
          revenue: revenueKes,
          revenue_kes: revenueKes,
          revenue_notes: `Auto-calculated from ${rateCurrency} ${rateAmount} ${rateType}`,
        })
        .eq("id", journey.id);

      if (error) {
        alert(error.message);
        return;
      }
    }

    alert(`Revenue rules applied to ${selectedJourneys.length} journey/journeys ✅`);
    loadJourneys();
  }

  async function updateTonnage(
    journeyId: string,
    loaded: string,
    offloaded: string
  ) {
    const journey = journeys.find((j) => j.id === journeyId);

    const updatedJourney = {
      ...journey,
      loaded_tonnage: Number(loaded || 0),
      offloaded_tonnage: Number(offloaded || 0),
    };

    const revenueKes = calculateRevenue(updatedJourney);

    const { error } = await supabase
      .from("journeys")
      .update({
        loaded_tonnage: Number(loaded || 0),
        offloaded_tonnage: Number(offloaded || 0),
        rate_amount: Number(rateAmount || journey.rate_amount || 0),
        rate_currency,
        rate_type: rateType,
        fx_rate: rateCurrency === "KES" ? 1 : Number(fxRate || 1),
        revenue: revenueKes,
        revenue_kes: revenueKes,
      })
      .eq("id", journeyId);

    if (error) {
      alert(error.message);
      return;
    }

    loadJourneys();
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Revenue Rules</h1>
      <p>
        Set revenue once per client/route. Nava calculates revenue per truck
        using offloaded tonnage or per-truck rate.
      </p>

      <form onSubmit={saveRateToSelectedJourneys}>
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
        </select>

        <br /><br />

        <input
          placeholder="Rate e.g. 45"
          value={rateAmount}
          onChange={(e) => setRateAmount(e.target.value)}
          required
        />

        <br /><br />

        <select
          value={rateCurrency}
          onChange={(e) => setRateCurrency(e.target.value)}
        >
          <option value="USD">USD</option>
          <option value="KES">KES</option>
        </select>

        <br /><br />

        {rateCurrency === "USD" && (
          <>
            <input
              placeholder="FX rate e.g. 129"
              value={fxRate}
              onChange={(e) => setFxRate(e.target.value)}
            />
            <br /><br />
          </>
        )}

        <button type="submit">
          Apply Revenue Rule to Selected Client/Route
        </button>
      </form>

      <br /><br />

      <h2>Matching Trips</h2>

      {selectedJourneys.length === 0 ? (
        <p>Select client and route to see trips.</p>
      ) : (
        <table border={1} cellPadding={10}>
          <thead>
            <tr>
              <th>Truck</th>
              <th>Driver</th>
              <th>Loaded Tonnage</th>
              <th>Offloaded Tonnage</th>
              <th>Calculated Revenue</th>
              <th>Save Tonnage</th>
            </tr>
          </thead>

          <tbody>
            {selectedJourneys.map((j) => {
              const revenue = calculateRevenue(j);

              return (
                <tr key={j.id}>
                  <td>{j.truck}</td>
                  <td>{j.driver || "—"}</td>

                  <td>
                    <input
                      defaultValue={j.loaded_tonnage || ""}
                      id={`loaded-${j.id}`}
                      placeholder="Loaded T"
                    />
                  </td>

                  <td>
                    <input
                      defaultValue={j.offloaded_tonnage || ""}
                      id={`offloaded-${j.id}`}
                      placeholder="Offloaded T"
                    />
                  </td>

                  <td>
                    {revenue.toLocaleString()} KES
                  </td>

                  <td>
                    <button
                      type="button"
                      onClick={() => {
                        const loadedInput = document.getElementById(
                          `loaded-${j.id}`
                        ) as HTMLInputElement;

                        const offloadedInput = document.getElementById(
                          `offloaded-${j.id}`
                        ) as HTMLInputElement;

                        updateTonnage(
                          j.id,
                          loadedInput.value,
                          offloadedInput.value
                        );
                      }}
                    >
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
