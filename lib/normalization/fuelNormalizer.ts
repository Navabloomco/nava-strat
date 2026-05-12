interface RawFuelData {
  value: number | null;
  unit: string;
  source: string;
  confidence: number;
}

interface NormalizedFuel {
  value: number;
  unit: string;
  source: string;
  confidence: number;
  original_value: number;
  original_unit: string;
}

export function normalizeFuel(raw: RawFuelData): NormalizedFuel {
  let normalizedValue = raw.value ?? 0;
  let normalizedUnit = raw.unit;

  if (raw.unit === "gallons") {
    normalizedValue = (raw.value ?? 0) * 3.78541;
    normalizedUnit = "litres";
  } else if (raw.unit === "percentage") {
    normalizedUnit = "percentage";
  } else if (raw.unit === "voltage") {
    normalizedUnit = "voltage";
  }

  return {
    value: normalizedValue,
    unit: normalizedUnit,
    source: raw.source,
    confidence: raw.confidence,
    original_value: raw.value ?? 0,
    original_unit: raw.unit,
  };
}

export function compareFuelReadings(
  prev: NormalizedFuel,
  curr: NormalizedFuel
): {
  drop: number;
  is_significant: boolean;
  message: string;
} {
  if (
    prev.unit !== curr.unit ||
    prev.confidence < 0.3 ||
    curr.confidence < 0.3
  ) {
    return {
      drop: 0,
      is_significant: false,
      message:
        "Fuel comparison not available (incompatible units or low confidence)",
    };
  }

  const drop = prev.value - curr.value;

  let threshold = 0;

  if (prev.unit === "percentage") threshold = 5;
  else if (prev.unit === "litres") threshold = 15;
  else threshold = 10;

  return {
    drop,
    is_significant: drop >= threshold,
    message:
      drop >= threshold
        ? `Fuel dropped ${drop.toFixed(1)} ${prev.unit} while stationary`
        : `Normal fuel consumption (${drop.toFixed(1)} ${prev.unit})`,
  };
}
