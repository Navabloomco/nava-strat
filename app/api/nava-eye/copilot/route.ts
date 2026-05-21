// app/api/nava-eye/copilot/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import {
  routeContext,
  resolveTruckTimelineTimeframe,
} from "../../../../lib/intelligence/contextRouter";
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
      conversation?.pending_followup,
      { companyId: company.id }
    );
    const effectiveQuestion = pendingFollowupResolution.question;

    if (pendingFollowupResolution.needsClarification) {
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
            used_pending_followup: false,
            clarification_reason: pendingFollowupResolution.clarificationReason || null,
          },
        });
      }

      const clarification = pendingFollowupResolution.clarification ||
        "Which truck should I check?";

      if (conversation) {
        await appendConversationMessage({
          conversationId: conversation.id,
          companyId: company.id,
          userId: auth.user.id,
          sender: "assistant",
          role: "assistant",
          content: clarification,
          intent: "clarification",
          metadata: {
            reason:
              pendingFollowupResolution.clarificationReason ||
              "missing_pending_followup",
          },
        });

        await updateConversationAfterAnswer({
          conversation,
          companyId: company.id,
          userId: auth.user.id,
          intent: "clarification",
          pendingFollowup: conversation.pending_followup || {},
          titleQuestion: question,
        });
      }

      return jsonResponse({
        success: true,
        tenant: company.slug,
        company,
        answer: clarification,
        intent: "clarification",
        conversation_id: conversation?.id || null,
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
          used_active_topic: pendingFollowupResolution.usedActiveTopic,
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
        used_active_topic: pendingFollowupResolution.usedActiveTopic,
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
      context.intent !== "truck_compound" &&
      context.intent !== "fleet_movement" &&
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
                "You are Nava Eye, a company operations intelligence analyst for logistics. Use only the provided data. Analyze deeply, then present clean operator-ready answers. Use direct operational statements, not database/log-viewer language. Avoid phrases like \"Nava reads\", \"Nava treats\", \"based on the data provided\", \"available data does not prove\", or \"I cannot treat\". Keep uncertainty as an operational boundary: say what is established, what is suggested, and what remains unverified. Do not accuse drivers or recommend discipline/contacting drivers by default. Include relevant active memories if they help answer the question. For fleet status answers, describe user-facing times in the provided operational timezone, normally EAT, and state the timezone once instead of repeating it after every timestamp. Translate locations into operational place context and do not show raw coordinates unless the user explicitly asks for GPS/coordinates or no readable place label exists.",
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
          answer = aiData.choices?.[0]?.message?.content || "No assistant answer was generated.";
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
  if (context.compound_truck_request && context.truck) {
    return buildCompoundTruckAnswer(context);
  }
  if (context.fleet_movement_summary) {
    return buildFleetMovementSummaryAnswer(context);
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
    return "Operational context is available for this role, but financial values are restricted. Ask an owner, admin, finance, management, or platform owner user to review profitability.";
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

function resolvePendingFollowupQuestion(
  question: string,
  pendingFollowup: any,
  options: { companyId?: string | null } = {}
) {
  const pending = sanitizeConversationMetadata(pendingFollowup || {});
  const activeTopic = getActiveTruckTopic(pending, options.companyId);
  const prompt = typeof pending.prompt === "string" ? pending.prompt.trim() : "";
  const detailedTimelineRequest = isDetailedTimelineRequest(question);
  const explicitFleetScope = asksForExplicitFleetScope(question);
  const explicitVehicleInput = containsVehicleLikeInput(question);
  const ellipticalTruckQuestion = isEllipticalTruckQuestion(question);

  if (
    detailedTimelineRequest &&
    prompt &&
    isTimelinePendingFollowup(pending) &&
    !explicitVehicleInput &&
    !explicitFleetScope
  ) {
    return {
      question: `${prompt} Show the detailed timeline evidence with movement and stationary blocks.`.slice(0, 500),
      usedPendingFollowup: true,
      usedActiveTopic: Boolean(activeTopic),
      pendingType: typeof pending.type === "string" ? pending.type : null,
    };
  }

  if (ellipticalTruckQuestion && activeTopic && !explicitFleetScope && !explicitVehicleInput) {
    return {
      question: buildTruckScopedFollowupQuestion(question, activeTopic),
      usedPendingFollowup: false,
      usedActiveTopic: true,
      pendingType: typeof pending.type === "string" ? pending.type : "active_truck_topic",
    };
  }

  if (
    ellipticalTruckQuestion &&
    !activeTopic &&
    !explicitFleetScope &&
    !explicitVehicleInput
  ) {
    return {
      question,
      usedPendingFollowup: false,
      usedActiveTopic: false,
      pendingType: null,
      needsClarification: true,
      clarificationReason: "missing_active_truck_topic",
      clarification: "Which truck should I check?",
    };
  }

  if (!isShortFollowupCommand(question) || !prompt) {
    return {
      question,
      usedPendingFollowup: false,
      usedActiveTopic: false,
      pendingType: null,
    };
  }

  return {
    question: prompt.slice(0, 500),
    usedPendingFollowup: true,
    usedActiveTopic: Boolean(activeTopic),
    pendingType: typeof pending.type === "string" ? pending.type : null,
  };
}

function getActiveTruckTopic(pending: any, companyId?: string | null) {
  const topic = pending?.active_topic;
  if (!topic || typeof topic !== "object") return null;
  if (String(topic.entity_type || "") !== "truck") return null;
  const truckId = String(topic.truck_id || "").trim();
  if (!truckId || truckId.length > 80) return null;
  const topicCompanyId = String(topic.company_id || "").trim();
  if (companyId && topicCompanyId && topicCompanyId !== companyId) return null;

  return {
    entity_type: "truck",
    truck_id: truckId,
    company_id: topicCompanyId || companyId || null,
    timeframe: sanitizeTopicTimeframe(topic.timeframe),
  };
}

function sanitizeTopicTimeframe(value: any) {
  if (!value || typeof value !== "object") return null;
  const requested = String(value.requested || "").trim().toLowerCase();
  if (requested !== "today" && requested !== "yesterday") return null;
  const dayOffset = requested === "yesterday" ? -1 : 0;
  return {
    requested,
    dayOffset,
    local_day: value.local_day ? String(value.local_day).slice(0, 20) : null,
    day_start_utc: value.day_start_utc ? String(value.day_start_utc).slice(0, 40) : null,
    day_end_utc: value.day_end_utc ? String(value.day_end_utc).slice(0, 40) : null,
    display_date_label: value.display_date_label
      ? String(value.display_date_label).slice(0, 80)
      : null,
  };
}

function buildTruckScopedFollowupQuestion(question: string, activeTopic: any) {
  const trimmed = String(question || "").trim();
  const normalized = trimmed.toLowerCase().replace(/[’]/g, "'");
  const truckId = activeTopic.truck_id;
  const fallbackTimeframe = activeTopic.timeframe || null;
  const timeframe = resolveTruckTimelineTimeframe(normalized, fallbackTimeframe);
  const hasExplicitTimeframe = questionHasExplicitTimeframe(normalized);
  const timeframeSuffix =
    !hasExplicitTimeframe && timeframe?.requested === "yesterday"
      ? " for yesterday"
      : !hasExplicitTimeframe && timeframe?.requested === "today" && isDetailedTimelineRequest(normalized)
        ? " for today"
        : "";

  if (/^show\s+yesterday\b/.test(normalized) || /^what\s+about\s+yesterday\b/.test(normalized)) {
    return `Show yesterday's movement for ${truckId}.`;
  }

  if (/^show\s+today\b/.test(normalized) || /^what\s+about\s+today\b/.test(normalized)) {
    return `Show today's movement for ${truckId}.`;
  }

  if (isDetailedTimelineRequest(normalized)) {
    return `Show detailed timeline for ${truckId}${timeframeSuffix}.`;
  }

  if (/\bis\s+it\s+idling\b/.test(normalized) || /\bidle\s+risk\b/.test(normalized)) {
    return `Is ${truckId} idling?`;
  }

  if (/\bis\s+it\s+moving\b/.test(normalized)) {
    return `Is ${truckId} moving?`;
  }

  const withoutTerminalPunctuation = trimmed.replace(/[.!?]+$/g, "");
  return `${withoutTerminalPunctuation} for ${truckId}${timeframeSuffix}?`.slice(0, 500);
}

function questionHasExplicitTimeframe(lower: string) {
  return (
    lower.includes("today") ||
    lower.includes("yesterday") ||
    lower.includes("previous day") ||
    lower.includes("previous-day") ||
    lower.includes("last operating day") ||
    lower.includes("last full route")
  );
}

function isEllipticalTruckQuestion(question: string) {
  const lower = String(question || "")
    .trim()
    .toLowerCase()
    .replace(/[’]/g, "'");
  if (!lower) return false;
  if (asksForExplicitFleetScope(lower)) return false;

  return (
    /\bwhat\s+are\s+(?:today'?s|yesterday'?s)\s+movements?\b/.test(lower) ||
    /\b(?:today'?s|yesterday'?s)\s+movements?\b/.test(lower) ||
    /\bshow\s+(?:today|yesterday)\b/.test(lower) ||
    /\bwhat\s+about\s+(?:today|yesterday)\b/.test(lower) ||
    /\bwhere\s+did\s+it\s+go\b/.test(lower) ||
    /\bis\s+it\s+(?:moving|idling|stopped|stationary)\b/.test(lower) ||
    /\bidle\s+risk\b/.test(lower) ||
    isDetailedTimelineRequest(lower)
  );
}

function asksForExplicitFleetScope(question: string) {
  const lower = String(question || "").toLowerCase();
  return /\b(fleet|all trucks|all vehicles|whole fleet|every truck|every vehicle|all assets|company-wide)\b/.test(
    lower
  );
}

function containsVehicleLikeInput(question: string) {
  return /[a-z]{2,4}[\s\-/.]*\d{2,4}\s*[a-z]?/i.test(String(question || ""));
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

function isDetailedTimelineRequest(question: string) {
  const lower = String(question || "").trim().toLowerCase();
  return (
    lower.includes("show detailed timeline") ||
    lower.includes("detailed timeline") ||
    lower.includes("show all blocks") ||
    lower.includes("all blocks") ||
    lower.includes("full evidence") ||
    lower.includes("raw timeline") ||
    lower.includes("expand the timeline") ||
    lower.includes("expand timeline") ||
    lower.includes("show the log blocks") ||
    lower.includes("log blocks")
  );
}

function isTimelinePendingFollowup(pending: any) {
  const type = String(pending?.type || "");
  return type === "compare_stop_motion_timeline" || type === "show_detailed_timeline";
}

function buildPendingFollowup(context: any, answer: string) {
  const truckLabel =
    context.truck?.registration ||
    context.truck?.truck_id ||
    context.vehicle_match?.matched_registration ||
    context.vehicle_match?.matched_truck_id ||
    context.detected_truck_id ||
    null;
  const attachActiveTopic = (followup: Record<string, any>, timeframeOverride: any = null) => {
    if (!truckLabel) return followup;
    return {
      ...followup,
      truck_id: followup.truck_id || truckLabel,
      active_topic: buildActiveTruckTopic(context, truckLabel, timeframeOverride),
    };
  };

  if (context.intent === "truck_status" && truckLabel) {
    const prompt = context.live_status_idle_focus
      ? `Compare today's idle markers against movement for ${truckLabel}. Keep the timeline in EAT/Kenya time and do not infer continuous idling unless movement data supports it.`
      : `Review today's movement timeline for ${truckLabel}. Summarize the corridor route, stop/rest pattern, and idle marker interpretation without raw coordinates or provider payloads.`;

    return attachActiveTopic({
      type: "compare_stop_motion_timeline",
      truck_id: truckLabel,
      timeframe: "today",
      prompt,
    }, { requested: "today", dayOffset: 0 });
  }

  if (
    context.truck_timeline_comparison &&
    truckLabel &&
    !context.timeline_detail_requested
  ) {
    const timeline = context.truck_timeline_comparison || {};
    const requestedTimeframe = timeline.timeframe?.requested || "today";
    if (timeline.timeframe?.new_day_rollover_window || timeline.day_story?.new_day_rollover_window) {
      return attachActiveTopic({
        type: "compare_stop_motion_timeline",
        truck_id: truckLabel,
        timeframe: "yesterday",
        prompt: `Show yesterday's movement for ${truckLabel}. Summarize the previous operating day's corridor route, stop/rest pattern, and idle marker interpretation without raw coordinates or provider payloads.`,
      }, { requested: "yesterday", dayOffset: -1 });
    }
    return attachActiveTopic({
      type: "show_detailed_timeline",
      truck_id: truckLabel,
      timeframe: requestedTimeframe,
      prompt: `Show the detailed timeline for ${truckLabel}${
        requestedTimeframe === "yesterday" ? " for yesterday" : ""
      }. Include movement/stationary blocks and idle marker evidence, but do not show raw coordinates or provider payloads.`,
    }, timeline.timeframe);
  }

  if (context.fuel_investigation && truckLabel) {
    return attachActiveTopic({
      type: "fuel_investigation_next_checks",
      truck_id: truckLabel,
      prompt: `Continue the fuel investigation for ${truckLabel}. Check stops, journeys, manual fuel entries, and usable provider fuel telemetry without accusing anyone.`,
    });
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

  if (truckLabel) {
    return attachActiveTopic({
      type: "active_truck_topic",
      truck_id: truckLabel,
    });
  }

  return {};
}

function buildActiveTruckTopic(context: any, truckLabel: string, timeframeOverride: any = null) {
  const timeline =
    context.truck_timeline_comparison ||
    Object.values(context.truck_timelines || {})[0] ||
    null;
  const timeframe =
    sanitizeTopicTimeframe(timeframeOverride) ||
    sanitizeTimelineTimeframe(timeline) ||
    sanitizeTopicTimeframe(context.timeline_timeframe) ||
    null;

  return {
    entity_type: "truck",
    truck_id: truckLabel,
    company_id: context.company?.id || null,
    last_intent: context.intent || null,
    timeframe,
    updated_at: new Date().toISOString(),
  };
}

function sanitizeTimelineTimeframe(timeline: any) {
  if (!timeline?.timeframe) return null;
  const requested = String(timeline.timeframe.requested || "").trim().toLowerCase();
  if (requested !== "today" && requested !== "yesterday") return null;
  return {
    requested,
    dayOffset:
      Number.isFinite(Number(timeline.timeframe.day_offset))
        ? Number(timeline.timeframe.day_offset)
        : requested === "yesterday"
          ? -1
          : 0,
    local_day: timeline.local_day || timeline.timeframe.local_day || null,
    day_start_utc: timeline.query_window_utc?.start || null,
    day_end_utc: timeline.query_window_utc?.end || null,
    display_date_label: buildTimelineDisplayDateLabel(timeline),
  };
}

function buildTimelineDisplayDateLabel(timeline: any) {
  const localDay = timeline?.local_day || timeline?.timeframe?.local_day || null;
  if (!localDay) return timeline?.timeframe?.requested || null;
  return `${localDay} ${timeline?.timezone?.label || "local time"}`;
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
    `A few possible matches came up for ${input}. Which one do you mean?`,
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

  return `${label} is present, but answers are limited to assets enabled for intelligence. This asset may be waiting for review.`;
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
    return "The dashboard trucks for that follow-up could not be safely resolved. Try asking with the truck registrations shown in the dashboard card.";
  }

  parts.push(`Using the ${label} currently shown on this dashboard, not unrelated recent events.`);
  parts.push(
    "Telemetry timestamps are compared internally, then presented in local operational time. Earlier idle events are historical markers, not proof of one continuous idle period if later movement appears."
  );
  if (strongIdleCount) {
    parts.push(
      `${strongIdleCount} of them have fresh low-speed telemetry and a recent idle event, so the current idle/stationary read is strong. Engine-on idling is not confirmed without ignition or engine-status data.`
    );
  } else {
    parts.push("Latest telemetry and recent idle events were checked for those exact trucks.");
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
      `${unmatched
        .map((truck: any) => truck.truck_id)
        .join(", ")} could not be safely matched to enabled intelligence assets, so telemetry is hidden for them.`
    );
  }

  parts.push("");
  parts.push(
    buildDashboardFollowupQuestion(visibleTrucks)
  );

  return parts.join("\n");
}

function buildFleetMovementSummaryAnswer(context: any) {
  const summary = context.fleet_movement_summary || {};
  const timeframe = summary.timeframe || {};
  const timeZone = summary.timezone?.time_zone || DEFAULT_OPERATIONAL_TIME_ZONE;
  const localDay = timeframe.local_day || "the selected day";
  const label = summary.timezone?.label || "local time";
  const parts: string[] = [];

  parts.push(`Fleet movement summary for ${localDay} (${label}).`);

  if (Number(summary.enabled_asset_count || 0) === 0) {
    parts.push("No enabled intelligence assets are available for this company, so fleet movement cannot be summarized yet.");
    return parts.join("\n");
  }

  if (Number(summary.telemetry_points || 0) === 0) {
    parts.push(
      `No enabled-asset telemetry was found for ${localDay}. I will not fall back to another date unless you ask for a different operating day.`
    );
    return parts.join("\n");
  }

  parts.push(
    `${Number(summary.trucks_with_telemetry || 0).toLocaleString()} of ${Number(
      summary.enabled_asset_count || 0
    ).toLocaleString()} enabled truck(s) reported telemetry. ${Number(
      summary.moving_truck_count || 0
    ).toLocaleString()} showed movement during the operating day; ${Number(
      summary.stationary_truck_count || 0
    ).toLocaleString()} ended the window stationary or low-speed.`
  );

  if (summary.truncated) {
    parts.push(
      "The fleet sample hit the query cap, so this is a safe high-level summary rather than a full truck-by-truck route reconstruction."
    );
  }

  const sampleTrucks = Array.isArray(summary.sample_trucks)
    ? summary.sample_trucks.slice(0, 6)
    : [];
  if (sampleTrucks.length) {
    parts.push("");
    parts.push("Sample truck reads");
    parts.push(
      ...sampleTrucks.map((truck: any) => {
        const labelText = truck.registration || truck.truck_id || "truck";
        const state =
          truck.latest_state === "moving"
            ? "moving at latest read"
            : truck.latest_state === "stationary"
              ? "stationary at latest read"
              : "latest state unknown";
        const speed =
          truck.latest_speed === null || truck.latest_speed === undefined
            ? ""
            : `, speed ${formatNumber(truck.latest_speed)}`;
        const latest = truck.latest_recorded_at
          ? `, latest ${formatTimelineClock(truck.latest_recorded_at, timeZone)}`
          : "";
        return `- ${labelText}: ${state}${speed}${latest}; ${Number(
          truck.points_found || 0
        ).toLocaleString()} point(s).`;
      })
    );
  }

  if (Number(summary.no_telemetry_truck_count || 0) > 0) {
    parts.push(
      `${Number(summary.no_telemetry_truck_count).toLocaleString()} enabled truck(s) had no telemetry in this resolved window.`
    );
  }

  parts.push("");
  parts.push("Ask about a specific truck for a corridor route narrative or detailed timeline.");

  return parts.join("\n");
}

function buildCompoundTruckAnswer(context: any) {
  const sections = context.compound_truck_request?.sections || [];
  const parts: string[] = [];

  sections.forEach((section: any, index: number) => {
    const title = formatCompoundTruckSectionTitle(section);
    parts.push(`${index + 1}. ${title}`);

    if (section.type === "current_status") {
      parts.push(
        buildTruckStatusFallbackAnswer(context, {
          includeIdleRead: false,
          includeFollowUp: false,
        })
      );
    } else if (section.type === "idle_status") {
      parts.push(buildTruckIdleStatusAnswer(context));
    } else if (section.type === "movement_timeline") {
      const timeline = getCompoundTimeline(context, section);
      parts.push(
        buildTruckTimelineComparisonAnswer({
          ...context,
          truck_timeline_comparison: timeline,
          timeline_detail_requested: false,
        })
      );
    } else if (section.type === "detailed_timeline") {
      const timeline = getCompoundTimeline(context, section);
      parts.push(
        buildTruckTimelineComparisonAnswer({
          ...context,
          truck_timeline_comparison: timeline,
          timeline_detail_requested: true,
        })
      );
    }

    if (index < sections.length - 1) parts.push("");
  });

  return parts.join("\n");
}

function formatCompoundTruckSectionTitle(section: any) {
  if (section.type === "current_status") return "Current location";
  if (section.type === "idle_status") return "Idle status";
  if (section.type === "movement_timeline") {
    return section.timeframe?.requested === "yesterday"
      ? "Yesterday's movement"
      : "Movement timeline";
  }
  if (section.type === "detailed_timeline") return "Detailed timeline";
  return "Truck check";
}

function getCompoundTimeline(context: any, section: any) {
  const key =
    section.timeline_key ||
    (section.timeframe?.requested === "yesterday" ? "yesterday" : "today");
  return context.truck_timelines?.[key] || context.truck_timeline_comparison || {};
}

function buildTruckStatusFallbackAnswer(context: any, options: any = {}) {
  const includeIdleRead = options.includeIdleRead !== false;
  const includeFollowUp = options.includeFollowUp !== false;
  const model = buildLiveTruckStatusModel(context);
  const parts: string[] = [];

  parts.push(
    `**${formatLiveTruckTopLine(
      model.matchedLabel,
      model.locationText,
      model.lastSeenAt,
      model.speed,
      model.stale,
      model.timeZone
    )}**`
  );
  parts.push(formatTimelineTimeNote(model.timeZone));

  if (context.coordinate_request && model.hasGpsPoint) {
    parts.push(
      `Coordinates: ${formatCoordinate(model.locationPoint.latitude)}, ${formatCoordinate(
        model.locationPoint.longitude
      )}.`
    );
  }

  parts.push(formatLiveOperationalState(model.speed, model.stale));

  if (hasAmbiguousTimestampWarning(model.timestampWarnings)) {
    parts.push(
      "Provider time appears local/ambiguous, so treat this timeline as approximate."
    );
  }

  if (includeIdleRead) {
    const idleRead = formatLiveIdleMarkerRead({
      idleEvents: model.idleEvents,
      latestPoint: model.locationPoint,
      speed: model.speed,
      idleFocus: Boolean(context.live_status_idle_focus),
      ignitionState: model.ignitionState,
    });
    if (idleRead) parts.push(idleRead);
  }

  if (includeFollowUp) {
    parts.push(
      context.live_status_idle_focus
        ? "I can compare today's idle markers against movement if you want."
        : "I can review today's movement timeline if you want."
    );
  }

  return parts.join("\n");
}

function buildTruckIdleStatusAnswer(context: any) {
  const model = buildLiveTruckStatusModel(context);
  const parts = [formatLiveOperationalState(model.speed, model.stale)];
  const idleRead = formatLiveIdleMarkerRead({
    idleEvents: model.idleEvents,
    latestPoint: model.locationPoint,
    speed: model.speed,
    idleFocus: true,
    ignitionState: model.ignitionState,
  });
  if (idleRead) {
    parts.push(idleRead);
  }
  return parts.join("\n");
}

function buildLiveTruckStatusModel(context: any) {
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
  const timeZone = context.display_timezone?.time_zone || DEFAULT_OPERATIONAL_TIME_ZONE;
  const latestPoint = latestTelemetry || truck;
  const lastSeenAt = latestTelemetry?.recorded_at || truck.last_seen_at || null;
  const speed = finiteNumberOrNull(latestTelemetry?.speed);
  const locationPoint = {
    ...truck,
    latitude: latestPoint?.latitude ?? truck.latitude,
    longitude: latestPoint?.longitude ?? truck.longitude,
    provider_location_label:
      latestTelemetry?.provider_location_label || truck.provider_location_label || null,
  };
  const location = formatOperationalLocation(locationPoint, {
    includeCoordinates: Boolean(context.coordinate_request),
    gpsFallback: null,
  });
  const locationText = location || "at its latest known GPS point";
  const hasGpsPoint = hasCoordinates(locationPoint);
  const freshnessMinutes = freshnessMinutesFromNow(lastSeenAt);
  const stale = freshnessMinutes !== null && freshnessMinutes > 60;
  const timestampWarnings = latestTelemetry?.validation?.warnings || [];
  const ignitionState = normalizeIgnitionState(
    latestTelemetry?.ignition_status ??
      latestTelemetry?.engine_status ??
      latestTelemetry?.ignition ??
      latestTelemetry?.engine_on ??
      latestTelemetry?.ignition_on ??
      truck.ignition_status ??
      truck.engine_status ??
      truck.ignition ??
      truck.engine_on ??
      truck.ignition_on
  );

  return {
    truck,
    latestTelemetry,
    idleEvents,
    matchedLabel,
    timeZone,
    latestPoint,
    lastSeenAt,
    speed,
    locationPoint,
    locationText,
    hasGpsPoint,
    stale,
    timestampWarnings,
    ignitionState,
  };
}

function formatLiveTruckTopLine(
  label: string,
  location: string,
  lastSeenAt: any,
  speed: number | null,
  stale: boolean,
  timeZone: string
) {
  const time = formatTimelineClock(lastSeenAt, timeZone);
  if (stale) {
    return `${label} was last seen ${location} at ${time}; this is a last-known position, not confirmed live status.`;
  }
  if (speed !== null && speed > 5) {
    return `${label} is moving ${location}, last seen at ${time} at ${formatNumber(speed)} km/h.`;
  }
  if (speed !== null) {
    return `${label} is currently stopped ${location}, last seen at ${time} with speed ${formatNumber(speed)}.`;
  }
  return `${label} is at its latest known position ${location}, last seen at ${time}; speed is not available.`;
}

function formatLiveOperationalState(speed: number | null, stale: boolean) {
  if (stale) {
    return "Provider data is stale; refresh sync or live tracking before treating it as current.";
  }
  if (speed === null) {
    return "Location is available, but speed is missing, so the live motion state is unverified.";
  }
  if (speed > 5) {
    return "This is active movement.";
  }
  return "The truck is stopped/stationary.";
}

function formatLiveIdleMarkerRead({
  idleEvents,
  latestPoint,
  speed,
  idleFocus,
  ignitionState,
}: {
  idleEvents: any[];
  latestPoint: any;
  speed: number | null;
  idleFocus: boolean;
  ignitionState: string | null;
}) {
  const latestIdle = idleEvents[0] || null;
  if (!latestIdle) {
    return idleFocus ? "No recent idle marker is attached to this truck's current status." : "";
  }
  if (!isRecentOperationalEvent(latestIdle, 24)) {
    return idleFocus
      ? "Older idle markers exist for this truck, but no recent marker is strong enough to support a live idle read."
      : "";
  }

  const distanceKm = distanceBetweenPointsKm(latestPoint, latestIdle);
  const nearSameLocation = distanceKm !== null ? distanceKm <= 0.5 : false;
  const markerText = formatIdleMarkerLabel(latestIdle);
  const locationPhrase = nearSameLocation ? " near this location" : " in this truck's event trail";
  const base = `${markerText} is present${locationPhrase}.`;

  if (ignitionState === "on" && speed !== null && speed <= 5) {
    return `${base} Ignition is on, so this is an active idle risk.`;
  }
  if (ignitionState === "off" && speed !== null && speed <= 5) {
    return `${base} Ignition is off, so this looks like a parked/stopped state rather than active idling.`;
  }
  if (speed !== null && speed <= 5) {
    return `${base} Without ignition data, this remains an unverified idle risk, not confirmed engine-on idling.`;
  }

  return `${base} Latest speed does not support a stopped live-idle read right now.`;
}

function formatIdleMarkerLabel(event: any) {
  const type = String(event?.event_type || "").trim().toLowerCase();
  if (type === "excessive_idle") return "An excessive-idle marker";
  if (type === "idle") return "An idle marker";
  return "A stop/idle marker";
}

function isRecentOperationalEvent(event: any, hours: number) {
  const timestamp = new Date(event?.created_at || event?.started_at || 0).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= hours * 60 * 60 * 1000;
}

function distanceBetweenPointsKm(first: any, second: any) {
  const lat1 = finiteNumberOrNull(first?.latitude);
  const lon1 = finiteNumberOrNull(first?.longitude);
  const lat2 = finiteNumberOrNull(second?.latitude);
  const lon2 = finiteNumberOrNull(second?.longitude);
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return null;

  const earthRadiusKm = 6371;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const haversine =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(deltaLon / 2) *
      Math.sin(deltaLon / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
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
  const summary = timeline.telemetry_summary || {};
  const dayStory = timeline.day_story || {};
  const latest = timeline.latest_snapshot || null;
  const blocks = Array.isArray(timeline.motion_blocks) ? timeline.motion_blocks : [];
  const idleEvents = Array.isArray(timeline.idle_events) ? timeline.idle_events : [];
  const continuity = timeline.continuity || {};
  const timeframe = timeline.timeframe || {
    requested: "today",
    new_day_rollover_window: Boolean(dayStory.new_day_rollover_window),
  };
  const detailed = Boolean(context.timeline_detail_requested);
  const parts: string[] = [];

  if (detailed) {
    return buildDetailedTruckTimelineAnswer({
      label,
      timeZone,
      dayStory,
      summary,
      latest,
      blocks,
      idleEvents,
      continuity,
      timeframe,
    });
  }

  if (isEmptyRequestedTimeline(timeframe, summary)) {
    return buildEmptyTimelineWindowAnswer(label, timeframe);
  }

  const rollover = isNewDayRolloverWindow(timeframe, dayStory, summary);

  parts.push(buildLogisticsTimelineOpening(label, dayStory, summary, continuity, latest, timeZone, timeframe));
  parts.push(formatTimelineTimeNote(timeZone));
  const coverageNote = formatNarrativeCoverageNote(dayStory, summary, timeZone, timeframe);
  if (coverageNote) {
    parts.push("");
    parts.push(coverageNote);
  }

  parts.push("");
  parts.push("The corridor route");
  parts.push(buildCorridorRouteNarrative(label, dayStory, summary, timeZone, timeframe));

  parts.push("");
  parts.push("Idle alerts");
  parts.push(buildNarrativeIdleAlerts(idleEvents, continuity, summary));

  parts.push("");
  parts.push("Hardware note");
  parts.push(formatHardwareNote(latest));

  parts.push("");
  parts.push(
    rollover
      ? "I can check yesterday's full route if you want the complete corridor story."
      : "I can show the detailed timeline if you want."
  );

  return parts.join("\n");
}

function buildLogisticsTimelineOpening(
  label: string,
  dayStory: any,
  summary: any,
  continuity: any,
  latest: any,
  timeZone: string,
  timeframe: any
) {
  const latestSeen = dayStory.latest_seen || latest || null;
  const location =
    formatNarrativeLocation(latestSeen?.location || latest?.location_resolution) ||
    "at its latest known GPS point";
  const speed = finiteNumberOrNull(latestSeen?.speed ?? latest?.speed);
  const movementState = formatNarrativeMovementState(speed);
  const time = formatTimelineClock(latestSeen?.recorded_at || latest?.recorded_at, timeZone);
  const speedText = speed === null ? "" : ` with speed ${formatNumber(speed)}`;
  const positionText =
    timeframe?.requested === "yesterday"
      ? `${label}'s yesterday movement ended ${location}`
      : speed === null
      ? `${label} has a latest known position ${location}`
      : `${label} is currently ${movementState} ${location}`;
  const routeEvidence =
    continuity.historical_idle_markers_broken_by_movement ||
    Number(summary.movement_blocks || 0) > 0;
  const rollover = isNewDayRolloverWindow(timeframe, dayStory, summary);
  const verdict =
    timeframe?.requested === "yesterday"
      ? routeEvidence
        ? "This is a previous-day route narrative, not a current-status snapshot."
        : "This is a narrow previous-day operating read, so it should not be forced into a full route story."
      : rollover
    ? "This is a new-day window after the EAT rollover, so a full-day route has not accumulated yet."
    : routeEvidence
    ? "The truck was not stuck in an all-day delay."
    : "This is a narrow operating read, so it should not be forced into a full-day route story.";
  const metricSentence = rollover ? "" : buildHumanTimelineMetrics(dayStory.stop_summary || {});

  return `${positionText}, last seen at ${time}${speedText}. ${verdict}${
    metricSentence ? ` ${metricSentence}` : ""
  }`;
}

function isEmptyRequestedTimeline(timeframe: any, summary: any) {
  return timeframe?.requested === "yesterday" && Number(summary?.points_found || 0) === 0;
}

function buildEmptyTimelineWindowAnswer(label: string, timeframe: any) {
  if (timeframe?.requested === "yesterday") {
    return `${label} has no telemetry history for yesterday in this company workspace, so that route cannot be reconstructed. I can check the current truck status or another operating day if you want.`;
  }

  return `${label} has no telemetry history in this operating window, so the route cannot be reconstructed from movement logs.`;
}

function formatNarrativeCoverageNote(dayStory: any, summary: any, timeZone: string, timeframe: any = {}) {
  if (isNewDayRolloverWindow(timeframe, dayStory, summary)) {
    return "";
  }
  if (dayStory.coverage_is_partial && dayStory.coverage_start_at && dayStory.coverage_end_at) {
    return `This ${formatTimeframeLabel(timeframe)} operating window currently runs from ${formatTimelineClock(
      dayStory.coverage_start_at,
      timeZone
    )} to ${formatTimelineClock(dayStory.coverage_end_at, timeZone)}. The route read below is based on that window.`;
  }
  if (summary.data_density === "low") {
    return `This is a thin ${formatTimeframeLabel(timeframe)} operating read, so the visible movement window is being compared with any idle markers instead of forcing a full-day route story.`;
  }
  return "";
}

function buildHumanTimelineMetrics(stopSummary: any) {
  const moving = finiteNumberOrNull(stopSummary.total_moving_minutes);
  const stopped = finiteNumberOrNull(stopSummary.total_stopped_minutes);
  const sentences: string[] = [];

  if (Number(moving || 0) > 0 || Number(stopped || 0) > 0) {
    if (moving !== null && stopped !== null) {
      sentences.push(
        `It logged about ${formatDurationWords(moving)} of movement against about ${formatDurationWords(
          stopped
        )} of stationary/rest periods.`
      );
    } else if (moving !== null) {
      sentences.push(`It logged about ${formatDurationWords(moving)} of movement in the visible window.`);
    } else if (stopped !== null) {
      sentences.push(
        `It logged about ${formatDurationWords(stopped)} of stationary/rest time in the visible window.`
      );
    }
  }

  const stopPhrase = buildHumanStopMix(stopSummary);
  if (stopPhrase) sentences.push(stopPhrase);

  return sentences.join(" ");
}

function buildHumanStopMix(stopSummary: any) {
  const major = Number(stopSummary.major_stop_count || 0);
  const medium = Number(stopSummary.medium_stop_count || 0);
  const short = Number(stopSummary.short_stop_count || 0);
  const shorter = medium + short;

  if (major > 0 && shorter > 0) {
    return `It made ${major.toLocaleString()} major stop${major === 1 ? "" : "s"} and ${
      shorter === 1 ? "one shorter operational stop" : "several shorter operational stops"
    }.`;
  }
  if (major > 0) {
    return `It made ${major.toLocaleString()} major stop${major === 1 ? "" : "s"}.`;
  }
  if (shorter > 0) {
    return `It made ${shorter === 1 ? "one shorter operational stop" : "several shorter operational stops"}.`;
  }
  return "";
}

function isNewDayRolloverWindow(timeframe: any, dayStory: any, summary: any) {
  if (timeframe?.requested !== "today") return false;
  if (timeframe?.new_day_rollover_window || dayStory?.new_day_rollover_window) return true;

  const elapsedLocalDayMinutes = finiteNumberOrNull(timeframe?.elapsed_local_day_minutes);
  const coverageMinutes = finiteNumberOrNull(dayStory?.coverage_minutes);
  const firstPointMinutesAfterDayStart = finiteNumberOrNull(
    dayStory?.first_point_minutes_after_day_start
  );
  const points = Number(summary?.points_found || 0);
  const movingBlocks = Number(summary?.movement_blocks || 0);
  const stationaryBlocks = Number(summary?.stationary_blocks || 0);

  if (elapsedLocalDayMinutes !== null && elapsedLocalDayMinutes <= 240 && points < 12) {
    return true;
  }

  return Boolean(
    firstPointMinutesAfterDayStart !== null &&
      firstPointMinutesAfterDayStart <= 30 &&
      Number(coverageMinutes || 0) <= 90 &&
      movingBlocks === 0 &&
      stationaryBlocks <= 1
  );
}

function formatTimeframeLabel(timeframe: any) {
  if (timeframe?.requested === "yesterday") return "yesterday";
  if (timeframe?.requested === "custom") return "selected";
  return "same-day";
}

function buildCorridorRouteNarrative(label: string, dayStory: any, summary: any, timeZone: string, timeframe: any = {}) {
  const route = cleanRoutePlaces(dayStory.route_progression || []);
  const first = dayStory.first_seen || null;
  const stopSummary = dayStory.stop_summary || {};
  const sentences: string[] = [];
  const firstLocation = formatNarrativeLocation(first?.location);

  if (isNewDayRolloverWindow(timeframe, dayStory, summary)) {
    return "This is an overnight rollover window. Today's route has not matured yet, so the first post-midnight reads should not be treated as a complete corridor story.";
  }

  if (first?.recorded_at) {
    sentences.push(
      `${label} first appeared${firstLocation ? ` ${firstLocation}` : " in the same-day track"} at ${formatTimelineClock(
        first.recorded_at,
        timeZone
      )}.`
    );
  }

  if (route.length >= 2) {
    sentences.push(`The observed corridor runs ${formatCorridorRoute(route)}.`);
  } else if (route.length === 1) {
    sentences.push(`The available points are concentrated around ${route[0]}.`);
  } else if (Number(summary.movement_blocks || 0) > 0) {
    sentences.push("Movement and stop periods are visible, but the key places are not resolved into clean town labels yet.");
  } else {
    sentences.push("The available telemetry does not yet show a clear route progression for today.");
  }

  const longestStop = stopSummary.longest_stop || null;
  const longestLocation = formatNarrativeLocation(longestStop?.location);
  if (longestStop?.duration_minutes) {
    sentences.push(
      `The longest observed stop was about ${formatDurationWords(longestStop.duration_minutes)}${
        longestLocation ? ` ${longestLocation}` : ""
      }.`
    );
  }

  return sentences.join(" ");
}

function formatNarrativeMovementState(speed: number | null) {
  if (speed === null) return "at its latest known position";
  if (speed > 5) return "moving";
  return "stopped";
}

function formatNarrativeLocation(location: any) {
  if (!location) return null;
  return formatOperationalLocation({ location_resolution: location }, { gpsFallback: null });
}

function cleanRoutePlaces(route: any[]) {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const item of route || []) {
    const label = cleanRoutePlaceLabel(item);
    const key = routePlaceKey(label);
    const previous = cleaned[cleaned.length - 1];
    if (!label || !key || key === routePlaceKey(previous) || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(label);
  }

  return cleaned;
}

function cleanRoutePlaceLabel(value: any) {
  return String(value || "")
    .trim()
    .replace(/^(near|inside|at)\s+/i, "")
    .split(",")[0]
    .replace(/\babout\s+\d+(?:\.\d+)?\s*km\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function routePlaceKey(value: any) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function formatCorridorRoute(route: string[]) {
  const places = cleanRoutePlaces(route);
  if (places.length <= 1) return places[0] ? `around ${places[0]}` : "through the available corridor";
  if (places.length === 2) return `from ${places[0]} toward ${places[1]}`;
  const first = places[0];
  const last = places[places.length - 1];
  const middle = places.slice(1, -1).slice(0, 6);
  return `from ${first} through ${formatAndList(middle)} toward ${last}`;
}

function formatAndList(items: string[]) {
  const values = (items || []).filter(Boolean);
  if (values.length <= 1) return values[0] || "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function buildNarrativeIdleAlerts(idleEvents: any[], continuity: any, summary: any) {
  if (!idleEvents.length) {
    return "No same-day idle or excessive-idle alerts are present in the event trail for this truck.";
  }

  const broken = idleEvents.filter(
    (event) => event.classification === "historical_broken_by_movement"
  ).length;
  const current = idleEvents.filter(
    (event) => event.classification === "possibly_current_same_location"
  ).length;

  if (broken > 0 && current > 0) {
    return "Do not treat the earlier idle alerts as one continuous all-day delay. The timeline shows clear movement between stop periods. The latest idle marker may relate to the current stop.";
  }

  if (broken > 0) {
    return "Do not treat the earlier idle alerts as one continuous all-day delay. The timeline shows clear movement between stop periods, so those alerts are historical markers rather than one unbroken delay.";
  }

  if (continuity.continuous_all_day_idle_supported || current > 0) {
    return "The latest idle marker may relate to the current stop because no later movement appears after that marker.";
  }

  if (summary.data_density === "low") {
    return "The idle alert trail is too thin to connect the markers into one continuous delay.";
  }

  return "Idle alerts exist, but there is not enough continuity evidence to merge them into one continuous delay.";
}

function formatHardwareNote(latest: any) {
  const speed = finiteNumberOrNull(latest?.speed);
  const ignitionState = normalizeIgnitionState(
    latest?.ignition_status ??
      latest?.engine_status ??
      latest?.ignition ??
      latest?.engine_on ??
      latest?.ignition_on
  );

  if (ignitionState === "on" && speed !== null && speed <= 5) {
    return "Ignition data shows the engine is on while the truck is stationary, so this is an active idle-risk condition.";
  }
  if (ignitionState === "off" && speed !== null && speed <= 5) {
    return "Ignition data shows the truck is stopped or parked and the engine appears off.";
  }
  if (ignitionState === "on") {
    return "Ignition data shows the engine is on.";
  }
  if (ignitionState === "off") {
    return "Ignition data shows the engine appears off.";
  }
  if (speed !== null && speed <= 5) {
    return "Ignition data is not available in this feed, so the truck is stopped but active fuel-burn idling is not confirmed.";
  }
  return "Ignition data is not available in this feed, so movement can be described from speed and location but engine state is not confirmed.";
}

function normalizeIgnitionState(value: any) {
  if (value === true || value === 1) return "on";
  if (value === false || value === 0) return "off";
  const text = String(value || "").trim().toLowerCase();
  if (!text) return null;
  if (["on", "engine_on", "ignition_on", "running", "true", "yes"].includes(text)) return "on";
  if (["off", "engine_off", "ignition_off", "stopped", "false", "no"].includes(text)) return "off";
  return null;
}

function buildDetailedTruckTimelineAnswer({
  label,
  timeZone,
  dayStory,
  summary,
  latest,
  blocks,
  idleEvents,
  continuity,
  timeframe = {},
}: any) {
  const parts: string[] = [];
  parts.push(`Detailed timeline evidence for ${label}. ${formatTimelineTimeNote(timeZone)}`);
  parts.push(buildTruckJourneyNarrative(label, dayStory, summary, continuity, timeZone));

  if (dayStory.coverage_is_partial && dayStory.coverage_start_at && dayStory.coverage_end_at) {
    parts.push(
      `This ${formatTimeframeLabel(timeframe)} operating window runs from ${formatTimelineClock(
        dayStory.coverage_start_at,
        timeZone
      )} to ${formatTimelineClock(dayStory.coverage_end_at, timeZone)}. This expands that available window.`
    );
  }

  if (latest?.timestamp_warnings && hasAmbiguousTimestampWarning(latest.timestamp_warnings)) {
    parts.push("Provider time appears local/ambiguous, so treat this timeline as approximate.");
  }

  parts.push("");
  parts.push("Structured timeline evidence");
  if (blocks.length) {
    parts.push(...blocks.map((block: any) => formatTimelineBlock(block, timeZone)));
    if (Number(summary.omitted_blocks || 0) > 0) {
      parts.push(
        `- ${Number(summary.omitted_blocks).toLocaleString()} shorter or less relevant block(s) were summarized out of this view.`
      );
    }
  } else {
    parts.push("- No movement/stationary blocks were found in this operating window.");
  }

  parts.push("");
  parts.push("Idle marker evidence");
  if (idleEvents.length) {
    if (countUnresolvedGpsMarkers(idleEvents) > 0) {
      parts.push("- Some marker locations are unresolved GPS points.");
    }
    parts.push(...idleEvents.map((event: any) => formatIdleComparison(event, timeZone)));
  } else {
    parts.push("- No idle or excessive-idle events were found for this truck in this operating window.");
  }

  parts.push("");
  parts.push("Continuity read");
  parts.push(`- ${formatContinuityRead(continuity, summary)}`);

  return parts.join("\n");
}

function buildExecutiveVerdict(label: string, dayStory: any, summary: any, continuity: any) {
  const route = Array.isArray(dayStory.route_progression)
    ? dayStory.route_progression.filter(Boolean)
    : [];
  const latest = dayStory.latest_seen || null;
  const latestLocation = formatOperationalLocation({ location_resolution: latest?.location });
  const movingBlocks = Number(summary.movement_blocks || 0);
  const stopSummary = dayStory.stop_summary || {};
  const hasContinuousIdle = Boolean(continuity.continuous_all_day_idle_supported);
  const condition = hasContinuousIdle
    ? "a current stationary/idle condition"
    : movingBlocks > 0
      ? "active transit with separate stops"
      : "a mostly stationary or limited telemetry window";
  const corridor =
    route.length >= 2
      ? ` through ${formatRouteProgression(route)}`
      : route.length === 1
        ? ` around ${route[0]}`
        : "";
  const stopNote =
    Number(stopSummary.major_stop_count || 0) > 0
      ? ` with ${Number(stopSummary.major_stop_count).toLocaleString()} major stop(s)`
      : "";
  const current = latestLocation ? ` It is now ${latestLocation}.` : "";

  return `${label} looks like ${condition}${corridor}${stopNote}, not a raw GPS trace.${current}`;
}

function buildExecutiveCurrentLine(label: string, dayStory: any, latest: any, timeZone: string) {
  const latestSeen = dayStory.latest_seen || latest || null;
  const location = formatOperationalLocation({
    location_resolution: latestSeen?.location || latest?.location_resolution,
  });
  const speed = finiteNumberOrNull(latestSeen?.speed ?? latest?.speed);
  const state =
    speed === null
      ? "current motion state is unclear"
      : speed > 5
        ? "moving"
        : "stationary/stopped";
  const time = formatTimelineClock(latestSeen?.recorded_at || latest?.recorded_at, timeZone);
  return `${label} latest read: ${location || "location unresolved"} at ${time}; ${state}${speed === null ? "" : `, speed ${formatNumber(speed)}`}.`;
}

function formatCurrentStatusBlock(latest: any, timeZone: string) {
  if (!latest) {
    return [
      "- Location: no latest telemetry snapshot available.",
      "- Time: unknown.",
      "- Movement: unknown.",
      "- Engine/ignition: not available in this telemetry.",
    ];
  }

  const speed = finiteNumberOrNull(latest.speed);
  const location = formatOperationalLocation(latest);
  const state =
    speed === null
      ? "unknown"
      : speed > 5
        ? "moving"
        : "stationary/stopped";
  const lines = [
    `- Location: ${location || "unresolved GPS point"}.`,
    `- Latest timestamp: ${formatTimelineClock(latest.recorded_at, timeZone)}.`,
    `- Movement: ${state}${speed === null ? "" : `, speed ${formatNumber(speed)}`}.`,
    "- Engine/ignition: not available in this telemetry.",
  ];

  if (hasAmbiguousTimestampWarning(latest.timestamp_warnings)) {
    lines.push("- Time quality: provider timestamps appear local/ambiguous; treat the timing as approximate.");
  }

  return lines;
}

function formatExecutiveMetrics(stopSummary: any, summary: any, timeZone: string) {
  const longest = stopSummary.longest_stop || null;
  const longestLocation = formatOperationalLocation({
    location_resolution: longest?.location,
  });
  const stopCounts = `${Number(stopSummary.major_stop_count || 0).toLocaleString()} major, ${Number(
    stopSummary.medium_stop_count || 0
  ).toLocaleString()} medium, ${Number(stopSummary.short_stop_count || 0).toLocaleString()} short`;
  const lines = [
    `- Moving time observed: about ${formatDurationWords(stopSummary.total_moving_minutes)}.`,
    `- Stopped/stationary time observed: about ${formatDurationWords(stopSummary.total_stopped_minutes)}.`,
    `- Stop mix: ${stopCounts}.`,
  ];

  if (longest?.duration_minutes) {
    lines.push(
      `- Longest stop: about ${formatDurationWords(longest.duration_minutes)}${
        longestLocation ? ` ${longestLocation}` : ""
      } (${formatTimelineClock(longest.start_at, timeZone)} to ${formatTimelineClock(
        longest.end_at,
        timeZone
      )}).`
    );
  } else {
    lines.push("- Longest stop: not enough stationary history to classify.");
  }

  lines.push(
    `- Telemetry coverage: ${Number(summary.points_found || 0).toLocaleString()} points across ${Number(
      summary.blocks_found || 0
    ).toLocaleString()} movement/stationary block(s).`
  );

  return lines.slice(0, 5);
}

function formatExecutiveIdleVerdict(idleEvents: any[], continuity: any, summary: any) {
  if (!idleEvents.length) {
    return "No same-day idle or excessive-idle markers are present in the event trail for this truck.";
  }

  const currentMarkers = idleEvents.filter(
    (event) => event.classification === "possibly_current_same_location"
  ).length;

  if (continuity.historical_idle_markers_broken_by_movement) {
    const suffix =
      currentMarkers > 0
        ? " The latest marker may relate to the current stop, but engine-on idling is not confirmed without ignition data."
        : " None of this proves engine-on idling without ignition data.";
    return `The idle alerts should be treated as separate historical markers because later movement was recorded after at least one marker.${suffix}`;
  }

  if (continuity.continuous_all_day_idle_supported) {
    return "The latest stationary state lines up with an idle marker and no later movement is visible after that marker. This supports a current stop/idle interpretation, but engine-on idling is still unconfirmed without ignition data.";
  }

  if (summary.data_density === "low") {
    return "There is too little same-day history to prove whether the idle markers are continuous or separate.";
  }

  return "Idle markers exist, but there is not enough continuity evidence to merge them into one continuous delay.";
}

function formatContinuityRead(continuity: any, summary: any) {
  if (continuity.continuous_all_day_idle_supported) {
    return "The latest stationary state, same-place idle marker, and lack of later movement support a current continuous stop/idle interpretation. Engine-on idling remains unconfirmed without ignition data.";
  }
  if (continuity.historical_idle_markers_broken_by_movement) {
    return "The idle markers are historical or separate events because later telemetry includes moving points after at least one marker.";
  }
  if (summary.data_density === "low") {
    return "The available history is too thin to prove a continuous unbroken delay.";
  }
  return "Continuous all-day idle is not proven from the available movement and event evidence.";
}

function countUnresolvedGpsMarkers(idleEvents: any[]) {
  return idleEvents.filter(
    (event) => event.location_resolution?.confidence_source === "coordinates_only"
  ).length;
}

function buildTruckJourneyNarrative(
  label: string,
  dayStory: any,
  summary: any,
  continuity: any,
  timeZone: string
) {
  const route = Array.isArray(dayStory.route_progression)
    ? dayStory.route_progression.filter(Boolean)
    : [];
  const first = dayStory.first_seen || null;
  const latest = dayStory.latest_seen || null;
  const firstLocation = formatOperationalLocation({ location_resolution: first?.location });
  const latestLocation = formatOperationalLocation({ location_resolution: latest?.location });
  const latestSpeed = finiteNumberOrNull(latest?.speed);
  const stopSummary = dayStory.stop_summary || {};
  const meaningfulStops = Number(stopSummary.meaningful_stop_count || 0);
  const movingBlocks = Number(summary.movement_blocks || 0);
  const stationaryBlocks = Number(summary.stationary_blocks || 0);
  const opening =
    continuity.historical_idle_markers_broken_by_movement || movingBlocks > 0
      ? `${label}'s day looks like a route movement with stops, not one continuous idle event.`
      : `${label}'s available day history is mostly stationary or limited, so this is a partial operational read.`;
  const sentences = [opening];

  if (first?.recorded_at) {
    sentences.push(
      `It first appeared${firstLocation ? ` ${firstLocation}` : ""} at ${formatTimelineClock(
        first.recorded_at,
        timeZone
      )}.`
    );
  }

  if (route.length >= 2) {
    sentences.push(`Route milestones: ${formatRouteProgression(route)}.`);
  } else if (route.length === 1) {
    sentences.push(`The available points are concentrated around ${route[0]}.`);
  }

  const longestStop = stopSummary.longest_stop || null;
  const longestStopLocation = formatOperationalLocation({
    location_resolution: longestStop?.location,
  });
  if (longestStop?.duration_minutes) {
    sentences.push(
      `The longest stop was about ${formatDurationWords(
        longestStop.duration_minutes
      )}${longestStopLocation ? ` ${longestStopLocation}` : ""}.`
    );
  } else if (meaningfulStops > 0) {
    sentences.push(`${meaningfulStops} meaningful stop(s) appear in the available window.`);
  } else if (stationaryBlocks > 0) {
    sentences.push("Stationary points appear, but none are long enough to classify as meaningful stops.");
  }

  if (latest?.recorded_at) {
    const status =
      latestSpeed === null
        ? "motion state unclear"
        : latestSpeed > 5
          ? "moving"
          : "currently stopped";
    sentences.push(
      `Latest telemetry places it${latestLocation ? ` ${latestLocation}` : ""} at ${formatTimelineClock(
        latest.recorded_at,
        timeZone
      )} with ${latestSpeed === null ? "speed unknown" : `speed ${formatNumber(latestSpeed)}`}, so it is ${status}.`
    );
  }

  if (summary.truncated) {
    sentences.push(
      `The row cap was reached at ${Number(summary.max_rows || 0).toLocaleString()} points, so the middle of the day may be sampled.`
    );
  }

  return sentences.join(" ");
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
      return "is stale; current idling is not confirmed.";
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

  parts.push("Findings");
  parts.push(...formatInvestigationFindings(caseFile, focus, label));
  parts.push("");

  parts.push("What this may mean");
  parts.push(...formatInvestigationMeanings(caseFile, focus));
  parts.push("");

  parts.push("Operational boundaries");
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
      `No matching enabled vehicle was found for ${vehicleMatch.input}. It may be unreviewed or not imported yet.`
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
  parts.push("Siphoning is not confirmed yet. The useful trail:");
  parts.push("");

  if (truck) {
    const location = formatOperationalLocation(truck);
    const status = truck.status ? `${matchedLabel} is currently ${truck.status}` : `${matchedLabel} is present in the enabled fleet`;
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
    parts.push("For now, stops, locations, driver assignment, journeys, and manual fuel entries carry more weight than fuel telemetry.");
    parts.push(formatFleetFuelAvailability(fleetFuelAvailability));
  }

  if (risk) {
    const riskNarrative = formatFuelRiskNarrative(risk);
    if (riskNarrative) parts.push(riskNarrative);
  }

  parts.push("");
  if (fuelLogs.length) {
    parts.push(`${fuelLogs.length} recent manual fuel entr${fuelLogs.length === 1 ? "y" : "ies"} found for this vehicle:`);
    parts.push(...fuelLogs.slice(0, 4).map(formatFuelLogLine));
  } else {
    parts.push("No recent manual fuel entries appear for this vehicle.");
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
        `Recent idle/stop activity also appears: ${idleEvents
          .slice(0, 3)
          .map(formatEventBrief)
          .join("; ")}.`
      );
    }
  } else {
    parts.push("No recent fuel-drop or excessive-idle events appear for this vehicle.");
  }

  if (journeys.length) {
    parts.push("Recent journey context:");
    parts.push(...journeys.slice(0, 3).map(formatJourneyBrief));
  } else {
    parts.push("No recent journey record appears for this vehicle.");
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
  return `${matchedLabel} is the matched vehicle.`;
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
    return "Fuel siphoning is not confirmed from one question, so the wider operational trail around this vehicle matters.";
  }
  if (focus?.stops_focus) {
    return "The recent stop/idle trail matters more than a single location snapshot here.";
  }
  if (focus?.profitability_focus) {
    return "Operating context and the permitted finance trail were checked together.";
  }
  if (focus?.repair_focus) {
    return "Recent repair and spare history were checked alongside operations data.";
  }
  return "This is treated as a small operations investigation, not a single data lookup.";
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
      `- ${label} is enabled for intelligence${location ? ` and is ${location}` : ""}; ${lastSeen}.`
    );
    if (asset.assigned_driver?.driver_name) {
      lines.push(`- Assigned driver: ${asset.assigned_driver.driver_name}.`);
    }
  }

  if (telemetry.telemetry_points > 0) {
    lines.push(
      `- The last ${telemetry.window_days || 7} days show ${telemetry.telemetry_points} telemetry point(s), with ${telemetry.stationary_points || 0} stationary/near-idle point(s).`
    );
  } else {
    lines.push("- No recent telemetry points appear for this vehicle.");
  }

  const fuelTelemetry = fuel.telemetry || {};
  if (focus?.fuel_focus || fuelTelemetry.fuel_readings > 0 || fuel.manual_entries?.length) {
    lines.push(`- ${formatFuelTelemetryExplanation(fuelTelemetry).text}`);
    if (fuel.manual_entries?.length) {
      lines.push(
        `- Manual fuel entries found: ${fuel.manual_entries.length}. Latest: ${formatFuelLogLine(fuel.manual_entries[0]).replace(/^- /, "")}`
      );
    } else {
      lines.push("- No recent manual fuel entries appear for this vehicle.");
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
    lines.push("- No recent journey record appears for this vehicle.");
  }

  if (focus?.repair_focus || spares.recent_events?.length) {
    if (spares.recent_events?.length) {
      lines.push(`- Recent repair/spares events found: ${spares.recent_events.length}. Latest: ${formatSpareEventLine(spares.recent_events[0]).replace(/^- /, "")}`);
    } else {
      lines.push("- No recent repair/spares history appears for this vehicle.");
    }
  }

  if (financials.visible) {
    lines.push(
      `- Finance trail: ${financials.journey_count || 0} journey(s), ${formatMoney(financials.revenue_kes)} revenue, ${formatMoney(financials.fuel_cost_kes)} fuel, ${formatMoney(financials.expense_cost_kes)} expenses, estimated profit ${formatMoney(financials.estimated_profit_kes)}.`
    );
  } else if (focus?.profitability_focus) {
    lines.push("- Financial values are hidden for this role.");
  }

  return lines.length ? lines : ["- Limited recent evidence appears for this vehicle."];
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
      lines.push("- The sampled finance trail does not establish this vehicle as too expensive by itself, but it gives a baseline for comparison.");
    }
  }

  if (focus?.repair_focus) {
    if (spares.recent_events?.length) {
      lines.push("- Recent repair/spares events can explain downtime or repeat issues, but lifespan needs install/removal or replacement history.");
    } else {
      lines.push("- Repair history is too thin to say a repair failed.");
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
    lines.push("- Siphoning stays unconfirmed without usable fuel readings, tank dips, receipts, or clear fuel-drop events.");
  }
  if (focus?.repair_focus) {
    lines.push("- Repair lifespan or mechanic/vendor quality is not established without enough install/removal/replacement history.");
  }
  if (focus?.profitability_focus && !caseFile.financial_summary?.visible) {
    lines.push("- Financial values are hidden for this role.");
  }

  return lines.length ? lines : ["- Root cause is not established from the current operational trail alone."];
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
        "The provider is sending fuel fields, but they are not useful for this truck yet. The recent values are all 0/unknown, so they are not treated as real tank readings.",
    };
  }

  if (telemetry.telemetry_points > 0) {
    return {
      usable: false,
      text:
        "The truck has recent telemetry, but no usable fuel-level readings appear in that feed.",
    };
  }

  return {
    usable: false,
    text: "No recent telemetry fuel-level data appears for this truck.",
  };
}

