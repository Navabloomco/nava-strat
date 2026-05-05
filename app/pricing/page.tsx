"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function PricingRulesPage() {
  const [tenantId, setTenantId] = useState("");
  const [rules, setRules] = useState<any[]>([]);
  const [message, setMessage] = useState("");

  const [clientName, setClientName] = useState("");
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [rateType, setRateType] = useState("per_tonne");
  const [billingUnit, setBillingUnit] = useState("tonne");
  const [rateAmount, setRateAmount] = useState("");
  const [rateCurrency, setRateCurrency] = useState("KES");
  const [fxRate, setFxRate] = useState("1");
  const [validFrom, setValidFrom] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [notes, setNotes] = useState("");

  useEffect(() => {
    init();
  }, []);

  async function init() {
    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      window.location.href = "/login";
      return;
    }

    const { data: tenant } = await supabase.rpc("current_tenant_id");

    if (!tenant) {
      setMessage("No tenant linked to this user.");
      return;
    }

    setTenantId(tenant);
    loadRules();
  }

  async function loadRules() {
    const { data, error } = await supabase
      .from("client_rate_rules")
      .select("*")
      .order("client_name", { ascending: true })
      .order("valid_from", { ascending: false });

    if (error) {
      setMessage(error.message);
      return;
    }

    setRules(data || []);
  }

  async function expireExistingMatchingRules() {
    const today = new Date().toISOString().slice(0, 10);

    let query = supabase
      .from("client_rate_rules")
      .update({
        is_active: false,
        valid_to: today,
      })
      .eq("client_name", clientName.trim().toUpperCase())
      .eq("is_active", true);

    if (fromLocation.trim()) {
      query = query.eq("from_location", fromLocation.trim().toUpperCase());
    } else {
      query = query.is("from_location", null);
    }

    if (toLocation.trim()) {
      query = query.eq("to_location", toLocation.trim().toUpperCase());
    } else {
      query = query.is("to_location", null);
    }

    await query;
  }

  async function saveRule(e: any) {
    e.preventDefault();

    if (!tenantId) {
      setMessage("Tenant not found. Login again.");
      return;
    }

    if (!clientName.trim()) {
      setMessage("Client name is required.");
      return;
    }

    if (!rateAmount || Number(rateAmount) <= 0) {
      setMessage("Rate amount must be greater than 0.");
      return;
    }

    await expireExistingMatchingRules();

    const { error } = await supabase.from("client_rate_rules").insert([
      {
        tenant_id: tenantId,
        client_name: clientName.trim().toUpperCase(),
        from_location: fromLocation.trim()
          ? fromLocation.trim().toUpperCase()
          : null,
        to_location: toLocation.trim() ? toLocation.trim().toUpperCase() : null,
        rate_type: rateType,
        billing_unit: billingUnit.trim().toLowerCase(),
        rate_amount: Number(rateAmount),
        rate_currency: rateCurrency,
        fx_rate: rateCurrency === "KES" ? 1 : Number(fxRate || 1),
        valid_from: validFrom,
        valid_to: null,
        is_active: true,
        notes: notes.trim() || null,
      },
    ]);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Pricing rule saved ✅ Old matching active rule expired.");

    setClientName("");
    setFromLocation("");
    setToLocation("");
    setRateType("per_tonne");
    setBillingUnit("tonne");
    setRateAmount("");
    setRateCurrency("KES");
    setFxRate("1");
    setValidFrom(new Date().toISOString().slice(0, 10));
    setNotes("");

    loadRules();
  }

  async function deactivateRule(id: string) {
    const today = new Date().toISOString().slice(0, 10);

    const { error } = await supabase
      .from("client_rate_rules")
      .update({
        is_active: false,
        valid_to: today,
      })
      .eq("id", id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Rule deactivated ✅");
    loadRules();
  }

  async function reactivateRule(id: string) {
    const { error } = await supabase
      .from("client_rate_rules")
      .update({
        is_active: true,
        valid_to: null,
      })
      .eq("id", id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Rule reactivated ✅");
    loadRules();
  }

  function rateTypeLabel(value: string) {
    return value.replace("per_", "Per ").replace("_", " ").toUpperCase();
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Pricing Rules</h1>
      <p>
        Manage client rates with history. When prices change, Nava expires the
        old rule and creates a new active version.
      </p>

      {message && (
        <pre style={{ background: "#f4f4f4", padding: 12 }}>{message}</pre>
      )}

      <h2>Add / Change Client Rate</h2>

      <form onSubmit={saveRule}>
        <input
          placeholder="Client e.g. ENGAANO"
          value={clientName}
          onChange={(e) => setClientName(e.target.value.toUpperCase())}
          required
        />

        <br />
        <br />

        <input
          placeholder="From optional e.g. MOMBASA"
          value={fromLocation}
          onChange={(e) => setFromLocation(e.target.value.toUpperCase())}
        />

        <br />
        <br />

        <input
          placeholder="To optional e.g. JINJA"
          value={toLocation}
          onChange={(e) => setToLocation(e.target.value.toUpperCase())}
        />

        <br />
        <br />

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

        <br />
        <br />

        <input
          placeholder="Billing unit e.g. tonne, box, truck"
          value={billingUnit}
          onChange={(e) => setBillingUnit(e.target.value)}
          required
        />

        <br />
        <br />

        <input
          placeholder="Rate amount e.g. 45"
          value={rateAmount}
          onChange={(e) => setRateAmount(e.target.value)}
          required
        />

        <br />
        <br />

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

        <br />
        <br />

        {rateCurrency !== "KES" && (
          <>
            <input
              placeholder="FX to KES e.g. 129"
              value={fxRate}
              onChange={(e) => setFxRate(e.target.value)}
              required
            />
            <br />
            <br />
          </>
        )}

        <input
          type="date"
          value={validFrom}
          onChange={(e) => setValidFrom(e.target.value)}
          required
        />

        <br />
        <br />

        <input
          placeholder="Notes e.g. fuel price adjustment"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <br />
        <br />

        <button type="submit">Save New Pricing Version</button>
      </form>

      <br />
      <hr />
      <br />

      <h2>Saved Pricing Rules</h2>

      {rules.length === 0 ? (
        <p>No pricing rules saved yet.</p>
      ) : (
        <table border={1} cellPadding={10}>
          <thead>
            <tr>
              <th>Status</th>
              <th>Client</th>
              <th>Route</th>
              <th>Rate</th>
              <th>FX</th>
              <th>Valid From</th>
              <th>Valid To</th>
              <th>Notes</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td>{rule.is_active ? "Active" : "Inactive"}</td>
                <td>{rule.client_name}</td>
                <td>
                  {rule.from_location || "ANY"} → {rule.to_location || "ANY"}
                </td>
                <td>
                  {rateTypeLabel(rule.rate_type)}: {rule.rate_currency}{" "}
                  {Number(rule.rate_amount || 0).toLocaleString()} /{" "}
                  {rule.billing_unit || "unit"}
                </td>
                <td>
                  {rule.rate_currency === "KES"
                    ? "1"
                    : Number(rule.fx_rate || 1).toLocaleString()}
                </td>
                <td>{rule.valid_from || "—"}</td>
                <td>{rule.valid_to || "Open"}</td>
                <td>{rule.notes || "—"}</td>
                <td>
                  {rule.is_active ? (
                    <button onClick={() => deactivateRule(rule.id)}>
                      Deactivate
                    </button>
                  ) : (
                    <button onClick={() => reactivateRule(rule.id)}>
                      Reactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
