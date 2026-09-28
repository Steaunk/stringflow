import { test } from "node:test";
import assert from "node:assert/strict";
import { harmonicSamples } from "../src/harmonics.ts";
import { frequency } from "../src/music.ts";
import { detectPitch } from "../src/pitch.ts";
import { ListeningAnalyzer, targetMatch } from "../src/listening.ts";

const energy = (
  wave: Float32Array,
  rate: number,
  start: number,
  duration: number,
  highpass = false,
) => {
  let sum = 0;
  const begin = Math.round(start * rate),
    count = Math.round(duration * rate);
  for (let i = begin; i < begin + count; i++) {
    const x = highpass ? wave[i] - (wave[i - 1] ?? 0) : wave[i];
    sum += x * x;
  }
  return sum / count;
};
test("tapped harmonics stay at C5 D5 G5 through the attack and ring at both device sample rates", () => {
  for (const rate of [44100, 48000]) {
    for (const [string, midi] of [
      [3, 72],
      [2, 74],
      [1, 79],
    ]) {
      const hz = frequency(midi),
        wave = harmonicSamples(hz, rate, "tap", string);
      for (const time of [0.12, 0.65]) {
        const pitch = detectPitch(
          wave.slice(Math.round(time * rate), Math.round(time * rate) + 4096),
          rate,
        );
        assert.ok(pitch);
        assert.ok(
          Math.abs(1200 * Math.log2(pitch.hz / hz)) < 4,
          `${midi} at ${time}`,
        );
      }
      assert.ok(
        energy(wave, rate, 1.3, 0.1) > energy(wave, rate, 0.1, 0.1) * 0.001,
      );
      assert.ok(
        energy(wave, rate, 2.3, 0.4) < energy(wave, rate, 0.1, 0.4) * 0.15,
      );
      assert.equal(wave[0], 0);
      assert.ok(Math.abs(wave.at(-1)!) < 0.00002);
      assert.ok(wave.every((v) => Number.isFinite(v) && Math.abs(v) <= 0.91));
    }
  }
});
test("tap contact is distinct from plucked harmonics and disappears into the pitched ring", () => {
  const rate = 48000,
    hz = frequency(79);
  const tapped = harmonicSamples(hz, rate, "tap", 1),
    plucked = harmonicSamples(hz, rate, "pluck", 1);
  const brightness = (w: Float32Array, t: number) =>
    energy(w, rate, t, 0.015, true) / energy(w, rate, t, 0.015);
  assert.ok(brightness(tapped, 0.001) > brightness(plucked, 0.001) * 1.15);
  assert.ok(brightness(tapped, 0.001) > brightness(tapped, 0.3) * 1.5);
});
test("the actual three-string harmonic chord remains recognizable by score following", () => {
  const rate = 48000,
    notes = [72, 74, 79],
    mixed = new Float32Array(8192);
  notes.forEach((midi, i) => {
    const wave = harmonicSamples(frequency(midi), rate, "tap", 3 - i);
    for (let j = 0; j < mixed.length; j++)
      mixed[j] += wave[j + 4800] / Math.sqrt(3);
  });
  const frame = new ListeningAnalyzer().analyze(mixed, rate);
  assert.ok(targetMatch(frame, notes), `heard ${frame.pitches}`);
  assert.equal(
    targetMatch(
      frame,
      notes.map((n) => n - 12),
    ),
    false,
  );
});

test("slap sustain is fundamental-led with weak higher partials and a separate short contact", () => {
  for (const rate of [44100, 48000])
    for (const [midi, string] of [
      [72, 3],
      [74, 2],
      [79, 1],
    ]) {
      const hz = frequency(midi),
        wave = harmonicSamples(hz, rate, "tap", string, false);
      const amplitude = (f: number) => {
        let re = 0,
          im = 0;
        const count = Math.round(rate * 0.12),
          start = Math.round(rate * 0.15);
        for (let i = 0; i < count; i++) {
          const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (count - 1));
          const phase = (2 * Math.PI * f * i) / rate;
          re += wave[start + i] * window * Math.cos(phase);
          im += wave[start + i] * window * Math.sin(phase);
        }
        return Math.hypot(re, im);
      };
      const fundamental = amplitude(hz);
      assert.ok(amplitude(hz * 2) / fundamental < 0.2);
      assert.ok(amplitude(hz * 3) / fundamental < 0.05);
      assert.ok(amplitude(hz / 2) / fundamental < 0.01);
      const full = harmonicSamples(hz, rate, "tap", string, true);
      assert.ok(
        energy(
          full.map((v, i) => v - wave[i]),
          rate,
          0,
          0.02,
        ) > 0.001,
      );
      for (let i = Math.round(0.16 * rate); i < wave.length; i++)
        assert.equal(full[i], wave[i]);
    }
});
