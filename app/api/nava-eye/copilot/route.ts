// app/api/nava-eye/copilot/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import {
  routeContext,
  getCompanyBySlug,
} from "../../../../lib/intelligence/contextRouter";
import {
  getActiveMemories,
  storeMemory,
} from "../../../../lib/intelligence/memoryEngine";

export async function POST(req: Request) {
  try {
    const { question, tenant = "jlcl" } = await req.json();
    if (!question || typeof question !== "string" || question.length > 500) {
      return NextResponse.json(
        { error: "Valid question string required (max 500 chars)" },
        { status: 400 }
      );
    }

    // 1. Get company (tenant) information
    let company;
    try {
      company = await getCompanyBySlug(tenant);
    } catch {
      return NextResponse.json(
        { error: `Tenant "${tenant}" not found` },
        { status: 404 }
      );
    }

    // 2. Get deterministic context from router
    const context = await routeContext(question, tenant);
    console.log("Context from router:", JSON.stringify(context, null, 2));

    // 3. Fetch active memories for this company (up to 5 most recent)
    const activeMemories = await getActiveMemories(company.id, { limit: 5 });
    const memoryContext = activeMemories.map(m => 
      `[${m.severity.toUpperCase()}] ${m.title}: ${m.summary}`
    ).join("\n");

    // 4. Fetch AI settings for this tenant (must be scoped to company)
    const { data: aiSettings, error: aiError } = await supabaseAdmin
      .from("company_ai_settings")
      .select("api_key, provider, model")
      .eq("company_id", company.id)
      .eq("is_active", true)
      .single();

    if (aiError) {
      console.error("AI settings query error:", aiError);
    }
    console.log("AI Settings:", aiSettings);
    const apiKey = aiSettings?.api_key;

    // 5. Prepare consolidated context for AI (or fallback)
    const enhancedContext = {
      ...context,
      active_memories: activeMemories.map(m => ({
        title: m.title,
        summary: m.summary,
        severity: m.severity,
        recommendation: m.recommendation,
      })),
    };

    let aiUsed = false;
    let answer = "";
    let storePromises = [];

    // 6. Try AI if key exists and we have context
    if (apiKey && Object.keys(context).length > 0) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const deepSeekPayload = {
          model: aiSettings?.model || "deepseek-chat",
          messages: [
            {
              role: "system",
              content:
                "You are Nava Eye, a company operations intelligence analyst for logistics. Use only the provided data. If evidence is missing, say so. Answer concisely and recommend the next operational action. Include relevant active memories if they help answer the question.",
            },
            {
              role: "user",
              content: `Question: ${question}\nCompany: ${company.name}\nActive memories:\n${memoryContext || "None"}\n\nCurrent context:\n${JSON.stringify(enhancedContext, null, 2)}`,
            },
          ],
          temperature: 0.2,
          max_tokens: 220,
        };
        console.log("Calling DeepSeek with payload:", JSON.stringify(deepSeekPayload, null, 2));

        const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(deepSeekPayload),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        console.log("DeepSeek status:", res.status);

        if (res.ok) {
          const aiData = await res.json();
          console.log("DeepSeek response:", JSON.stringify(aiData, null, 2));
          answer = aiData.choices?.[0]?.message?.content || "Nava Eye could not generate an answer.";
          aiUsed = true;
        } else {
          const errorText = await res.text();
          console.error("DeepSeek API error status:", res.status, errorText);
        }
      } catch (err: any) {
        clearTimeout(timeout);
        console.error("DeepSeek fetch error:", err.message);
      }
    }

    // 7. Fallback deterministic answer if AI not used
    if (!aiUsed) {
      answer = buildFallbackAnswer(context);
    }

    // 8. Store new memories based on critical findings (only if they are likely new/actionable)
    //    We'll deduplicate inside storeMemory using memory_hash.

    // Fuel risk (critical or high)
    if (context.fuel_risk && context.fuel_risk.risk_score >= 70) {
      storePromises.push(
        storeMemory({
          companyId: company.id,
          memoryType: "fuel_risk",
          severity: context.fuel_risk.risk_score >= 80 ? "critical" : "warning",
          title: `High fuel theft risk for ${context.detected_truck_id || "a truck"}`,
          summary: context.fuel_risk.recommendation || `Risk score ${context.fuel_risk.risk_score}.`,
          entityType: "truck",
          entityId: context.detected_truck_id,
          confidence: context.fuel_risk.risk_score / 100,
          recommendation: context.fuel_risk.recommendation,
        })
      );
    }

    // Offline trucks (store a summary memory, but avoid duplicates per truck)
    if (context.fleet_health?.offline_truck_ids?.length) {
      for (const truckId of context.fleet_health.offline_truck_ids) {
        if (truckId && !truckId.includes("2022") && !truckId.includes("2023")) { // skip ancient offline (likely decommissioned)
          storePromises.push(
            storeMemory({
              companyId: company.id,
              memoryType: "offline_truck",
              severity: "warning",
              title: `Truck ${truckId} is offline`,
              summary: `Truck ${truckId} has not reported telemetry for more than 30 minutes. Last seen: ${context.offline_trucks?.find((t: any) => t.truck_id === truckId)?.last_seen_at || "unknown"}.`,
              entityType: "truck",
              entityId: truckId,
              confidence: 0.9,
            })
          );
        }
      }
    }

    // High critical event count (e.g., > 10 critical events in 24h)
    if (context.fleet_health?.critical_events_24h > 10) {
      storePromises.push(
        storeMemory({
          companyId: company.id,
          memoryType: "general_insight",
          severity: "warning",
          title: "High number of critical events",
          summary: `${context.fleet_health.critical_events_24h} critical events in the last 24 hours. Review recent telemetry_events.`,
          confidence: 0.8,
        })
      );
    }

    // Truck-specific risk from events (e.g., repeated idle or overspeed)
    if (context.detected_truck_id && context.recent_events?.length > 0) {
      const idleCount = context.recent_events.filter((e: any) => e.event_type === "excessive_idle").length;
      const overspeedCount = context.recent_events.filter((e: any) => e.event_type === "overspeed").length;
      if (idleCount > 2) {
        storePromises.push(
          storeMemory({
            companyId: company.id,
            memoryType: "idle_pattern",
            severity: "warning",
            title: `Excessive idle for ${context.detected_truck_id}`,
            summary: `${idleCount} excessive idle events detected for ${context.detected_truck_id} in recent telemetry.`,
            entityType: "truck",
            entityId: context.detected_truck_id,
            confidence: 0.7,
          })
        );
      }
      if (overspeedCount > 2) {
        storePromises.push(
          storeMemory({
            companyId: company.id,
            memoryType: "driver_behavior",
            severity: "warning",
            title: `Repeated overspeed for ${context.detected_truck_id}`,
            summary: `${overspeedCount} overspeed events detected for ${context.detected_truck_id}.`,
            entityType: "truck",
            entityId: context.detected_truck_id,
            confidence: 0.7,
          })
        );
      }
    }

    // Wait for memory storage to complete (fire-and-forget, but we log)
    Promise.all(storePromises).catch(err => console.error("Memory storage error:", err));

    // 9. Return response
    return NextResponse.json({
      success: true,
      tenant,
      company,
      answer,
      intent: context.intent,
      context: enhancedContext,
      active_memories: activeMemories,
      ai_used: aiUsed,
    });
  } catch (err: any) {
    console.error("Copilot error:", err);
    return NextResponse.json(
      { error: "Internal server error. Please try again later." },
      { status: 500 }
    );
  }
}

