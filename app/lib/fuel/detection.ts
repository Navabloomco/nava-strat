export function detectFuelDrops(readings: any[]) {
  if (!readings || readings.length < 2) return [];

  const alerts = [];

  let smallDropAccumulator = 0;
  let lastDropTime: number | null = null;

  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i - 1];
    const curr = readings[i];

    if (
      prev.smoothed_fuel == null ||
      curr.smoothed_fuel == null
    ) continue;

    const drop = prev.smoothed_fuel - curr.smoothed_fuel;

    const prevTime = new Date(prev.recorded_at).getTime();
    const currTime = new Date(curr.recorded_at).getTime();

    const minutes = (currTime - prevTime) / (1000 * 60);

    // 🚨 BIG DROP (classic theft)
    if (drop > 20 && minutes < 30) {
      alerts.push({
        truck_id: curr.truck_id,
        drop_amount: drop,
        minutes,
        time: curr.recorded_at,
        type: "fuel_drop",
        severity: "high",
      });
    }

    // 🕵️ SMALL STEALTH DROPS (your dad’s case)
    if (drop > 3 && drop <= 20 && minutes < 15) {
      smallDropAccumulator += drop;

      if (!lastDropTime) lastDropTime = currTime;

      const totalMinutes = (currTime - lastDropTime) / (1000 * 60);

      // If small drops accumulate suspiciously
      if (smallDropAccumulator > 15 && totalMinutes < 60) {
        alerts.push({
          truck_id: curr.truck_id,
          drop_amount: smallDropAccumulator,
          minutes: totalMinutes,
          time: curr.recorded_at,
          type: "stealth_fuel_theft",
          severity: "medium",
        });

        // reset
        smallDropAccumulator = 0;
        lastDropTime = null;
      }
    } else {
      // reset if pattern breaks
      smallDropAccumulator = 0;
      lastDropTime = null;
    }

    // 🚨 ENGINE OFF CHECK (VERY IMPORTANT)
    if (drop > 3 && curr.speed === 0) {
      alerts.push({
        truck_id: curr.truck_id,
        drop_amount: drop,
        time: curr.recorded_at,
        type: "engine_off_fuel_loss",
        severity: "high",
      });
    }
  }

  return alerts;
}
