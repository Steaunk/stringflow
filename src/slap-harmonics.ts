/** Multi-string slap harmonics: a shared fret contact, then sparse ringing modes.
 * Informed by Hub Guitar's slap-harmonic example, not a sampled performance.
 * The numerical weights are a timbre design, not a fitted model of Youngso Kim.
 */
export function slapContactSamples(rate: number) {
  const wave = new Float32Array(Math.ceil(rate * 0.16));
  let seed = 1627,
    low = 0;
  const alpha = 1 - Math.exp((-2 * Math.PI * 4500) / rate);
  for (let i = 0; i < wave.length; i++) {
    const t = i / rate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    low += alpha * (noise - low);
    // A brief fret tick over a damped body impulse, not three independent drums.
    wave[i] =
      (0.34 * (noise - low) * Math.exp(-t / 0.003) +
        0.3 * Math.sin(2 * Math.PI * 165 * t) * Math.exp(-t / 0.018) +
        0.12 * Math.sin(2 * Math.PI * 315 * t) * Math.exp(-t / 0.012)) *
      (1 - Math.exp(-t / 0.00035)) *
      Math.min(1, (0.16 - t) / 0.02);
  }
  return wave;
}
export function slappedStringSamples(
  hz: number,
  rate: number,
  string: number,
  contact = true,
) {
  const scale = Math.max(0.75, Math.min(1.3, Math.sqrt(660 / hz)));
  const duration = 5.8 * scale;
  const wave = new Float32Array(Math.ceil(rate * duration));
  const weights = [1, 0.13, 0.026, 0.014, 0.008, 0.004];
  function mode(
    f: number,
    amplitude: number,
    decay: number,
    phase: number,
    rise = 0.0025,
  ) {
    if (f >= rate * 0.44) return;
    const a = Math.cos((2 * Math.PI * f) / rate),
      b = Math.sin((2 * Math.PI * f) / rate);
    const d = Math.exp(-1 / (rate * decay)),
      onsetDecay = Math.exp(-1 / (rate * rise));
    let sine = Math.sin(phase),
      cosine = Math.cos(phase),
      level = amplitude,
      onset = 1;
    for (let i = 0; i < wave.length; i++) {
      wave[i] += sine * level * (1 - onset);
      const next = sine * a + cosine * b;
      cosine = cosine * a - sine * b;
      sine = next;
      level *= d;
      onset *= onsetDecay;
    }
  }
  weights.forEach((weight, i) => {
    const n = i + 1,
      f = hz * n * Math.sqrt((1 + 0.000014 * n * n) / 1.000014);
    const decay = (1.55 * scale) / n ** 1.15;
    // Two weakly split string polarizations give uneven decay without a chorus effect.
    const split = n === 1 ? 0.8 : 0.4;
    mode(f * 2 ** (-split / 1200), 0.52 * weight, decay, string * 0.31);
    mode(
      f * 2 ** (split / 1200),
      0.07 * weight,
      decay * 1.15,
      string * 0.31 + 0.2,
    );
  });
  // Brief unsuppressed whole-string components disappear as the octave mode rings.
  mode(hz / 2, 0.075, 0.018, 0, 0.0006);
  mode(hz * 1.5, 0.035, 0.012, 0.4, 0.0006);
  const hit = contact ? slapContactSamples(rate) : null;
  for (let i = 0; i < wave.length; i++) {
    wave[i] =
      (wave[i] + (hit?.[i] ?? 0)) * Math.min(1, (duration - i / rate) / 0.08);
  }
  return wave;
}
