import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SOMETHING_JUST_LIKE_THIS as song,
  songBars,
} from "../src/songs/something-just-like-this.ts";
import {
  connections,
  strokeNotes,
  techniqueMarkup,
} from "../src/techniques.ts";
import { parseScore, validateScore, starts } from "../src/score.ts";
import { rhythmMarkup } from "../src/notation.ts";
import { percussionSamples } from "../src/percussion.ts";

const at = (bar: number, beat: number) => {
  let t = 0;
  return songBars()[bar - 1].find((e) => {
    const match = t === beat;
    t += e.beats;
    return match;
  })!;
};
test("source arcs, strum arrows, PM and body tap are attached to exact notes and beats", () => {
  assert.equal(at(8, 2.25).notes.find((n) => n.string === 2)?.link, "hammer");
  assert.equal(at(9, 3).notes[0].link, "pull");
  // Bar 56 checked against the enlarged original: no high open string on beat 3,
  // and only strings 5/6 are muted on beat 4. Each group below is one onset.
  const bar56 = songBars()[55];
  assert.deepEqual(
    bar56.map((e) => e.beats),
    [1, 0.5, 0.25, 0.25, 0.5, 0.5, 0.5, 0.5],
  );
  assert.deepEqual(
    bar56.map((e) =>
      e.notes.map((n) => [n.string, n.technique === "muted" ? "x" : n.fret]),
    ),
    [
      [
        [4, 5],
        [5, 4],
        [6, 4],
      ],
      [
        [4, 5],
        [5, 4],
        [6, 4],
      ],
      [
        [3, 0],
        [4, 5],
        [5, 4],
      ],
      [[3, 4]],
      [
        [2, 0],
        [3, 4],
        [4, 5],
        [5, 4],
      ],
      [
        [2, 0],
        [3, 0],
        [4, 5],
        [5, 4],
      ],
      [
        [1, 7],
        [2, 0],
        [3, 0],
        [5, "x"],
        [6, "x"],
      ],
      [[1, 5]],
    ],
  );
  assert.equal(at(56, 1.75).notes[0].link, "hammer");
  assert.equal(at(56, 3.5).notes[0].link, "slide");
  // P.M. positions read from all three printed pages, including both missed starts.
  const expectedPM = new Map<number, number[]>();
  for (const bar of [29, 31, 33, 35, 53, 55, 57, 59, 87, 89, 91])
    expectedPM.set(bar, [0, 1.5, 2, 3.5]);
  for (const bar of [30, 34, 54, 58, 86, 90]) expectedPM.set(bar, [0, 2.5]);
  for (const bar of [36, 56, 60, 88, 92]) expectedPM.set(bar, [0]);
  expectedPM.set(85, [0, 1.5, 3.5]);
  for (const [i, bar] of songBars().entries()) {
    let beat = 0;
    const actual: number[] = [];
    for (const e of bar) {
      if (e.palmMute) actual.push(beat);
      beat += e.beats;
    }
    assert.deepEqual(
      actual,
      expectedPM.get(i + 1) ?? [],
      `P.M. in bar ${i + 1}`,
    );
  }
  for (const bar of [32, 56, 88]) {
    for (const beat of bar === 56 ? [3] : [1, 3]) {
      assert.deepEqual(
        at(bar, beat)
          .notes.filter((n) => n.technique === "muted")
          .map((n) => n.string),
        [5, 6],
      );
    }
  }
  assert.equal(at(29, 0).palmMute, true);
  assert.equal(at(29, 1).palmMute, undefined);
  assert.equal(at(29, 0.5).percussion, "string-slap");
  assert.equal(at(85, 3).percussion, "body-tap");
  assert.equal(at(30, 1.5).strum, "down");
  assert.equal(at(30, 2).strum, "up");
  assert.equal(at(53, 0.5).percussion, "string-slap");
  assert.equal(at(52, 1.75).notes.find((n) => n.string === 2)?.link, "hammer");
  assert.equal(song.letRing, true);
  assert.deepEqual(parseScore(JSON.stringify(song)), song);
});
test("chord slide across bar 87/88 retains three independent source pitches and both drawn halves", () => {
  const timeline = starts(song),
    links = connections(song);
  const cross = links.filter((l) => timeline[l.to] === 87 * 4);
  assert.deepEqual(
    cross.map((l) => [l.string, l.fromFret, l.toFret]),
    [
      [4, 4, 5],
      [5, 2, 4],
      [6, 2, 4],
    ],
  );
  for (const b of [86, 87]) {
    const html = techniqueMarkup(song, timeline, b, 4, links);
    for (const l of cross)
      assert.ok(
        html.includes(
          `data-link-from="${l.from}" data-link-to="${l.to}" data-link-string="${l.string}"`,
        ),
      );
  }
});
test("strumming follows physical string order in both directions with staggered attacks", () => {
  const chord = {
    beats: 1,
    notes: [
      { string: 2, fret: 0 },
      { string: 6, fret: 0 },
      { string: 4, fret: 0 },
    ],
  };
  assert.deepEqual(
    strokeNotes({ ...chord, strum: "down" }).map((s) => [
      s.note.string,
      s.offset,
    ]),
    [
      [6, 0],
      [4, 0.012],
      [2, 0.024],
    ],
  );
  assert.deepEqual(
    strokeNotes({ ...chord, strum: "up" }).map((s) => s.note.string),
    [2, 4, 6],
  );
  assert.ok(strokeNotes(chord).every((s) => s.offset === 0));
});
test("invalid technique metadata and impossible legato links are rejected", () => {
  const base = {
    ...song,
    events: [
      { beats: 1, notes: [{ string: 1, fret: 2 }] },
      { beats: 1, notes: [{ string: 1, fret: 4, link: "hammer" }] },
    ],
  };
  assert.doesNotThrow(() => validateScore(base));
  for (const patch of [
    { link: "pull" },
    { link: "tie" },
    { link: "oops" },
    { link: "slide", fret: 2 },
    { link: "hammer", technique: "muted" },
  ]) {
    assert.throws(() =>
      validateScore({
        ...base,
        events: [
          base.events[0],
          { beats: 1, notes: [{ string: 1, fret: 4, ...patch }] },
        ],
      }),
    );
  }
  assert.throws(() => validateScore({ ...base, events: [base.events[1]] }));
  for (const patch of [
    { strum: "left" },
    { palmMute: "yes" },
    { percussion: "kick" },
  ])
    assert.throws(() =>
      validateScore({ ...base, events: [{ ...base.events[0], ...patch }] }),
    );
});
test("body tap has resonant low energy, distinct from short broadband string attacks", () => {
  const rate = 48000,
    body = percussionSamples("body-tap", rate),
    slap = percussionSamples("string-slap", rate),
    mute = percussionSamples("muted", rate);
  const roughness = (a: Float32Array) => {
    let delta = 0,
      energy = 0;
    for (let i = 1; i < 2400; i++) {
      delta += (a[i] - a[i - 1]) ** 2;
      energy += a[i] ** 2;
    }
    return delta / energy;
  };
  assert.ok(body.length > slap.length && slap.length > mute.length);
  assert.ok(roughness(body) < roughness(slap) * 0.1);
  for (const a of [body, slap, mute])
    assert.ok(a.every((v) => Number.isFinite(v) && Math.abs(v) < 1));
});

