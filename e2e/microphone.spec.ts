import { test, expect, chromium } from "@playwright/test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("real Web Audio microphone path detects E2 and advances exactly one held note", async () => {
  const folder = mkdtempSync(join(tmpdir(), "stringflow-mic-"));
  const path = join(folder, "guitar.wav");
  const rate = 48000,
    count = rate * 8,
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
  const hz = 440 * 2 ** ((40 - 69) / 12);
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    const sample =
      0.16 * Math.sin(2 * Math.PI * hz * t) +
      0.08 * Math.sin(4 * Math.PI * hz * t);
    wav.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
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
    await page.goto("http://localhost:5173");
    await page.locator("#mic-button").click();
    await expect(page.locator("#detected-note")).toContainText("E2", {
      timeout: 10000,
    });
    await expect(page.locator("#tuner-state")).toHaveText("音准刚刚好");
    await page.locator("#mic-button").click();
    await expect(page.locator("#tuner-state")).toHaveText("等待麦克风");
    await page.locator("#follow-mode").click();
    await page.locator("#play").click();
    await expect(page.locator('[data-event="1"]')).toHaveClass(/current/, {
      timeout: 10000,
    });
    await page.waitForTimeout(700);
    await expect(page.locator('[data-event="1"]')).toHaveClass(/current/);
    await page.locator("#play").click();
    await expect(page.locator("#mic-button")).toHaveText("◉ 开启麦克风");
  } finally {
    await browser.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
