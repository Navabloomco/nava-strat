export function smoothFuelReadings(readings: any[]) {
  if (!readings || readings.length === 0) return [];

  const windowSize = 5;
  const smoothed = [];

  for (let i = 0; i < readings.length; i++) {
    let sum = 0;
    let count = 0;

    for (let j = i - windowSize; j <= i + windowSize; j++) {
      if (readings[j] && readings[j].fuel_level != null) {
        sum += readings[j].fuel_level;
        count++;
      }
    }

    smoothed.push({
      ...readings[i],
      smoothed_fuel: count > 0 ? sum / count : readings[i].fuel_level,
    });
  }

  return smoothed;
}
