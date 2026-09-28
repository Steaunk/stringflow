import { test } from "node:test";
import assert from "node:assert/strict";
import { palmMutedSamples } from "../src/palm-mute.ts";
import { harmonicRoomImpulse } from "../src/ambience.ts";
import { detectPitch } from "../src/pitch.ts";
import { frequency } from "../src/music.ts";
const energy = (a: Float32Array, start: number, end: number) =>
  a.slice(start, end).reduce((s, v) => s + v * v, 0) / (end - start);
test("P.M. preserves source bass pitches after the attack and loses energy naturally", () => {
  for (const rate of [44100, 48000])
    for (const midi of [41, 43, 45, 48, 50, 52, 57, 59, 60]) {
      const hz = frequency(midi),
        wave = palmMutedSamples(hz, rate, 6);
      const pitch = detectPitch(
        wave.slice(Math.round(rate * 0.012), Math.round(rate * 0.012) + 4096),
        rate,
      );
      assert.ok(pitch, `missing ${midi}`);
      assert.ok(
        Math.abs(1200 * Math.log2(pitch.hz / hz)) < 15,
        `${midi}: ${pitch.hz}`,
      );
      const early = energy(
        wave,
        Math.round(rate * 0.015),
        Math.round(rate * 0.06),
      );
      assert.ok(early > 0.005);
      assert.ok(
        energy(wave, Math.round(rate * 0.3), Math.round(rate * 0.4)) <
          early * 0.002,
      );
      assert.ok(wave.every((v) => Number.isFinite(v) && Math.abs(v) < 1));
      assert.equal(Math.abs(wave[0]), 0);
      assert.ok(Math.abs(wave.at(-1)!) < 1e-6);
    }
});
test("harmonic room starts after the direct attack, has decorrelated stereo tails and bounded energy", () => {
  for (const rate of [44100, 48000]) {
    const [l, r] = harmonicRoomImpulse(rate);
    assert.ok(l.slice(0, Math.floor(rate * 0.022)).every((v) => v === 0));
    let cross = 0,
      ll = 0,
      rr = 0;
    for (let i = Math.floor(rate * 0.1); i < l.length; i++) {
      cross += l[i] * r[i];
      ll += l[i] ** 2;
      rr += r[i] ** 2;
    }
    assert.ok(Math.abs(cross / Math.sqrt(ll * rr)) < 0.1);
    const sum = l.reduce((s, v) => s + v * v, 0);
    assert.ok(sum > 0.6 && sum < 1);
    assert.ok(energy(l, rate, Math.round(rate * 1.2)) > 1e-9);
    assert.ok(
      energy(l, Math.round(rate * 2.5), Math.round(rate * 2.7)) <
        energy(l, Math.round(rate * 0.2), Math.round(rate * 0.4)) * 0.001,
    );
  }
});