test("a standalone body tap is an attack rather than a rest", () => {
  const event = { beats: 0.5, notes: [], percussion: "body-tap" as const };
  assert.doesNotThrow(() => validateScore({ ...song, events: [event] }));
  const html = rhythmMarkup([{ event, beat: 0 }], 0, 4, [4, 4]);
  assert.ok(!html.includes("rhythm-rest"));
  assert.ok(html.includes("rhythm-stem"));
});

test("muted-string brush has continuous contact and no repeated 12ms noise pattern", async () => {
  const { mutedBrushSamples } = await import("../src/percussion.ts");
  for (const rate of [44100, 48000]) {
    const w = mutedBrushSamples(rate, 3, 0.024),
      lag = Math.round(rate * 0.012);
    let xy = 0,
      xx = 0,
      yy = 0;
    for (let i = Math.round(rate * 0.003); i < Math.round(rate * 0.03); i++) {
      xy += w[i] * w[i + lag];
      xx += w[i] ** 2;
      yy += w[i + lag] ** 2;
    }
    assert.ok(Math.abs(xy / Math.sqrt(xx * yy)) < 0.15);
    assert.ok(w.every((v) => Number.isFinite(v) && Math.abs(v) < 1));
    assert.equal(w[0], 0);
    assert.ok(Math.abs(w.at(-1)!) < 0.00001);
  }
});
