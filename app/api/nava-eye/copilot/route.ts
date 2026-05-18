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

    const companyRoles = Array.from(
      new Set(
        activeMemberships
          .filter((membership) => isPlatformOwner || membership.company_id === company.id)
          .map((membership) => String(membership.role || "").toLowerCase())
          .filter(Boolean)
      )
    );

    // 2. Get deterministic context from router
    const context = await routeContext(question, company.slug, {
      roles: companyRoles,
    });
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
    if (
      apiKey &&
      Object.keys(context).length > 0 &&
      !context.profit_simulation &&
      !context.spares &&
      !context.asset_access_restricted &&
      !context.no_enabled_intelligence_assets
    ) {
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
  if (context.asset_access_restricted) {
    return "I can only answer using assets enabled for Nava intelligence. This asset may be waiting for review.";
  }
  if (context.no_enabled_intelligence_assets && !context.spares) {
    return "Fleet data has been imported, but no assets are enabled for Nava intelligence yet. Review assets before I use them in answers.";
  }
  if (context.profit_simulation) {
    const simulation = context.profit_simulation;
    const knownInputs = formatSimulationInputs(simulation.inputs || {});
    const routeText =
      simulation.route?.from || simulation.route?.to
        ? `Route: ${simulation.route?.from || "unknown origin"} to ${
            simulation.route?.to || "unknown destination"
          }`
        : null;

    if (simulation.missing_inputs?.length) {
      parts.push(`I can calculate that, but I need: ${simulation.missing_inputs.join(", ")}.`);
      parts.push("");
      if (knownInputs.length > 0) {
        parts.push("Known inputs");
        parts.push(...knownInputs);
        if (routeText) parts.push(routeText);
        parts.push("");
      } else if (routeText) {
        parts.push("Known inputs");
        parts.push(routeText);
        parts.push("");
      }
      parts.push("Missing inputs");
      parts.push(...simulation.missing_inputs.map(formatMissingInput));
      if (simulation.assumptions?.length) {
        parts.push("");
        parts.push("Assumptions");
        parts.push(...simulation.assumptions);
      }

      return parts.join("\n");
    }

    const result = simulation.result || {};
    const inputs = simulation.inputs || {};
    const costBreakdown = formatSimulationCosts(inputs);

    parts.push("Estimated trip profit");
    parts.push("");
    if (routeText) {
      parts.push(routeText);
      parts.push("");
    }
    parts.push("Revenue");
    parts.push(
      `${formatMoney(inputs.rate_per_tonne)} × ${formatNumber(inputs.tonnes)} tonnes = ${formatMoney(result.revenue)}`
    );
    parts.push("");
    parts.push("Costs");
    parts.push(...costBreakdown);
    parts.push(`Total costs: ${formatMoney(result.total_costs)}`);
    parts.push("");
    parts.push("Result");
    parts.push(`Estimated profit: ${formatMoney(result.profit)}`);
    parts.push(
      `Margin: ${
        result.margin_percent === null || result.margin_percent === undefined
          ? "not available"
          : `${Number(result.margin_percent).toFixed(1)}%`
      }`
    );
    parts.push(
      `Break-even rate: ${
        result.break_even_rate_per_tonne === null ||
        result.break_even_rate_per_tonne === undefined
          ? "not available"
          : `${formatMoney(result.break_even_rate_per_tonne)} per tonne`
      }`
    );
    if (simulation.assumptions?.length) {
      parts.push("");
      parts.push("Assumptions");
      parts.push(...simulation.assumptions);
    }

    return parts.join("\n");
  }
  if (context.spares) {
    return buildSparesFallbackAnswer(context);
  }
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
        .map((t: any) => {
          const location = formatOperationalLocation(t);
          const driver = t.assigned_driver?.driver_name
            ? `, assigned driver: ${t.assigned_driver.driver_name}`
            : "";
          return location
            ? `${t.truck_id} ${location}${driver}`
            : `${t.truck_id}${driver}`;
        })
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
    const location = formatOperationalLocation(context.truck);
    parts.push(
      location
        ? `Truck ${context.detected_truck_id} was last seen ${location} at ${context.truck.last_seen_at}.`
        : `Truck ${context.detected_truck_id} was last seen at ${context.truck.last_seen_at}.`
    );
    if (context.truck.assigned_driver?.driver_name) {
      parts.push(`Assigned driver: ${context.truck.assigned_driver.driver_name}.`);
    }
  }
  if (context.recent_events?.length) {
    const eventPlaces = context.recent_events
      .map((event: any) => formatEventLocation(event))
      .filter(Boolean)
      .slice(0, 3);
    const eventDriverNotes = context.recent_events
      .map((event: any) => formatEventDriverContext(event))
      .filter(Boolean)
      .slice(0, 3);
    parts.push(
      eventPlaces.length
        ? `${context.recent_events.length} recent operational events found, including ${eventPlaces.join("; ")}.`
        : `${context.recent_events.length} recent operational events found.`
    );
    if (eventDriverNotes.length) {
      parts.push(eventDriverNotes.join(" "));
    }
  }
  if (context.driver_assignments?.length) {
    parts.push(
      `Current/recent driver assignments: ${context.driver_assignments
        .slice(0, 5)
        .map(formatDriverAssignment)
        .join("; ")}.`
    );
  }
  if (parts.length === 0) {
    return "Nava Eye found limited context. Ask about fleet health, offline trucks, fuel risk, truck status, driver activity, or journeys.";
  }
  return parts.join(" ");
}

