/** Harmonic fret numbers are touch nodes relative to the capo, not stopped pitches.
 * This model intentionally supports the octave node only; score validation agrees.
 */
export type HarmonicAttack = "pluck" | "tap";
export const octaveHarmonicMidi = (openMidi: number, capo: number) =>
  openMidi + capo + 12;

/** Modal approximation of a steel-string harmonic, not a recorded guitar sample.
 * hz is the sounding harmonic (2 × the capoed open-string frequency).
 * Tap excitation has a brief broadband contact, then the same pitched string modes.
 * Partial decay and a fast/slow envelope keep the transient distinct from the ring.
 * Coefficients are sound-design parameters, not measurements of the source recording.
 */
export function harmonicSamples(
  hz: number,
  sampleRate: number,
  attack: HarmonicAttack = "pluck",
  string = 1,
) {
  const tapped = attack === "tap";
  const scale = Math.max(0.7, Math.min(1.35, Math.sqrt(660 / hz)));
  const duration = 4.2 * scale;
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  // An octave node suppresses the original open-string fundamental and odd modes.
  // These ratios are relative to the surviving second mode, so they remain 1,2,3…
  const modes = Array.from({ length: 12 }, (_, i) => {
    const ratio = i + 1;
    // String stiffness slightly stretches upper partials while the target stays tuned.
    const stiffness = 0.000015 + string * 0.000004;
    const frequency =
      hz * ratio * Math.sqrt((1 + stiffness * ratio ** 2) / (1 + stiffness));
    return {
      frequency,
      amplitude:
        ((tapped ? 0.64 : 0.72) *
          Math.abs(Math.cos(ratio * (0.37 + string * 0.018)))) /
        ratio ** (tapped ? 1.15 : 1.7),
      fast: ((tapped ? 0.12 : 0.2) * scale) / ratio ** 0.65,
      slow: (0.95 * scale) / ratio ** 0.85,
      phase: ratio === 1 ? 0 : string * ratio * 0.41,
    };
  }).filter((m) => m.frequency < sampleRate * 0.45);
  // Oscillator/envelope recurrences avoid millions of sin/exp calls on the audio
  // scheduling path; each new timbre is generated once and cached by AudioEngine.
  for (const m of modes) {
    const angle = (2 * Math.PI * m.frequency) / sampleRate;
    const rotationCos = Math.cos(angle),
      rotationSin = Math.sin(angle);
    const fastDecay = Math.exp(-1 / (sampleRate * m.fast));
    const slowDecay = Math.exp(-1 / (sampleRate * m.slow));
    let sine = Math.sin(m.phase),
      cosine = Math.cos(m.phase);
    let fast = 0.55,
      slow = 0.45;
    for (let i = 0; i < samples.length; i++) {
      samples[i] += m.amplitude * sine * (fast + slow);
      const nextSine = sine * rotationCos + cosine * rotationSin;
      cosine = cosine * rotationCos - sine * rotationSin;
      sine = nextSine;
      fast *= fastDecay;
      slow *= slowDecay;
    }
  }
  let seed = (Math.round(hz * 100) + string * 7919) >>> 0;
  let contactLow = 0;
  const contactAlpha = 1 - Math.exp((-2 * Math.PI * 3500) / sampleRate);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    const onset = 1 - Math.exp(-t / (tapped ? 0.0007 : 0.002));
    const release = Math.min(1, (duration - t) / 0.08);
    let value = samples[i];
    if (t < 0.12) {
      // Short fret contact, not a second body-tap or a sustained noise layer.
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 2147483648 - 1;
      contactLow += contactAlpha * (noise - contactLow);
      value +=
        (tapped ? 0.38 : 0.025) *
        (noise - contactLow) *
        Math.exp(-t / (tapped ? 0.007 : 0.003));
      value +=
        (tapped ? 0.12 : 0.015) *
        (Math.sin(2 * Math.PI * 190 * t) +
          0.45 * Math.sin(2 * Math.PI * 410 * t)) *
        Math.exp(-t / 0.012);
    }
    samples[i] = value * onset * release;
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  // Fixed headroom preserves the balance between plucked and tapped articulations.
  if (peak > 0.9)
    for (let i = 0; i < samples.length; i++) samples[i] *= 0.9 / peak;
  return samples;
}
