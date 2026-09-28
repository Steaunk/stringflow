/** YIN difference function + cumulative mean normalized difference, mono guitar. */
export function detectPitch(
  samples: Float32Array,
  sampleRate: number,
): { hz: number; confidence: number; rms: number } | null {
  let energy = 0;
  for (const s of samples) energy += s * s;
  const rms = Math.sqrt(energy / samples.length);
  if (rms < 0.008) return null;
  const maxLag = Math.min(
    Math.floor(sampleRate / 40),
    Math.floor(samples.length / 2),
  );
  const minLag = Math.floor(sampleRate / 3000);
  const size = samples.length - maxLag;
  const diff = new Float32Array(maxLag + 1);
  let running = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < size; i++) {
      const delta = samples[i] - samples[i + lag];
      sum += delta * delta;
    }
    running += sum;
    diff[lag] = running ? (sum * lag) / running : 1;
  }
  for (let lag = minLag; lag < maxLag; lag++) {
    if (diff[lag] >= 0.15) continue;
    while (lag + 1 < maxLag && diff[lag + 1] < diff[lag]) lag++;
    const a = diff[lag - 1],
      b = diff[lag],
      c = diff[lag + 1];
    const denom = 2 * (2 * b - a - c);
    const refined = lag + (denom ? (c - a) / denom : 0);
    return { hz: sampleRate / refined, confidence: 1 - b, rms };
  }
  return null;
}
