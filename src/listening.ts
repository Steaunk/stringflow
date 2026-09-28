import { detectPitch } from "./pitch.ts";
import { midiFromHz } from "./music.ts";
export interface ListeningFrame {
  rms: number;
  peak: number;
  pitches: number[];
  strengths: Record<number, number>;
}
/** Windowed spectrum for score-guided following; YIN remains the tuner estimator. */
export class ListeningAnalyzer {
  private real = new Float64Array(8192);
  private imaginary = new Float64Array(8192);
  private window = Float64Array.from(
    { length: 8192 },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 8191),
  );
  analyze(samples: Float32Array, sampleRate: number): ListeningFrame {
    const n = 8192,
      re = this.real,
      im = this.imaginary;
    let energy = 0,
      peak = 0;
    for (
      let start = Math.max(0, samples.length - 2048);
      start < samples.length;
      start += 256
    ) {
      let block = 0;
      for (let i = start; i < Math.min(start + 256, samples.length); i++)
        block += samples[i] ** 2;
      energy += block;
      peak = Math.max(peak, Math.sqrt(block / 256));
    }
    const rms = Math.sqrt(energy / Math.min(2048, samples.length));
    const frame: ListeningFrame = { rms, peak, pitches: [], strengths: {} };
    if (rms < 0.0025) return frame;
    for (let i = 0; i < n; i++) {
      re[i] = (samples[i] ?? 0) * this.window[i];
      im[i] = 0;
    }
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) [re[i], re[j]] = [re[j], re[i]];
    }
    for (let size = 2; size <= n; size *= 2) {
      const angle = (-2 * Math.PI) / size,
        wr = Math.cos(angle),
        wi = Math.sin(angle);
      for (let start = 0; start < n; start += size) {
        let ur = 1,
          ui = 0;
        for (let j = 0; j < size / 2; j++) {
          const a = start + j,
            b = a + size / 2,
            tr = ur * re[b] - ui * im[b],
            ti = ur * im[b] + ui * re[b];
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
          const next = ur * wr - ui * wi;
          ui = ur * wi + ui * wr;
          ur = next;
        }
      }
    }
    const limit = Math.min(n / 2 - 1, Math.ceil((3500 * n) / sampleRate));
    let total = 0;
    for (let i = 1; i <= limit + 1; i++) {
      re[i] = (Math.hypot(re[i], im[i]) * 4) / n;
      total += re[i] ** 2;
    }
    const peaks: { hz: number; amplitude: number }[] = [];
    for (
      let i = Math.max(2, Math.floor((35 * n) / sampleRate));
      i < limit;
      i++
    ) {
      if (re[i] < re[i - 1] || re[i] <= re[i + 1]) continue;
      const a = Math.log(re[i - 1] + 1e-12),
        b = Math.log(re[i] + 1e-12),
        c = Math.log(re[i + 1] + 1e-12);
      const shift = Math.max(
        -0.5,
        Math.min(0.5, (0.5 * (a - c)) / (a - 2 * b + c)),
      );
      peaks.push({ hz: ((i + shift) * sampleRate) / n, amplitude: re[i] });
    }
    peaks.sort((a, b) => b.amplitude - a.amplitude);
    if (
      !peaks.length ||
      peaks.slice(0, 12).reduce((sum, p) => sum + p.amplitude ** 2, 0) /
        Math.max(total, 1e-12) <
        0.24
    )
      return frame;
    const strong = peaks
      .filter((p) => p.amplitude > Math.max(0.002, peaks[0].amplitude * 0.08))
      .slice(0, 24);
    const mono = detectPitch(
      samples.subarray(Math.max(0, samples.length - 4096)),
      sampleRate,
    );
    // A pure note's partials must not be mistaken for independent chord tones.
    if (
      mono &&
      strong.some((p) => Math.abs(1200 * Math.log2(p.hz / mono.hz)) < 45) &&
      strong.every(
        (p) => Math.abs(p.hz / mono.hz - Math.round(p.hz / mono.hz)) < 0.035,
      )
    ) {
      const midi = Math.round(midiFromHz(mono.hz));
      if (Math.abs(midiFromHz(mono.hz) - midi) < 0.45) {
        frame.pitches = [midi];
        frame.strengths[midi] = rms;
      }
      return frame;
    }
    for (const p of strong.sort((a, b) => a.hz - b.hz)) {
      const midi = midiFromHz(p.hz),
        rounded = Math.round(midi);
      if (rounded < 28 || rounded > 100 || Math.abs(midi - rounded) > 0.45)
        continue;
      const lower = strong.find(
        (q) =>
          q.hz < p.hz * 0.8 &&
          Math.abs(p.hz / q.hz - Math.round(p.hz / q.hz)) < 0.025 &&
          p.amplitude < q.amplitude * 0.7,
      );
      if (lower) continue;
      frame.strengths[rounded] = Math.max(
        frame.strengths[rounded] ?? 0,
        p.amplitude,
      );
    }
    frame.pitches = Object.keys(frame.strengths).map(Number);
    return frame;
  }
}
export function targetMatch(frame: ListeningFrame, expected: number[]) {
  const target = [...new Set(expected)].sort((a, b) => a - b);
  if (!target.length) return false;
  if (target.length === 1) return frame.pitches.includes(target[0]);
  const classes = [...new Set(target.map((n) => n % 12))];
  const heard = new Set(frame.pitches.map((n) => n % 12));
  // Chord following checks the bass and most pitch classes, not fingering correctness.
  return (
    frame.pitches.includes(target[0]) &&
    classes.filter((n) => heard.has(n)).length >=
      Math.max(Math.min(2, classes.length), Math.ceil(classes.length * 0.67))
  );
}
