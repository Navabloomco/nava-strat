// app/api/nava-eye/copilot/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { supabase } from "../../../../lib/supabase";
import { routeContext } from "../../../../lib/intelligence/contextRouter";
import {
  getActiveMemories,
  storeMemory,
} from "../../../../lib/intelligence/memoryEngine";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { question, companyId: requestedCompanyId } = await req.json();
    if (!question || typeof question !== "string" || question.length > 500) {
      return NextResponse.json(
        { error: "Valid question string required (max 500 chars)" },
        { status: 400 }
      );
    }

    const { data: memberships, error: membershipError } = await supabaseAdmin
      .from("company_users")
      .select("company_id, role, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (membershipError) throw membershipError;

    const activeMemberships = memberships || [];
    const isPlatformOwner = activeMemberships.some(
      (membership) => membership.role === "platform_owner"
    );

    let company;

    if (isPlatformOwner) {
      if (!requestedCompanyId) {
        return NextResponse.json(
          { error: "companyId is required for platform owner Copilot requests" },
          { status: 400 }
        );
      }

      const { data: requestedCompany, error: companyError } =
        await supabaseAdmin
          .from("companies")
          .select("id, name, slug")
          .eq("id", requestedCompanyId)
          .maybeSingle();

      if (companyError) throw companyError;
      if (!requestedCompany) {
        return NextResponse.json(
          { error: "Company not found" },
          { status: 404 }
        );
      }

      company = requestedCompany;
    } else {
      const companyId = activeMemberships
        .map((membership) => membership.company_id)
        .filter(Boolean)[0];

      if (!companyId) {
        return NextResponse.json(
          { error: "Unable to resolve company access" },
          { status: 403 }
        );
      }

      const { data: assignedCompany, error: companyError } = await supabaseAdmin
        .from("companies")
        .select("id, name, slug")
        .eq("id", companyId)
        .maybeSingle();

      if (companyError) throw companyError;
      if (!assignedCompany) {
        return NextResponse.json(
          { error: "Unable to resolve company access" },
          { status: 403 }
        );
      }

      company = assignedCompany;
    }

    // 2. Get deterministic context from router
    const context = await routeContext(question, company.slug);
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
      tenant: company.slug,
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
  if (context.profitability) {
    const p = context.profitability;
    const summary = p.summary || {};
    const topTruck = p.most_profitable_trucks?.[0];
    const weakTruck = p.least_profitable_trucks?.[0];
    const topClient = p.most_profitable_clients?.[0];
    const weakClient = p.least_profitable_clients?.[0];
    const weakRoute = p.least_profitable_routes?.[0];

    parts.push(
      `Profitability summary: revenue is ${Number(
        summary.total_revenue || 0
      ).toLocaleString()} KES, fuel cost is ${Number(
        summary.total_fuel_cost || 0
      ).toLocaleString()} KES, expenses are ${Number(
        summary.total_expenses || 0
      ).toLocaleString()} KES, and estimated profit is ${Number(
        summary.estimated_profit || 0
      ).toLocaleString()} KES.`
    );

    if (topTruck) {
      parts.push(
        `Most profitable truck: ${topTruck.name} at ${Number(
          topTruck.profit || 0
        ).toLocaleString()} KES across ${topTruck.count || 0} journey(s).`
      );
    }
    if (weakTruck) {
      parts.push(
        `Least profitable truck: ${weakTruck.name} at ${Number(
          weakTruck.profit || 0
        ).toLocaleString()} KES across ${weakTruck.count || 0} journey(s).`
      );
    }
    if (topClient) {
      parts.push(
        `Most profitable client: ${topClient.name} at ${Number(
          topClient.profit || 0
        ).toLocaleString()} KES.`
      );
    }
    if (weakClient) {
      parts.push(
        `Renegotiation candidate: ${weakClient.name} at ${Number(
          weakClient.profit || 0
        ).toLocaleString()} KES.`
      );
    }
    if (weakRoute) {
      parts.push(
        `Route bleeding money: ${weakRoute.name} at ${Number(
          weakRoute.profit || 0
        ).toLocaleString()} KES.`
      );
    }
    if (
      Number(summary.unlinked_fuel_cost || 0) > 0 ||
      Number(summary.unlinked_expense_cost || 0) > 0
    ) {
      parts.push(
        `Note: ${Number(summary.unlinked_fuel_cost || 0).toLocaleString()} KES fuel cost and ${Number(
          summary.unlinked_expense_cost || 0
        ).toLocaleString()} KES expenses are unlinked company costs, so they affect total profit but are not attributed to a specific truck, client, or route.`
      );
    }
  }
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
  if (context.country_fleet_location) {
    const locationContext = context.country_fleet_location;
    const country = locationContext.country || "that country";
    const freshnessWindow =
      locationContext.freshness_window_minutes || 30;
    const trucks = locationContext.trucks || [];

    if (trucks.length === 0) {
      parts.push(
        `No fresh evidence shows active company trucks in ${country} within the last ${freshnessWindow} minutes.`
      );
    } else {
      parts.push(
        `Current trucks in ${country} within the last ${freshnessWindow} minutes: ${trucks
          .map((t: any) => {
            const freshness =
              t.freshness_minutes === null
                ? "freshness unknown"
                : `${t.freshness_minutes} minutes old`;
            const location = t.location ? ` near ${t.location}` : "";
            return `${t.registration || t.truck_id}${location}, last seen ${
              t.last_seen_at || "unknown"
            } at ${t.latitude}, ${t.longitude} (${freshness})`;
          })
          .join("; ")}.`
      );
    }
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
