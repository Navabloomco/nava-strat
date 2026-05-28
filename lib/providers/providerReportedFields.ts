export type ProviderReportedEvidence = {
  source: "provider_reported";
  provider_name: string | null;
  observed_field_paths: string[];
  labels: string[];
  distance_odometer?: ProviderReportedNumericEvidence;
  engine_hours?: ProviderReportedNumericEvidence;
  ignition_engine_state?: ProviderReportedTextEvidence;
  fuel?: {
    fuel_quantity?: ProviderReportedNumericEvidence;
    fuel_price?: ProviderReportedNumericEvidence;
    fuel_per_km?: ProviderReportedNumericEvidence;
    fuel_per_h?: ProviderReportedNumericEvidence;
  };
  status?: {
    alarm?: ProviderReportedTextEvidence;
    icon_status?: ProviderReportedTextEvidence;
  };
  device_timezone?: ProviderReportedTextEvidence;
  caveat: string;
};

export type ProviderReportedNumericEvidence = {
  value: number;
  field_path: string;
  evidence_label: string;
  source: "provider_reported";
  unit: string;
};

export type ProviderReportedTextEvidence = {
  value: string;
  field_path: string;
  evidence_label: string;
  source: "provider_reported";
};

type NumericFieldCandidate = {
  paths: string[];
  evidenceLabel: string;
  unit: string;
  min?: number;
  max?: number;
};

type TextFieldCandidate = {
  paths: string[];
  evidenceLabel: string;
};

export const PROVIDER_REPORTED_FIELD_PATHS = [
  "total_distance",
  "mileage",
  "engine_hours",
  "device_data.engine_hours",
  "device_data.traccar.engine_on_at",
  "device_data.fuel_quantity",
  "device_data.fuel_price",
  "device_data.fuel_per_km",
  "device_data.fuel_per_h",
  "alarm",
  "icon.by_status",
  "device_data.icon.by_status",
  "device_timezone",
];

const DISTANCE_CANDIDATE: NumericFieldCandidate = {
  paths: ["total_distance", "mileage"],
  evidenceLabel: "Provider-reported distance/odometer",
  unit: "provider distance units",
  min: 0,
  max: 10000000,
};

const ENGINE_HOURS_CANDIDATE: NumericFieldCandidate = {
  paths: ["engine_hours", "device_data.engine_hours"],
  evidenceLabel: "Provider-reported engine hours",
  unit: "hours",
  min: 0,
  max: 1000000,
};

const FUEL_CANDIDATES: Record<string, NumericFieldCandidate> = {
  fuel_quantity: {
    paths: ["device_data.fuel_quantity"],
    evidenceLabel: "Provider-reported fuel quantity",
    unit: "provider fuel units",
    min: 0,
    max: 1000000,
  },
  fuel_price: {
    paths: ["device_data.fuel_price"],
    evidenceLabel: "Provider-reported fuel price",
    unit: "provider currency units",
    min: 0,
    max: 100000000,
  },
  fuel_per_km: {
    paths: ["device_data.fuel_per_km"],
    evidenceLabel: "Provider-reported fuel per km",
    unit: "provider fuel units per km",
    min: 0,
    max: 10000,
  },
  fuel_per_h: {
    paths: ["device_data.fuel_per_h"],
    evidenceLabel: "Provider-reported fuel per hour",
    unit: "provider fuel units per hour",
    min: 0,
    max: 10000,
  },
};

const IGNITION_ENGINE_STATE_CANDIDATE: TextFieldCandidate = {
  paths: ["device_data.traccar.engine_on_at", "engine_on_at", "ignition_on_at"],
  evidenceLabel: "Provider ignition/engine-state signal",
};

const ALARM_CANDIDATE: TextFieldCandidate = {
  paths: ["alarm"],
  evidenceLabel: "Provider status/alarm field",
};

const ICON_STATUS_CANDIDATE: TextFieldCandidate = {
  paths: ["icon.by_status", "device_data.icon.by_status"],
  evidenceLabel: "Provider status/alarm field",
};

const DEVICE_TIMEZONE_CANDIDATE: TextFieldCandidate = {
  paths: ["device_timezone"],
  evidenceLabel: "Provider device timezone",
};