function buildSparesFallbackAnswer(context: any): string {
  const spares = context.spares || {};
  const parts: string[] = [];
  const truckHistory = spares.truck_spare_history || [];
  const recentEvents = spares.recent_spare_events || [];
  const vendorSummary = spares.vendor_mechanic_summary?.vendors || [];
  const mechanicSummary = spares.vendor_mechanic_summary?.mechanics || [];
  const retreadSummary = spares.retread_summary || {};
  const catalogMatches = spares.part_catalog_matches || [];

  if (spares.unsupported_lifespan_question) {
    parts.push(
      "Nava needs more install/removal or replacement history before estimating lifespan reliably."
    );
    parts.push("");
  }

  if (context.detected_truck_id) {
    parts.push(`Spare history for ${context.detected_truck_id}`);
    if (truckHistory.length) {
      parts.push(...truckHistory.slice(0, 10).map(formatSpareEventLine));
    } else {
      parts.push("No spare usage records found for this enabled vehicle yet.");
    }
    parts.push("");
  }

  if (!context.detected_truck_id) {
    parts.push("Recent spares usage");
    if (recentEvents.length) {
      parts.push(formatSpareEventCounts(recentEvents));
      parts.push(...recentEvents.slice(0, 5).map(formatSpareEventLine));
    } else {
      parts.push("No spare usage records found yet.");
    }
    parts.push("");
  }

  if (mechanicSummary.length || vendorSummary.length) {
    parts.push("Mechanic/vendor summary");
    if (mechanicSummary.length) {
      parts.push(
        `Mechanics: ${mechanicSummary
          .slice(0, 5)
          .map(formatSpareNameCount)
          .join("; ")}.`
      );
    }
    if (vendorSummary.length) {
      parts.push(
        `Vendors: ${vendorSummary
          .slice(0, 5)
          .map(formatSpareNameCount)
          .join("; ")}.`
      );
    }
    parts.push("These are counts only, not quality or lifespan rankings.");
    parts.push("");
  }

  if (retreadSummary.event_count || retreadSummary.catalog_reference?.length) {
    parts.push("Retread context");
    if (retreadSummary.event_count) {
      parts.push(
        `${retreadSummary.event_count} retread event(s) recorded. ${(
          retreadSummary.by_part || []
        )
          .slice(0, 5)
          .map(
            (item: any) =>
              `${item.part_name || "Unknown part"} (${item.retread_count || 0})`
          )
          .join("; ")}.`
      );
    }
    if (retreadSummary.catalog_reference?.length) {
      parts.push(
        `Catalog retread references: ${retreadSummary.catalog_reference
          .slice(0, 5)
          .map(formatSpareCatalogPart)
          .join("; ")}.`
      );
    }
    parts.push("");
  }

  if (catalogMatches.length) {
    parts.push("Catalog matches");
    parts.push(...catalogMatches.slice(0, 5).map(formatSpareCatalogPart));
    parts.push("");
  }

  if (!spares.cost_visible) {
    parts.push("Cost details are hidden for this role.");
  }

  return parts.join("\n").trim();
}

function formatSpareEventLine(event: any) {
  const pieces = [
    formatReadableDate(event.event_at || event.created_at),
    formatSpareEventType(event.event_type),
    event.part_name || "Spare part",
  ];
  const vehicle = event.truck_id ? `vehicle ${event.truck_id}` : null;
  const quantity =
    event.quantity === null || event.quantity === undefined
      ? null
      : `qty ${formatNumber(event.quantity)}`;
  const vendor = event.vendor_name ? `vendor ${event.vendor_name}` : null;
  const mechanic = event.mechanic_name ? `mechanic ${event.mechanic_name}` : null;
  const condition =
    event.condition_before || event.condition_after
      ? `condition ${[event.condition_before, event.condition_after]
          .filter(Boolean)
          .join(" to ")}`
      : null;
  const odometer = event.odometer ? `${formatNumber(event.odometer)} km` : null;
  const engineHours = event.engine_hours
    ? `${formatNumber(event.engine_hours)} engine hours`
    : null;
  const cost = Object.prototype.hasOwnProperty.call(event, "cost") && event.cost
    ? `cost ${formatMoney(event.cost)}`
    : null;

  return `- ${pieces.filter(Boolean).join(" · ")}${[
    vehicle,
    quantity,
    vendor,
    mechanic,
    condition,
    odometer,
    engineHours,
    cost,
  ]
    .filter(Boolean)
    .map((value) => ` · ${value}`)
    .join("")}`;
}

