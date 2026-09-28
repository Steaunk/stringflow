import { test } from "node:test";
import assert from "node:assert/strict";
import { ListeningAnalyzer, targetMatch } from "../src/listening.ts";
import type { ListeningFrame } from "../src/listening.ts";
import { ScoreFollower } from "../src/follower.ts";
import { frequency } from "../src/music.ts";
const wave = (notes: number[], rate = 48000) =>
  Float32Array.from({ length: 8192 }, (_, i) =>
    notes.reduce(
      (sum, n) =>
        sum +
        (0.1 * Math.sin((2 * Math.PI * frequency(n) * i) / rate) +
          0.045 * Math.sin((4 * Math.PI * frequency(n) * i) / rate) +
          0.02 * Math.sin((6 * Math.PI * frequency(n) * i) / rate)) /
          Math.sqrt(notes.length),
      0,
    ),
  );
const frame = (pitches: number[], peak = 0.1): ListeningFrame => ({
  pitches,
  peak,
  rms: peak * 0.7,
  strengths: Object.fromEntries(pitches.map((n) => [n, peak])),
});

test("actual multi-note spectra match source chords with tuning and capo applied", () => {
  const analyzer = new ListeningAnalyzer();
  for (const rate of [44100, 48000])
    for (const notes of [
      [41, 48, 60],
      [43, 50, 59],
      [45, 52, 60],
      [67, 74, 79],
    ]) {
      const result = analyzer.analyze(wave(notes, rate), rate);
      assert.ok(
        targetMatch(result, notes),
        `${notes} detected ${result.pitches} at ${rate}`,
      );
    }
  assert.equal(
    targetMatch(analyzer.analyze(wave([42, 49, 61]), 48000), [41, 48, 60]),
    false,
  );
});
test("single-note harmonics, quiet input and noise do not become chords", () => {
  const analyzer = new ListeningAnalyzer();
  assert.deepEqual(analyzer.analyze(wave([40]), 48000).pitches, [40]);
  assert.equal(
    targetMatch(analyzer.analyze(wave([40]), 48000), [40, 47, 55]),
    false,
  );
  assert.deepEqual(analyzer.analyze(new Float32Array(8192), 48000).pitches, []);
  let seed = 12;
  const noise = Float32Array.from({ length: 8192 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 2147483648 - 1) * 0.1;
  });
  assert.deepEqual(analyzer.analyze(noise, 48000).pitches, []);
});
test("holding a chord does not consume following constituent notes, but a new strike does", () => {
  const follower = new ScoreFollower(),
    chord = frame([41, 48, 60]);
  assert.equal(follower.update(chord, [41, 48, 60], false, 1000), false);
  assert.equal(follower.update(chord, [41, 48, 60], false, 1070), true);
  for (let now = 1100; now < 2000; now += 40)
    assert.equal(follower.update(chord, [60], false, now), false);
  follower.update(frame([41, 48, 60], 0.03), [60], false, 2000);
  assert.equal(follower.update(frame([60], 0.1), [60], false, 2100), false);
  assert.equal(follower.update(frame([60], 0.1), [60], false, 2170), true);
});
test("legato pitch changes progress without requiring a silent gap", () => {
  const follower = new ScoreFollower();
  follower.update(frame([60]), [60], false, 1000);
  assert.equal(follower.update(frame([60]), [60], false, 1070), true);
  follower.update(frame([62]), [62], false, 1200);
  assert.equal(follower.update(frame([62]), [62], false, 1270), true);
});
test("percussion needs a fresh attack, while silence and a held tone never advance it", () => {
  const follower = new ScoreFollower();
  follower.update(frame([60]), [60], false, 1000);
  follower.update(frame([60]), [60], false, 1070);
  for (let now = 1200; now < 1800; now += 40)
    assert.equal(follower.update(frame([60]), [], true, now), false);
  assert.equal(follower.update(frame([], 0), [], true, 1800), false);
  assert.equal(follower.update(frame([], 0), [], true, 1900), false);
  assert.equal(follower.update(frame([], 0.2), [], true, 2000), true);
  assert.equal(follower.update(frame([], 0.2), [], true, 2200), false);
});

test("opening the microphone on steady input is not a percussion attack", () => {
  const follower = new ScoreFollower();
  assert.equal(follower.update(frame([], 0.1), [], true, 1000), false);
  assert.equal(follower.update(frame([], 0.1), [], true, 1100), false);
  assert.equal(follower.update(frame([], 0.2), [], true, 1200), true);
  follower.reset();
  assert.equal(follower.update(frame([], 0.2), [], true, 1300), false);
});
