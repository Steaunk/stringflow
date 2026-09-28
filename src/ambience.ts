/** Synthetic stereo room response: predelay, sparse early reflections, diffuse tail.
 * Separate left/right tails add space without pitch shifting or an octave shimmer.
 * Unit-energy normalization makes wet gain independent of sample rate.
 * This is not an IR from the source performance or an emulation of a named pedal.
 */
export function harmonicRoomImpulse(
  rate: number,
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  return [0, 1].map((channel) => {
    const duration = 3.2,
      delay = 0.022;
    const wave = new Float32Array(Math.ceil(rate * duration));
    let seed = 1979 + channel * 7919,
      smooth = 0,
      bass = 0;
    const lowpass = 1 - Math.exp((-2 * Math.PI * 5500) / rate),
      highpass = 1 - Math.exp((-2 * Math.PI * 350) / rate);
    for (let i = Math.ceil(delay * rate); i < wave.length; i++) {
      const t = i / rate - delay;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      smooth += lowpass * (seed / 2147483648 - 1 - smooth);
      bass += highpass * (smooth - bass);
      wave[i] =
        (smooth - bass) *
        (1 - Math.exp(-t / 0.035)) *
        Math.exp((-6.9078 * t) / 2.8) *
        Math.min(1, (duration - i / rate) / 0.06);
    }
    const norm = Math.sqrt(wave.reduce((s, v) => s + v * v, 0));
    for (let i = 0; i < wave.length; i++) wave[i] *= 0.85 / norm;
    for (const [time, level] of [
      [0.029, 0.24],
      [0.047, 0.17],
      [0.071, 0.12],
    ])
      wave[Math.round((time + channel * 0.003) * rate)] += level;
    return wave;
  }) as [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>];
}
