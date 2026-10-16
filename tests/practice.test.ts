import { test } from "node:test";
import assert from "node:assert/strict";
import { ScoreFollower } from "../src/follower.ts";
import {
  TimingPractice,
  practiceTargets,
  practiceScoreKey,
  reportMatchesScore,
} from "../src/practice.ts";
import type { ListeningFrame } from "../src/listening.ts";
import { DEMOS } from "../src/score.ts";
const frame = (
  pitches: number[],
  peak = 0.1,
  strengths?: Record<number, number>,
): ListeningFrame => ({
  pitches,
  peak,
  rms: peak * 0.7,
  strengths: strengths ?? Object.fromEntries(pitches.map((n) => [n, peak])),
});
const target = (index: number, pitch: number, beat = index) => ({
  index,
  pitches: [pitch],
  percussive: false,
  beat,
});

test("late partials and thinning chord tails cannot consume the next event", () => {
  const f = new ScoreFollower();
  f.update(frame([40]), [40], false, 1000);
  assert.equal(f.update(frame([40]), [40], false, 1070), true);
  for (let t = 1200; t < 1900; t += 40)
    assert.equal(f.update(frame([52], 0.03), [52], false, t), false);
  f.reset();
  f.update(frame([40, 47, 55]), [40, 47, 55, 59], false, 2000);
  assert.equal(
    f.update(frame([40, 47, 55]), [40, 47, 55, 59], false, 2070),
    true,
  );
  for (let t = 2200; t < 3000; t += 40)
    assert.equal(f.update(frame([59], 0.03), [59], false, t), false);
});
test("an unrelated attack does not reuse a sustaining target; a real restrike does", () => {
  const f = new ScoreFollower();
  f.update(frame([60]), [60], false, 1000);
  f.update(frame([60]), [60], false, 1070);
  f.update(frame([60], 0.02), [60], false, 1300);
  const other = frame([43, 60], 0.15, { 43: 0.15, 60: 0.02 });
  assert.equal(f.update(other, [60], false, 1400), false);
  assert.equal(f.update(other, [60], false, 1470), false);
  assert.equal(f.update(other, [60], false, 1700), false);
  f.update(frame([60], 0.01), [60], false, 1800);
  f.update(frame([60], 0.1), [60], false, 1900);
  assert.equal(f.update(frame([60], 0.1), [60], false, 1970), true);
});
test("nearby-score search recovers a missed note, then consumes that gesture only once", () => {
  const f = new ScoreFollower(),
    candidates = [target(1, 62), target(2, 64), target(3, 65)];
  f.update(frame([60]), [60], false, 1000);
  f.update(frame([60]), [60], false, 1070);
  assert.equal(f.locate(frame([64]), candidates, 1300), null);
  assert.equal(f.locate(frame([64]), candidates, 1370)?.index, 2);
  for (let t = 1450; t < 2000; t += 40)
    assert.equal(
      f.locate(frame([64]), [target(3, 64), target(4, 67)], t),
      null,
    );
});
test("clock-led practice records early/late/on-time and recovers after an unheard note", () => {
  const p = new TimingPractice(
    [target(0, 60), target(1, 62), target(2, 64), target(3, 65)],
    120,
    0,
    4,
  );
  p.update(frame([], 0), 800, -0.4);
  p.update(frame([60]), 900, -0.2);
  assert.equal(p.update(frame([60]), 970, -0.06)?.result, "early");
  p.update(frame([], 0), 1200, 0.4);
  p.update(frame([62]), 1620, 1.24);
  const late = p.update(frame([62]), 1690, 1.38);
  assert.equal(late?.result, "late");
  assert.equal(late?.offsetMs, 120);
  p.update(frame([], 0), 1850, 1.7);
  p.update(frame([65]), 2500, 3);
  const onTime = p.update(frame([65]), 2570, 3.14);
  assert.equal(onTime?.result, "on-time");
  assert.equal(onTime?.offsetMs, 0);
  assert.deepEqual(
    p.finish(4, true).map((r) => r.result),
    ["early", "late", "unheard", "on-time"],
  );
});
test("same-pitch timing locks the first candidate through confirmation; latency compensation is applied once", () => {
  const p = new TimingPractice(
    [target(0, 60), target(1, 60, 0.25)],
    120,
    0,
    1,
    50,
  );
  p.update(frame([], 0), 700, -0.6);
  p.update(frame([60]), 1040, 0.08);
  const matched = p.update(frame([60]), 1110, 0.22);
  assert.equal(matched?.index, 0);
  assert.equal(matched?.offsetMs, -10);
  p.update(frame([60]), 1200, 0.4);
  assert.equal(p.rows[1].result, "pending");
});
test("rests and tied continuations need no new attack; partial reports exclude future targets", () => {
  const score = structuredClone(DEMOS[0]);
  score.events = [
    { beats: 1, notes: [{ string: 1, fret: 0 }] },
    { beats: 1, notes: [{ string: 1, fret: 0, link: "tie" }] },
    { beats: 1, notes: [] },
    { beats: 1, notes: [{ string: 1, fret: 2, link: "hammer" }] },
  ];
  const targets = practiceTargets(score);
  assert.deepEqual(
    targets.map((t) => t.index),
    [0, 3],
  );
  assert.equal(targets[1].legato, true);
  const p = new TimingPractice(targets, 120, 0, 4);
  assert.deepEqual(
    p.finish(1, false).map((r) => r.index),
    [0],
  );
  assert.deepEqual(p.finish(-1, false), []);
});

