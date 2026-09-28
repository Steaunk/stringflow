import { test, expect } from "@playwright/test";

test("source performance symbols survive import/export and appear at their actual positions", async ({
  page,
}) => {
  await page.goto("/?song=something-just-like-this");
  await expect(page.locator('#bar-7 [data-link="hammer"]')).toHaveCount(2);
  await expect(page.locator('#bar-8 [data-link="pull"]')).toHaveCount(1);
  await expect(page.locator('#bar-29 [data-strum="down"]')).toHaveCount(1);
  await expect(page.locator('#bar-29 [data-strum="up"]')).toHaveCount(2);
  await expect(page.locator("#bar-84 .body-tap")).toHaveText("拍");
  await expect(
    page.locator("#bar-28 .event-technique").filter({ hasText: "P.M." }),
  ).toHaveCount(4);
  await expect(page.locator('#bar-87 [data-link="slide"]')).toHaveCount(3);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator("#bar-84").evaluate((el) => {
    const container = document.querySelector("#score")!;
    container.scrollTop = (el as HTMLElement).offsetTop - 10;
  });
  const visible = await page.locator("#score").evaluate(
    (el) =>
      [...el.querySelectorAll(".tab-bar")].filter((b) => {
        const r = b.getBoundingClientRect(),
          v = el.getBoundingClientRect();
        return r.top >= v.top && r.bottom <= v.bottom;
      }).length,
  );
  expect(visible).toBeGreaterThanOrEqual(4);
  await page.locator("#edit-button").click();
  const raw = JSON.parse(await page.locator("#score-input").inputValue());
  expect(
    raw.events.some(
      (e: { percussion?: string }) => e.percussion === "body-tap",
    ),
  ).toBe(true);
  await page.locator("#apply-score").click();
  await expect(page.locator("#bar-84 .body-tap")).toHaveText("拍");
});

test("rendered legato reuses one string voice, reaches the correct pitches and glides continuously", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const audioPath = "/src/audio.ts",
      pitchPath = "/src/pitch.ts";
    const { AudioEngine } = await import(/* @vite-ignore */ audioPath);
    const { detectPitch } = await import(/* @vite-ignore */ pitchPath);
    const ctx = new OfflineAudioContext(1, 72000, 48000);
    let oscillators = 0;
    const original = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = () => {
      oscillators++;
      return original();
    };
    const engine = new AudioEngine();
    engine.context = ctx;
    const options = { string: 1, volume: 1, letRing: true };
    engine.guitarNote(440, 0, 0.25, options);
    engine.guitarNote(660, 0.25, 0.25, { ...options, link: "hammer" });
    engine.guitarNote(440, 0.5, 0.35, { ...options, link: "pull" });
    engine.guitarNote(880, 0.85, 0.5, { ...options, link: "slide" });
    const wave = (await ctx.startRendering()).getChannelData(0);
    const pitch = (time: number, size = 4096) =>
      detectPitch(
        wave.slice(Math.round(time * 48000), Math.round(time * 48000) + size),
        48000,
      )?.hz;
    return {
      oscillators,
      pitches: [pitch(0.1), pitch(0.33), pitch(0.59), pitch(0.96)],
      glide: pitch(0.77, 2048),
    };
  });
  expect(result.oscillators).toBe(1);
  [440, 660, 440, 880].forEach((hz, i) =>
    expect(Math.abs(1200 * Math.log2(result.pitches[i] / hz))).toBeLessThan(8),
  );
  expect(result.glide).toBeGreaterThan(490);
  expect(result.glide).toBeLessThan(820);
});

test("palm-muted rendering decays early while let-ring stays audible; direct legato seeks still sound", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const audioPath = "/src/audio.ts",
      pitchPath = "/src/pitch.ts";
    const { AudioEngine } = await import(/* @vite-ignore */ audioPath);
    const { detectPitch } = await import(/* @vite-ignore */ pitchPath);
    const render = async (palmMute: boolean, link?: string) => {
      const ctx = new OfflineAudioContext(1, 48000, 48000),
        engine = new AudioEngine();
      engine.context = ctx;
      engine.guitarNote(440, 0, 0.5, {
        string: 1,
        volume: 1,
        letRing: true,
        palmMute,
        link,
      });
      const wave = (await ctx.startRendering()).getChannelData(0);
      return {
        rms: Math.sqrt(
          wave.slice(19200, 24000).reduce((n, v) => n + v * v, 0) / 4800,
        ),
        pitch: detectPitch(wave.slice(2400, 6496), 48000)?.hz,
      };
    };
    return {
      ring: await render(false),
      muted: await render(true),
      seek: await render(false, "slide"),
    };
  });
  expect(result.ring.rms).toBeGreaterThan(0.005);
  expect(result.muted.rms).toBeLessThan(0.0001);
  expect(result.seek.pitch).toBeCloseTo(440, 0);
});

test("clicking a down-strummed chord schedules low-to-high attacks without count-in", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as unknown as {
      strokes: { hz: number; time: number }[];
    };
    state.strokes = [];
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const osc = create.call(this),
        start = osc.start.bind(osc);
      osc.start = (when = 0) => {
        state.strokes.push({ hz: osc.frequency.value, time: when });
        start(when);
      };
      return osc;
    };
  });
  await page.goto("/?song=something-just-like-this");
  await page.locator("#metronome").uncheck();
  await page
    .getByRole("button", { name: "从第 45 小节播放", exact: true })
    .click();
  const strokes = await page.evaluate(() =>
    (
      window as unknown as { strokes: { hz: number; time: number }[] }
    ).strokes.slice(0, 6),
  );
  expect(strokes).toHaveLength(6);
  [41, 48, 57, 60, 65, 69].forEach((midi, i) =>
    expect(strokes[i].hz).toBeCloseTo(440 * 2 ** ((midi - 69) / 12), 2),
  );
  for (let i = 1; i < 6; i++)
    expect(strokes[i].time - strokes[i - 1].time).toBeCloseTo(0.012, 4);
});
