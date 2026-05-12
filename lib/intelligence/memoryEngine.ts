// lib/intelligence/memoryEngine.ts
import { supabaseAdmin } from "../supabaseAdmin";
import { createHash } from "crypto";

export type MemoryType =
  | "fuel_risk"
  | "idle_pattern"
  | "offline_truck"
  | "driver_behavior"
  | "journey_delay"
  | "maintenance_needed"
  | "client_issue"
  | "general_insight";

export type Severity = "info" | "warning" | "critical";

export interface MemoryInput {
  companyId: string;
  memoryType: MemoryType;
  severity: Severity;
  title: string;
  summary: string;
  entityType?: "truck" | "driver" | "client" | "journey";
  entityId?: string;
  source?: string;
  confidence?: number;
  evidence?: any;
  recommendation?: string;
}

function generateMemoryHash(input: MemoryInput): string {
  const base = `${input.companyId}|${input.memoryType}|${input.entityType || ""}|${input.entityId || ""}|${input.title}`;
  return createHash("sha256").update(base).digest("hex");
}

export async function storeMemory(input: MemoryInput) {
  const memoryHash = generateMemoryHash(input);
  const {
    companyId,
    memoryType,
    severity,
    title,
    summary,
    entityType,
    entityId,
    source = "copilot",
    confidence = 0.7,
    evidence,
    recommendation,
  } = input;

  // Try to find existing active memory with same hash
  const { data: existing } = await supabaseAdmin
    .from("nava_eye_memory")
    .select("id")
    .eq("company_id", companyId)
    .eq("memory_hash", memoryHash)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    // Update last_seen_at and optionally escalate severity/title/summary
    const { error } = await supabaseAdmin
      .from("nava_eye_memory")
      .update({
        last_seen_at: new Date().toISOString(),
        severity,
        title,
        summary,
        confidence,
        evidence,
        recommendation,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) throw new Error(`Failed to update memory: ${error.message}`);
    return { id: existing.id, updated: true };
  } else {
    // Insert new memory
    const { data, error } = await supabaseAdmin
      .from("nava_eye_memory")
      .insert({
        company_id: companyId,
        memory_type: memoryType,
        severity,
        title,
        summary,
        entity_type: entityType || null,
        entity_id: entityId || null,
        source,
        confidence,
        evidence: evidence || null,
        recommendation: recommendation || null,
        memory_hash: memoryHash,
        status: "active",
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw new Error(`Failed to insert memory: ${error.message}`);
    return { id: data.id, updated: false };
  }
}

export async function resolveMemory(memoryId: string) {
  const { error } = await supabaseAdmin
    .from("nava_eye_memory")
    .update({ status: "resolved", updated_at: new Date().toISOString() })
    .eq("id", memoryId);
  if (error) throw new Error(`Failed to resolve memory: ${error.message}`);
  return true;
}

export async function getActiveMemories(
  companyId: string,
  filters?: { memoryType?: MemoryType; entityType?: string; entityId?: string; limit?: number }
) {
  let query = supabaseAdmin
    .from("nava_eye_memory")
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("last_seen_at", { ascending: false });

  if (filters?.memoryType) query = query.eq("memory_type", filters.memoryType);
  if (filters?.entityType) query = query.eq("entity_type", filters.entityType);
  if (filters?.entityId) query = query.eq("entity_id", filters.entityId);
  if (filters?.limit) query = query.limit(filters.limit);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to retrieve memories: ${error.message}`);
  return data || [];
}

export async function archiveOldMemories(companyId: string, olderThanDays: number = 90) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  const { error } = await supabaseAdmin
    .from("nava_eye_memory")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("status", "resolved")
    .lt("updated_at", cutoff.toISOString());
  if (error) throw new Error(`Failed to archive memories: ${error.message}`);
  return true;
}

export async function getMemoryContext(companyId: string): Promise<string> {
  const memories = await getActiveMemories(companyId, { limit: 10 });
  if (memories.length === 0) return "No active operational memories.";
  const bySeverity = memories.reduce(
    (acc, m) => {
      acc[m.severity] = (acc[m.severity] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const summary = `Active memories: ${memories.length} (critical: ${bySeverity.critical || 0}, warning: ${bySeverity.warning || 0}, info: ${bySeverity.info || 0}). `;
  const topMemories = memories.slice(0, 3).map((m) => `- ${m.title}: ${m.summary}`).join("\n");
  return summary + "\n" + topMemories;
}
