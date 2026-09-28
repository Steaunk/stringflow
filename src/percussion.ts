export type PercussionKind = "muted" | "body-tap" | "string-slap";
export function percussionSamples(kind: PercussionKind, sampleRate: number) {
  const duration =
    kind === "body-tap" ? 0.32 : kind === "string-slap" ? 0.16 : 0.06;
  const data = new Float32Array(Math.ceil(duration * sampleRate));
  let state = 314159,
    previous = 0;
  for (let i = 0; i < data.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const noise = state / 2147483648 - 1,
      t = i / sampleRate;
    const high = noise - previous;
    previous = noise;
    if (kind === "body-tap") {
      data[i] =
        (0.64 * Math.sin(2 * Math.PI * 92 * t) * Math.exp(-t / 0.055) +
          0.22 * Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t / 0.026) +
          0.1 * noise * Math.exp(-t / 0.007)) *
        (1 - Math.exp(-t / 0.0007));
    } else if (kind === "string-slap") {
      data[i] =
        0.38 * high * Math.exp(-t / 0.022) +
        0.2 * Math.sin(2 * Math.PI * 240 * t) * Math.exp(-t / 0.028);
    } else data[i] = 0.3 * high * Math.exp(-t / 0.009);
    data[i] *= Math.min(1, (duration - t) / 0.005);
  }
  return data;
}
