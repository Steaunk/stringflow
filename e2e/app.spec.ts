import { test, expect } from "@playwright/test";
test("tempo playback, pause, score seek, and local playback preferences", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#song-title")).toHaveText("晚风练习曲");
  await expect(page.locator(".tab-event")).toHaveCount(64);
  await page.selectOption("#count-in", "0");
  await page.fill("#bpm", "240");
  await page.locator("#bpm").blur();
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect(page.locator('[data-event="0"]')).not.toHaveClass(/current/);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const current = await page
    .locator(".tab-event.current")
    .getAttribute("data-event");
  await page.waitForTimeout(350);
  expect(
    await page.locator(".tab-event.current").getAttribute("data-event"),
  ).toBe(current);
  await page.locator('[data-event="10"]').click();
  await expect(page.locator('[data-event="10"]')).toHaveClass(/current/);
  await page.reload();
  await expect(page.locator("#bpm")).toHaveValue("240");
  expect(errors).toEqual([]);
});
test("only built-in scores load, with no import or editing controls", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "stringflow-score",
      JSON.stringify({
        version: 1,
        title: "旧的自定义曲谱",
        artist: "",
        bpm: 120,
        timeSignature: [4, 4],
        tuning: [40, 45, 50, 55, 59, 64],
        capo: 0,
        events: [{ beats: 4, notes: [{ string: 1, fret: 0 }] }],
      }),
    );
  });
  await page.goto("/");
  await expect(page.locator("#song-title")).toHaveText("晚风练习曲");
  await expect(
    page.locator(
      "#import-button, #sidebar-import, #edit-button, #editor, input[type=file]",
    ),
  ).toHaveCount(0);
  await page.locator("#toggle-library").click();
  await expect(page.locator(".library-item")).toHaveCount(4);
  await page.locator('[data-demo="2"]').click();
  await expect(page.locator("#tuning-tag")).toContainText("DADGAD");
  await expect(page.locator("#capo-tag")).toHaveText("Capo 2");
  await page.locator("#open-tuner").click();
  await expect(page.locator('[data-string="0"]')).toContainText("D2");
  await page.locator("#tune-capo").check();
  await expect(page.locator('[data-string="0"]')).toContainText("E2");
  await page.locator("#close-tuner").click();
  await page.reload();
  await expect(page.locator("#tuning-tag")).toContainText("DADGAD");
  const settings = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("stringflow-playback")!),
  );
  expect(settings).toEqual({ libraryIndex: 2, bpm: 90 });
});
test("a direct song link overrides saved playback selection", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "stringflow-playback",
      JSON.stringify({ libraryIndex: 2, bpm: 90 }),
    ),
  );
  await page.goto("/?song=something-just-like-this");
  await expect(page.locator("#song-title")).toHaveText(
    "Something Just Like This",
  );
});
test("loop stays in range and metronome mode finishes", async ({ page }) => {
  await page.goto("/");
  await page.locator("#toggle-library").click();
  await page.locator('[data-demo="1"]').click();
  await page.locator("#count-in").selectOption("0");
  await page.fill("#bpm", "240");
  await page.locator("#bpm").blur();
  await page.locator("#loop").check();
  await page.locator("#loop-start").selectOption("2");
  await page.locator("#loop-end").selectOption("2");
  await page.locator("#play").click();
  await page.waitForTimeout(1400);
  const index = Number(
    await page.locator(".tab-event.current").getAttribute("data-event"),
  );
  expect(index).toBeGreaterThanOrEqual(4);
  expect(index).toBeLessThan(8);
  await page.locator("#play").click();
  await page.locator("#loop").uncheck();
  await page.locator('[data-event="15"]').click();
  await expect(page.locator("#status")).toContainText("这一遍完成了");
});
test("denied microphone shows actionable messages for both notes and chords", async ({
  page,
  context,
}) => {
  await context.clearPermissions();
  await page.goto("/");
  await page.locator("#follow-mode").click();
  await page.locator("#play").click();
  await expect(page.locator("#status")).toContainText(/麦克风|设备/);
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "播放");
  await page.locator("#toggle-library").click();
  await page.locator('[data-demo="3"]').click();
  await page.locator("#play").click();
  await expect(page.locator("#status")).toContainText(/麦克风|设备/);
});
test("mobile layout fits viewport and built-in library is usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.locator("#toggle-library").click();
  await page.locator('[data-demo="1"]').click();
  await expect(page.locator("#tuning-tag")).toContainText("Drop D");
  await expect(page.locator("#library-panel")).toHaveAttribute("inert", "");
});
test("selecting a distant note automatically scrolls its bar into view", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator('[data-event="56"]')
    .evaluate((button: HTMLElement) => button.click());
  await expect(page.locator("#bar-7")).toBeInViewport({ ratio: 1 });
  await expect(page.locator("#bar-position")).toHaveText("8 / 8 小节");
});
