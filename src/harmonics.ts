/** A plucked natural harmonic: tuned partials with independently decaying energy.
 * hz is the sounding pitch, already including tuning, capo and the octave node.
 * The ring is independent of written duration; the string can be damped separately.
 */
export function harmonicSamples(hz: number, sampleRate: number) {
  const duration = Math.max(1.4, Math.min(2.8, 0.8 + 900 / hz));
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  const partials = [
    { ratio: 1, amplitude: 0.82, decay: 0.48 },
    { ratio: 2, amplitude: 0.13, decay: 0.19 },
    { ratio: 3, amplitude: 0.04, decay: 0.1 },
    { ratio: 4, amplitude: 0.01, decay: 0.06 },
  ];
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    const attack = 1 - Math.exp(-t / 0.0025);
    const release = Math.min(1, (duration - t) / 0.03);
    let value = 0;
    for (const p of partials) {
      if (hz * p.ratio >= sampleRate / 2) continue;
      value +=
        p.amplitude *
        Math.sin(2 * Math.PI * hz * p.ratio * t) *
        Math.exp(-t / p.decay);
    }
    samples[i] = value * attack * release;
  }
  return samples;
}
