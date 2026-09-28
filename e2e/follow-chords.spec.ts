import { test, expect, chromium } from "@playwright/test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("microphone follows the actual song chord, waits through sustain, and accepts the next two picked notes", async () => {
  const folder = mkdtempSync(join(tmpdir(), "stringflow-chord-")),
    path = join(folder, "performance.wav");
  const rate = 48000,
    count = rate * 12,
    wav = Buffer.alloc(44 + count * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(count * 2, 40);
  const tone = (midi: number, t: number) => {
    const phase = 2 * Math.PI * 440 * 2 ** ((midi - 69) / 12) * t;
    return (
      0.12 * Math.sin(phase) +
      0.05 * Math.sin(2 * phase) +
      0.02 * Math.sin(3 * phase)
    );
  };
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    let sample = 0;
    if (t >= 0.25 && t < 3.2) {
      const age = t - 0.25;
      sample =
        ([41, 48, 60].reduce((s, m) => s + tone(m, age), 0) / Math.sqrt(3)) *
        Math.min(1, age / 0.008) *
        Math.exp(-Math.max(0, age - 1.3));
    }
    if (t >= 3.2 && t < 5.8) {
      const age = t - 3.2;
      sample = tone(60, age) * Math.min(1, age / 0.008) * Math.exp(-age / 0.9);
    }
    if (t >= 5.8) {
      const age = t - 5.8;
      sample = tone(67, age) * Math.min(1, age / 0.008) * Math.exp(-age / 1.5);
    }
    wav.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, sample)) * 32767),
      44 + i * 2,
    );
  }
  writeFileSync(path, wav);
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${path}`,
    ],
  });
  try {
    const context = await browser.newContext({ permissions: ["microphone"] });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://localhost:5173/?song=something-just-like-this");
    await page.locator("#follow-mode").click();
    await expect(page.locator("#follow-panel")).toBeVisible();
    await page.locator("#play").click();
    await expect(page.locator("#play")).toHaveAttribute("aria-label", "暂停");
    await expect(page.locator('[data-event="1"]')).toHaveClass(/current/, {
      timeout: 2500,
    });
    await expect(page.locator("#follow-heard")).toContainText("检测音高");
    await page.waitForTimeout(800);
    await expect(page.locator('[data-event="1"]')).toHaveClass(/current/);
    await expect(page.locator('[data-event="2"]')).toHaveClass(/current/, {
      timeout: 5000,
    });
    await expect(page.locator('[data-event="3"]')).toHaveClass(/current/, {
      timeout: 5000,
    });
    await page.waitForTimeout(450);
    await expect(page.locator('[data-event="3"]')).toHaveClass(/current/);
    await page.locator("#play").click();
    await expect(page.locator("#follow-signal")).toHaveText("未开启");
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
