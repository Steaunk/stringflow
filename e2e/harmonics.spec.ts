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
        ambience: false,
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

test("harmonic space preserves the direct attack, produces stereo decay, and clears on stop", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/audio.ts";
    const { AudioEngine } = await import(/* @vite-ignore */ path);
    const render = async (wet: boolean, stop = false) => {
      const ctx = new OfflineAudioContext(2, 48000 * 2, 48000),
        engine = new AudioEngine();
      engine.context = ctx;
      engine.harmonicNote(783.991, 0, {
        string: 1,
        volume: 1,
        attack: "tap",
        ambience: wet,
      });
      if (!stop) engine.dampString(1, 0.2);
      const pause = stop
        ? ctx.suspend(0.256).then(() => {
            engine.silence();
            return ctx.resume();
          })
        : Promise.resolve();
      const buffer = await ctx.startRendering();
      await pause;
      return [
        Array.from(buffer.getChannelData(0)),
        Array.from(buffer.getChannelData(1)),
      ];
    };
    const dry = await render(false),
      wet = await render(true),
      stopped = await render(true, true);
    const energy = (wave: number[], begin: number, end: number) =>
      wave.slice(begin * 48000, end * 48000).reduce((s, v) => s + v * v, 0) /
      ((end - begin) * 48000);
    return {
      directError: wet[0]
        .slice(0, 700)
        .reduce((s, v, i) => s + Math.abs(v - dry[0][i]), 0),
      dryTail: energy(dry[0], 0.6, 0.9),
      wetTail: energy(wet[0], 0.6, 0.9),
      stereo: energy(
        wet[0].map((v, i) => v - wet[1][i]),
        0.3,
        0.9,
      ),
      stopped: energy(stopped[0], 0.4, 0.9),
    };
  });
  expect(result.directError).toBeLessThan(1e-5);
  expect(result.dryTail).toBeLessThan(1e-10);
  expect(result.wetTail).toBeGreaterThan(1e-8);
  expect(result.stereo).toBeGreaterThan(1e-7);
  expect(result.stopped).toBeLessThan(1e-10);
  await page.locator(".notation-key summary").click();
  await page.locator("#harmonic-space").selectOption("0");
  await expect(page.locator("#harmonic-space")).toHaveValue("0");
});
