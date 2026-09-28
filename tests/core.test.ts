import { test } from "node:test";
import assert from "node:assert/strict";
import { centsFrom, frequency, noteName, parseNote } from "../src/music.ts";
import {
  ASCII_EXAMPLE,
  DEMOS,
  beatsPerBar,
  eventPitch,
  parseScore,
  starts,
  validateScore,
} from "../src/score.ts";
import { detectPitch } from "../src/pitch.ts";
import { Follower } from "../src/follower.ts";

test("pitch conversions and accidental notation", () => {
  assert.equal(parseNote("E2"), 40);
  assert.equal(parseNote("Bb3"), 58);
  assert.equal(parseNote("F#2"), 42);
  assert.equal(noteName(38), "D2");
  assert.equal(frequency(69), 440);
  assert.equal(centsFrom(440, 69), 0);
  assert.throws(() => parseNote("<script>"));
});
test("tuning, capo and string indexing determine sounding pitch", () => {
  const score = DEMOS[2];
  assert.equal(eventPitch(score, { string: 6, fret: 0 }), 40);
  assert.equal(eventPitch(score, { string: 1, fret: 3 }), 67);
  assert.equal(beatsPerBar(score), 3);
  assert.equal(starts(score)[6], 3);
});
test("all demo scores round trip through validated JSON", () => {
  for (const demo of DEMOS)
    assert.deepEqual(parseScore(JSON.stringify(demo)), demo);
});
test("ASCII supports tuning, capo, multi-digit frets, and aligned chords", () => {
  const s = parseScore(ASCII_EXAMPLE);
  assert.equal(s.events.length, 4);
  assert.deepEqual(s.events[0], { beats: 1, notes: [{ string: 1, fret: 0 }] });
  const text =
    "@title Drop D\n@tuning D2 A2 D3 G3 B3 E4\n@capo 2\n@step 1\ne|--10--12--10--12--|\nB|--10--12--10--12--|\nG|------------------|\nD|------------------|\nA|------------------|\nE|------------------|";
  const altered = parseScore(text);
  assert.equal(altered.tuning[0], 38);
  assert.equal(altered.capo, 2);
  assert.equal(altered.events[0].notes.length, 2);
  assert.equal(altered.events[0].notes[0].fret, 10);
});
test("reject malformed scores and ambiguous text rhythm", () => {
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
  assert.throws(() =>
    parseScore(ASCII_EXAMPLE.replace("@step 1", "@step 0.5")),
  );
  assert.throws(() => parseScore(ASCII_EXAMPLE.replace("--0--1", "--0h-1")));
  assert.throws(() =>
    parseScore(ASCII_EXAMPLE.replace("B|--------------|", "B|--|")),
  );
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
test("follower requires stable correct pitches; sustained same note cannot run ahead", () => {
  const f = new Follower(),
    e = frequency(40);
  assert.equal(f.update(e, 0.1, 40, 1000), false);
  assert.equal(f.update(e, 0.1, 40, 1120), true);
  for (let t = 1200; t <= 2000; t += 100)
    assert.equal(f.update(e, 0.1, 40, t), false);
  f.update(null, 0, 40, 2100);
  f.update(null, 0, 40, 2220);
  assert.equal(f.update(e, 0.1, 40, 2300), false);
  assert.equal(f.update(e, 0.1, 40, 2420), true);
  assert.equal(f.update(frequency(42), 0.1, 42, 2500), false);
  assert.equal(f.update(frequency(42), 0.1, 42, 2620), true);
  f.reset();
  assert.equal(f.update(frequency(41), 0.1, 40, 3000), false);
  assert.equal(f.update(frequency(41), 0.1, 40, 3200), false);
});
test("follower permits a fresh attack on repeated notes without a full silence", () => {
  const f = new Follower(),
    hz = frequency(50);
  f.update(hz, 0.1, 50, 1000);
  assert.equal(f.update(hz, 0.1, 50, 1150), true);
  f.update(hz, 0.03, 50, 1200);
  f.update(hz, 0.12, 50, 1300);
  assert.equal(f.update(hz, 0.11, 50, 1450), true);
});
