import { supabaseAdmin } from "../supabaseAdmin";
import { normalizeFuel, compareFuelReadings } from "../normalization/fuelNormalizer";

interface TelemetryPoint {
  id: string;
  truck_id: string;
  recorded_at: string;
  fuel_level: number | null;
  fuel_unit: string;
  fuel_source: string;
  fuel_confidence: number;
  speed: number | null;
  latitude: number | null;
  longitude: number | null;
}

interface ShiftWindow {
  start: Date;
  end: Date;
  truck_id: string;
  driver_id: string | null;
  driver_name: string | null;
  journey_id: string | null;
}

export async function runUniversalFuelRiskEngine(shiftWindow?: ShiftWindow, lookbackHours: number = 168) {
  if (!shiftWindow) {
    const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
    
    const { data: shifts, error } = await supabaseAdmin
      .from("asset_driver_assignments")
      .select("*")
      .gte("assigned_from", since.toISOString());
    
    if (error) throw error;
    
    const results = [];
    for (const shift of shifts || []) {
      const result = await analyzeShiftUniversal({
        start: new Date(shift.assigned_from),
        end: shift.assigned_to ? new Date(shift.assigned_to) : new Date(),
        truck_id: shift.truck_id,
        driver_id: shift.driver_id,
        driver_name: shift.driver_name,
        journey_id: shift.journey_id
      });
      if (result) results.push(result);
    }
    
    return { success: true, scores: results, lookback_hours: lookbackHours };
  }
  
  const score = await analyzeShiftUniversal(shiftWindow);
  return { success: true, score };
}

