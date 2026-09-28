import { test, expect } from "@playwright/test";

test("imported song opens directly, tunes according to the source, and renders all measures", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?song=something-just-like-this");
  await expect(page.locator("#song-title")).toHaveText(
    "Something Just Like This",
  );
  await expect(page.locator("#bpm")).toHaveValue("112");
  await expect(page.locator("#capo-tag")).toHaveText("Capo 5");
  await expect(page.locator("#tuning-tag")).toContainText(
    "CGDGAD · C2 G2 D3 G3 A3 D4",
  );
  await expect(page.locator(".tab-bar")).toHaveCount(101);
  await expect(page.locator(".tab-event")).toHaveCount(822);
  await expect(page.locator("#bar-28 .harmonic").first()).toHaveText("◇12");
  await expect(page.locator("#bar-28 .muted").first()).toHaveText("×");
  await expect(page.locator("#bar-100 .rest")).toBeAttached();
  await page.locator("#open-tuner").click();
  await page.locator("#tune-capo").check();
  await expect(page.locator('[data-string="0"]')).toContainText("F2");
  await expect(page.locator('[data-string="5"]')).toContainText("G4");
  await page.locator("#close-tuner").click();
  await page.locator("#count-in").selectOption("0");
  await page.locator("#play").click();
  await expect(page.locator('[data-event="0"]')).not.toHaveClass(/current/);
  await page.locator("#play").click();
  await page.locator("#follow-mode").click();
  await page.locator("#play").click();
  await expect(page.locator("#status")).toContainText("和弦或打板");
  await page.locator("#toggle-library").click();
  await page.locator('[data-demo="0"]').click();
  expect(new URL(page.url()).searchParams.has("song")).toBe(false);
  await page.locator("#toggle-library").click();
  await page
    .getByRole("button", { name: "载入 Something Just Like This", exact: true })
    .click();
  expect(new URL(page.url()).searchParams.get("song")).toBe(
    "something-just-like-this",
  );
  expect(errors).toEqual([]);
});

test("imported song loops the harmonic/percussion passage and remains usable on mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?song=something-just-like-this");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.locator("#count-in").selectOption("0");
  await page.fill("#bpm", "240");
  await page.locator("#bpm").blur();
  await page.locator("#loop").check();
  await page.locator("#loop-start").selectOption("29");
  await page.locator("#loop-end").selectOption("29");
  await page.locator("#play").click();
  await page.waitForTimeout(1500);
  await expect(page.locator("#bar-position")).toHaveText("29 / 101 小节");
  await page.locator("#play").click();
  await expect
    .poll(() => page.locator("#score").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(1000);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: "test-results/song-mobile.png",
    fullPage: true,
  });
});
