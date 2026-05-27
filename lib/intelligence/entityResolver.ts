import { supabaseAdmin } from "../supabaseAdmin";
import { readStoredVehicleIdentityContext } from "../providers/vehicleIdentity";

export function normalizeVehicleKey(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function getVehicleMatchKeys(asset: any) {
  const trailerKey = getVehicleTrailerMatchKey(asset);
  return [
    normalizeVehicleKey(asset?.truck_id),
    normalizeVehicleKey(asset?.registration),
    trailerKey,
  ].filter((key) => key.length >= 4);
}

function getVehiclePrimaryMatchKeys(asset: any) {
  return [
    normalizeVehicleKey(asset?.truck_id),
    normalizeVehicleKey(asset?.registration),
  ].filter((key) => key.length >= 4);
}

function getVehicleTrailerMatchKey(asset: any) {
  const trailer = readStoredVehicleIdentityContext(asset).attached_trailer_plate;
  return normalizeVehicleKey(trailer);
}

function extractVehicleInputs(question: string) {
  const inputs = new Map<string, string>();
  const platePattern = /[A-Z]{2,4}[\s\-/.]*\d{2,4}[A-Z]?/gi;
  const matches = question.match(platePattern) || [];

  for (const match of matches) {
    const key = normalizeVehicleKey(match);
    if (key.length >= 4) inputs.set(key, match.trim().toUpperCase());
  }

  const tokens = question
    .split(/[^A-Za-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const key = normalizeVehicleKey(token);
    if (
      key.length >= 4 &&
      key.length <= 12 &&
      /[A-Z]/.test(key) &&
      /\d/.test(key)
    ) {
      inputs.set(key, token.toUpperCase());
    }
  }

  return Array.from(inputs.entries()).map(([key, input]) => ({ key, input }));
}

export async function matchVehicleInFleet(question: string, companyId: string) {
  const inputs = extractVehicleInputs(question);

  const baseMatch: any = {
    input: inputs[0]?.input || null,
    matched: false,
    confidence: "none",
    match_type: "none",
    matched_truck_id: null,
    matched_registration: null,
    enabled_for_intelligence: false,
    candidates: [],
  };

  if (inputs.length === 0) return baseMatch;

  const data = await loadFleetAssetsForVehicleMatching(companyId);

  const candidates = new Map<string, any>();
  for (const input of inputs) {
    for (const asset of data || []) {
      const best = bestVehicleMatchForAsset(input.key, asset);
      if (!best) continue;

      const candidateKey = asset.id || `${asset.truck_id}:${asset.registration}`;
      const existing = candidates.get(candidateKey);
      if (!existing || best.rank > existing.rank) {
        const identityContext = readStoredVehicleIdentityContext(asset);
        candidates.set(candidateKey, {
          id: asset.id,
          truck_id: asset.truck_id || null,
          registration: asset.registration || null,
          confidence: best.confidence,
          match_type: best.match_type,
          attached_trailer_plate: identityContext.attached_trailer_plate,
          provider_label: identityContext.provider_label,
          trailer_context: Boolean(best.trailer_context),
          enabled_for_intelligence: Boolean(asset.intelligence_enabled),
          input: input.input,
          rank: best.rank,
        });
      }
    }
  }

  const sortedCandidates = Array.from(candidates.values())
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 5);

  if (sortedCandidates.length === 0) return baseMatch;

  const topRank = sortedCandidates[0].rank;
  const topCandidates = sortedCandidates.filter(
    (candidate) => candidate.rank === topRank
  );
  const safeCandidates = sortedCandidates.map(sanitizeVehicleCandidate);

  if (topCandidates.length > 1) {
    return {
      ...baseMatch,
      input: topCandidates[0].input || baseMatch.input,
      confidence: "low",
      match_type: "multiple_candidates",
      candidates: safeCandidates,
    };
  }

  const winner = topCandidates[0];
  return {
    input: winner.input || baseMatch.input,
    matched: true,
    confidence: winner.confidence,
    match_type: winner.match_type,
    matched_truck_id: winner.truck_id,
    matched_registration: winner.registration,
    attached_trailer_plate: winner.attached_trailer_plate || null,
    provider_label: winner.provider_label || null,
    trailer_context: Boolean(winner.trailer_context),
    enabled_for_intelligence: winner.enabled_for_intelligence,
    candidates: safeCandidates,
  };
}

async function loadFleetAssetsForVehicleMatching(companyId: string) {
  let { data, error } = await supabaseAdmin
    .from("fleet_assets")
    .select("id, truck_id, registration, intelligence_enabled, telemetry_capabilities")
    .eq("company_id", companyId)
    .eq("status", "active")
    .limit(1000);

  if (isMissingOptionalTelemetryColumnError(error)) {
    const retry = await supabaseAdmin
      .from("fleet_assets")
      .select("id, truck_id, registration, intelligence_enabled")
      .eq("company_id", companyId)
      .eq("status", "active")
      .limit(1000);
    data = retry.data as any;
    error = retry.error;
  }

  if (error) throw error;
  return data || [];
}

function bestVehicleMatchForAsset(inputKey: string, asset: any) {
  let best: any = null;

  for (const key of getVehiclePrimaryMatchKeys(asset)) {
    const match = scoreVehicleKey(inputKey, key);
    if (match && (!best || match.rank > best.rank)) {
      best = match;
    }
  }

  const trailerKey = getVehicleTrailerMatchKey(asset);
  if (trailerKey && inputKey === trailerKey) {
    const trailerMatch = {
      confidence: "high",
      match_type: "attached_trailer_context",
      rank: 95,
      trailer_context: true,
    };
    if (!best || trailerMatch.rank > best.rank) best = trailerMatch;
  }

  return best;
}

function scoreVehicleKey(inputKey: string, assetKey: string) {
  if (!inputKey || !assetKey || inputKey.length < 4 || assetKey.length < 4) {
    return null;
  }

  if (inputKey === assetKey) {
    return { confidence: "high", match_type: "exact_normalized", rank: 100 };
  }

  const missingOneTrailing =
    assetKey.length === inputKey.length + 1 && assetKey.startsWith(inputKey);
  if (missingOneTrailing) {
    return {
      confidence: "high",
      match_type: "missing_trailing_character",
      rank: 90,
    };
  }

  const distance = editDistance(inputKey, assetKey);
  if (distance === 1 && Math.max(inputKey.length, assetKey.length) >= 5) {
    return { confidence: "medium", match_type: "edit_distance_1", rank: 75 };
  }

  const strongPartial =
    inputKey.length >= 5 &&
    (assetKey.includes(inputKey) || inputKey.includes(assetKey));
  if (strongPartial) {
    return { confidence: "medium", match_type: "strong_partial", rank: 65 };
  }

  return null;
}

function sanitizeVehicleCandidate(candidate: any) {
  return {
    truck_id: candidate.truck_id || null,
    registration: candidate.registration || null,
    confidence: candidate.confidence || "low",
    match_type: candidate.match_type || "candidate",
    attached_trailer_plate: candidate.attached_trailer_plate || null,
    provider_label: candidate.provider_label || null,
    trailer_context: Boolean(candidate.trailer_context),
    enabled_for_intelligence: Boolean(candidate.enabled_for_intelligence),
  };
}

function isMissingOptionalTelemetryColumnError(error: any) {
  if (!error) return false;
  const code = String(error.code || "").toUpperCase();
  const message = String(error.message || error.details || error.hint || "").toLowerCase();
  return (
    code === "PGRST204" ||
    message.includes("column") ||
    message.includes("schema cache") ||
    message.includes("could not find")
  );
}

function editDistance(a: string, b: string) {
  const matrix = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}
