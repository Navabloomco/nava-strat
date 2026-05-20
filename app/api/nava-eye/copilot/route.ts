// app/api/nava-eye/copilot/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { routeContext } from "../../../../lib/intelligence/contextRouter";
import {
  getActiveMemories,
  storeMemory,
} from "../../../../lib/intelligence/memoryEngine";
import { getRoleCapabilities } from "../../../../lib/api/roleAccess";
import { recordAnalyticsEvent } from "../../../../lib/api/analyticsEvents";
import {
  DEFAULT_OPERATIONAL_TIME_ZONE,
  formatOperationalDateTime,
  hasAmbiguousTimestampWarning,
} from "../../../../lib/timeFormatting";
import {
  authenticateNavaEyeRequest,
  fetchAccessibleConversation,
  isMissingConversationSchemaError,
  jsonResponse,
  resolveNavaEyeCompanyAccess,
  safeConversationContent,
  sanitizeConversationMetadata,
  sanitizeId,
  NAVA_EYE_CONVERSATION_SETUP_MESSAGE,
} from "../../../../lib/api/navaEyeConversations";
import { normalizeProviderLocationLabel } from "../../../../lib/location/resolveOperationalLocation";

export async function POST(req: Request) {
  try {
    const auth = await authenticateNavaEyeRequest(req);
    if ("response" in auth) return auth.response;

    const body = await req.json().catch(() => ({}));
    const question = body?.question;
    const requestedCompanyId = body?.companyId;
    const dashboardContext = body?.dashboard_context;
    const conversationId = sanitizeId(body?.conversation_id);

    if (!question || typeof question !== "string" || question.length > 500) {
      return jsonResponse(
        { success: false, error: "Valid question string required (max 500 chars)" },
        { status: 400 }
      );
    }

    let conversation: any = null;
    let recentConversationMessages: any[] = [];
    if (conversationId) {
      const { data, error } = await fetchAccessibleConversation(
        conversationId,
        auth.user.id
      );

      if (error) {
        if (isMissingConversationSchemaError(error)) {
          return jsonResponse(
            {
              success: false,
              setup_required: true,
              error: NAVA_EYE_CONVERSATION_SETUP_MESSAGE,
            },
            { status: 503 }
          );
        }
        throw error;
      }

      if (!data) {
        return jsonResponse(
          { success: false, error: "Conversation not found" },
          { status: 404 }
        );
      }

      if (data.status === "closed") {
        return jsonResponse(
          {
            success: false,
            error: "This Nava Eye conversation is closed. Start a new conversation for follow-ups.",
          },
          { status: 409 }
        );
      }

      conversation = data;
    }

    const resolved = await resolveNavaEyeCompanyAccess(auth, {
      requestedCompanyId,
      conversationCompanyId: conversation?.company_id,
    });
    if ("response" in resolved) return resolved.response;

    const company = resolved.company;
    const companyRoles = resolved.roles;
    const roleCapabilities = resolved.roleCapabilities;

    if (conversation) {
      recentConversationMessages = await fetchRecentConversationMessages(
        conversation.id,
        company.id
      );
    }

    const pendingFollowupResolution = resolvePendingFollowupQuestion(
      question,
      conversation?.pending_followup
    );
    const effectiveQuestion = pendingFollowupResolution.question;

    if (
      conversation &&
      isShortFollowupCommand(question) &&
      !pendingFollowupResolution.usedPendingFollowup
    ) {
      await appendConversationMessage({
        conversationId: conversation.id,
        companyId: company.id,
        userId: auth.user.id,
        sender: "user",
        role: roleCategory(companyRoles, roleCapabilities),
        content: question,
        intent: null,
        metadata: { used_pending_followup: false },
      });

      const clarification =
        "I can continue, but I need the specific check you want me to run. Ask me to compare a truck timeline, check active journeys, review fuel evidence, or name the vehicle again.";

      await appendConversationMessage({
        conversationId: conversation.id,
        companyId: company.id,
        userId: auth.user.id,
        sender: "assistant",
        role: "assistant",
        content: clarification,
        intent: "clarification",
        metadata: { reason: "missing_pending_followup" },
      });

      await updateConversationAfterAnswer({
        conversation,
        companyId: company.id,
        userId: auth.user.id,
        intent: "clarification",
        pendingFollowup: {},
        titleQuestion: question,
      });

      return jsonResponse({
        success: true,
        tenant: company.slug,
        company,
        answer: clarification,
        intent: "clarification",
        conversation_id: conversation.id,
        ai_used: false,
      });
    }

    if (conversation) {
      await appendConversationMessage({
        conversationId: conversation.id,
        companyId: company.id,
        userId: auth.user.id,
        sender: "user",
        role: roleCategory(companyRoles, roleCapabilities),
        content: question,
        intent: null,
        metadata: {
          used_pending_followup: pendingFollowupResolution.usedPendingFollowup,
          pending_followup_type: pendingFollowupResolution.pendingType || null,
        },
      });
    }

    // 2. Get deterministic context from router
    const context = await routeContext(effectiveQuestion, company.slug, {
      roles: companyRoles,
      roleCapabilities,
      dashboardContext,
    });

    await recordAnalyticsEvent({
      companyId: company.id,
      userId: auth.user.id,
      eventName: "nava_eye_question_asked",
      eventCategory: "nava_eye",
      source: "api/nava-eye/copilot",
      metadata: {
        company_id: company.id,
        question_category: context.intent || "general",
        intent: context.intent || "general",
        role_category: roleCategory(companyRoles, roleCapabilities),
        role_capabilities: context.capabilities || {},
        had_dashboard_context: Boolean(dashboardContext),
        has_conversation: Boolean(conversation),
        used_pending_followup: pendingFollowupResolution.usedPendingFollowup,
      },
    });

    if (context.permission_boundary && !context.investigation_case_file) {
      await recordAnalyticsEvent({
        companyId: company.id,
        userId: auth.user.id,
        eventName: "nava_eye_permission_boundary_shown",
        eventCategory: "nava_eye",
        source: "api/nava-eye/copilot",
        metadata: {
          boundary_category: context.permission_boundary.category || "restricted",
          intent: context.intent || "general",
          role_category: roleCategory(companyRoles, roleCapabilities),
          had_dashboard_context: Boolean(dashboardContext),
        },
      });
    }

    // 3. Fetch active memories for this company (up to 5 most recent)
    const activeMemories = sanitizeActiveMemories(
      await getActiveMemories(company.id, { limit: 5 }),
      roleCapabilities
    );
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
    const aiContext = conversation
      ? {
          ...enhancedContext,
          conversation_thread: buildConversationContextForAi(
            recentConversationMessages,
            conversation.pending_followup,
            pendingFollowupResolution
          ),
        }
      : enhancedContext;

    let aiUsed = false;
    let answer = "";
    let storePromises = [];

    // 6. Try AI if key exists and we have context
    if (
      apiKey &&
      Object.keys(context).length > 0 &&
      !context.profit_simulation &&
      !context.spares &&
      !context.investigation_case_file &&
      !context.fuel_investigation &&
      !context.dashboard_followup &&
      context.intent !== "truck_status" &&
      !context.asset_access_restricted &&
      !context.no_enabled_intelligence_assets &&
      !context.permission_boundary
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
                "You are Nava Eye, a company operations intelligence analyst for logistics. Use only the provided data. If evidence is missing, say so. Answer concisely and recommend the next operational action. Include relevant active memories if they help answer the question. For fleet status answers, describe user-facing times in the provided operational timezone, normally EAT/Kenya time, and do not present UTC unless the user explicitly asks for UTC. Translate locations into operational place context and do not show raw coordinates unless the user explicitly asks for GPS/coordinates or no readable place label exists.",
            },
            {
              role: "user",
              content: `Question: ${effectiveQuestion}\n${
                effectiveQuestion !== question
                  ? `Original follow-up reply: ${question}\n`
                  : ""
              }Company: ${company.name}\nActive memories:\n${memoryContext || "None"}\n\nCurrent context:\n${JSON.stringify(aiContext, null, 2)}`,
            },
          ],
          temperature: 0.2,
          max_tokens: 220,
        };
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

        if (res.ok) {
          const aiData = await res.json();
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
              summary: `Truck ${truckId} has not reported telemetry for more than 30 minutes. Last seen: ${formatReadableDate(
                context.offline_trucks?.find((t: any) => t.truck_id === truckId)
                  ?.last_seen_at
              )}.`,
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

    const nextPendingFollowup = buildPendingFollowup(context, answer);
    if (conversation) {
      await appendConversationMessage({
        conversationId: conversation.id,
        companyId: company.id,
        userId: auth.user.id,
        sender: "assistant",
        role: "assistant",
        content: answer,
        intent: context.intent || "general",
        metadata: {
          ai_used: aiUsed,
          pending_followup_offered: Object.keys(nextPendingFollowup).length > 0,
        },
      });

      await updateConversationAfterAnswer({
        conversation,
        companyId: company.id,
        userId: auth.user.id,
        intent: context.intent || "general",
        pendingFollowup: nextPendingFollowup,
        titleQuestion: question,
      });
    }

    // Wait for memory storage to complete (fire-and-forget, but we log)
    Promise.all(storePromises).catch(err => console.error("Memory storage error:", err));

    // 9. Return response
    return jsonResponse({
      success: true,
      tenant: company.slug,
      company,
      answer,
      intent: context.intent,
      context: enhancedContext,
      active_memories: activeMemories,
      capabilities: context.capabilities,
      ai_used: aiUsed,
      conversation_id: conversation?.id || null,
    });
  } catch (err: any) {
    console.error("Copilot error:", err);
    if (
      String(err?.message || "").includes("Nava Eye conversation tables") ||
      isMissingConversationSchemaError(err)
    ) {
      return jsonResponse(
        {
          success: false,
          setup_required: true,
          error: NAVA_EYE_CONVERSATION_SETUP_MESSAGE,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Internal server error. Please try again later." },
      { status: 500 }
    );
  }
}

function buildFallbackAnswer(context: any): string {
  const parts: string[] = [];
  if (context.permission_boundary && !context.investigation_case_file) {
    return buildPermissionBoundaryAnswer(context.permission_boundary);
  }
  if (
    context.vehicle_match?.match_type === "multiple_candidates" &&
    context.vehicle_match?.candidates?.length
  ) {
    return buildVehicleCandidateAnswer(context.vehicle_match);
  }
  if (context.asset_access_restricted) {
    return buildAssetRestrictedAnswer(context.vehicle_match);
  }
  if (context.no_enabled_intelligence_assets && !context.spares) {
    return "Fleet data has been imported, but no assets are enabled for Nava intelligence yet. Review assets before I use them in answers.";
  }
  if (context.dashboard_followup) {
    return buildDashboardFollowupAnswer(context);
  }
  if (context.truck_timeline_comparison) {
    return buildTruckTimelineComparisonAnswer(context);
  }
  if (context.intent === "truck_status" && context.truck) {
    return buildTruckStatusFallbackAnswer(context);
  }
  if (context.investigation_case_file) {
    return buildInvestigationFallbackAnswer(context);
  }
  if (context.financial_access_restricted) {
    return "I can help with the operational side, but I cannot show financial values for this role. Ask an owner, admin, finance, management, or platform owner user to review profitability.";
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
  if (
    context.intent === "fuel_risk" &&
    (context.vehicle_match?.input || context.fuel_investigation)
  ) {
    return buildFuelSuspicionFallbackAnswer(context);
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
            const location = t.location
              ? ` near ${t.location}`
              : formatOperationalLocation(t, {
                  includeCoordinates: Boolean(context.coordinate_request),
                  gpsFallback: hasCoordinates(t)
                    ? "at an unresolved GPS point"
                    : null,
                });
            const locationText = location
              ? String(location).startsWith(" near ")
                ? location
                : ` ${location}`
              : "";
            return `${t.registration || t.truck_id}${locationText}, last seen ${formatReadableDate(
              t.last_seen_at
            )} (${freshness})`;
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
  if (context.recent_fuel_scores?.length) {
    parts.push(
      `Recent fuel risk scores are available for ${context.recent_fuel_scores.length} enabled vehicle(s). Ask about a specific registration if you want me to investigate one vehicle.`
    );
  }
  if (context.recent_fuel_events?.length) {
    parts.push(
      `${context.recent_fuel_events.length} recent fuel-related event(s) were found across enabled vehicles.`
    );
  }
  if (context.truck) {
    const location = formatOperationalLocation(context.truck);
    parts.push(
      location
        ? `Truck ${context.detected_truck_id} was last seen ${location} at ${formatReadableDate(
            context.truck.last_seen_at
          )}.`
        : `Truck ${context.detected_truck_id} was last seen at ${formatReadableDate(
            context.truck.last_seen_at
          )}.`
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

function sanitizeActiveMemories(
  memories: any[],
  capabilities: ReturnType<typeof getRoleCapabilities>
) {
  return (memories || [])
    .filter((memory) => {
      if (capabilities.canViewFinance && capabilities.canViewBilling) return true;
      const text = [
        memory.memory_type,
        memory.title,
        memory.summary,
        memory.recommendation,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return !/\b(revenue|profit|margin|rate|invoice|billing|billable|expense|payment)\b/.test(
        text
      );
    })
    .map((memory) => ({
      id: memory.id,
      memory_type: memory.memory_type,
      severity: memory.severity,
      title: memory.title,
      summary: memory.summary,
      recommendation: memory.recommendation || null,
      last_seen_at: memory.last_seen_at || null,
    }));
}

function roleCategory(
  roles: string[],
  capabilities: ReturnType<typeof getRoleCapabilities>
) {
  if (capabilities.isPlatformOwner) return "platform_owner";
  if (roles.some((role) => ["owner", "admin"].includes(role))) return "elevated";
  if (roles.includes("finance")) return "finance";
  if (roles.includes("management")) return "management";
  if (roles.includes("ops")) return "ops";
  return "member";
}

async function fetchRecentConversationMessages(conversationId: string, companyId: string) {
  const { data, error } = await supabaseAdmin
    .from("nava_eye_conversation_messages")
    .select("id, sender, role, content, intent, metadata, created_at")
    .eq("conversation_id", conversationId)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(8);

  if (error) {
    if (isMissingConversationSchemaError(error)) {
      throw new Error(NAVA_EYE_CONVERSATION_SETUP_MESSAGE);
    }
    throw error;
  }

  return (data || []).reverse();
}

async function appendConversationMessage(input: {
  conversationId: string;
  companyId: string;
  userId: string;
  sender: "user" | "assistant" | "system";
  role: string;
  content: string;
  intent?: string | null;
  metadata?: Record<string, any>;
}) {
  const { error } = await supabaseAdmin
    .from("nava_eye_conversation_messages")
    .insert({
      conversation_id: input.conversationId,
      company_id: input.companyId,
      user_id: input.sender === "assistant" ? null : input.userId,
      role: input.role,
      sender: input.sender,
      content: safeConversationContent(input.content),
      intent: input.intent || null,
      metadata: sanitizeConversationMetadata(input.metadata || {}),
    });

  if (error) throw error;
}

async function updateConversationAfterAnswer(input: {
  conversation: any;
  companyId: string;
  userId: string;
  intent: string;
  pendingFollowup: Record<string, any>;
  titleQuestion: string;
}) {
  const updates: Record<string, any> = {
    last_intent: input.intent,
    pending_followup: sanitizeConversationMetadata(input.pendingFollowup || {}),
    updated_at: new Date().toISOString(),
  };

  if (isDefaultConversationTitle(input.conversation?.title)) {
    updates.title = buildConversationTitle(input.titleQuestion);
  }

  const { error } = await supabaseAdmin
    .from("nava_eye_conversations")
    .update(updates)
    .eq("id", input.conversation.id)
    .eq("company_id", input.companyId)
    .eq("created_by", input.userId)
    .eq("status", "open");

  if (error) throw error;
}

function buildConversationContextForAi(
  messages: any[],
  pendingFollowup: any,
  followupResolution: { usedPendingFollowup: boolean; pendingType?: string | null }
) {
  return {
    recent_messages: (messages || []).map((message) => ({
      sender: message.sender,
      intent: message.intent || null,
      content: safeConversationContent(message.content).slice(0, 800),
    })),
    pending_followup: sanitizeConversationMetadata(pendingFollowup || {}),
    used_pending_followup: followupResolution.usedPendingFollowup,
    pending_followup_type: followupResolution.pendingType || null,
  };
}

function resolvePendingFollowupQuestion(question: string, pendingFollowup: any) {
  const pending = sanitizeConversationMetadata(pendingFollowup || {});
  const prompt = typeof pending.prompt === "string" ? pending.prompt.trim() : "";

  if (!isShortFollowupCommand(question) || !prompt) {
    return {
      question,
      usedPendingFollowup: false,
      pendingType: null,
    };
  }

  return {
    question: prompt.slice(0, 500),
    usedPendingFollowup: true,
    pendingType: typeof pending.type === "string" ? pending.type : null,
  };
}

function isShortFollowupCommand(question: string) {
  const normalized = String(question || "")
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "");

  return [
    "yes",
    "y",
    "yeah",
    "yep",
    "please",
    "please do",
    "do it",
    "go ahead",
    "continue",
    "compare",
    "show me",
    "check it",
    "check",
    "that one",
    "those",
  ].includes(normalized);
}

function buildPendingFollowup(context: any, answer: string) {
  const truckLabel =
    context.truck?.registration ||
    context.truck?.truck_id ||
    context.vehicle_match?.matched_registration ||
    context.vehicle_match?.matched_truck_id ||
    context.detected_truck_id ||
    null;

  if (
    context.intent === "truck_status" &&
    truckLabel &&
    /compare today'?s stop\/motion timeline/i.test(answer)
  ) {
    return {
      type: "compare_stop_motion_timeline",
      truck_id: truckLabel,
      prompt: `Compare today's stop/motion timeline for ${truckLabel} against Nava idle events. Keep the timeline in EAT/Kenya time and do not infer continuous idling unless movement data supports it.`,
    };
  }

  if (context.fuel_investigation && truckLabel) {
    return {
      type: "fuel_investigation_next_checks",
      truck_id: truckLabel,
      prompt: `Continue the fuel investigation for ${truckLabel}. Check stops, journeys, manual fuel entries, and usable provider fuel telemetry without accusing anyone.`,
    };
  }

  if (context.dashboard_followup?.trucks?.length) {
    const trucks = context.dashboard_followup.trucks
      .map((truck: any) => truck.registration || truck.truck_id)
      .filter(Boolean)
      .slice(0, 5);
    if (trucks.length) {
      return {
        type: "dashboard_truck_followup",
        truck_ids: trucks,
        prompt: `Continue investigating these same dashboard trucks: ${trucks.join(", ")}. Check active journeys, geofence/location context, spares/mechanical history, provider freshness, and idle-event data quality within the user's role permissions.`,
      };
    }
  }

  return {};
}

function isDefaultConversationTitle(title: any) {
  const normalized = String(title || "").trim().toLowerCase();
  return !normalized || normalized === "new nava eye conversation" || normalized === "nava eye conversation";
}

function buildConversationTitle(question: string) {
  const title = String(question || "").trim().replace(/\s+/g, " ");
  if (!title) return "Nava Eye conversation";
  return title.length > 80 ? `${title.slice(0, 77).trim()}...` : title;
}

function buildPermissionBoundaryAnswer(permissionBoundary: any) {
  return (
    permissionBoundary?.message ||
    "I can help with operational context, but that data is restricted for your role."
  );
}

function buildVehicleCandidateAnswer(vehicleMatch: any) {
  const candidates = vehicleMatch?.candidates || [];
  const input = vehicleMatch?.input || "that vehicle";
  const parts = [
    `I found a few possible matches for ${input}. Which one do you mean?`,
    "",
    ...candidates.map(formatVehicleCandidateLine),
    "",
    "Reply with the exact registration or truck ID and I will continue from there.",
  ];

  return parts.join("\n");
}

function buildAssetRestrictedAnswer(vehicleMatch: any) {
  const label =
    vehicleMatch?.matched_registration ||
    vehicleMatch?.matched_truck_id ||
    vehicleMatch?.input ||
    "this asset";

  return `I found ${label}, but I can only answer using assets enabled for Nava intelligence. This asset may be waiting for review.`;
}

function buildDashboardFollowupAnswer(context: any) {
  const followup = context.dashboard_followup || {};
  const trucks = followup.trucks || [];
  const visibleTrucks = trucks.filter((truck: any) => truck.enabled_for_intelligence);
  const unmatched = trucks.filter((truck: any) => !truck.enabled_for_intelligence);
  const label = followup.label || "trucks shown on the dashboard";
  const strongIdleCount = visibleTrucks.filter(
    (truck: any) => truck.current_status === "still_idling"
  ).length;
  const suspiciousDurationCount = visibleTrucks.filter(hasSuspiciousDashboardIdleTotal).length;
  const parts: string[] = [];

  if (!trucks.length) {
    return "I could not safely resolve the dashboard trucks for that follow-up. Try asking with the truck registrations shown in the dashboard card.";
  }

  parts.push(`I used the ${label} currently shown on this dashboard, not unrelated recent events.`);
  parts.push(
    "I am comparing actual telemetry timestamps internally, then showing the timeline in EAT/Kenya time. Earlier idle events are historical markers, not proof of one continuous idle period if later movement appears."
  );
  if (strongIdleCount) {
    parts.push(
      `${strongIdleCount} of them have fresh low-speed telemetry and a recent idle event, so the current idle/stationary read is strong. I cannot prove engine-on idling without ignition or engine-status data.`
    );
  } else {
    parts.push("I checked latest telemetry and recent idle events for those exact trucks.");
  }

  if (suspiciousDurationCount) {
    parts.push(
      "The current status looks real; at least one accumulated dashboard idle total looks suspicious and may need idle-event closure or provider data-quality review."
    );
  }
  parts.push("");

  if (visibleTrucks.length) {
    parts.push("Current read");
    parts.push(...visibleTrucks.map(formatDashboardTruckLine));
  }

  if (unmatched.length) {
    parts.push("");
    parts.push(
      `I could not safely match ${unmatched
        .map((truck: any) => truck.truck_id)
        .join(", ")} to enabled intelligence assets, so I am not exposing telemetry for them.`
    );
  }

  parts.push("");
  parts.push(
    buildDashboardFollowupQuestion(visibleTrucks)
  );

  return parts.join("\n");
}

function buildTruckStatusFallbackAnswer(context: any) {
  const truck = context.truck || {};
  const telemetry = Array.isArray(context.recent_telemetry)
    ? context.recent_telemetry
    : [];
  const latestTelemetry = telemetry[0] || null;
  const events = Array.isArray(context.recent_events) ? context.recent_events : [];
  const idleEvents = events.filter(isIdleStopEvent);
  const matchedLabel =
    truck.registration ||
    truck.truck_id ||
    context.vehicle_match?.matched_registration ||
    context.vehicle_match?.matched_truck_id ||
    context.detected_truck_id ||
    "the vehicle";
  const latestPoint = latestTelemetry || truck;
  const lastSeenAt = latestTelemetry?.recorded_at || truck.last_seen_at || null;
  const speed = finiteNumberOrNull(latestTelemetry?.speed);
  const locationPoint = {
    ...truck,
    latitude: latestPoint?.latitude ?? truck.latitude,
    longitude: latestPoint?.longitude ?? truck.longitude,
  };
  const location = formatOperationalLocation(locationPoint, {
    includeCoordinates: Boolean(context.coordinate_request),
    gpsFallback: null,
  });
  const hasGpsPoint = hasCoordinates(locationPoint);
  const freshnessMinutes = freshnessMinutesFromNow(lastSeenAt);
  const stale = freshnessMinutes !== null && freshnessMinutes > 60;
  const parts: string[] = [];

  if (location) {
    parts.push(
      stale
        ? `${matchedLabel}'s last known location is ${location}.`
        : `${matchedLabel} is ${location}.`
    );
    if (context.coordinate_request && hasGpsPoint) {
      parts.push(
        `Coordinates: ${formatCoordinate(locationPoint.latitude)}, ${formatCoordinate(
          locationPoint.longitude
        )}.`
      );
    }
  } else if (hasGpsPoint) {
    const coordinateText = context.coordinate_request
      ? ` Coordinates: ${formatCoordinate(locationPoint.latitude)}, ${formatCoordinate(
          locationPoint.longitude
        )}.`
      : "";
    parts.push(
      `I only have a GPS point for ${matchedLabel}, not a resolved place name yet.${coordinateText}`
    );
  } else {
    parts.push(
      `${matchedLabel} is in the enabled fleet, but I do not have a clean location label yet.`
    );
  }

  parts.push(`Last update: ${formatReadableDate(lastSeenAt)}.`);

  if (speed !== null) {
    if (stale) {
      const state =
        speed > 5
          ? "moving at the last update"
          : speed <= 2
            ? "stopped/stationary at the last update"
            : "low-speed/unclear at the last update";
      parts.push(
        `Last known read: ${state}, speed ${formatNumber(speed)}. Because the timestamp is stale, I would treat this as last-known status rather than live status.`
      );
    } else if (speed <= 2) {
      parts.push(
        `Current read: stopped/stationary, speed ${formatNumber(speed)}. I am not treating that as confirmed engine-on idling without ignition or engine-status data.`
      );
    } else if (speed > 5) {
      parts.push(
        `Current read: moving, speed ${formatNumber(speed)}.`
      );
    } else {
      parts.push(
        `Current read: low-speed/unclear, speed ${formatNumber(speed)}.`
      );
    }
  } else {
    parts.push("Latest speed is not available, so I cannot classify the current motion state confidently.");
  }

  const timestampWarnings = latestTelemetry?.validation?.warnings || [];
  if (hasAmbiguousTimestampWarning(timestampWarnings)) {
    parts.push(
      "Provider time appears local/ambiguous, so treat this timeline as approximate."
    );
  }

  if (idleEvents.length) {
    const latestIdle = idleEvents[0];
    const movementAfterIdle = hasMovementAfterEvent(telemetry, latestIdle);
    const latestIdleLine = formatEventBrief(latestIdle);
    parts.push(`Nava also has idle/stop history for this truck. Latest marker: ${latestIdleLine}.`);
    if (movementAfterIdle) {
      parts.push(
        "I cannot treat those events as one continuous idle period because later movement appears in the Nava telemetry after at least one idle/stop event."
      );
    } else {
      parts.push(
        "I cannot treat those events as one continuous idle period because the available Nava data does not prove one still-open stop/idle event at the current location."
      );
    }
    parts.push("Current stop duration is not confirmed from the available Nava data.");
  } else {
    parts.push("I do not see recent idle/stop events for this truck in Nava's event trail.");
  }

  const driverName = truck.assigned_driver?.driver_name;
  if (driverName) {
    if (isPlaceholderDriverName(driverName)) {
      parts.push("Driver assignment appears to be placeholder/test data.");
    } else {
      parts.push(`Assigned driver: ${driverName}.`);
    }
  }

  parts.push(
    "Would you like me to compare today's stop/motion timeline against Nava idle events?"
  );

  return parts.join("\n");
}

function buildTruckTimelineComparisonAnswer(context: any) {
  const timeline = context.truck_timeline_comparison || {};
  const truck = context.truck || context.investigation_case_file?.asset_status || {};
  const label =
    timeline.registration ||
    timeline.truck_id ||
    truck.registration ||
    truck.truck_id ||
    context.detected_truck_id ||
    "the truck";
  const timeZone = timeline.timezone?.time_zone || DEFAULT_OPERATIONAL_TIME_ZONE;
  const timeLabel = timeline.timezone?.label || "EAT (Kenya time)";
  const summary = timeline.telemetry_summary || {};
  const latest = timeline.latest_snapshot || null;
  const blocks = Array.isArray(timeline.motion_blocks) ? timeline.motion_blocks : [];
  const idleEvents = Array.isArray(timeline.idle_events) ? timeline.idle_events : [];
  const continuity = timeline.continuity || {};
  const parts: string[] = [];

  parts.push(
    `I reconstructed today's stop/motion trail for ${label} from Nava telemetry logs and idle events, displayed in ${timeLabel}.`
  );

  if (summary.data_density === "low") {
    parts.push(
      "Nava has limited history for this truck today, so I can compare only the latest snapshot and idle markers."
    );
  }

  if (latest) {
    const speed = finiteNumberOrNull(latest.speed);
    const location = formatOperationalLocation(latest);
    const speedText = speed === null ? "speed unknown" : `speed ${formatNumber(speed)}`;
    const state =
      speed === null
        ? "current motion state is unclear"
        : speed > 5
          ? "it appears to be moving"
          : "it appears stationary or stopped";
    parts.push(
      `Latest snapshot: ${formatTimelineTime(latest.recorded_at, timeZone)}; ${speedText}${
        location ? `, ${location}` : ""
      }. On that latest point, ${state}.`
    );
    if (hasAmbiguousTimestampWarning(latest.timestamp_warnings)) {
      parts.push(
        "Provider time appears local/ambiguous, so treat this timeline as approximate."
      );
    }
  } else {
    parts.push("I do not have a latest telemetry snapshot for this truck today.");
  }

  parts.push("");
  parts.push("Stop/motion blocks");
  if (blocks.length) {
    parts.push(...blocks.slice(0, 10).map((block: any) => formatTimelineBlock(block, timeZone)));
    if (blocks.length > 10) {
      parts.push(`- ${blocks.length - 10} additional block(s) omitted from this concise view.`);
    }
  } else {
    parts.push("- No same-day movement/stationary blocks were found in telemetry_logs.");
  }

  parts.push("");
  parts.push("Idle marker comparison");
  if (idleEvents.length) {
    parts.push(...idleEvents.slice(0, 8).map((event: any) => formatIdleComparison(event, timeZone)));
  } else {
    parts.push("- No same-day idle or excessive-idle telemetry events were found for this truck.");
  }

  parts.push("");
  parts.push("Continuity read");
  if (continuity.continuous_all_day_idle_supported) {
    parts.push(
      "- The current speed is 0, the latest location closely matches the earliest idle marker, and I do not see intervening movement after that idle marker. That supports a continuous current idle/stationary interpretation."
    );
  } else if (continuity.historical_idle_markers_broken_by_movement) {
    parts.push(
      "- The idle markers should be treated as historical or separate events because later telemetry shows movement after at least one idle marker."
    );
  } else if (summary.data_density === "low") {
    parts.push(
      "- The available history is too thin to prove a continuous unbroken delay."
    );
  } else {
    parts.push(
      "- I do not have enough continuity evidence to call this a continuous all-day idle period."
    );
  }

  parts.push("");
  parts.push(
    "This means I would not merge older idle markers into one continuous delay unless the same location, zero-speed current state, and absence of later movement all line up."
  );
  parts.push(
    "Next, I can compare this timeline against active journeys, driver assignment, geofence/place context, or spares history for the same truck."
  );

  return parts.join("\n");
}

function isIdleStopEvent(event: any) {
  return ["excessive_idle", "idle", "stopped", "long_stop"].includes(
    String(event?.event_type || "").trim().toLowerCase()
  );
}

function hasMovementAfterEvent(telemetry: any[], event: any) {
  const eventTime = eventTimestampMillis(event);
  if (!Number.isFinite(eventTime)) return false;

  return telemetry.some((point: any) => {
    const recordedAt = new Date(point?.recorded_at || 0).getTime();
    const speed = finiteNumberOrNull(point?.speed);
    return Number.isFinite(recordedAt) && recordedAt > eventTime && speed !== null && speed > 5;
  });
}

function eventTimestampMillis(event: any) {
  const value = event?.created_at || event?.started_at || null;
  if (!value) return NaN;
  return new Date(value).getTime();
}

function finiteNumberOrNull(value: any) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isPlaceholderDriverName(value: any) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return false;
  return /\b(test|dummy|placeholder|sample|demo)\b/.test(text);
}

function formatDashboardTruckLine(truck: any) {
  const label = [truck.registration, truck.truck_id]
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .join(" / ");
  const status = formatDashboardTruckStatus(truck);
  const freshness =
    truck.freshness_minutes === null || truck.freshness_minutes === undefined
      ? "freshness unknown"
      : `${truck.freshness_minutes} min old`;
  const speed =
    truck.latest_speed === null || truck.latest_speed === undefined
      ? "speed unknown"
      : `latest speed ${Number(truck.latest_speed).toLocaleString()}`;
  const location = formatOperationalLocation(truck);
  const locationText = location ? `, ${location}` : "";
  const latestIdle = truck.latest_idle_event
    ? ` Latest idle/stop event marker: ${formatDashboardIdleEvent(truck.latest_idle_event)}.`
    : " No recent idle event found in the last 24 hours.";
  const dashboardMetric = formatDashboardMetric(truck.dashboard_context);
  const dataQualityNote = formatDashboardDataQualityNote(truck.dashboard_context);
  const timestampNote = formatTimestampQualityNote(truck);

  return `- ${label || truck.truck_id}: ${status} Last seen ${formatReadableDate(
    truck.last_seen_at
  )} (${freshness}), ${speed}${locationText}. Confidence: ${
    truck.confidence || "unknown"
  }.${dashboardMetric}${dataQualityNote}${timestampNote}${latestIdle} ${truck.reason || ""}`;
}

function formatDashboardTruckStatus(truck: any) {
  switch (truck.current_status) {
    case "still_idling":
      if (Number(truck.latest_speed) === 0) {
        return "fresh speed is 0 and a recent idle event exists, so this strongly suggests it is still idle or stationary.";
      }
      return "fresh low-speed telemetry and a recent idle event strongly suggest it is still idle or stationary.";
    case "stopped_or_idle":
      return "fresh telemetry suggests it is stopped or idle, but the idle event trail is weaker.";
    case "moving":
      return "does not look idle now; fresh telemetry shows movement.";
    case "stale":
      return "is stale, so I cannot confirm whether it is still idling.";
    case "active_unknown":
      return "is active, but the current status is not clear enough to classify.";
    default:
      return "status is unknown.";
  }
}

function formatDashboardMetric(dashboardContext: any) {
  if (!dashboardContext) return "";
  if (dashboardContext.idle_hours) {
    return ` Dashboard idle total: ${dashboardContext.idle_hours} hours.`;
  }
  if (dashboardContext.event_count !== null && dashboardContext.event_count !== undefined) {
    return ` Dashboard event count: ${dashboardContext.event_count}.`;
  }
  if (dashboardContext.event_type) {
    return ` Dashboard event: ${formatSpareEventType(dashboardContext.event_type)}.`;
  }
  return "";
}

function formatDashboardIdleEvent(event: any) {
  const label = formatSpareEventType(event.event_type || "idle");
  const at = formatReadableDate(event.created_at || event.started_at);
  const duration =
    event.duration_minutes === null || event.duration_minutes === undefined
      ? ""
      : `, ${Number(event.duration_minutes).toLocaleString()} min`;
  const context = event.context_label ? `, context: ${event.context_label}` : "";

  return `${label} at ${at}${duration}${context}`;
}

function formatDashboardDataQualityNote(dashboardContext: any) {
  if (!hasSuspiciousDashboardIdleTotal({ dashboard_context: dashboardContext })) {
    return "";
  }

  return " Data-quality note: that accumulated idle total is unusually high, so I would treat the duration as suspect until idle-event closure is reviewed.";
}

function formatTimestampQualityNote(value: any) {
  if (!hasAmbiguousTimestampWarning(value?.timestamp_warnings)) {
    return "";
  }

  return " Timeline note: provider timestamps appear local/ambiguous, so treat the event timing as approximate.";
}

function hasSuspiciousDashboardIdleTotal(truck: any) {
  const hours = parseDashboardNumber(truck?.dashboard_context?.idle_hours);
  return hours !== null && hours > 24;
}

function parseDashboardNumber(value: any) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function buildDashboardFollowupQuestion(trucks: any[]) {
  const hasDriverContext = trucks.some((truck) => truck.assigned_driver?.driver_name);
  const hasGeofenceContext = trucks.some((truck) => truck.geofence_match?.name);
  const hasSuspiciousTotals = trucks.some(hasSuspiciousDashboardIdleTotal);
  const options = [
    "whether these trucks are on active journeys",
    "whether they have recent mechanical or spares issues",
  ];

  if (hasDriverContext) {
    options.push("which assigned drivers were responsible at the time");
  } else {
    options.push("whether standing driver assignments exist for them");
  }

  if (hasGeofenceContext) {
    options.push("whether their saved-place or geofence context explains the stop");
  } else {
    options.push("whether their locations point to yards, queues, borders, or client sites");
  }

  options.push("whether provider sync freshness is affecting the read");

  if (hasSuspiciousTotals) {
    options.push("whether this is an idle-event closure/data-quality problem");
  }

  options.push("fuel impact if usable fuel data exists");

  return `Would you like me to check ${formatNaturalList(options)} for these same trucks?`;
}

function formatNaturalList(items: string[]) {
  const unique = items.filter((item, index, list) => list.indexOf(item) === index);
  if (unique.length <= 1) return unique[0] || "";
  if (unique.length === 2) return `${unique[0]} or ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, or ${unique[unique.length - 1]}`;
}

function buildInvestigationFallbackAnswer(context: any) {
  const caseFile = context.investigation_case_file || {};
  const focus = caseFile.focus || context.investigation_focus || {};
  const entity = caseFile.entity_match || context.vehicle_match || {};
  const label =
    entity.matched_registration ||
    entity.matched_truck_id ||
    context.detected_truck_id ||
    "this vehicle";
  const parts: string[] = [];

  parts.push(formatVehicleMatchIntro(entity, label));
  parts.push(buildInvestigationOpening(focus));
  parts.push("");

  parts.push("What I found");
  parts.push(...formatInvestigationFindings(caseFile, focus, label));
  parts.push("");

  parts.push("What this may mean");
  parts.push(...formatInvestigationMeanings(caseFile, focus));
  parts.push("");

  parts.push("What I cannot prove yet");
  parts.push(...formatInvestigationLimits(caseFile, focus));
  parts.push("");

  parts.push("Next checks");
  parts.push(...formatInvestigationNextChecks(caseFile, focus, label));
  parts.push("");

  parts.push(formatInvestigationFollowUps(focus, label, caseFile));

  return parts.join("\n");
}

function buildFuelSuspicionFallbackAnswer(context: any) {
  const vehicleMatch = context.vehicle_match || {};
  const investigation = context.fuel_investigation || {};
  const truck = investigation.truck || context.truck || null;
  const telemetry = investigation.telemetry_summary || null;
  const fleetFuelAvailability = investigation.fleet_fuel_data_availability || null;
  const fuelLogs = investigation.recent_fuel_logs || [];
  const fuelEvents = investigation.fuel_related_events || [];
  const idleEvents = investigation.idle_stop_events || [];
  const journeys = investigation.recent_journeys || [];
  const risk = context.fuel_risk || investigation.latest_fuel_score || null;
  const parts: string[] = [];

  if (vehicleMatch?.input && !vehicleMatch?.matched) {
    parts.push(
      `I could not find a matching enabled vehicle for ${vehicleMatch.input}. It may be unreviewed or not imported yet.`
    );
    parts.push("");
    parts.push("What to verify next");
    parts.push("- Check Asset Review for imported vehicles waiting to be enabled.");
    parts.push("- Try the full registration exactly as it appears on the vehicle.");
    return parts.join("\n");
  }

  const matchedLabel =
    vehicleMatch?.matched_registration ||
    vehicleMatch?.matched_truck_id ||
    context.detected_truck_id ||
    "the vehicle";

  parts.push(formatVehicleMatchIntro(vehicleMatch, matchedLabel));
  parts.push("I can't confirm siphoning yet, but here's the useful trail.");
  parts.push("");

  if (truck) {
    const location = formatOperationalLocation(truck);
    const status = truck.status ? `${matchedLabel} is currently ${truck.status}` : `I found ${matchedLabel} in the enabled fleet`;
    const lastSeen = truck.last_seen_at
      ? `last seen ${formatReadableDate(truck.last_seen_at)}`
      : "last seen time is not available";
    const locationText = location ? ` ${location}` : "";
    parts.push(`${status}${locationText}; ${lastSeen}.`);
    if (truck.assigned_driver?.driver_name) {
      parts.push(`Assigned driver: ${truck.assigned_driver.driver_name}.`);
    }
  }

  const telemetryExplanation = formatFuelTelemetryExplanation(telemetry);
  parts.push(telemetryExplanation.text);
  if (!telemetryExplanation.usable) {
    parts.push("That means I should rely more on stops, locations, driver assignment, journeys, and manual fuel entries for now.");
    parts.push(formatFleetFuelAvailability(fleetFuelAvailability));
  }

  if (risk) {
    const riskNarrative = formatFuelRiskNarrative(risk);
    if (riskNarrative) parts.push(riskNarrative);
  }

  parts.push("");
  if (fuelLogs.length) {
    parts.push(`I found ${fuelLogs.length} recent manual fuel entr${fuelLogs.length === 1 ? "y" : "ies"} for this vehicle:`);
    parts.push(...fuelLogs.slice(0, 4).map(formatFuelLogLine));
  } else {
    parts.push("I do not see recent manual fuel entries for this vehicle.");
  }

  if (fuelEvents.length || idleEvents.length) {
    if (fuelEvents.length) {
      parts.push(
        `There is fuel-event evidence to investigate: ${fuelEvents
          .slice(0, 3)
          .map(formatEventBrief)
          .join("; ")}. That is not proof of siphoning, but it is worth checking.`
      );
    }
    if (idleEvents.length) {
      parts.push(
        `I also found recent idle/stop activity: ${idleEvents
          .slice(0, 3)
          .map(formatEventBrief)
          .join("; ")}.`
      );
    }
  } else {
    parts.push("I did not find recent fuel-drop or excessive-idle events for this vehicle.");
  }

  if (journeys.length) {
    parts.push("Recent journey context I can use:");
    parts.push(...journeys.slice(0, 3).map(formatJourneyBrief));
  } else {
    parts.push("I do not see a recent journey record for this vehicle.");
  }

  parts.push("");
  parts.push(
    "Small repeated losses may not show as a single major drop unless the truck has reliable fuel-level telemetry or you compare tank dips/receipts against expected consumption."
  );
  parts.push("");
  parts.push("I can next check stops around the idle times, show which enabled trucks have usable fuel data, or compare this vehicle against similar trips once journeys and fuel entries are recorded.");

  return parts.join("\n");
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

function normalizeDisplayKey(value: any) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function formatVehicleMatchIntro(vehicleMatch: any, matchedLabel: string) {
  if (
    vehicleMatch?.input &&
    normalizeDisplayKey(vehicleMatch.input) !== normalizeDisplayKey(matchedLabel)
  ) {
    return `I matched ${vehicleMatch.input} to ${matchedLabel} - tell me if that is the wrong truck.`;
  }
  return `I found ${matchedLabel}.`;
}

function formatVehicleCandidateLine(candidate: any) {
  const label = [candidate.registration, candidate.truck_id]
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .join(" / ");
  const status = candidate.enabled_for_intelligence
    ? "enabled"
    : "waiting for review";
  const confidence = candidate.confidence || "low";

  return `- ${label || "Vehicle"} - ${status}, ${confidence} match`;
}

function buildInvestigationOpening(focus: any) {
  if (focus?.fuel_focus) {
    return "I can't confirm fuel siphoning from one question, so I checked the wider operational trail around this vehicle.";
  }
  if (focus?.stops_focus) {
    return "I checked the recent stop/idle trail instead of treating this as just a location question.";
  }
  if (focus?.profitability_focus) {
    return "I checked the operating context and the finance trail I am allowed to see.";
  }
  if (focus?.repair_focus) {
    return "I checked recent repair and spare history alongside operations data.";
  }
  return "I checked this like a small operations investigation, not a single data lookup.";
}

function formatInvestigationFindings(caseFile: any, focus: any, label: string) {
  const lines: string[] = [];
  const asset = caseFile.asset_status;
  const telemetry = caseFile.recent_telemetry_summary || {};
  const fuel = caseFile.fuel_summary || {};
  const events = caseFile.events_alerts_summary || {};
  const journeys = caseFile.journey_summary || {};
  const spares = caseFile.spares_repair_summary || {};
  const financials = caseFile.financial_summary || {};

  if (asset) {
    const location = formatOperationalLocation(asset);
    const lastSeen = asset.last_seen_at
      ? `last seen ${formatReadableDate(asset.last_seen_at)}`
      : "last seen time is not available";
    lines.push(
      `- ${label} is enabled for Nava intelligence${location ? ` and is ${location}` : ""}; ${lastSeen}.`
    );
    if (asset.assigned_driver?.driver_name) {
      lines.push(`- Assigned driver: ${asset.assigned_driver.driver_name}.`);
    }
  }

  if (telemetry.telemetry_points > 0) {
    lines.push(
      `- In the last ${telemetry.window_days || 7} days I found ${telemetry.telemetry_points} telemetry point(s), with ${telemetry.stationary_points || 0} stationary/near-idle point(s).`
    );
  } else {
    lines.push("- I do not see recent telemetry points for this vehicle.");
  }

  const fuelTelemetry = fuel.telemetry || {};
  if (focus?.fuel_focus || fuelTelemetry.fuel_readings > 0 || fuel.manual_entries?.length) {
    lines.push(`- ${formatFuelTelemetryExplanation(fuelTelemetry).text}`);
    if (fuel.manual_entries?.length) {
      lines.push(
        `- Manual fuel entries found: ${fuel.manual_entries.length}. Latest: ${formatFuelLogLine(fuel.manual_entries[0]).replace(/^- /, "")}`
      );
    } else {
      lines.push("- I do not see recent manual fuel entries for this vehicle.");
    }
  }

  if (events.stop_like_events?.length) {
    lines.push(
      `- Stop/idle events found: ${events.stop_like_events.length}. Latest: ${formatEventBrief(events.stop_like_events[0])}.`
    );
  }
  if (events.fuel_events?.length) {
    lines.push(
      `- Fuel-related alert events found: ${events.fuel_events.length}. Latest: ${formatEventBrief(events.fuel_events[0])}.`
    );
  }
  if (events.context_labels?.length) {
    lines.push(`- Existing alert context labels: ${events.context_labels.join(", ")}.`);
  }

  if (journeys.recent_journeys?.length) {
    lines.push(`- Recent journey context: ${formatJourneyBrief(journeys.recent_journeys[0]).replace(/^- /, "")}`);
  } else {
    lines.push("- I do not see a recent journey record for this vehicle.");
  }

  if (focus?.repair_focus || spares.recent_events?.length) {
    if (spares.recent_events?.length) {
      lines.push(`- Recent repair/spares events found: ${spares.recent_events.length}. Latest: ${formatSpareEventLine(spares.recent_events[0]).replace(/^- /, "")}`);
    } else {
      lines.push("- I do not see recent repair/spares history for this vehicle.");
    }
  }

  if (financials.visible) {
    lines.push(
      `- Finance trail: ${financials.journey_count || 0} journey(s), ${formatMoney(financials.revenue_kes)} revenue, ${formatMoney(financials.fuel_cost_kes)} fuel, ${formatMoney(financials.expense_cost_kes)} expenses, estimated profit ${formatMoney(financials.estimated_profit_kes)}.`
    );
  } else if (focus?.profitability_focus) {
    lines.push("- I am not exposing financial values for this role.");
  }

  return lines.length ? lines : ["- I found limited recent evidence for this vehicle."];
}

function formatInvestigationMeanings(caseFile: any, focus: any) {
  const lines: string[] = [];
  const fuel = caseFile.fuel_summary || {};
  const events = caseFile.events_alerts_summary || {};
  const spares = caseFile.spares_repair_summary || {};
  const financials = caseFile.financial_summary || {};
  const dataQuality = caseFile.data_quality_summary || {};
  const fuelTelemetry = fuel.telemetry || {};

  if (focus?.fuel_focus) {
    if (fuelTelemetry.fuel_telemetry_usable) {
      lines.push("- Fuel-level data is usable, so repeated drops or mismatches would be worth investigating against stops and receipts.");
    } else {
      lines.push("- Fuel telemetry is weak here, so any fuel concern needs receipts, tank dips, stops, and journey distance to support it.");
      if (dataQuality.flags?.includes("all_zero_or_unusable_fuel_sensor_fields")) {
        lines.push("- The all-zero/unknown fuel fields may be a provider mapping, calibration, or sensor issue.");
      }
    }
  }

  if (events.stop_like_events?.length) {
    lines.push("- Repeated stops/idle events may point to normal queues, dispatch holds, roadside delays, or behavior that needs supervisor review.");
  }

  if (focus?.profitability_focus && financials.visible) {
    if (Number(financials.estimated_profit_kes || 0) < 0) {
      lines.push("- The visible finance trail suggests this vehicle is loss-making in the sampled records.");
    } else if (financials.journey_count > 0) {
      lines.push("- The sampled finance trail does not by itself prove this vehicle is too expensive, but it gives a baseline for comparison.");
    }
  }

  if (focus?.repair_focus) {
    if (spares.recent_events?.length) {
      lines.push("- Recent repair/spares events can explain downtime or repeat issues, but lifespan needs install/removal or replacement history.");
    } else {
      lines.push("- I do not have enough repair history to say a repair failed.");
    }
  }

  if (!lines.length) {
    lines.push("- I see operational clues, but not enough evidence for a single confident cause yet.");
  }

  return lines;
}

function formatInvestigationLimits(caseFile: any, focus: any) {
  const lines: string[] = [];
  const dataQuality = caseFile.data_quality_summary || {};

  for (const note of dataQuality.notes || []) {
    lines.push(`- ${note}`);
  }

  if (focus?.fuel_focus) {
    lines.push("- I will not call this siphoning without usable fuel readings, tank dips, receipts, or clear fuel-drop events.");
  }
  if (focus?.repair_focus) {
    lines.push("- I will not claim repair lifespan or mechanic/vendor quality without enough install/removal/replacement history.");
  }
  if (focus?.profitability_focus && !caseFile.financial_summary?.visible) {
    lines.push("- Financial values are hidden for this role.");
  }

  return lines.length ? lines : ["- I cannot prove the root cause from the available data alone."];
}

function formatInvestigationNextChecks(caseFile: any, focus: any, label: string) {
  const checks: string[] = [];
  const financialsVisible = Boolean(caseFile.financial_summary?.visible);

  if (focus?.fuel_focus) {
    checks.push("- Compare fuel receipts, tank dips, route distance, and expected consumption for this vehicle.");
    checks.push("- Check stops around the latest idle/fuel-event times.");
  }
  if (focus?.stops_focus) {
    checks.push("- Review the latest stop/idle locations and whether they match yards, queues, borders, ports, or client sites.");
  }
  if (focus?.profitability_focus && financialsVisible) {
    checks.push("- Compare this vehicle against similar routes and clients before deciding it is expensive.");
  } else if (focus?.profitability_focus) {
    checks.push("- Review operational clues first: routes, stops, fuel availability, and repair history.");
  }
  if (focus?.repair_focus) {
    checks.push("- Check whether the same part was repaired, removed, or replaced again after the last repair.");
  }
  if (!checks.length) {
    checks.push(`- Review recent events, journeys, fuel entries, and repairs for ${label}.`);
  }

  return checks;
}

function formatInvestigationFollowUps(focus: any, label: string, caseFile: any = {}) {
  const financialsVisible = Boolean(caseFile.financial_summary?.visible);
  if (focus?.fuel_focus) {
    return `I can next check stops around the suspicious times, show enabled trucks with usable fuel data, or compare ${label} against similar trips.`;
  }
  if (focus?.stops_focus) {
    return `I can next group the stop locations for ${label}, or compare this vehicle's idle pattern against the rest of the fleet.`;
  }
  if (focus?.profitability_focus && financialsVisible) {
    return `I can next compare ${label} against similar routes, clients, or fuel/expense patterns.`;
  }
  if (focus?.profitability_focus) {
    return `I can next compare ${label} against similar routes and fuel/expense patterns if your role can view finance data, or stay with operational clues like stops, journeys, and repairs.`;
  }
  if (focus?.repair_focus) {
    return `I can next list the repair/spares timeline for ${label}, or look for repeat parts and mechanics.`;
  }
  return `I can next narrow this by stops, fuel, journeys, or repairs for ${label}.`;
}

function formatFuelTelemetryExplanation(telemetry: any) {
  if (!telemetry) {
    return {
      usable: false,
      text: "I do not have fuel-level telemetry available for this investigation.",
    };
  }

  if (telemetry.fuel_telemetry_usable) {
    const latest = formatFuelLevel(
      telemetry.latest_fuel_level,
      telemetry.latest_fuel_unit
    );
    const min = formatFuelLevel(
      telemetry.min_usable_fuel_level,
      telemetry.latest_fuel_unit
    );
    const max = formatFuelLevel(
      telemetry.max_usable_fuel_level,
      telemetry.latest_fuel_unit
    );
    const latestTime = telemetry.latest_fuel_at
      ? ` at ${formatReadableDate(telemetry.latest_fuel_at)}`
      : "";
    const rangeText =
      min === max ? "" : ` Recent range: ${min} to ${max}.`;

    return {
      usable: true,
      text: `Current fuel is available. Latest provider fuel reading: ${latest}${latestTime}.${rangeText}`,
    };
  }

  if (telemetry.fuel_readings > 0) {
    return {
      usable: false,
      text:
        "The provider is sending fuel fields, but they are not useful for this truck yet. The recent values are all 0/unknown, so I will not treat them as real tank readings.",
    };
  }

  if (telemetry.telemetry_points > 0) {
    return {
      usable: false,
      text:
        "The truck has recent telemetry, but I do not see usable fuel-level readings in that feed.",
    };
  }

  return {
    usable: false,
    text: "I do not see recent telemetry fuel-level data for this truck.",
  };
}

function formatFleetFuelAvailability(availability: any) {
  if (availability?.other_usable_fuel_data_available) {
    return "Some other vehicles do appear to have usable fuel/fuel-risk data. I can list them if you want.";
  }
  return "I do not currently see usable fuel-level telemetry across the enabled fleet.";
}

function formatFuelLevel(value: any, unit: any) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "not available";
  }
  const normalizedUnit = String(unit || "").trim().toLowerCase();
  const suffix = normalizedUnit && normalizedUnit !== "unknown" ? ` ${unit}` : "";
  return `${Number(value).toLocaleString()}${suffix}`;
}

function formatFuelRiskNarrative(risk: any) {
  if (risk.not_enabled) return "";
  if (risk.risk_level === "insufficient_data") {
    return "The existing fuel-risk check also says there is not enough usable fuel telemetry for a reliable score.";
  }

  const score =
    risk.risk_score === null || risk.risk_score === undefined
      ? "not available"
      : risk.risk_score;
  const level = risk.risk_level ? ` (${risk.risk_level})` : "";
  const smallDrops = Number(risk.small_drop_count || 0);
  const largeDrops = Number(risk.large_drop_count || 0);

  if (smallDrops > 0 || largeDrops > 0) {
    return `The existing fuel-risk check is ${score}${level}, with ${smallDrops} small drop(s) and ${largeDrops} large drop(s) in its analysis window. Treat that as an investigation cue, not a conclusion.`;
  }

  return `The existing fuel-risk check is ${score}${level}. I do not see fuel-drop evidence strong enough to call this confirmed.`;
}

function formatFuelLogLine(log: any) {
  const liters =
    log.liters === null || log.liters === undefined
      ? "liters not recorded"
      : `${formatNumber(log.liters)} liters`;
  const vendor = log.vendor ? ` - vendor ${log.vendor}` : "";
  const allocation = log.allocation_status ? ` - ${log.allocation_status}` : "";
  const source = log.fuel_source ? ` - ${log.fuel_source}` : "";

  return `- ${formatReadableDate(log.created_at)} - ${liters}${vendor}${allocation}${source}`;
}

function formatEventBrief(event: any) {
  const location = formatOperationalLocation(event);
  const driver = event.assigned_driver?.driver_name &&
    !isPlaceholderDriverName(event.assigned_driver.driver_name)
    ? ` while ${event.assigned_driver.driver_name} was assigned`
    : "";
  return `${formatSpareEventType(event.event_type)} at ${formatReadableDate(
    event.created_at || event.started_at
  )}${location ? ` ${location}` : ""}${driver}`;
}

function formatTimelineBlock(block: any, timeZone: string) {
  const state =
    block.state === "moving"
      ? "Moving"
      : block.state === "stationary"
        ? "Stationary"
        : "Unknown motion";
  const speedRange =
    block.min_speed === null || block.max_speed === null
      ? "speed unknown"
      : block.min_speed === block.max_speed
        ? `speed ${formatNumber(block.max_speed)}`
        : `speed ${formatNumber(block.min_speed)}-${formatNumber(block.max_speed)}`;
  const location = formatOperationalLocation({
    latitude: block.end_latitude,
    longitude: block.end_longitude,
    geofence_match: block.geofence_match,
  }, { gpsFallback: null });

  return `- ${state}: ${formatTimelineTime(block.start_at, timeZone)} to ${formatTimelineTime(
    block.end_at,
    timeZone
  )}; ${speedRange}; ${block.sample_count || 0} point(s)${
    location ? `; last position ${location}` : ""
  }.`;
}

function formatIdleComparison(event: any, timeZone: string) {
  const eventTime = event.started_at || event.created_at;
  const base = `${formatSpareEventType(event.event_type)} at ${formatTimelineTime(
    eventTime,
    timeZone
  )}`;
  const location = formatOperationalLocation(event);
  const duration =
    event.duration_minutes === null || event.duration_minutes === undefined
      ? ""
      : `, duration ${formatNumber(event.duration_minutes)} min`;

  if (event.classification === "historical_broken_by_movement") {
    const movementAt = event.movement_after_event_at
      ? ` Movement later appears at ${formatTimelineTime(event.movement_after_event_at, timeZone)}.`
      : "";
    return `- ${base}${location ? ` ${location}` : ""}${duration}: historical marker, broken by later movement.${movementAt}`;
  }

  if (event.classification === "possibly_current_same_location") {
    const distance =
      event.location_distance_km === null
        ? ""
        : ` Latest location is about ${formatNumber(event.location_distance_km)} km from the event marker.`;
    return `- ${base}${location ? ` ${location}` : ""}${duration}: possibly connected to the current stop.${distance}`;
  }

  return `- ${base}${location ? ` ${location}` : ""}${duration}: continuity not proven from the available movement blocks.`;
}

function formatTimelineTime(value: any, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown time";
  const formatted = new Intl.DateTimeFormat("en-KE", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  const label = timeZone === DEFAULT_OPERATIONAL_TIME_ZONE ? "EAT" : timeZone;
  return `${formatted} ${label}`;
}

function formatJourneyBrief(journey: any) {
  const reference = journey.reference || "Journey";
  const route = [journey.from_location, journey.to_location].filter(Boolean).join(" to ");
  const status = journey.status ? ` - ${journey.status}` : "";
  const client = journey.client_name ? ` - ${journey.client_name}` : "";
  const created = journey.created_at ? ` - ${formatReadableDate(journey.created_at)}` : "";

  return `- ${reference}${client}${route ? ` - ${route}` : ""}${status}${created}`;
}

type OperationalLocationOptions = {
  includeCoordinates?: boolean;
  gpsFallback?: string | null;
};

function formatOperationalLocation(value: any, options: OperationalLocationOptions = {}) {
  if (!value) return null;
  const resolvedLocation = value.location_resolution;
  if (resolvedLocation?.display_label) {
    if (resolvedLocation.confidence_source !== "coordinates_only") {
      return String(resolvedLocation.display_label);
    }
    return options.gpsFallback === undefined
      ? String(resolvedLocation.display_label)
      : options.gpsFallback;
  }
  if (value.provider_location_label) {
    return normalizeProviderLocationLabel(value.provider_location_label);
  }
  if (value.location_label) {
    return normalizeProviderLocationLabel(value.location_label);
  }
  if (value.location_name) {
    return normalizeProviderLocationLabel(value.location_name);
  }
  if (value.geofence_match?.name) {
    return `inside ${value.geofence_match.name}`;
  }
  if (hasCoordinates(value)) {
    if (options.includeCoordinates) {
      return `at coordinates ${formatCoordinate(value.latitude)}, ${formatCoordinate(value.longitude)}`;
    }
    return options.gpsFallback === undefined ? "at an unresolved GPS point" : options.gpsFallback;
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
  if (isPlaceholderDriverName(driverName)) {
    return "Driver assignment appears to be placeholder/test data.";
  }

  const eventName = event.event_type
    ? event.event_type.replace(/_/g, " ")
    : "This event";
  const truck = event.truck_id ? ` for ${event.truck_id}` : "";
  return `${eventName}${truck}: This happened while ${driverName} was assigned.`;
}

function formatDriverAssignment(assignment: any) {
  const driver = isPlaceholderDriverName(assignment.driver_name)
    ? "Placeholder/test driver"
    : assignment.driver_name || "Driver";
  const truck = assignment.truck_id || "an enabled asset";
  const since = assignment.assigned_from
    ? ` since ${formatReadableDate(assignment.assigned_from)}`
    : "";
  return `${driver} assigned to ${truck}${since}`;
}

function formatReadableDate(value: any) {
  return formatOperationalDateTime(value, DEFAULT_OPERATIONAL_TIME_ZONE);
}

function freshnessMinutesFromNow(value: any) {
  const timestamp = new Date(value || 0).getTime();
  if (!Number.isFinite(timestamp)) return null;
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  return Number.isFinite(minutes) ? minutes : null;
}

function hasCoordinates(value: any) {
  return Number.isFinite(Number(value?.latitude)) && Number.isFinite(Number(value?.longitude));
}

function formatCoordinate(value: any) {
  return Number(value).toFixed(5);
}