export function extractProviderReportedEvidence(
  raw: any,
  providerName?: string | null
): ProviderReportedEvidence | null {
  if (!raw || typeof raw !== "object") return null;

  const observed = new Set<string>();
  const labels = new Set<string>();
  const distance = extractNumericEvidence(raw, DISTANCE_CANDIDATE, observed, labels);
  const engineHours = extractNumericEvidence(raw, ENGINE_HOURS_CANDIDATE, observed, labels);
  const ignitionEngineState = extractTextEvidence(
    raw,
    IGNITION_ENGINE_STATE_CANDIDATE,
    observed,
    labels
  );
  const alarm = extractTextEvidence(raw, ALARM_CANDIDATE, observed, labels);
  const iconStatus = extractTextEvidence(raw, ICON_STATUS_CANDIDATE, observed, labels);
  const deviceTimezone = extractTextEvidence(
    raw,
    DEVICE_TIMEZONE_CANDIDATE,
    observed,
    labels
  );
  const fuel = Object.fromEntries(
    Object.entries(FUEL_CANDIDATES)
      .map(([key, candidate]) => [
        key,
        extractNumericEvidence(raw, candidate, observed, labels),
      ])
      .filter(([, value]) => Boolean(value))
  ) as ProviderReportedEvidence["fuel"];

  if (
    !distance &&
    !engineHours &&
    !ignitionEngineState &&
    !alarm &&
    !iconStatus &&
    !deviceTimezone &&
    (!fuel || Object.keys(fuel).length === 0)
  ) {
    return null;
  }

  return {
    source: "provider_reported",
    provider_name: providerName || null,
    observed_field_paths: Array.from(observed).slice(0, 30),
    labels: Array.from(labels).slice(0, 12),
    ...(distance ? { distance_odometer: distance } : {}),
    ...(engineHours ? { engine_hours: engineHours } : {}),
    ...(ignitionEngineState ? { ignition_engine_state: ignitionEngineState } : {}),
    ...(fuel && Object.keys(fuel).length > 0 ? { fuel } : {}),
    ...(alarm || iconStatus
      ? { status: { ...(alarm ? { alarm } : {}), ...(iconStatus ? { icon_status: iconStatus } : {}) } }
      : {}),
    ...(deviceTimezone ? { device_timezone: deviceTimezone } : {}),
    caveat:
      "Provider-reported field evidence is not audited truth. It must not be used for fuel burn, theft, engine-on idle, or diagnostics claims unless the provider capability and signal quality support that conclusion.",
  };
}

export function providerReportedDistanceValueFromSignalFlags(
  signalFlags: any
): number | null {
  const value = signalFlags?.provider_reported_evidence?.distance_odometer?.value;
  return saneNumber(value, 0, 10000000);
}

function extractNumericEvidence(
  raw: any,
  candidate: NumericFieldCandidate,
  observed: Set<string>,
  labels: Set<string>
): ProviderReportedNumericEvidence | null {
  for (const path of candidate.paths) {
    const value = getValueByCaseInsensitivePath(raw, path);
    const parsed = saneNumber(value, candidate.min ?? 0, candidate.max ?? Number.MAX_SAFE_INTEGER);
    if (parsed === null) continue;
    observed.add(path);
    labels.add(candidate.evidenceLabel);
    return {
      value: parsed,
      field_path: path,
      evidence_label: candidate.evidenceLabel,
      source: "provider_reported",
      unit: candidate.unit,
    };
  }

  return null;
}

function extractTextEvidence(
  raw: any,
  candidate: TextFieldCandidate,
  observed: Set<string>,
  labels: Set<string>
): ProviderReportedTextEvidence | null {
  for (const path of candidate.paths) {
    const value = getValueByCaseInsensitivePath(raw, path);
    const text = safeShortText(value);
    if (!text) continue;
    observed.add(path);
    labels.add(candidate.evidenceLabel);
    return {
      value: text,
      field_path: path,
      evidence_label: candidate.evidenceLabel,
      source: "provider_reported",
    };
  }

  return null;
}

function saneNumber(value: any, min: number, max: number) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue =
    typeof value === "number"
      ? value
      : Number(String(value).trim().replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0]);
  if (!Number.isFinite(numberValue)) return null;
  if (numberValue < min || numberValue > max) return null;
  return numberValue;
}

function safeShortText(value: any) {
  const text = String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text === "-" || text === "--" || /^n\/?a$/i.test(text)) return "";
  return text.slice(0, 120);
}

function getValueByCaseInsensitivePath(raw: any, path: string): any {
  if (!raw || !path) return null;

  return path.split(".").reduce((current: any, segment: string) => {
    if (current === undefined || current === null) return null;

    if (
      typeof current === "object" &&
      !Array.isArray(current) &&
      segment in current
    ) {
      return current[segment];
    }

    if (typeof current !== "object" || Array.isArray(current)) return null;

    const target = normalizeProviderKey(segment);
    const match = Object.keys(current).find(
      (key) => normalizeProviderKey(key) === target
    );

    return match ? current[match] : null;
  }, raw);
}

function normalizeProviderKey(value: any) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
