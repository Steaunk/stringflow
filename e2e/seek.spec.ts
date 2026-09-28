import { test, expect } from "@playwright/test";

test("clicking a note starts its audio immediately even when count-in is enabled", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as unknown as {
      scheduled: { hz: number; lead: number }[];
    };
    state.scheduled = [];
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const osc = create.call(this),
        start = osc.start.bind(osc),
        ctx = this;
      osc.start = (when = 0) => {
        state.scheduled.push({
          hz: osc.frequency.value,
          lead: when - ctx.currentTime,
        });
        start(when);
      };
      return osc;
    };
  });
  await page.goto("/");
  await page.locator("#count-in").selectOption("2");
  await page.locator("#metronome").uncheck();
  await page.locator('[data-event="10"]').click();
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "暂停");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { scheduled: unknown[] }).scheduled.length,
      ),
    )
    .toBeGreaterThan(0);
  const first = await page.evaluate(
    () =>
      (window as unknown as { scheduled: { hz: number; lead: number }[] })
        .scheduled[0],
  );
  expect(first.hz).toBeCloseTo(440 * 2 ** ((55 - 69) / 12), 2);
  expect(first.lead).toBeLessThan(0.2);
});

test("seeking outside a loop respects the clicked note instead of jumping to the loop start", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#loop").check();
  await page.locator("#loop-end").selectOption("1");
  await page.locator('[data-event="18"]').click();
  await expect(page.locator("#loop")).not.toBeChecked();
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "暂停");
  await expect(page.locator("#bar-position")).toHaveText("3 / 8 小节");
});

test("space pauses after clicking a focused note and another click seeks while playing", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#count-in").selectOption("0");
  await page.locator('[data-event="10"]').click();
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "暂停");
  await page.keyboard.press("Space");
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "播放");
  await page.keyboard.press("Space");
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "暂停");
  await page.locator('[data-event="37"]').click();
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "暂停");
  await expect(page.locator("#bar-position")).toHaveText("5 / 8 小节");
});

test("clicking a bar number starts that bar, and clicking within a loop retains it", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#loop").check();
  await page.locator("#loop-start").selectOption("3");
  await page.locator("#loop-end").selectOption("4");
  await page
    .getByRole("button", { name: "从第 4 小节播放", exact: true })
    .click();
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "暂停");
  await expect(page.locator("#loop")).toBeChecked();
  await expect(page.locator("#bar-position")).toHaveText("4 / 8 小节");
});

test("mobile taps in staff whitespace start the nearest note", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const staff = page.locator("#bar-1 .staff-body");
  await staff.scrollIntoViewIfNeeded();
  await staff.click({ position: { x: 2, y: 50 } });
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "暂停");
  await expect(page.locator("#bar-position")).toHaveText("2 / 8 小节");
});
