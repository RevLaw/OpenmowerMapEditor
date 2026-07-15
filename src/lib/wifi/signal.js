export const WIFI_SAMPLE_DISTANCE_M = 0.75;
export const MAX_WIFI_SAMPLES = 2000;

export function wifiPercentFromDbm(signalDbm) {
  if (!Number.isFinite(signalDbm)) return null;
  return Math.max(0, Math.min(100, Math.round((signalDbm + 100) * 2)));
}

export function wifiSignalColor(signalDbm) {
  if (signalDbm >= -55) return "#22c55e";
  if (signalDbm >= -65) return "#84cc16";
  if (signalDbm >= -72) return "#facc15";
  if (signalDbm >= -80) return "#f97316";
  return "#ef4444";
}

export function wifiSignalLabel(signalDbm) {
  if (!Number.isFinite(signalDbm)) return "No signal";
  if (signalDbm >= -55) return "Excellent";
  if (signalDbm >= -65) return "Good";
  if (signalDbm >= -72) return "Fair";
  if (signalDbm >= -80) return "Weak";
  return "Very weak";
}

function validReading(reading) {
  return (
    Number.isFinite(reading?.x) &&
    Number.isFinite(reading?.y) &&
    Number.isFinite(reading?.signalDbm)
  );
}

export function mergeWifiSample(samples, reading, timestamp = Date.now()) {
  if (!validReading(reading)) return samples;
  const next = Array.isArray(samples) ? [...samples] : [];
  const maxDistanceSq = WIFI_SAMPLE_DISTANCE_M ** 2;
  let nearestIndex = -1;
  let nearestDistanceSq = Infinity;

  for (let i = 0; i < next.length; i += 1) {
    const dx = next[i].x - reading.x;
    const dy = next[i].y - reading.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq <= maxDistanceSq && distanceSq < nearestDistanceSq) {
      nearestIndex = i;
      nearestDistanceSq = distanceSq;
    }
  }

  if (nearestIndex >= 0) {
    const previous = next[nearestIndex];
    const weight = Math.min(Math.max(previous.samples || 1, 1), 9);
    next[nearestIndex] = {
      ...previous,
      signalDbm: (previous.signalDbm * weight + reading.signalDbm) / (weight + 1),
      samples: weight + 1,
      timestamp,
    };
    return next;
  }

  next.push({
    x: reading.x,
    y: reading.y,
    signalDbm: reading.signalDbm,
    samples: 1,
    timestamp,
  });
  return next.length > MAX_WIFI_SAMPLES ? next.slice(-MAX_WIFI_SAMPLES) : next;
}
