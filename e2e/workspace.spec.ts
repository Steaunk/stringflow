import { test, expect } from "@playwright/test";

test("score gets the full desktop width with six readable measures and aligned beats", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?song=something-just-like-this");
  await expect(page.locator("#library-panel")).not.toBeVisible();
  await expect(page.locator("#tuner")).not.toBeVisible();
  const layout = await page.locator("#score").evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      width: rect.width,
      visible: [...el.querySelectorAll(".tab-bar")].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.top >= rect.top && r.bottom <= rect.bottom;
      }).length,
      font: parseFloat(getComputedStyle(el.querySelector(".fret")!).fontSize),
    };
  });
  expect(layout.width).toBeGreaterThan(1300);
  expect(layout.visible).toBeGreaterThanOrEqual(6);
  expect(layout.font).toBeGreaterThanOrEqual(16);
  const note = await page.locator('[data-event="1"]').boundingBox();
  const beat = await page.locator("#bar-0 .onbeat").nth(1).boundingBox();
  expect(
    Math.abs(note!.x + note!.width / 2 - beat!.x - beat!.width / 2),
  ).toBeLessThan(1);
  await page.setViewportSize({ width: 1280, height: 720 });
  const laptopRows = await page.locator("#score").evaluate(
    (el) =>
      [...el.querySelectorAll(".tab-bar")].filter((b) => {
        const r = b.getBoundingClientRect(),
          view = el.getBoundingClientRect();
        return r.top >= view.top && r.bottom <= view.bottom;
      }).length,
  );
  expect(laptopRows).toBeGreaterThanOrEqual(4);
  await page.setViewportSize({ width: 1440, height: 900 });
  const original = (await page.locator("#score").boundingBox())!.height;
  await page.locator("#focus-score").click();
  expect((await page.locator("#score").boundingBox())!.height).toBeGreaterThan(
    original + 100,
  );
  await page.locator("#score-size").selectOption("large");
  expect(
    await page
      .locator(".fret")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThan(16);
  await page.locator("#focus-score").click();
  await page.locator("#toggle-library").click();
  await expect(page.locator("#library-panel")).toBeVisible();
  await page.locator('[data-demo="1"]').click();
  await expect(page.locator("#library-panel")).not.toBeVisible();
  await expect(page.locator("#toggle-library")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

test("tuner is independent, pauses playback, and Escape restores the score", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-event="0"]').click();
  await page.locator("#open-tuner").click();
  await expect(page.locator("#tuner")).toBeVisible();
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "播放");
  await page.keyboard.press("Escape");
  await expect(page.locator("#tuner")).not.toBeVisible();
  await expect(page.locator("#open-tuner")).toBeFocused();
});

test("harmonic audio sustains independently of notation and damps on the same string", async ({
  page,
}) => {
  await page.goto("/");
  const energy = await page.evaluate(async () => {
    const modulePath = "/src/audio.ts";
    const { AudioEngine } = await import(/* @vite-ignore */ modulePath);
    const render = async (damp: boolean) => {
      const ctx = new OfflineAudioContext(1, 48000, 48000);
      const engine = new AudioEngine();
      engine.context = ctx;
      engine.harmonicNote(783.991, 0, {
        string: 1,
        volume: 1,
        ambience: false,
      });
      if (damp) engine.dampString(1, 0.4);
      const samples = (await ctx.startRendering()).getChannelData(0);
      return Math.sqrt(
        samples.slice(24000, 28800).reduce((s, v) => s + v * v, 0) / 4800,
      );
    };
    return { ring: await render(false), damped: await render(true) };
  });
  expect(energy.ring).toBeGreaterThan(0.01);
  expect(energy.damped).toBeLessThan(energy.ring * 0.01);
});

test("row count selects 3, 4 or 5 bars, persists across reload and adapts on mobile", async ({
  page,
}) => {
  await page.goto("/?song=something-just-like-this");
  const columns = () =>
    page.locator("#score").evaluate((el) => {
      const bars = [...el.querySelectorAll(".tab-bar")];
      const top = bars[0].getBoundingClientRect().top;
      return bars.filter(
        (b) => Math.abs(b.getBoundingClientRect().top - top) < 1,
      ).length;
    });
  for (const n of [3, 4, 5]) {
    await page.locator("#bars-per-row").selectOption(String(n));
    await expect.poll(columns).toBe(n);
  }
  await page.reload();
  await expect(page.locator("#bars-per-row")).toHaveValue("5");
  await expect.poll(columns).toBe(5);
  await page.locator("#bar-18 .bar-start").click();
  await expect(page.locator("#bar-position")).toHaveText("19 / 101 小节");
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "暂停");
  await page.locator("#bars-per-row").selectOption("4");
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "暂停");
  await page.locator("#play").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(columns).toBe(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.locator("#bars-per-row").selectOption("3");
  await page.setViewportSize({ width: 1440, height: 1080 });
  await expect.poll(columns).toBe(3);
});
