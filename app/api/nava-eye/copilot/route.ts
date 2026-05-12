import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import {
  routeContext,
  getCompanyBySlug,
} from "../../../../lib/intelligence/contextRouter";

export async function POST(req: Request) {
  try {
    const { question, tenant = "jlcl" } = await req.json();
    if (!question || typeof question !== "string" || question.length > 500) {
      return NextResponse.json(
        { error: "Valid question string required (max 500 chars)" },
        { status: 400 }
      );
    }

    let company;
    try {
      company = await getCompanyBySlug(tenant);
    } catch {
      return NextResponse.json(
        { error: `Tenant "${tenant}" not found` },
        { status: 404 }
      );
    }

    const context = await routeContext(question, tenant);
    console.log("Context from router:", JSON.stringify(context, null, 2));

    // Fetch AI settings for this tenant (must be filtered by company_id)
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
    console.log("API Key exists:", !!apiKey);
    console.log("Context has keys:", Object.keys(context).length > 0);

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
                "You are Nava Eye, a company operations intelligence analyst for logistics. Use only the provided data. If evidence is missing, say so. Answer concisely and recommend the next operational action.",
            },
            {
              role: "user",
              content: `Question: ${question}\nCompany: ${company.name}\nContext: ${JSON.stringify(context)}`,
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
          const answer =
            aiData.choices?.[0]?.message?.content ||
            "Nava Eye could not generate an answer.";
          return NextResponse.json({
            success: true,
            tenant,
            company,
            answer,
            intent: context.intent,
            context,
            ai_used: true,
          });
        } else {
          const errorText = await res.text();
          console.error("DeepSeek API error status:", res.status, errorText);
        }
      } catch (err: any) {
        clearTimeout(timeout);
        console.error("DeepSeek fetch error:", err.message);
      }
    } else {
      console.log("Skipping AI: missing key or empty context");
    }

    const fallbackAnswer = buildFallbackAnswer(context);
    return NextResponse.json({
      success: true,
      tenant,
      company,
      answer: fallbackAnswer,
      intent: context.intent,
      context,
      ai_used: false,
    });
  } catch (err: any) {
    console.error("Copilot error:", err);
    return NextResponse.json(
      { error: "Internal server error. Please try again later." },
      { status: 500 }
    );
  }
}

function buildFallbackAnswer(context: any) {
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
