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

test("Space starts by default and toggles exactly once after using transport buttons", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Space");
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "暂停");
  await page.keyboard.press("Space");
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "播放");
  await page.locator("#count-in").selectOption("0");
  for (const selector of ["#faster", "#tempo-mode", "#rewind", "#play"]) {
    await page.locator(selector).click();
    if (selector === "#play") await page.locator(selector).click();
    await page.keyboard.press("Space");
    await expect(page.locator("#play")).toHaveAttribute("aria-label", "暂停");
    await page.keyboard.press("Space");
    await expect(page.locator("#play")).toHaveAttribute("aria-label", "播放");
  }
  await expect(page.locator("#bpm")).toHaveValue("85");
  await page.locator("#toggle-library").click();
  await page.locator('[data-demo="2"]').click();
  // Closing the library restores focus to its opener.
  await page.keyboard.down("Space");
  await page.keyboard.down("Space");
  await page.keyboard.up("Space");
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "暂停");
  await expect(page.locator("#toggle-library")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.keyboard.press("Space");
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "播放");
});

test("Space preserves input, select, checkbox and dialog keyboard behavior", async ({
  page,
}) => {
  await page.goto("/");
  for (const selector of ["#bpm", "#count-in"]) {
    await page.locator(selector).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("Escape");
    await expect(page.locator("#play")).toHaveAttribute("aria-label", "播放");
  }
  await page.locator("#metronome").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#metronome")).not.toBeChecked();
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "播放");
  await page.locator("#toggle-library").click();
  await expect(page.locator('[data-demo="1"]')).toBeVisible();
  await page.locator('[data-demo="1"]').focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#tuning-tag")).toContainText("Drop D");
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "播放");
  await page.locator("#open-tuner").click();
  await page.locator("#close-tuner").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#tuner")).not.toBeVisible();
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "播放");
});

test("playback turns the page at the penultimate visible row and keeps the next row readable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1300 });
  await page.goto("/?song=something-just-like-this");
  await page.locator("#bpm").fill("240");
  await page.locator("#bpm").blur();
  await page.locator("#metronome").uncheck();
  await page.locator("#sound").uncheck();
  // Fit exactly three complete rows, using the actual responsive layout.
  const rows = await page.locator("#score").evaluate((el: HTMLElement) => {
    const bars = [...el.querySelectorAll<HTMLElement>(".tab-bar")];
    const rows = bars.filter(
      (bar, i) => !i || bar.offsetTop !== bars[i - 1].offsetTop,
    );
    el.style.flex = "none";
    el.style.height = `${rows[2].offsetTop + rows[2].offsetHeight + 14}px`;
    el.scrollTop = 0;
    return rows.slice(0, 4).map((row) => ({
      id: row.id,
      firstEvent: Number(
        row.querySelector<HTMLElement>(".tab-event")!.dataset.event,
      ),
    }));
  });
  // Start on the last event of row one, then let the playback clock cross
  // into the penultimate row without another click or manual scroll.
  await page.locator(`#${rows[1].id}`).evaluate((el) => {
    const container = document.querySelector<HTMLElement>("#score")!;
    container.scrollTop = 0;
    const event = container.querySelector<HTMLElement>(
      `[data-event="${Number(el.querySelector<HTMLElement>(".tab-event")!.dataset.event) - 1}"]`,
    )!;
    event.click();
  });
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "暂停");
  await expect
    .poll(() => page.locator("#score").evaluate((el) => el.scrollTop))
    .toBe(0);
  await expect
    .poll(() => page.locator("#score").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(100);
  const position = await page.locator("#score").evaluate((el, rowId) => {
    const row = el.querySelector<HTMLElement>(`#${rowId}`)!;
    return {
      offset: row.offsetTop - el.scrollTop,
      visible:
        row.offsetTop + row.offsetHeight <= el.scrollTop + el.clientHeight,
    };
  }, rows[1].id);
  expect(position.offset).toBeCloseTo(12, 0);
  expect(position.visible).toBe(true);
  await expect(page.locator(`#${rows[2].id}`)).toBeInViewport({ ratio: 1 });
  await expect(page.locator(`#${rows[3].id}`)).toBeInViewport({ ratio: 1 });
  // The second bar on the same row must not cause another page turn.
  await page.locator("#play").click();
  const scrollTop = await page.locator("#score").evaluate((el) => el.scrollTop);
  await page.locator(`#${rows[1].id}`).evaluate((el) => {
    const next =
      el.nextElementSibling!.querySelector<HTMLElement>(".tab-event")!;
    next.click();
  });
  await expect
    .poll(() => page.locator("#score").evaluate((el) => el.scrollTop))
    .toBe(scrollTop);
});