function formatSpareEventCounts(events: any[]) {
  const counts = events.reduce((acc: Record<string, number>, event: any) => {
    const key = formatSpareEventType(event.event_type);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts)
    .map(([eventType, count]) => `${eventType}: ${count}`)
    .join("; ");
}

function formatSpareNameCount(item: any) {
  const cost = Object.prototype.hasOwnProperty.call(item, "total_cost")
    ? `, cost ${formatMoney(item.total_cost)}`
    : "";
  return `${item.name} (${item.event_count || 0}${cost})`;
}

function formatSpareCatalogPart(part: any) {
  const base = [
    part.name || "Part",
    part.category ? part.category.replace(/_/g, " ") : null,
    [part.brand, part.model].filter(Boolean).join(" / ") || null,
    part.part_number ? `part no. ${part.part_number}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const expectedLife = [
    part.expected_life_km
      ? `${formatNumber(part.expected_life_km)} km expected life`
      : null,
    part.expected_life_days
      ? `${formatNumber(part.expected_life_days)} days expected life`
      : null,
  ]
    .filter(Boolean)
    .join(", ");
  const retread =
    part.retreadable && part.max_retreads !== null && part.max_retreads !== undefined
      ? `max ${part.max_retreads} retread(s)`
      : part.retreadable
        ? "retreadable"
        : null;
  return [base, expectedLife, retread].filter(Boolean).join(" · ");
}

function formatSpareEventType(value: any) {
  return String(value || "event")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatSimulationInputs(inputs: any) {
  const labels: Record<string, string> = {
    rate_per_tonne: "Rate per tonne",
    tonnes: "Tonnes",
    fuel_cost: "Fuel",
    per_diem: "Per diem",
    tolls: "Tolls",
    parking: "Parking",
    loading: "Loading",
    offloading: "Offloading",
    transaction_cost: "Transaction cost",
    other_costs: "Other costs",
  };

  return Object.entries(labels)
    .filter(([key]) => inputs[key] !== undefined)
    .map(([key, label]) => {
      if (key === "tonnes") return `${label}: ${formatNumber(inputs[key])}`;
      if (key === "rate_per_tonne") {
        return `${label}: ${formatMoney(inputs[key])}`;
      }
      return `${label}: ${formatMoney(inputs[key])}`;
    });
}

function formatSimulationCosts(inputs: any) {
  const labels: Record<string, string> = {
    fuel_cost: "Fuel",
    per_diem: "Per diem",
    tolls: "Tolls",
    parking: "Parking",
    loading: "Loading",
    offloading: "Offloading",
    transaction_cost: "Transaction cost",
    other_costs: "Other costs",
  };

  return Object.entries(labels)
    .filter(([key]) => Number(inputs[key] || 0) > 0)
    .map(([key, label]) => `${label}: ${formatMoney(inputs[key])}`);
}

function formatMoney(value: any) {
  return `${Number(value || 0).toLocaleString()} KES`;
}

function formatNumber(value: any) {
  return Number(value || 0).toLocaleString();
}

function formatMissingInput(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatOperationalLocation(value: any) {
  if (!value) return null;
  if (value.geofence_match?.name) {
    return `inside ${value.geofence_match.name}`;
  }
  if (value.provider_location_label) {
    return `at ${value.provider_location_label}`;
  }
  if (value.location_label) {
    return `at ${value.location_label}`;
  }
  if (value.location_name) {
    return `near ${value.location_name}`;
  }
  if (hasCoordinates(value)) {
    return `at ${formatCoordinate(value.latitude)}, ${formatCoordinate(value.longitude)}`;
  }
  return null;
}

function formatEventLocation(event: any) {
  const location = formatOperationalLocation(event);
  if (!location) return null;
  return `${event.event_type || "event"} ${location}`;
}

function formatEventDriverContext(event: any) {
  const driverName = event?.assigned_driver?.driver_name;
  if (!driverName) return null;

  const eventName = event.event_type
    ? event.event_type.replace(/_/g, " ")
    : "This event";
  const truck = event.truck_id ? ` for ${event.truck_id}` : "";
  return `${eventName}${truck}: This happened while ${driverName} was assigned.`;
}

function formatDriverAssignment(assignment: any) {
  const driver = assignment.driver_name || "Driver";
  const truck = assignment.truck_id || "an enabled asset";
  const since = assignment.assigned_from
    ? ` since ${formatReadableDate(assignment.assigned_from)}`
    : "";
  return `${driver} assigned to ${truck}${since}`;
}

function formatReadableDate(value: any) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "an unknown time";
  return date.toLocaleString();
}

function hasCoordinates(value: any) {
  return Number.isFinite(Number(value?.latitude)) && Number.isFinite(Number(value?.longitude));
}

function formatCoordinate(value: any) {
  return Number(value).toFixed(5);
}