async function analyzeShiftUniversal(shift: ShiftWindow) {
  const { data: telemetry, error } = await supabaseAdmin
    .from("telemetry_logs")
    .select("*")
    .eq("truck_id", shift.truck_id)
    .gte("recorded_at", shift.start.toISOString())
    .lte("recorded_at", shift.end.toISOString())
    .not("fuel_level", "is", null)
    .order("recorded_at", { ascending: true });
  
  if (error || !telemetry || telemetry.length < 2) return null;
  
  const evidence = {
    small_drops: [] as Array<{ amount: number; unit: string; timestamp: string }>,
    large_drops: [] as Array<{ amount: number; unit: string; timestamp: string }>,
    idle_periods: [] as Array<{ minutes: number; timestamp: string }>
  };
  
  let stationaryFuelDropTotal = 0;
  let smallDropCount = 0;
  let largeDropCount = 0;
  let totalIdleMinutes = 0;
  let confidenceSum = 0;
  let fuelUnit = "unknown";
  let confidenceCount = 0;
  
  for (let i = 1; i < telemetry.length; i++) {
    const prev = telemetry[i - 1];
    const curr = telemetry[i];
    
    if (prev.fuel_unit) fuelUnit = prev.fuel_unit;
    
    const normalizedPrev = normalizeFuel({
      value: prev.fuel_level,
      unit: prev.fuel_unit || 'unknown',
      source: prev.fuel_source || 'provider',
      confidence: prev.fuel_confidence || 0.5
    });
    
    const normalizedCurr = normalizeFuel({
      value: curr.fuel_level,
      unit: curr.fuel_unit || 'unknown',
      source: curr.fuel_source || 'provider',
      confidence: curr.fuel_confidence || 0.5
    });
    
    confidenceSum += (normalizedPrev.confidence + normalizedCurr.confidence) / 2;
    confidenceCount += 1;
    
    const comparison = compareFuelReadings(normalizedPrev, normalizedCurr);
    
    const minutesSince = (new Date(curr.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) / 60000;
    const wasStationary = (prev.speed !== null && prev.speed <= 1) && (curr.speed !== null && curr.speed <= 1);
    
    if (wasStationary && comparison.drop > 0) {
      stationaryFuelDropTotal += comparison.drop;
      
      const isSmallDrop = fuelUnit === 'percentage' ? comparison.drop < 5 : comparison.drop < 15;
      if (isSmallDrop) {
        smallDropCount++;
        evidence.small_drops.push({
          amount: comparison.drop,
          unit: normalizedCurr.unit,
          timestamp: curr.recorded_at
        });
      } else {
        largeDropCount++;
        evidence.large_drops.push({
          amount: comparison.drop,
          unit: normalizedCurr.unit,
          timestamp: curr.recorded_at
        });
      }
    }
    
    if (wasStationary && minutesSince > 30) {
      evidence.idle_periods.push({
        minutes: Math.floor(minutesSince),
        timestamp: curr.recorded_at
      });
      totalIdleMinutes += minutesSince;
    }
  }
  
  const firstTelemetry = telemetry[0];
  const lastTelemetry = telemetry[telemetry.length - 1];
  
  const startingFuel = firstTelemetry.fuel_level || 0;
  const endingFuel = lastTelemetry.fuel_level || 0;
  const totalFuelDrop = startingFuel - endingFuel;
  
  const avgConfidence = confidenceCount > 0 ? confidenceSum / confidenceCount : 0.5;
  
  let riskScore = 0;
  if (smallDropCount >= 10) riskScore += 40;
  else if (smallDropCount >= 5) riskScore += 25;
  else if (smallDropCount >= 2) riskScore += 10;
  
  if (largeDropCount >= 2) riskScore += 30;
  else if (largeDropCount >= 1) riskScore += 15;
  
  const dropNormalized = fuelUnit === 'percentage' ? stationaryFuelDropTotal / 100 : stationaryFuelDropTotal / 200;
  if (dropNormalized > 0.3) riskScore += 20;
  else if (dropNormalized > 0.15) riskScore += 10;
  
  if (totalIdleMinutes > 180) riskScore += 10;
  else if (totalIdleMinutes > 90) riskScore += 5;
  
  if (avgConfidence < 0.3) riskScore = Math.floor(riskScore * 0.5);
  else if (avgConfidence < 0.6) riskScore = Math.floor(riskScore * 0.8);
  
  let riskLevel: "low" | "medium" | "high" | "critical" = "low";
  let recommendation = "";
  
  if (riskScore >= 70) {
    riskLevel = "critical";
    recommendation = `URGENT: Multiple fuel anomalies detected (${smallDropCount} small drops, ${largeDropCount} large drops). Fuel unit: ${fuelUnit}. Investigate driver immediately.`;
  } else if (riskScore >= 50) {
    riskLevel = "high";
    recommendation = `High fuel theft probability. ${smallDropCount} small drops detected while stationary. Compare against fleet baseline.`;
  } else if (riskScore >= 25) {
    riskLevel = "medium";
    recommendation = `Suspicious fuel pattern. ${smallDropCount} small drops detected. Monitor next 5 trips.`;
  } else {
    riskLevel = "low";
    recommendation = `Normal fuel consumption pattern. ${smallDropCount} small drops within acceptable range.`;
  }
  
  if (smallDropCount >= 5 && riskLevel !== "critical") {
    recommendation = `Pattern of small fuel drops (${smallDropCount} events) detected. This suggests repeated siphoning of approximately ${(smallDropCount * 4).toFixed(0)}-${(smallDropCount * 6).toFixed(0)} ${fuelUnit} over the shift.`;
  }
  
  const score = {
    truck_id: shift.truck_id,
    driver_id: shift.driver_id,
    driver_name: shift.driver_name,
    journey_id: shift.journey_id,
    analysis_window_start: shift.start,
    analysis_window_end: shift.end,
    starting_fuel: startingFuel,
    ending_fuel: endingFuel,
    fuel_drop_total: totalFuelDrop,
    stationary_fuel_drop_total: stationaryFuelDropTotal,
    small_drop_count: smallDropCount,
    large_drop_count: largeDropCount,
    idle_minutes: totalIdleMinutes,
    fuel_unit: fuelUnit,
    fuel_source: telemetry[0]?.fuel_source || 'unknown',
    avg_confidence: avgConfidence,
    risk_score: riskScore,
    risk_level: riskLevel,
    recommendation: recommendation,
    evidence: evidence
  };
  
  await supabaseAdmin.from("fuel_risk_scores").insert({
    truck_id: score.truck_id,
    driver_id: score.driver_id,
    driver_name: score.driver_name,
    journey_id: score.journey_id,
    analysis_window_start: score.analysis_window_start.toISOString(),
    analysis_window_end: score.analysis_window_end.toISOString(),
    starting_fuel: score.starting_fuel,
    ending_fuel: score.ending_fuel,
    fuel_drop_total: score.fuel_drop_total,
    stationary_fuel_drop_total: score.stationary_fuel_drop_total,
    small_drop_count: score.small_drop_count,
    large_drop_count: score.large_drop_count,
    idle_minutes: score.idle_minutes,
    fuel_unit: score.fuel_unit,
    fuel_source: score.fuel_source,
    avg_confidence: score.avg_confidence,
    risk_score: score.risk_score,
    risk_level: score.risk_level,
    recommendation: score.recommendation,
    evidence: score.evidence
  });
  
  return score;
}

export async function getUniversalDriverFuelRisk(driverName: string, days: number = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  
  const { data: scores, error } = await supabaseAdmin
    .from("fuel_risk_scores")
    .select("*")
    .eq("driver_name", driverName)
    .gte("analysis_window_start", since.toISOString())
    .order("analysis_window_start", { ascending: true });
  
  if (error) throw error;
  
  const totalScores = scores?.length || 0;
  const highRiskCount = scores?.filter(s => s.risk_level === "high" || s.risk_level === "critical").length || 0;
  const totalSmallDrops = scores?.reduce((sum, s) => sum + (s.small_drop_count || 0), 0) || 0;
  const totalStationaryDrop = scores?.reduce((sum, s) => sum + (s.stationary_fuel_drop_total || 0), 0) || 0;
  
  const fuelUnits = scores?.map(s => s.fuel_unit).filter(Boolean) || [];
  const primaryFuelUnit = fuelUnits.length > 0 
    ? fuelUnits.sort((a,b) => 
        fuelUnits.filter(v => v === a).length - fuelUnits.filter(v => v === b).length
      ).pop()
    : "unknown";
  
  return {
    driver_name: driverName,
    period_days: days,
    total_shifts_analyzed: totalScores,
    high_risk_shifts: highRiskCount,
    average_risk_score: totalScores > 0 ? (scores.reduce((sum, s) => sum + (s.risk_score || 0), 0) / totalScores).toFixed(1) : "0",
    total_small_drops: totalSmallDrops,
    total_suspected_fuel_loss_units: totalStationaryDrop.toFixed(1),
    fuel_unit: primaryFuelUnit,
    overall_risk_level: highRiskCount > 2 ? "HIGH" : highRiskCount > 0 ? "MEDIUM" : "LOW",
    shifts: scores
  };
}

/**
 * Analyze fuel risk for a specific truck over a time period (no driver required).
 * Useful for yard theft detection, parked vehicle monitoring.
 */
export async function analyzeTruckFuelRisk(truckId: string, days: number = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Fetch telemetry for this truck with fuel data
  const { data: telemetry, error } = await supabaseAdmin
    .from("telemetry_logs")
    .select("*")
    .eq("truck_id", truckId)
    .gte("recorded_at", since.toISOString())
    .not("fuel_level", "is", null)
    .order("recorded_at", { ascending: true });

  if (error) throw error;
  if (!telemetry || telemetry.length < 2) {
    return {
      message: "Insufficient fuel telemetry data for this truck in the specified period",
      telemetry_points_found: telemetry?.length || 0,
      risk_score: 0,
      risk_level: "insufficient_data"
    };
  }

  const evidence = {
    small_drops: [] as Array<{ amount: number; unit: string; timestamp: string }>,
    large_drops: [] as Array<{ amount: number; unit: string; timestamp: string }>,
    idle_periods: [] as Array<{ minutes: number; timestamp: string }>
  };

  let stationaryFuelDropTotal = 0;
  let smallDropCount = 0;
  let largeDropCount = 0;
  let totalIdleMinutes = 0;
  let confidenceSum = 0;
  let fuelUnit = "unknown";
  let confidenceCount = 0;

  for (let i = 1; i < telemetry.length; i++) {
    const prev = telemetry[i - 1];
    const curr = telemetry[i];

    if (prev.fuel_unit) fuelUnit = prev.fuel_unit;

    const normalizedPrev = normalizeFuel({
      value: prev.fuel_level,
      unit: prev.fuel_unit || 'unknown',
      source: prev.fuel_source || 'provider',
      confidence: prev.fuel_confidence || 0.5
    });

    const normalizedCurr = normalizeFuel({
      value: curr.fuel_level,
      unit: curr.fuel_unit || 'unknown',
      source: curr.fuel_source || 'provider',
      confidence: curr.fuel_confidence || 0.5
    });

    confidenceSum += (normalizedPrev.confidence + normalizedCurr.confidence) / 2;
    confidenceCount += 1;

    const comparison = compareFuelReadings(normalizedPrev, normalizedCurr);

    const minutesSince = (new Date(curr.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) / 60000;
    const wasStationary = (prev.speed !== null && prev.speed <= 1) && (curr.speed !== null && curr.speed <= 1);

    if (wasStationary && comparison.drop > 0) {
      stationaryFuelDropTotal += comparison.drop;

      const isSmallDrop = fuelUnit === 'percentage' ? comparison.drop < 5 : comparison.drop < 15;
      if (isSmallDrop) {
        smallDropCount++;
        evidence.small_drops.push({
          amount: comparison.drop,
          unit: normalizedCurr.unit,
          timestamp: curr.recorded_at
        });
      } else {
        largeDropCount++;
        evidence.large_drops.push({
          amount: comparison.drop,
          unit: normalizedCurr.unit,
          timestamp: curr.recorded_at
        });
      }
    }

    if (wasStationary && minutesSince > 30) {
      evidence.idle_periods.push({
        minutes: Math.floor(minutesSince),
        timestamp: curr.recorded_at
      });
      totalIdleMinutes += minutesSince;
    }
  }

  const avgConfidence = confidenceCount > 0 ? confidenceSum / confidenceCount : 0.5;

  let riskScore = 0;
  if (smallDropCount >= 10) riskScore += 40;
  else if (smallDropCount >= 5) riskScore += 25;
  else if (smallDropCount >= 2) riskScore += 10;

  if (largeDropCount >= 2) riskScore += 30;
  else if (largeDropCount >= 1) riskScore += 15;

  const dropNormalized = fuelUnit === 'percentage' ? stationaryFuelDropTotal / 100 : stationaryFuelDropTotal / 200;
  if (dropNormalized > 0.3) riskScore += 20;
  else if (dropNormalized > 0.15) riskScore += 10;

  if (totalIdleMinutes > 180) riskScore += 10;
  else if (totalIdleMinutes > 90) riskScore += 5;

  if (avgConfidence < 0.3) riskScore = Math.floor(riskScore * 0.5);
  else if (avgConfidence < 0.6) riskScore = Math.floor(riskScore * 0.8);

  let riskLevel: "low" | "medium" | "high" | "critical" = "low";
  let recommendation = "";

  if (riskScore >= 70) {
    riskLevel = "critical";
    recommendation = `URGENT: Truck ${truckId} shows multiple fuel anomalies while stationary (${smallDropCount} small drops, ${largeDropCount} large drops). Suspected theft, investigate immediately.`;
  } else if (riskScore >= 50) {
    riskLevel = "high";
    recommendation = `High probability of fuel theft for truck ${truckId} (${smallDropCount} small drops). Review yard logs and camera footage.`;
  } else if (riskScore >= 25) {
    riskLevel = "medium";
    recommendation = `Suspicious fuel pattern detected for truck ${truckId}. Monitor for next 7 days.`;
  } else {
    riskLevel = "low";
    recommendation = `Normal fuel consumption pattern for truck ${truckId}.`;
  }

  // Save analysis to fuel_risk_scores (driver fields null)
  await supabaseAdmin.from("fuel_risk_scores").insert({
    truck_id: truckId,
    driver_id: null,
    driver_name: null,
    journey_id: null,
    analysis_window_start: since.toISOString(),
    analysis_window_end: new Date().toISOString(),
    starting_fuel: telemetry[0].fuel_level,
    ending_fuel: telemetry[telemetry.length-1].fuel_level,
    fuel_drop_total: (telemetry[0].fuel_level || 0) - (telemetry[telemetry.length-1].fuel_level || 0),
    stationary_fuel_drop_total: stationaryFuelDropTotal,
    small_drop_count: smallDropCount,
    large_drop_count: largeDropCount,
    idle_minutes: totalIdleMinutes,
    fuel_unit: fuelUnit,
    fuel_source: telemetry[0]?.fuel_source || 'unknown',
    avg_confidence: avgConfidence,
    risk_score: riskScore,
    risk_level: riskLevel,
    recommendation: recommendation,
    evidence: evidence
  });

  return {
    period_days: days,
    telemetry_points_analyzed: telemetry.length,
    stationary_fuel_drop_total: stationaryFuelDropTotal,
    small_drop_count: smallDropCount,
    large_drop_count: largeDropCount,
    idle_minutes: totalIdleMinutes,
    fuel_unit: fuelUnit,
    avg_confidence: avgConfidence,
    risk_score: riskScore,
    risk_level: riskLevel,
    recommendation: recommendation,
    evidence_summary: {
      small_drops_count: evidence.small_drops.length,
      large_drops_count: evidence.large_drops.length,
      idle_periods_count: evidence.idle_periods.length
    }
  };
}
