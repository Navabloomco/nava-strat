import { supabaseAdmin } from "../supabaseAdmin";

export const ASSET_SUGGESTION_CATEGORIES = [
  "unknown",
  "truck",
  "trailer",
  "van",
  "pickup",
  "car",
  "motorcycle",
  "equipment",
  "other",
] as const;

type AssetSuggestionCategory = (typeof ASSET_SUGGESTION_CATEGORIES)[number];

type AssetClassificationSuggestion = {
  asset_id: string;
  ai_suggested_category: AssetSuggestionCategory;
  ai_suggested_reason: string;
  ai_confidence: number;
  signals: {
    matched_recent_journey: boolean;
    telemetry_points_30d: number;
    movement_km_estimate: number;
    duplicate_pattern: boolean;
    provider_label_match: string | null;
    stale_last_seen: boolean;
  };
};

type CompanyOperatingContext = {
  business_type?: string | null;
  primary_asset_types?: string[] | null;
  main_billing_unit?: string | null;
  operating_regions?: string[] | null;
  primary_use_case?: string | null;
};

function normalizeKey(value: any) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function clampConfidence(value: number) {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function toNumber(value: any) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function distanceKm(a: any, b: any) {
  const lat1 = toNumber(a.latitude);
  const lon1 = toNumber(a.longitude);
  const lat2 = toNumber(b.latitude);
  const lon2 = toNumber(b.longitude);

  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) {
    return 0;
  }

  const earthRadiusKm = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const rLat1 = (lat1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;

  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) *
      Math.cos(rLat2) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function estimateMovementKm(points: any[]) {
  const ordered = [...points]
    .filter((point) => point.recorded_at)
    .sort(
      (a, b) =>
        new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
    );

  let total = 0;
  for (let i = 1; i < ordered.length; i++) {
    const segmentKm = distanceKm(ordered[i - 1], ordered[i]);
    if (segmentKm > 0 && segmentKm < 500) {
      total += segmentKm;
    }
  }

  return Number(total.toFixed(1));
}

function collectSafeLabels(asset: any) {
  const labels: string[] = [];

  for (const value of [
    asset.provider_location_label,
    asset.provider_name,
    asset.registration,
    asset.truck_id,
  ]) {
    const text = String(value || "").trim();
    if (text) labels.push(text);
  }

  const raw = asset.raw_payload;
  if (raw && typeof raw === "object") {
    const usefulKeys = [
      "type",
      "vehicle_type",
      "category",
      "class",
      "label",
      "name",
      "model",
      "description",
    ];

    for (const key of usefulKeys) {
      const value = raw[key];
      if (typeof value === "string" && value.trim()) {
        labels.push(value.trim());
      }
    }
  }

  return labels.join(" ").toLowerCase();
}

function categoryFromLabels(labelText: string): {
  category: AssetSuggestionCategory;
  reason: string;
  confidence: number;
  match: string | null;
} | null {
  const patterns: Array<{
    category: AssetSuggestionCategory;
    words: string[];
    reason: string;
    confidence: number;
  }> = [
    {
      category: "motorcycle",
      words: ["motorcycle", "motorbike", "bike", "boda"],
      reason: "Provider label suggests motorcycle",
      confidence: 0.68,
    },
    {
      category: "trailer",
      words: ["trailer"],
      reason: "Provider label suggests trailer",
      confidence: 0.66,
    },
    {
      category: "pickup",
      words: ["pickup", "pick-up"],
      reason: "Provider label suggests pickup",
      confidence: 0.65,
    },
    {
      category: "van",
      words: ["van"],
      reason: "Provider label suggests van",
      confidence: 0.62,
    },
    {
      category: "equipment",
      words: ["excavator", "loader", "crane", "grader", "forklift", "equipment"],
      reason: "Provider label suggests equipment",
      confidence: 0.62,
    },
    {
      category: "truck",
      words: ["truck", "lorry", "prime mover", "tractor"],
      reason: "Provider label suggests truck",
      confidence: 0.62,
    },
    {
      category: "car",
      words: ["car", "saloon", "sedan", "suv"],
      reason: "Provider label suggests car",
      confidence: 0.6,
    },
  ];

  for (const pattern of patterns) {
    const match = pattern.words.find((word) => labelText.includes(word));
    if (match) {
      return {
        category: pattern.category,
        reason: pattern.reason,
        confidence: pattern.confidence,
        match,
      };
    }
  }

  return null;
}

function normalizeArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function preferredMovementCategory(
  context: CompanyOperatingContext | null
): AssetSuggestionCategory {
  const primaryTypes = normalizeArray(context?.primary_asset_types);

  for (const category of [
    "truck",
    "van",
    "pickup",
    "car",
    "motorcycle",
    "equipment",
    "trailer",
  ] as AssetSuggestionCategory[]) {
    if (primaryTypes.includes(category)) return category;
  }

  if (context?.business_type === "construction_equipment") return "equipment";
  if (context?.business_type === "sales_fleet") return "car";
  if (context?.business_type === "courier_delivery") return "van";

  return "truck";
}

function boostForOperatingContext(
  category: AssetSuggestionCategory,
  confidence: number,
  context: CompanyOperatingContext | null
) {
  if (!context || category === "unknown") return confidence;
  const primaryTypes = normalizeArray(context.primary_asset_types);
  const directMatch = primaryTypes.includes(category);
  const businessMatch =
    (context.business_type === "courier_delivery" &&
      ["motorcycle", "van", "pickup"].includes(category)) ||
    (context.business_type === "sales_fleet" && category === "car") ||
    (context.business_type === "construction_equipment" &&
      category === "equipment");

  return directMatch || businessMatch ? Math.min(confidence + 0.05, 0.8) : confidence;
}

function buildIdentifierSet(asset: any) {
  return new Set(
    [asset.truck_id, asset.registration].map(normalizeKey).filter(Boolean)
  );
}

export async function suggestAssetClassifications(
  companyId: string,
  options: { assetIds?: string[] } = {}
): Promise<AssetClassificationSuggestion[]> {
  const since = daysAgo(30).toISOString();

  let assetQuery = supabaseAdmin
    .from("fleet_assets")
    .select(
      "id, truck_id, registration, provider_name, provider_location_label, last_seen_at, raw_payload"
    )
    .eq("company_id", companyId);

  if (options.assetIds?.length) {
    assetQuery = assetQuery.in("id", options.assetIds);
  }

  const [assetsResult, journeysResult, companyResult] = await Promise.all([
    assetQuery,
    supabaseAdmin
      .from("journeys")
      .select("truck")
      .eq("company_id", companyId)
      .eq("is_demo", false)
      .gte("created_at", since),
    supabaseAdmin
      .from("companies")
      .select("business_type, primary_asset_types, main_billing_unit, operating_regions, primary_use_case")
      .eq("id", companyId)
      .maybeSingle(),
  ]);

  if (assetsResult.error) throw assetsResult.error;
  if (journeysResult.error) throw journeysResult.error;
  if (companyResult.error) throw companyResult.error;

  const assets = assetsResult.data || [];
  if (assets.length === 0) return [];
  const operatingContext = companyResult.data || null;

  const identifierCounts = new Map<string, number>();
  for (const asset of assets) {
    for (const key of Array.from(buildIdentifierSet(asset))) {
      identifierCounts.set(key, (identifierCounts.get(key) || 0) + 1);
    }
  }

  const journeyTruckKeys = new Set(
    (journeysResult.data || []).map((journey) => normalizeKey(journey.truck))
  );

  const truckIds = Array.from(
    new Set(assets.map((asset) => asset.truck_id).filter(Boolean))
  );

  let telemetry: any[] = [];
  if (truckIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("telemetry_logs")
      .select("truck_id, latitude, longitude, recorded_at")
      .eq("company_id", companyId)
      .in("truck_id", truckIds)
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: true })
      .limit(5000);

    if (error) throw error;
    telemetry = data || [];
  }

  const telemetryByTruck = new Map<string, any[]>();
  for (const point of telemetry) {
    const key = normalizeKey(point.truck_id);
    if (!key) continue;
    const current = telemetryByTruck.get(key) || [];
    current.push(point);
    telemetryByTruck.set(key, current);
  }

  return assets.map((asset) => {
    const identifiers = buildIdentifierSet(asset);
    const matchedJourney = Array.from(identifiers).some((key) =>
      journeyTruckKeys.has(key)
    );
    const duplicatePattern = Array.from(identifiers).some(
      (key) => (identifierCounts.get(key) || 0) > 1
    );
    const telemetryPoints = telemetryByTruck.get(normalizeKey(asset.truck_id)) || [];
    const telemetryCount = telemetryPoints.length;
    const movementKm = estimateMovementKm(telemetryPoints);
    const labelSuggestion = categoryFromLabels(collectSafeLabels(asset));
    const lastSeenAt = asset.last_seen_at ? new Date(asset.last_seen_at) : null;
    const staleLastSeen =
      !lastSeenAt ||
      Number.isNaN(lastSeenAt.getTime()) ||
      lastSeenAt.getTime() < daysAgo(14).getTime();

    let category: AssetSuggestionCategory = "unknown";
    let reason = "Not enough evidence";
    let confidence = 0.15;
    let providerLabelMatch: string | null = null;

    if (duplicatePattern) {
      reason = "Duplicate registration pattern";
      confidence = 0.56;
    }

    if (labelSuggestion && labelSuggestion.confidence > confidence) {
      category = labelSuggestion.category;
      reason = labelSuggestion.reason;
      confidence = boostForOperatingContext(
        labelSuggestion.category,
        labelSuggestion.confidence,
        operatingContext
      );
      providerLabelMatch = labelSuggestion.match;
    }

    if (movementKm >= 100 && telemetryCount >= 12 && confidence < 0.58) {
      category = preferredMovementCategory(operatingContext);
      reason = "Frequent long-distance movement";
      confidence = boostForOperatingContext(category, 0.55, operatingContext);
    }

    if (matchedJourney) {
      category = preferredMovementCategory(operatingContext);
      reason = "Matched to recent journeys";
      confidence = boostForOperatingContext(category, 0.72, operatingContext);
    } else if (staleLastSeen && telemetryCount < 3 && confidence < 0.3) {
      category = "unknown";
      reason = "Low activity / stale tracker";
      confidence = 0.24;
    }

    return {
      asset_id: asset.id,
      ai_suggested_category: category,
      ai_suggested_reason: reason,
      ai_confidence: clampConfidence(confidence),
      signals: {
        matched_recent_journey: matchedJourney,
        telemetry_points_30d: telemetryCount,
        movement_km_estimate: movementKm,
        duplicate_pattern: duplicatePattern,
        provider_label_match: providerLabelMatch,
        stale_last_seen: staleLastSeen,
      },
    };
  });
}
