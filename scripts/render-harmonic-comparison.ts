import { mkdirSync, writeFileSync } from "node:fs";
import { harmonicSamples } from "../src/harmonics.ts";
import { frequency } from "../src/music.ts";

// Frozen reference from 7b234bf, only used to render the before/after demonstration.
function previousHarmonic(hz: number, rate: number) {
  const duration = Math.max(1.4, Math.min(2.8, 0.8 + 900 / hz));
  const wave = new Float32Array(Math.ceil(duration * rate));
  const partials = [
    [1, 0.82, 0.48],
    [2, 0.13, 0.19],
    [3, 0.04, 0.1],
    [4, 0.01, 0.06],
  ];
  for (let i = 0; i < wave.length; i++) {
    const t = i / rate;
    for (const [ratio, amplitude, decay] of partials)
      if (hz * ratio < rate / 2)
        wave[i] +=
          amplitude *
          Math.sin(2 * Math.PI * hz * ratio * t) *
          Math.exp(-t / decay);
    wave[i] *= (1 - Math.exp(-t / 0.0025)) * Math.min(1, (duration - t) / 0.03);
  }
  return wave;
}
const rate = 44100;
function render(kind: "before" | "after") {
  const output = new Float32Array(rate * 10);
  const notes = [72, 74, 79];
  notes.forEach((midi, n) => {
    const wave =
      kind === "before"
        ? previousHarmonic(frequency(midi), rate)
        : harmonicSamples(frequency(midi), rate, "tap", 3 - n);
    // Match each isolated note's first 700 ms RMS so louder isn't confused with better.
    const count = Math.round(rate * 0.7);
    const rms = Math.sqrt(
      wave.slice(0, count).reduce((s, v) => s + v * v, 0) / count,
    );
    const gain = 0.07 / rms;
    for (const [at, volume] of [
      [0.15 + n * 1.65, gain],
      [5.4, gain / Math.sqrt(3)],
    ]) {
      const start = Math.round(at * rate);
      const end = Math.min(
        wave.length,
        Math.round(rate * (at < 5 ? 1.45 : 4.5)),
      );
      for (let i = 0; i < end && start + i < output.length; i++)
        output[start + i] +=
          wave[i] * volume * Math.min(1, (end - i) / (rate * 0.025));
    }
  });
  const wav = Buffer.alloc(44 + output.length * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(output.length * 2, 40);
  let peak = 0;
  output.forEach((v, i) => {
    peak = Math.max(peak, Math.abs(v));
    if (Math.abs(v) > 1) throw new Error("Comparison clips");
    wav.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  });
  mkdirSync("public/audio", { recursive: true });
  writeFileSync(`public/audio/harmonic-${kind}.wav`, wav);
  console.log(`${kind}: C5 / D5 / G5 / chord, 10 s, peak ${peak.toFixed(3)}`);
}
render("before");
render("after");
