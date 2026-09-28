import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
const score = {
  version: 1,
  title: "节奏定位测试",
  artist: "",
  bpm: 120,
  timeSignature: [4, 4],
  tuning: [40, 45, 50, 55, 59, 64],
  capo: 0,
  events: [0, 2, 4, 5].map((fret) => ({
    beats: 1,
    notes: [{ string: 1, fret }],
  })),
};
async function setup(page: Page, timed: boolean) {
  await page.addInitScript(
    (s) => localStorage.setItem("stringflow-score", JSON.stringify(s)),
    score,
  );
  await page.goto("/");
  await page.evaluate(async (timed) => {
    const path = "/src/audio.ts";
    const { AudioEngine } = await import(/* @vite-ignore */ path);
    const original = AudioEngine.prototype.listen;
    const tone = AudioEngine.prototype.tone;
    const state = window as unknown as {
      clicks: number[];
      noteCalls: number;
      input: (midi: number, delay?: number, duration?: number) => void;
      tracks: MediaStreamTrack[];
    };
    state.clicks = [];
    state.noteCalls = 0;
    state.tracks = [];
    const guitar = AudioEngine.prototype.guitarNote;
    AudioEngine.prototype.guitarNote = function (...args: unknown[]) {
      state.noteCalls++;
      return guitar.apply(this, args);
    };
    AudioEngine.prototype.listen = async function (...args: unknown[]) {
      const ctx = await this.ready();
      const dest = ctx.createMediaStreamDestination();
      state.tracks.push(...dest.stream.getTracks());
      state.input = (midi, delay = 0, duration = 0.3) => {
        const at = ctx.currentTime + delay;
        const osc = ctx.createOscillator(),
          gain = ctx.createGain();
        osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.2, at + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.002, at + duration);
        osc.connect(gain).connect(dest);
        osc.start(at);
        osc.stop(at + duration + 0.01);
      };
      navigator.mediaDevices.getUserMedia = async () => dest.stream;
      return original.apply(this, args);
    };
    AudioEngine.prototype.tone = function (
      hz: number,
      at: number,
      ...rest: unknown[]
    ) {
      state.clicks.push(at);
      if (timed && state.clicks.length === 1) {
        const start = at + 2;
        state.input(64, start - this.context.currentTime - 0.24);
        state.input(66, start - this.context.currentTime + 0.5 + 0.15);
        // Skip the third note entirely. Fourth must still be located.
        state.input(69, start - this.context.currentTime + 1.5);
      }
      return tone.call(this, hz, at, ...rest);
    };
  }, timed);
}
test("clock-led microphone practice keeps clicking, tracks early/late/missed notes and persists a report", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await setup(page, true);
  await page.locator("#practice-mode").click();
  await page.locator("#play").click();
  await expect(page.locator("#played-position")).not.toHaveText(
    "尚未识别弹奏位置",
    { timeout: 5000 },
  );
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "播放", {
    timeout: 8000,
  });
  await expect(page.locator("#practice-results")).toBeVisible();
  await page.locator("#practice-results summary").click();
  const rows = page.locator("#practice-rows tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toHaveClass("result-early");
  await expect(rows.nth(1)).toHaveClass("result-late");
  await expect(rows.nth(2)).toHaveClass("result-unheard");
  await expect(rows.nth(3)).toHaveClass(/result-(on-time|late)/);
  await expect(page.locator('[data-event="3"]')).toHaveClass(/heard/);
  const state = await page.evaluate(() => {
    const s = window as unknown as {
      clicks: number[];
      noteCalls: number;
      tracks: MediaStreamTrack[];
    };
    return {
      clicks: s.clicks,
      notes: s.noteCalls,
      stopped: s.tracks.every((t) => t.readyState === "ended"),
    };
  });
  expect(state.clicks).toHaveLength(8);
  expect(state.notes).toBe(0);
  expect(state.stopped).toBe(true);
  state.clicks
    .slice(1)
    .forEach((t, i) => expect(t - state.clicks[i]).toBeCloseTo(0.5, 5));
  await page.reload();
  await page.locator("#practice-results summary").click();
  await expect(page.locator("#practice-rows tr")).toHaveCount(4);
  const download = page.waitForEvent("download");
  await page.locator("#export-practice").click();
  expect((await download).suggestedFilename()).toBe("stringflow-practice.json");
  expect(errors).toEqual([]);
});
test("free following recovers from a missed note without advancing again on its tail", async ({
  page,
}) => {
  await setup(page, false);
  await page.locator("#follow-mode").click();
  await page.locator("#play").click();
  await page.evaluate(() =>
    (
      window as unknown as {
        input: (m: number, d?: number, t?: number) => void;
      }
    ).input(64, 0, 0.7),
  );
  await expect(page.locator('[data-event="1"]')).toHaveClass(/current/);
  await page.waitForTimeout(850);
  await page.evaluate(() =>
    (
      window as unknown as {
        input: (m: number, d?: number, t?: number) => void;
      }
    ).input(68, 0, 1.8),
  );
  await expect(page.locator('[data-event="3"]')).toHaveClass(/current/);
  await expect(page.locator("#status")).toContainText("重新定位");
  await page.waitForTimeout(600);
  await expect(page.locator('[data-event="3"]')).toHaveClass(/current/);
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "暂停");
  await page.locator("#play").click();
});
test("silent practice finishes, count-in cancellation saves no empty run, and mobile controls fit", async ({
  page,
}) => {
  await setup(page, false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#practice-mode").click();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.locator("#play").click();
  await page.locator("#play").click();
  await expect(page.locator("#practice-results")).toBeHidden();
  await page.selectOption("#count-in", "0");
  await page.locator("#play").click();
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "播放", {
    timeout: 5000,
  });
  await page.locator("#practice-results summary").click();
  await expect(page.locator("#practice-rows .result-unheard")).toHaveCount(4);
  await page.screenshot({ path: "/tmp/stringflow-practice-mobile.png" });
});

test("practice loops save separate runs and seeking/BPM changes close the current partial run", async ({
  page,
}) => {
  await setup(page, false);
  await page.locator("#bpm").fill("240");
  await page.locator("#bpm").blur();
  await page.locator("#practice-mode").click();
  await page.selectOption("#count-in", "0");
  await page.locator("#loop").check();
  await page.locator("#play").click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            JSON.parse(
              localStorage.getItem("stringflow-practice") ?? "[]",
            ).filter((r: { completed: boolean }) => r.completed).length,
        ),
      { timeout: 6000 },
    )
    .toBeGreaterThanOrEqual(2);
  await page.locator("#play").click();
  await page.locator("#loop").uncheck();
  await page.locator('[data-event="2"]').click();
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "暂停");
  await page.locator("#bpm").fill("110");
  await page.locator("#bpm").blur();
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "播放");
  const reports = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("stringflow-practice") ?? "[]"),
  );
  expect(reports.some((r: { completed: boolean }) => r.completed)).toBe(true);
  expect(
    reports.every((r: { rows: { index: number }[] }) =>
      r.rows.every((v) => v.index >= 0 && v.index < 4),
    ),
  ).toBe(true);
});
