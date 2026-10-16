import { test } from "node:test";
import assert from "node:assert/strict";
import { centsFrom, frequency, noteName } from "../src/music.ts";
import {
  DEMOS,
  beatsPerBar,
  eventPitch,
  starts,
  validateScore,
} from "../src/score.ts";
import { detectPitch } from "../src/pitch.ts";

test("pitch conversions and note naming", () => {
  assert.equal(noteName(38), "D2");
  assert.equal(frequency(69), 440);
  assert.equal(centsFrom(440, 69), 0);
});
test("tuning, capo and string indexing determine sounding pitch", () => {
  const score = DEMOS[2];
  assert.equal(eventPitch(score, { string: 6, fret: 0 }), 40);
  assert.equal(eventPitch(score, { string: 1, fret: 3 }), 67);
  assert.equal(beatsPerBar(score), 3);
  assert.equal(starts(score)[6], 3);
});
test("all built-in practice scores contain valid structured data", () => {
  for (const demo of DEMOS) assert.deepEqual(validateScore(demo), demo);
});
test("reject malformed built-in score data", () => {
  const bad = [
    { bpm: 0 },
    { tuning: [40] },
    { capo: 13 },
    { timeSignature: [0, 4] },
    { events: [] },
    { events: [{ beats: -1, notes: [] }] },
    { events: [{ beats: 1, notes: [{ string: 7, fret: 0 }] }] },
    {
      events: [
        {
          beats: 1,
          notes: [
            { string: 1, fret: 0 },
            { string: 1, fret: 2 },
          ],
        },
      ],
    },
  ];
  for (const patch of bad)
    assert.throws(() => validateScore({ ...DEMOS[0], ...patch }));
});
test("YIN finds guitar fundamentals at 44.1 and 48 kHz with strong harmonics", () => {
  for (const rate of [44100, 48000])
    for (const midi of [28, 38, 40, 45, 50, 55, 59, 64, 76, 88]) {
      const hz = frequency(midi);
      const data = Float32Array.from(
        { length: 4096 },
        (_, i) =>
          0.13 * Math.sin((2 * Math.PI * hz * i) / rate) +
          0.18 * Math.sin((4 * Math.PI * hz * i) / rate) +
          0.07 * Math.sin((6 * Math.PI * hz * i) / rate),
      );
      const p = detectPitch(data, rate);
      assert.ok(p, `No pitch for ${midi} at ${rate}`);
      assert.ok(
        Math.abs(centsFrom(p.hz, midi)) < 5,
        `Pitch ${midi} detected ${p.hz}`,
      );
    }
});
test("YIN rejects silence and deterministic broadband noise", () => {
  assert.equal(detectPitch(new Float32Array(4096), 48000), null);
  let seed = 42;
  const noise = Float32Array.from({ length: 4096 }, () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return (seed / 4294967296 - 0.5) * 0.4;
  });
  assert.equal(detectPitch(noise, 48000), null);
});
