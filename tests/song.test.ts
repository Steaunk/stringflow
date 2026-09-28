import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SOMETHING_JUST_LIKE_THIS as song,
  songBars,
} from "../src/songs/something-just-like-this.ts";
import { eventPitch, parseScore, validateScore } from "../src/score.ts";
import { noteName } from "../src/music.ts";

test("supplied arrangement has 101 complete measures including the final whole-bar rest", () => {
  const bars = songBars();
  assert.equal(bars.length, 101);
  for (const [index, bar] of bars.entries())
    assert.equal(
      bar.reduce((n, e) => n + e.beats, 0),
      4,
      `Measure ${index + 1}`,
    );
  assert.equal(
    song.events.reduce((n, e) => n + e.beats, 0),
    404,
  );
  assert.deepEqual(bars[100], [{ beats: 4, notes: [] }]);
  assert.deepEqual(validateScore(song), song);
});
test("source tuning and capo map to C G D G A D before capo and F C G C D G after capo", () => {
  assert.equal(song.bpm, 112);
  assert.deepEqual(song.timeSignature, [4, 4]);
  assert.equal(song.capo, 5);
  assert.deepEqual(song.tuning.map(noteName), [
    "C2",
    "G2",
    "D3",
    "G3",
    "A3",
    "D4",
  ]);
  assert.deepEqual(
    song.tuning.map((n) => noteName(n + song.capo)),
    ["F2", "C3", "G3", "C4", "D4", "G4"],
  );
  assert.equal(eventPitch(song, { string: 6, fret: 0 }), 41);
  assert.equal(
    eventPitch(song, { string: 1, fret: 12, technique: "harmonic" }),
    79,
  );
});
test("notation preserves opening rhythm, ghost notes, 12th-fret harmonics, and nonpitched attacks", () => {
  const bars = songBars();
  assert.deepEqual(
    bars[0].map((e) => e.beats),
    [1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
  );
  assert.equal(bars[4][0].beats, 1.5);
  assert.equal(bars[1][1].notes[0].ghost, true);
  assert.ok(bars[28][1].notes.every((n) => n.technique === "muted"));
  assert.deepEqual(
    bars[28][2].notes.map((n) => [n.string, n.fret, n.technique]),
    [
      [1, 12, "harmonic"],
      [2, 12, "harmonic"],
      [3, 12, "harmonic"],
    ],
  );
  assert.equal(bars[85].at(-1)?.beats, 1);
  assert.equal(bars[99].at(-1)?.beats, 1);
  assert.deepEqual(parseScore(JSON.stringify(song)), song);
});
test("import rejects unsupported special-note metadata", () => {
  const invalid = (patch: Record<string, unknown>) => ({
    ...song,
    events: [{ beats: 4, notes: [{ string: 1, fret: 12, ...patch }] }],
  });
  assert.throws(() => validateScore(invalid({ technique: "invalid" })));
  assert.throws(() =>
    validateScore(invalid({ technique: "harmonic", fret: 7 })),
  );
  assert.throws(() => validateScore(invalid({ ghost: "true" })));
  assert.throws(() =>
    validateScore({ ...song, barAnnotations: { 1: "x".repeat(121) } }),
  );
});