function formatFleetFuelAvailability(availability: any) {
  if (availability?.other_usable_fuel_data_available) {
    return "Some other vehicles do appear to have usable fuel/fuel-risk data. I can list them if you want.";
  }
  return "No usable fuel-level telemetry currently appears across the enabled fleet.";
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

  return `The existing fuel-risk check is ${score}${level}. Fuel-drop evidence is not strong enough to call this confirmed.`;
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

function formatStopPattern(stopSummary: any, timeZone: string) {
  const lines = [
    `- Major stops: ${Number(stopSummary.major_stop_count || 0).toLocaleString()}`,
    `- Medium stops: ${Number(stopSummary.medium_stop_count || 0).toLocaleString()}`,
    `- Short stops: ${Number(stopSummary.short_stop_count || 0).toLocaleString()}`,
  ];
  const longest = stopSummary.longest_stop || null;
  const longestLocation = formatOperationalLocation({
    location_resolution: longest?.location,
  });

  if (longest?.duration_minutes) {
    lines.push(
      `- Longest stop: about ${formatDurationWords(longest.duration_minutes)}${
        longestLocation ? ` ${longestLocation}` : ""
      } (${formatTimelineClock(longest.start_at, timeZone)} to ${formatTimelineClock(
        longest.end_at,
        timeZone
      )})`
    );
  } else {
    lines.push("- Longest stop: not enough stationary history to classify.");
  }

  if (stopSummary.average_non_major_stop_minutes !== null && stopSummary.average_non_major_stop_minutes !== undefined) {
    lines.push(
      `- Average short/medium stop: about ${formatDurationWords(
        stopSummary.average_non_major_stop_minutes
      )}`
    );
  } else if (stopSummary.average_meaningful_stop_minutes !== null && stopSummary.average_meaningful_stop_minutes !== undefined) {
    lines.push(
      `- Average meaningful stop: about ${formatDurationWords(
        stopSummary.average_meaningful_stop_minutes
      )}`
    );
  }

  if (stopSummary.total_moving_minutes !== null && stopSummary.total_moving_minutes !== undefined) {
    lines.push(`- Total moving time observed: about ${formatDurationWords(stopSummary.total_moving_minutes)}`);
  }
  if (stopSummary.total_stopped_minutes !== null && stopSummary.total_stopped_minutes !== undefined) {
    lines.push(`- Total stopped/stationary time observed: about ${formatDurationWords(stopSummary.total_stopped_minutes)}`);
  }

  return lines;
}

function formatTimelineBlock(block: any, timeZone: string) {
  const state =
    block.state === "moving"
      ? "moving"
      : block.state === "stationary"
        ? "stopped/stationary"
        : "unknown motion";
  const speedRange =
    block.max_speed === null && block.average_speed === null
      ? "speed unknown"
      : block.state === "moving"
        ? `avg ${formatNumber(block.average_speed)} / max ${formatNumber(block.max_speed)}`
        : `max speed ${formatNumber(block.max_speed)}`;
  const startLocation = formatOperationalLocation(
    {
      location_resolution: block.start_location,
    },
    { gpsFallback: null }
  );
  const endLocation = formatOperationalLocation(
    {
      location_resolution: block.end_location,
    },
    { gpsFallback: null }
  );
  const location =
    block.state === "moving" && startLocation && endLocation && startLocation !== endLocation
      ? `from ${stripLeadingPlacePrefix(startLocation)} to ${stripLeadingPlacePrefix(endLocation)}`
      : endLocation || startLocation
        ? `${block.state === "moving" ? "around" : "at"} ${stripLeadingPlacePrefix(
            endLocation || startLocation
          )}`
        : null;
  const duration =
    block.duration_minutes === null || block.duration_minutes === undefined
      ? ""
      : `; ${formatNumber(block.duration_minutes)} min`;

  return `- ${formatTimelineClock(block.start_at, timeZone)} to ${formatTimelineClock(
    block.end_at,
    timeZone
  )}: ${state}${location ? ` ${location}` : ""}${duration}; ${speedRange}; ${
    block.sample_count || 0
  } point(s).`;
}

function formatRouteProgression(route: string[]) {
  const cleaned = route
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item, index, list) => index === 0 || item !== list[index - 1]);

  if (cleaned.length <= 1) return cleaned[0] || "the available corridor";
  if (cleaned.length <= 8) return formatAndList(cleaned);
  return `${formatAndList(cleaned.slice(0, 5))}, then toward ${formatAndList(cleaned.slice(-2))}`;
}

