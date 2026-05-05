export function smoothFuelReadings(readings: any[]) {
  if (!readings || readings.length === 0) return [];

  const windowSize = 5;
  const smoothed = [];

  for (let i = 0; i < readings.length; i++) {
    let sum = 0;
    let count = 0;

    for (let j = i - windowSize; j <= i + windowSize; j++) {
      if (readings[j]) {
        sum += readings[j].fuel_level || 0;
        count++;
      }
    }

    smoothed.push({
      ...readings[i],
      smoothed_fuel: sum / count,
    });
  }

  return smoothed;
}
