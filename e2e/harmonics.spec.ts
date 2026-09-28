import { test, expect } from "@playwright/test";

test("the printed harmonic chord schedules the tap timbre together and preserves the bass strings", async ({
  page,
}) => {
  await page.goto("/?song=something-just-like-this");
  await expect(
    page.locator("#bar-28 .event-technique").filter({ hasText: "T.H." }),
  ).toHaveCount(2);
  await page.locator("#metronome").uncheck();
  await page.evaluate(async () => {
    const path = "/src/audio.ts";
    const { AudioEngine } = await import(/* @vite-ignore */ path);
    const state = window as unknown as { harmonicCalls: unknown[] };
    state.harmonicCalls = [];
    const original = AudioEngine.prototype.harmonicNote;
    AudioEngine.prototype.harmonicNote = function (
      hz: number,
      time: number,
      options: unknown,
    ) {
      state.harmonicCalls.push({ hz, time, options });
      return original.call(this, hz, time, options);
    };
  });
  await page
    .locator("#bar-28 .tab-event")
    .filter({ has: page.locator(".harmonic") })
    .first()
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { harmonicCalls: unknown[] }).harmonicCalls
            .length,
      ),
    )
    .toBe(3);
  await page.locator("#play").click();
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          harmonicCalls: {
            hz: number;
            time: number;
            options: { attack: string; string: number };
          }[];
        }
      ).harmonicCalls,
  );
  expect(calls.map((c) => c.options.attack)).toEqual(["tap", "tap", "tap"]);
  expect(calls.map((c) => c.options.string)).toEqual([1, 2, 3]);
  [783.991, 587.33, 523.251].forEach((hz, i) =>
    expect(calls[i].hz).toBeCloseTo(hz, 1),
  );
  expect(
    Math.max(...calls.map((c) => c.time)) -
      Math.min(...calls.map((c) => c.time)),
  ).toBeLessThan(0.001);
});

test("rendered tapped harmonics ring across other strings, stop on their own string, and cache articulation separately", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/audio.ts";
    const { AudioEngine } = await import(/* @vite-ignore */ path);
    const render = async (action: "none" | "other" | "same" | "mute") => {
      const ctx = new OfflineAudioContext(1, 48000, 48000),
        engine = new AudioEngine();
      engine.context = ctx;
      engine.prepareHarmonics([
        { hz: 783.991, string: 1, attack: "pluck" },
        { hz: 783.991, string: 1, attack: "tap" },
      ]);
      engine.harmonicNote(783.991, 0, {
        string: 1,
        volume: 1,
        attack: "tap",
        palmMute: action === "mute",
      });
      if (action !== "none" && action !== "mute")
        engine.dampString(action === "same" ? 1 : 6, 0.3);
      const wave = (await ctx.startRendering()).getChannelData(0);
      return Math.sqrt(
        wave.slice(24000, 28800).reduce((s, v) => s + v * v, 0) / 4800,
      );
    };
    const ctx = new OfflineAudioContext(1, 48000, 48000),
      engine = new AudioEngine();
    engine.context = ctx;
    const buffers: AudioBuffer[] = [];
    const original = ctx.createBufferSource.bind(ctx);
    ctx.createBufferSource = () => {
      const source = original();
      const start = source.start.bind(source);
      source.start = (...args: Parameters<AudioBufferSourceNode["start"]>) => {
        buffers.push(source.buffer!);
        start(...args);
      };
      return source;
    };
    engine.harmonicNote(783.991, 0, { string: 1, volume: 1, attack: "pluck" });
    engine.harmonicNote(783.991, 0.3, { string: 1, volume: 1, attack: "tap" });
    engine.harmonicNote(783.991, 0.6, { string: 1, volume: 1, attack: "tap" });
    return {
      ring: await render("none"),
      other: await render("other"),
      same: await render("same"),
      mute: await render("mute"),
      separate: buffers[0] !== buffers[1],
      reused: buffers[1] === buffers[2],
    };
  });
  expect(result.ring).toBeGreaterThan(0.01);
  expect(result.other).toBeCloseTo(result.ring, 6);
  expect(result.same).toBeLessThan(result.ring * 0.001);
  expect(result.mute).toBeLessThan(result.ring * 0.001);
  expect(result.separate).toBe(true);
  expect(result.reused).toBe(true);
});