function formatDurationWords(value: any) {
  const minutes = finiteNumberOrNull(value);
  if (minutes === null) return "unknown duration";
  if (minutes < 60) return `${formatNumber(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  if (remainder === 0) return `${hours} hr${hours === 1 ? "" : "s"}`;
  return `${hours} hr ${remainder} min`;
}

function formatIdleComparison(event: any, timeZone: string) {
  const eventTime = event.started_at || event.created_at;
  const eventMs = new Date(eventTime || 0).getTime();
  const movementMs = new Date(event.movement_after_event_at || 0).getTime();
  const hasValidMovementAfter =
    Number.isFinite(eventMs) && Number.isFinite(movementMs) && movementMs > eventMs;
  const base = `${formatTimelineClock(eventTime, timeZone)} - ${formatSpareEventType(event.event_type)}`;
  const location = formatOperationalLocation(event, { gpsFallback: null });
  const locationText = location
    ? `, ${stripLeadingPlacePrefix(location)}`
    : ", location unresolved";
  const duration =
    event.duration_minutes === null || event.duration_minutes === undefined
      ? ""
      : `, duration ${formatNumber(event.duration_minutes)} min`;

  if (event.classification === "historical_broken_by_movement" && hasValidMovementAfter) {
    const movementAt = event.movement_after_event_at
      ? ` Movement later appears at ${formatTimelineClock(event.movement_after_event_at, timeZone)}.`
      : "";
    return `- ${base}${duration}${locationText}: historical marker, broken by later movement.${movementAt}`;
  }

  if (event.classification === "historical_broken_by_movement") {
    return `- ${base}${duration}${locationText}: no later movement found after this marker in the selected window.`;
  }

  if (event.classification === "possibly_current_same_location") {
    const distance =
      event.location_distance_km === null
        ? ""
        : ` Latest location is about ${formatNumber(event.location_distance_km)} km from the event marker.`;
    return `- ${base}${duration}${locationText}: possibly connected to the current stop.${distance}`;
  }

  if (event.classification === "no_movement_after_event_but_not_confirmed_current") {
    return `- ${base}${duration}${locationText}: no later movement found after this marker in the selected window.`;
  }

  return `- ${base}${duration}${locationText}: continuity not proven from the available movement blocks.`;
}

function formatTimelineClock(value: any, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return new Intl.DateTimeFormat("en-KE", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatTimelineTimeNote(timeZone: string) {
  const label = timeZone === DEFAULT_OPERATIONAL_TIME_ZONE ? "EAT" : timeZone;
  return `Times shown in ${label}.`;
}

function stripLeadingPlacePrefix(value: any) {
  return String(value || "").replace(/^(near|inside|at)\s+/i, "");
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
