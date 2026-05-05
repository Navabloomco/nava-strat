export function detectFuelDrop(events: any[]) {
  const alerts = [];

  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const curr = events[i];

    const drop = prev.smoothed_fuel - curr.smoothed_fuel;

    // Only flag REAL drops (not noise)
    if (drop > 20) {
      alerts.push({
        truck_id: curr.truck_id,
        drop_amount: drop,
        time: curr.recorded_at,
        type: "possible_theft",
      });
    }
  }

  return alerts;
}
