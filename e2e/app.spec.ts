import { test, expect } from "@playwright/test";
test("tempo playback, pause, score seek, and private local persistence", async ({
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
test("score import handles validation, escaping, tuning and capo", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#import-button").click();
  await page.locator("#score-input").fill("bad data");
  await page.locator("#apply-score").click();
  await expect(page.locator("#editor-error")).not.toBeEmpty();
  await page.locator("#ascii-example").click();
  await page.locator("#apply-score").click();
  await expect(page.locator("#song-title")).toHaveText("我的第一段旋律");
  await page.locator("#toggle-library").click();
  await page.locator('[data-demo="2"]').click();
  await expect(page.locator("#tuning-tag")).toContainText("DADGAD");
  await expect(page.locator("#capo-tag")).toHaveText("Capo 2");
  await page.locator("#open-tuner").click();
  await expect(page.locator('[data-string="0"]')).toContainText("D2");
  await page.locator("#tune-capo").check();
  await expect(page.locator('[data-string="0"]')).toContainText("E2");
  await page.locator("#close-tuner").click();
  await page.locator("#edit-button").click();
  const raw = JSON.parse(await page.locator("#score-input").inputValue());
  raw.title = "<img src=x onerror=alert(1)>";
  await page.locator("#score-input").fill(JSON.stringify(raw));
  await page.locator("#apply-score").click();
  await expect(page.locator("#song-title")).toHaveText(raw.title);
  await expect(page.locator("#song-title img")).toHaveCount(0);
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
test("denied microphone and polyphonic follow show actionable messages", async ({
  page,
  context,
}) => {
  await context.clearPermissions();
  await page.goto("/");
  await page.locator("#follow-mode").click();
  await page.locator("#play").click();
  await expect(page.locator("#status")).toContainText(/麦克风|设备/);
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "播放");
  await page.locator("#edit-button").click();
  const raw = JSON.parse(await page.locator("#score-input").inputValue());
  raw.events[0].notes.push({ string: 1, fret: 0 });
  await page.locator("#score-input").fill(JSON.stringify(raw));
  await page.locator("#apply-score").click();
  await page.locator("#play").click();
  await expect(page.locator("#status")).toContainText("同时发声的和弦");
});
test("mobile layout fits viewport and editor is usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.locator("#import-button").click();
  await expect(page.locator("#score-input")).toBeVisible();
  await page.locator("#apply-score").click();
  await expect(page.locator("#song-title")).toHaveText("我的第一段旋律");
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});
test("desktop interface screenshot", async ({ page }) => {
  await page.goto("/");
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
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
