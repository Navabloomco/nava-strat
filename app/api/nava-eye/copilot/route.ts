// app/api/nava-eye/copilot/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { analyzeTruckFuelRisk } from "../../../../lib/intelligence/fuelRiskEngine.universal";

// Simple in-memory cache for fleet health (5 minutes)
let fleetHealthCache: { data: any; timestamp: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

async function getCachedFleetHealth() {
  if (fleetHealthCache && Date.now() - fleetHealthCache.timestamp < CACHE_TTL) {
    return fleetHealthCache.data;
  }
  const data = await fetchFleetHealth();
  fleetHealthCache = { data, timestamp: Date.now() };
  return data;
}

async function fetchFleetHealth() {
  const since = new Date();
  since.setHours(since.getHours() - 24);

  const [assetsRes, eventsRes] = await Promise.all([
    supabaseAdmin.from("fleet_assets").select("*"),
    supabaseAdmin.from("telemetry_events").select("*").gte("created_at", since.toISOString()),
  ]);

  const assets = assetsRes.data || [];
  const events = eventsRes.data || [];

  const now = Date.now();
  const offlineTrucks = assets.filter((a) => {
    if (!a.last_seen_at) return true;
    return (now - new Date(a.last_seen_at).getTime()) > 30 * 60 * 1000;
  });

  const criticalEvents = events.filter((e) => e.severity === "high");
  const fuelEvents = events.filter((e) =>
    ["fuel_drop_stationary", "low_fuel"].includes(e.event_type)
  );

  return {
    total_trucks: assets.length,
    online_trucks: assets.length - offlineTrucks.length,
    offline_trucks: offlineTrucks.length,
    critical_events_24h: criticalEvents.length,
    fuel_anomalies_24h: fuelEvents.length,
    top_offline_trucks: offlineTrucks.slice(0, 5).map((t) => t.truck_id),
  };
}

async function getOfflineTrucks() {
  const { data: assets } = await supabaseAdmin
    .from("fleet_assets")
    .select("truck_id, last_seen_at");
  if (!assets) return [];
  const now = Date.now();
  return assets
    .filter((a) => {
      if (!a.last_seen_at) return true;
      return (now - new Date(a.last_seen_at).getTime()) > 30 * 60 * 1000;
    })
    .map((a) => a.truck_id);
}

async function getTopFuelRiskTrucks(limit = 3) {
  // Simplified: get trucks with most fuel_drop_stationary events in last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("telemetry_events")
    .select("truck_id")
    .eq("event_type", "fuel_drop_stationary")
    .gte("created_at", sevenDaysAgo);
  if (!data) return [];
  const counts: Record<string, number> = {};
  for (const ev of data) {
    counts[ev.truck_id] = (counts[ev.truck_id] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([truck_id, count]) => ({ truck_id, event_count: count }));
}

export async function POST(req: Request) {
  try {
    const { question } = await req.json();
    if (!question || typeof question !== "string" || question.length > 500) {
      return NextResponse.json(
        { error: "Valid question string required (max 500 chars)" },
        { status: 400 }
      );
    }

    const lower = question.toLowerCase();
    let context: any = {};
    let intent = "general";

    // Intent detection
    if (lower.includes("fuel") && (lower.includes("theft") || lower.includes("siphon") || lower.includes("risk"))) {
      intent = "fuel_risk";
      const truckMatch = question.match(/[A-Z]{3}\s?\d{3}[A-Z]/i);
      if (truckMatch) {
        const risk = await analyzeTruckFuelRisk(truckMatch[0], 30);
        context = { truck: truckMatch[0], fuel_risk_analysis: risk };
      } else {
        const topRisky = await getTopFuelRiskTrucks(3);
        context = { top_fuel_risk_trucks: topRisky, message: "Based on recent fuel drop events." };
      }
    } else if (lower.includes("fleet") && (lower.includes("health") || lower.includes("summary"))) {
      intent = "fleet_health";
      context = await getCachedFleetHealth();
    } else if (lower.includes("offline") || lower.includes("disconnected")) {
      intent = "offline_trucks";
      const offline = await getOfflineTrucks();
      context = { offline_trucks: offline, count: offline.length };
    } else {
      // Fallback: generic ask – use a simple deterministic response
      intent = "general";
      context = { note: "Nava Eye can answer about fuel risk, fleet health, and offline trucks. Please rephrase your question." };
    }

    // Use DeepSeek only if we have meaningful context and API key
    const apiKey = process.env.JLCL_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;
    if (apiKey && Object.keys(context).length > 0 && intent !== "general") {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      try {
        const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [
              {
                role: "system",
                content:
                  "You are Nava Eye, a fleet intelligence analyst. Answer concisely (max 2 sentences) using the provided data. Be actionable.",
              },
              { role: "user", content: `Question: ${question}\nData: ${JSON.stringify(context)}` },
            ],
            temperature: 0.2,
            max_tokens: 150,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.ok) {
          const aiData = await res.json();
          const answer = aiData.choices?.[0]?.message?.content || "Sorry, Nava Eye couldn't generate an answer.";
          return NextResponse.json({ success: true, answer, intent, context });
        } else {
          console.error("DeepSeek API error:", res.status);
        }
      } catch (err: any) {
        console.error("DeepSeek fetch error:", err.message);
      }
    }

    // Fallback deterministic response
    let fallbackAnswer = "";
    if (intent === "fuel_risk") {
      if (context.truck) {
        fallbackAnswer = `Truck ${context.truck} shows fuel risk score ${context.fuel_risk_analysis?.risk_score}. ${context.fuel_risk_analysis?.recommendation || ""}`;
      } else {
        fallbackAnswer = `Top fuel risk trucks: ${context.top_fuel_risk_trucks?.map((t: any) => t.truck_id).join(", ")}.`;
      }
    } else if (intent === "fleet_health") {
      fallbackAnswer = `Fleet health: ${context.online_trucks} online, ${context.offline_trucks} offline, ${context.critical_events_24h} critical events, ${context.fuel_anomalies_24h} fuel anomalies in last 24h.`;
    } else if (intent === "offline_trucks") {
      fallbackAnswer = `${context.count} truck(s) offline: ${context.offline_trucks.join(", ")}.`;
    } else {
      fallbackAnswer = "I can answer questions about fuel theft, fleet health, and offline trucks. Please be more specific.";
    }

    return NextResponse.json({ success: true, answer: fallbackAnswer, intent, context });
  } catch (err: any) {
    console.error("Copilot error:", err);
    return NextResponse.json(
      { error: "Internal server error. Please try again later." },
      { status: 500 }
    );
  }
}
