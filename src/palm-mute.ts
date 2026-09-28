/** Near-bridge damping: pitched low modes survive the short contact transient.
 * Sound-design approximation informed by string/body models, not a recorded sample.
 * Unlike a dead note (x), P.M. retains the fretted pitch. Duration is physical decay,
 * independent of score tempo; explicit string damping can still stop it sooner.
 */
export function palmMutedSamples(hz: number, rate: number, string = 6) {
  const scale = Math.max(0.72, Math.min(1.25, Math.sqrt(110 / hz)));
  const duration = 0.65 * scale;
  const wave = new Float32Array(Math.ceil(rate * duration));
  for (let n = 1; n <= 24 && hz * n < rate * 0.43; n++) {
    const amplitude =
      (0.48 * Math.sin(Math.PI * n * 0.16)) /
      (Math.sin(Math.PI * 0.16) * n ** 1.45);
    // Frequency-dependent damping: high modes are audible at the attack but die first.
    const tau = (0.065 * scale) / (1 + 0.11 * (n - 1) ** 1.4);
    const angle = (2 * Math.PI * hz * n) / rate;
    const a = Math.cos(angle),
      b = Math.sin(angle),
      decay = Math.exp(-1 / (rate * tau));
    let s = 0,
      c = 1,
      envelope = amplitude;
    for (let i = 0; i < wave.length; i++) {
      wave[i] += s * envelope;
      const next = s * a + c * b;
      c = c * a - s * b;
      s = next;
      envelope *= decay;
    }
  }
  let seed = (Math.round(hz * 1000) + string * 7919) >>> 0,
    low = 0;
  const alpha = 1 - Math.exp((-2 * Math.PI * 4200) / rate);
  for (let i = 0; i < wave.length; i++) {
    const t = i / rate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    low += alpha * (noise - low);
    const contact = 0.055 * (noise - low) * Math.exp(-t / 0.0035);
    const body =
      0.025 *
      (Math.sin(2 * Math.PI * 105 * t) +
        0.6 * Math.sin(2 * Math.PI * 205 * t)) *
      Math.exp(-t / 0.02);
    wave[i] =
      (wave[i] + contact + body) *
      (1 - Math.exp(-t / 0.0008)) *
      Math.min(1, (duration - t) / 0.025);
  }
  return wave;
}