function buildFallbackAnswer(context: any): string {
  const parts: string[] = [];
  if (context.fleet_health) {
    const f = context.fleet_health;
    parts.push(
      `Fleet health: ${f.online_trucks}/${f.total_trucks} online, ${f.offline_trucks} offline, ${f.critical_events_24h} critical events, ${f.fuel_events_24h} fuel events, and ${f.idle_events_24h} idle events in the last 24 hours.`
    );
  }
  if (context.offline_trucks?.length) {
    parts.push(
      `Offline trucks: ${context.offline_trucks
        .map((t: any) => t.truck_id)
        .join(", ")}.`
    );
  }
  if (context.fuel_risk) {
    parts.push(
      `Fuel risk score: ${context.fuel_risk.risk_score}. ${context.fuel_risk.recommendation || ""}`
    );
  }
  if (context.truck) {
    parts.push(
      `Truck ${context.detected_truck_id} was last seen at ${context.truck.last_seen_at}.`
    );
  }
  if (context.recent_events?.length) {
    parts.push(
      `${context.recent_events.length} recent operational events found.`
    );
  }
  if (parts.length === 0) {
    return "Nava Eye found limited context. Ask about fleet health, offline trucks, fuel risk, truck status, driver activity, or journeys.";
  }
  return parts.join(" ");
}
