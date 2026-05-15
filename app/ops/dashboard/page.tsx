"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";

type OpsData = {
  company?: any;
  journeys: any[];
  fleet_assets: any[];
  provider_statuses: any[];
  alerts: any[];
  summary?: any;
};

function normalizeTruck(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function freshnessLabel(lastSeenAt: string | null | undefined) {
  if (!lastSeenAt) return "No recent telemetry";
  const minutes = Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 60000);
  if (!Number.isFinite(minutes)) return "Telemetry time unknown";
  if (minutes < 1) return "Seen just now";
  if (minutes === 1) return "Seen 1 minute ago";
  return `Seen ${minutes} minutes ago`;
}

export default function OpsDashboard() {
  const [data, setData] = useState<OpsData>({
    journeys: [],
    fleet_assets: [],
    provider_statuses: [],
    alerts: [],
  });
  const [loading, setLoading] = useState(true);
  const [errorDetail, setErrorDetail] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setErrorDetail("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return;
    }

    const res = await fetch("/api/ops/dashboard", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setErrorDetail(json.error || "Failed to load operations dashboard");
      setLoading(false);
      return;
    }

    setData({
      company: json.company,
      journeys: json.journeys || [],
      fleet_assets: json.fleet_assets || [],
      provider_statuses: json.provider_statuses || [],
      alerts: json.alerts || [],
      summary: json.summary || {},
    });
    setLoading(false);
  }

  const assetsByTruck = useMemo(() => {
    const map = new Map<string, any>();
    for (const asset of data.fleet_assets) {
      const keys = [
        normalizeTruck(asset.truck_id),
        normalizeTruck(asset.registration),
      ].filter(Boolean);
      for (const key of keys) map.set(key, asset);
    }
    return map;
  }, [data.fleet_assets]);

  const operations = useMemo(() => {
    return data.journeys
      .filter((journey) => String(journey.status || "").toLowerCase() === "active")
      .map((journey) => {
      const asset =
        assetsByTruck.get(normalizeTruck(journey.truck)) ||
        assetsByTruck.get(normalizeTruck(journey.truck_id));
      const relatedAlerts = data.alerts.filter(
        (alert) =>
          normalizeTruck(alert.truck_id) === normalizeTruck(journey.truck) ||
          normalizeTruck(alert.truck_id) === normalizeTruck(asset?.truck_id)
      );
      const highAlert = relatedAlerts.some((alert) => alert.severity === "high");

      return {
        journey,
        asset,
        relatedAlerts,
        truck: journey.truck || asset?.registration || asset?.truck_id || "No truck",
        client: journey.client_name || "No client",
        route:
          journey.from_location || journey.to_location
            ? `${journey.from_location || "Unknown origin"} -> ${
                journey.to_location || "Unknown destination"
              }`
            : "No route saved",
        driver: journey.driver || "No driver",
        location:
          asset?.latitude && asset?.longitude
            ? `${Number(asset.latitude).toFixed(5)}, ${Number(asset.longitude).toFixed(5)}`
            : "No current location",
        status: asset?.last_seen_at ? freshnessLabel(asset.last_seen_at) : "No fleet match",
        risk: highAlert ? "High alert" : relatedAlerts.length ? "Review alerts" : "No recent alerts",
      };
      });
  }, [assetsByTruck, data.alerts, data.journeys]);

  if (loading) {
    return (
      <main style={{ padding: 40, fontFamily: "sans-serif", color: "#64748b" }}>
        Loading operations dashboard...
      </main>
    );
  }

  if (errorDetail) {
    return (
      <main style={{ padding: 40, fontFamily: "sans-serif" }}>
        <h1 style={{ color: "#dc2626", fontSize: 24 }}>Operations unavailable</h1>
        <p style={{ marginTop: 10, color: "#64748b" }}>{errorDetail}</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 40, fontFamily: "sans-serif", backgroundColor: "#f4f7f6", minHeight: "100vh" }}>
      <header style={{ marginBottom: 30, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: "bold", color: "#1a202c" }}>Ops Command Center</h1>
          <p style={{ color: "#718096" }}>
            {data.company?.name || "Company"} real-time operations
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(90px, 1fr))", gap: 10 }}>
          <Metric label="Active journeys" value={data.summary?.active_journeys || 0} />
          <Metric label="Online assets" value={data.summary?.online_assets || 0} />
          <Metric label="Alerts" value={data.summary?.alert_count || 0} />
        </div>
      </header>

      <section style={{ marginBottom: 35 }}>
        <h2 style={sectionHeader}>Provider Status</h2>
        {data.provider_statuses.length === 0 ? (
          <div style={emptyCard}>No provider data configured for this company.</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {data.provider_statuses.map((provider) => (
              <div key={provider.id} style={providerBadge}>
                <strong>{provider.provider_name}</strong>
                <span>{provider.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ marginBottom: 35 }}>
        <h2 style={sectionHeader}>Operational Alerts</h2>
        {data.alerts.length === 0 ? (
          <div style={emptyCard}>No recent telemetry alerts for this company.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {data.alerts.slice(0, 5).map((alert) => (
              <div key={alert.id} style={incidentCard}>
                <div style={{ fontWeight: "bold", color: alert.severity === "high" ? "#e53e3e" : "#2d3748" }}>
                  {alert.truck_id || "Unknown asset"} - {alert.event_type || "Event"}
                </div>
                <div style={{ fontSize: 12, color: "#718096" }}>
                  {alert.location_name || alert.created_at || "No event detail"}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 style={sectionHeader}>Active Operations</h2>
        {operations.length === 0 ? (
          <div style={emptyCard}>No active journeys or saved operations found.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 20 }}>
            {operations.map((op) => (
              <div
                key={op.journey.id}
                style={{
                  ...operationCard,
                  borderTop: op.risk === "High alert" ? "4px solid #e53e3e" : "4px solid #38a169",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 15 }}>
                  <strong style={{ fontSize: 18 }}>{op.truck}</strong>
                  <span style={statusPill}>{op.journey.status || "unknown"}</span>
                </div>

                <div style={cardRow}><span style={cardLabel}>CLIENT:</span> {op.client}</div>
                <div style={cardRow}><span style={cardLabel}>ROUTE:</span> {op.route}</div>
                <div style={cardRow}><span style={cardLabel}>LOCATION:</span> {op.location}</div>
                <div style={cardRow}><span style={cardLabel}>DRIVER:</span> {op.driver}</div>

                <div style={{ marginTop: 15, paddingTop: 15, borderTop: "1px solid #edf2f7" }}>
                  <div style={{ fontSize: 12, color: "#718096" }}>{op.status}</div>
                  <div style={{ fontSize: 12, color: op.risk === "High alert" ? "#e53e3e" : "#4a5568", fontWeight: "bold" }}>
                    {op.risk}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div style={metricCard}>
      <div style={{ fontSize: 20, fontWeight: 800, color: "#1a202c" }}>{value}</div>
      <div style={{ fontSize: 11, color: "#718096", textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

const sectionHeader = { fontSize: 14, fontWeight: "bold", color: "#4a5568", textTransform: "uppercase" as const, marginBottom: 15, letterSpacing: "0.05em" };
const providerBadge = { padding: "10px 12px", borderRadius: 8, border: "1px solid #cbd5e1", backgroundColor: "#fff", fontSize: 12, color: "#2d3748", display: "flex", gap: 10, alignItems: "center" };
const incidentCard = { backgroundColor: "#fff", padding: 15, borderRadius: 8, borderLeft: "4px solid #e53e3e", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" };
const operationCard = { backgroundColor: "#fff", padding: 20, borderRadius: 12, boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)", display: "flex", flexDirection: "column" as const };
const emptyCard = { backgroundColor: "#fff", padding: 18, borderRadius: 8, border: "1px solid #e2e8f0", color: "#718096" };
const metricCard = { backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", minWidth: 100 };
const statusPill = { fontSize: 10, padding: "4px 8px", borderRadius: 4, backgroundColor: "#edf2f7", color: "#4a5568", fontWeight: "bold", textTransform: "uppercase" as const };
const cardRow = { fontSize: 13, color: "#2d3748", marginBottom: 6 };
const cardLabel = { color: "#a0aec0", fontSize: 11, fontWeight: "bold", marginRight: 5 };