test("loop boundaries preserve the onset gate, and early recognized notes survive a partial stop", () => {
  const gate = new ScoreFollower();
  const first = new TimingPractice([target(0, 60)], 120, 0, 1, 0, gate);
  first.update(frame([60]), 1000, 0);
  assert.ok(first.update(frame([60]), 1070, 0.14));
  const loop = new TimingPractice([target(0, 60)], 120, 0, 1, 0, gate);
  assert.equal(loop.update(frame([60]), 1500, 0), null);
  assert.equal(loop.update(frame([60]), 1570, 0.14), null);
  assert.equal(loop.finish(1, true)[0].result, "unheard");
  const early = new TimingPractice([target(0, 62, 1)], 120, 0, 2);
  early.update(frame([62]), 2000, 0.7);
  early.update(frame([62]), 2070, 0.84);
  assert.equal(early.finish(0.85, false)[0].result, "early");
});

test("late attacks remain eligible while their spectrum is being confirmed", () => {
  const p = new TimingPractice([target(0, 60)], 120, 0, 2);
  p.update(frame([], 0), 1000, 0);
  p.update(frame([]), 1150, 0.3);
  p.update(frame([60]), 1320, 0.64);
  const row = p.update(frame([60]), 1390, 0.78);
  assert.equal(row?.result, "late");
  assert.equal(row?.offsetMs, 150);
});

test("timing reports follow the score identity, not coincidentally matching note indices", () => {
  const score = structuredClone(DEMOS[0]);
  const rows = practiceTargets(score).map((t) => ({
    ...t,
    result: "on-time" as const,
    offsetMs: 0,
  }));
  const report = {
    title: score.title,
    scoreKey: practiceScoreKey(score),
    date: "",
    bpm: score.bpm,
    barBeats: 4,
    beatUnit: 1,
    startBeat: 0,
    endBeat: 32,
    completed: true,
    latencyMs: 0,
    rows,
  };
  assert.equal(reportMatchesScore(report, score), true);
  score.bpm = 120;
  assert.equal(reportMatchesScore(report, score), true);
  assert.equal(reportMatchesScore({ ...report, scoreKey: "" }, score), false);
  score.events[0].notes[0].fret++;
  assert.equal(reportMatchesScore(report, score), false);
  assert.equal(reportMatchesScore({ ...report, scoreKey: "" }, score), false);
});
