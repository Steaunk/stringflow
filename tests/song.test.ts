import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  SOMETHING_JUST_LIKE_THIS as song,
  songBars,
  refreshSavedArrangement,
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
  const harmonics = song.events
    .flatMap((e) => e.notes)
    .filter((n) => n.technique === "harmonic");
  assert.ok(harmonics.every((n) => n.harmonicAttack === "tap"));
  assert.deepEqual(
    [...new Set(harmonics.map((n) => eventPitch(song, n)))].sort(
      (a, b) => a - b,
    ),
    [72, 74, 79],
  );
  assert.equal(bars[85].at(-1)?.beats, 1);
  assert.equal(bars[99].at(-1)?.beats, 0.5);
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
  assert.throws(() => validateScore(invalid({ harmonicAttack: "tap" })));
  assert.throws(() =>
    validateScore(
      invalid({ technique: "harmonic", harmonicAttack: "invalid" }),
    ),
  );
  assert.equal(
    validateScore(invalid({ technique: "harmonic" })).events[0].notes[0]
      .harmonicAttack,
    undefined,
  );
  assert.throws(() =>
    validateScore({ ...song, barAnnotations: { 1: "x".repeat(121) } }),
  );
});

// Positions transcribed independently from the printed PDF; beats below start at zero.
test("PDF audit preserves bar 19 melody alignment and the sparse bass in bars 10, 43 and 65", () => {
  const bars = songBars();
  const onString = (bar: number, string: number) => {
    let beat = 0;
    const result: number[][] = [];
    for (const e of bars[bar - 1]) {
      for (const n of e.notes)
        if (n.string === string) result.push([beat, n.fret]);
      beat += e.beats;
    }
    return result;
  };
  assert.deepEqual(onString(19, 3), [
    [1.5, 2],
    [2, 2],
    [2.5, 2],
  ]);
  assert.deepEqual(onString(19, 2), [
    [0, 3],
    [3, 3],
    [3.5, 2],
  ]);
  assert.deepEqual(onString(19, 6), [
    [0, 0],
    [0.5, 0],
    [1, 0],
    [1.5, 0],
    [2, 0],
    [2.5, 2],
    [3, 2],
    [3.5, 2],
  ]);
  assert.deepEqual(onString(10, 6), [
    [0, 4],
    [2.5, 2],
  ]);
  assert.deepEqual(onString(43, 6), [
    [0, 0],
    [1, 0],
    [1.5, 0],
    [2, 0],
    [2.5, 2],
    [3, 2],
    [3.5, 2],
  ]);
  assert.deepEqual(onString(65, 6), [
    [0, 0],
    [1.5, 0],
    [2.5, 2],
    [3.5, 2],
  ]);
  assert.deepEqual(
    bars[99].map((e) => e.beats),
    Array(8).fill(0.5),
  );
  assert.deepEqual(onString(100, 3), [
    [1, 0],
    [2, 0],
    [3, 0],
  ]);
  assert.deepEqual(onString(100, 1), [[2.5, 0]]);
  assert.deepEqual(onString(100, 4), [
    [0, 5],
    [1.5, 5],
    [3.5, 4],
  ]);
  assert.deepEqual(onString(74, 3), [
    [0, 4],
    [1.5, 4],
    [2, 4],
    [2.5, 4],
    [3, 4],
    [3.5, 2],
  ]);
  assert.deepEqual(onString(74, 4), [[1, 0]]);
  assert.deepEqual(onString(74, 6), [
    [0, 4],
    [0.5, 4],
    [1, 4],
    [1.5, 4],
    [2, 4],
    [2.5, 2],
    [3, 2],
  ]);
  assert.ok(bars[73].every((e) => e.beats === 0.5));
  assert.equal(bars[73][7].notes[0].link, "pull");
  assert.equal(song.events.length, 823);
});
test("saved previous library score receives corrections while user note edits and tempo survive", () => {
  const previous = validateScore(
    JSON.parse(
      readFileSync(
        new URL("./fixtures/something-before-2026-09-29.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  previous.bpm = 90;
  const refreshed = refreshSavedArrangement(previous);
  assert.deepEqual(refreshed.events, song.events);
  assert.equal(refreshed.bpm, 90);
  assert.equal(previous.events.length, 822);
  const edited = structuredClone(previous);
  edited.events[0].notes[0].fret = 1;
  assert.deepEqual(refreshSavedArrangement(edited), edited);
  assert.equal(refreshSavedArrangement(song), song);
});

test("bars 46 and 51 preserve sparse bass attacks and all published copies upgrade safely", () => {
  const bar = songBars()[45];
  assert.deepEqual(bar[1], { beats: 0.5, notes: [{ string: 4, fret: 0 }] });
  assert.deepEqual(
    bar.map((e) => e.notes.find((n) => n.string === 6)?.fret ?? null),
    [4, null, 4, 4, 4, 2, 2, 2],
  );
  assert.deepEqual(songBars()[50][2], {
    beats: 0.25,
    notes: [{ string: 2, fret: 0 }],
  });
  const previous = structuredClone(song);
  let beat = 0;
  for (const event of previous.events) {
    if (beat === 73 * 4 + 0.5) event.notes.unshift({ string: 4, fret: 0 });
    if (beat === 73 * 4 + 1) event.notes[0] = { string: 3, fret: 4 };
    beat += event.beats;
  }
  previous.bpm = 89;
  assert.deepEqual(refreshSavedArrangement(previous).events, song.events);
  assert.equal(refreshSavedArrangement(previous).bpm, 89);
  const userEdit = structuredClone(previous);
  userEdit.events[0].notes[0].fret = 1;
  assert.deepEqual(refreshSavedArrangement(userEdit), userEdit);
  beat = 0;
  for (const event of previous.events) {
    if (beat === 55 * 4 || beat === 87 * 4) delete event.palmMute;
    if ([31 * 4 + 1, 31 * 4 + 3, 87 * 4 + 1, 87 * 4 + 3].includes(beat)) {
      const at = event.notes.findIndex((n) => n.string === 5);
      event.notes.splice(at, 0, { string: 4, fret: 0, technique: "muted" });
    }
    if (beat === 55 * 4 + 2 || beat === 55 * 4 + 2.5) {
      event.notes.unshift({ string: 1, fret: 0 });
      event.notes.find((n) => n.string === 3)!.fret = 0;
    }
    if (beat === 55 * 4 + 3)
      event.notes.splice(3, 0, { string: 4, fret: 0, technique: "muted" });
    beat += event.beats;
  }
  previous.barAnnotations![56] = "扫弦 · 击弦 · 滑音 · let ring";
  previous.barAnnotations![88] = "滑音 · 扫弦 · let ring";
  previous.barAnnotations![1] = "自定义说明";
  const refreshed = refreshSavedArrangement(previous);
  assert.deepEqual(refreshed.events, song.events);
  assert.equal(refreshed.barAnnotations![56], "let ring");
  assert.equal(refreshed.barAnnotations![88], "let ring");
  assert.equal(refreshed.barAnnotations![1], "自定义说明");
  beat = 0;
  for (const event of previous.events) {
    if (beat === 45 * 4 + 0.5) event.notes.push({ string: 6, fret: 4 });
    if (beat === 50 * 4 + 0.75) event.notes.push({ string: 6, fret: 0 });
    beat += event.beats;
  }
  previous.bpm = 85;
  assert.deepEqual(refreshSavedArrangement(previous).events, song.events);
  assert.equal(refreshSavedArrangement(previous).bpm, 85);
  previous.events[0].notes[0].fret = 1;
  assert.deepEqual(refreshSavedArrangement(previous), previous);
});
