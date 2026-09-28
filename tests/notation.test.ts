import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beatX,
  rhythmValue,
  rhythmMarkup,
  restSymbol,
} from "../src/notation.ts";
import { harmonicSamples } from "../src/harmonics.ts";
import { detectPitch } from "../src/pitch.ts";

test("time axis aligns quarter and eighth beats in simple and compound time", () => {
  assert.equal(beatX(0, 4), 5);
  assert.equal(beatX(2, 4), 50);
  assert.equal(beatX(1.5, 3), 50);
  assert.equal(beatX(4, 4), 95);
  assert.deepEqual(rhythmValue(1.5), { base: 1, dots: 1, flags: 0 });
  assert.deepEqual(rhythmValue(0.375), { base: 0.25, dots: 1, flags: 2 });
  assert.deepEqual(rhythmValue(1.75), { base: 1, dots: 2, flags: 0 });
  assert.equal(rhythmValue(1.25), null);
  assert.notEqual(restSymbol(4), restSymbol(1));
});

test("eighth-note beams respect beat boundaries and rests, including 6/8 groups", () => {
  const notes = Array.from({ length: 6 }, (_, i) => ({
    beat: i * 0.5,
    event: { beats: 0.5, notes: [{ string: 1, fret: 0 }] },
  }));
  const simple = rhythmMarkup(notes, 0, 4, [4, 4]);
  const compound = rhythmMarkup(notes, 0, 3, [6, 8]);
  assert.equal((simple.match(/class="rhythm-beam"/g) ?? []).length, 3);
  assert.equal((compound.match(/class="rhythm-beam"/g) ?? []).length, 4);
  notes[1].event.notes = [];
  const rest = rhythmMarkup(notes, 0, 3, [6, 8]);
  assert.equal((rest.match(/class="rhythm-beam"/g) ?? []).length, 2);
  assert.match(rest, /rhythm-rest/);
});

test("sixteenth and thirty-second notes carry the correct number of beam levels", () => {
  for (const [beats, flags] of [
    [0.25, 2],
    [0.125, 3],
  ]) {
    const html = rhythmMarkup(
      [
        { beat: 0, event: { beats, notes: [{ string: 1, fret: 0 }] } },
        { beat: beats, event: { beats, notes: [{ string: 1, fret: 0 }] } },
      ],
      0,
      4,
      [4, 4],
    );
    for (let level = 1; level <= flags; level++)
      assert.equal(
        (html.match(new RegExp(`data-level="${level}"`, "g")) ?? []).length,
        1,
      );
  }
});

test("harmonic voices retain the requested pitch, ring past an eighth note and decay smoothly", () => {
  const rate = 48000;
  for (const hz of [523.251, 587.33, 783.991]) {
    const wave = harmonicSamples(hz, rate);
    const pitch = detectPitch(wave.slice(2400, 2400 + 4096), rate);
    assert.ok(pitch);
    assert.ok(Math.abs(1200 * Math.log2(pitch.hz / hz)) < 3);
    assert.ok(wave.length > rate * 1.4);
    const rms = (start: number) =>
      Math.sqrt(
        wave.slice(start, start + 2400).reduce((a, v) => a + v * v, 0) / 2400,
      );
    assert.ok(rms(rate * 0.5) > 0.1);
    assert.ok(rms(rate * 1.3) < rms(rate * 0.5) * 0.25);
    assert.equal(wave[0], 0);
    assert.ok(Math.abs(wave.at(-1)!) < 0.00002);
    assert.ok(wave.every((v) => Number.isFinite(v) && Math.abs(v) < 1));
  }
});
