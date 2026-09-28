// Run Vite on 5174 first. Requires git history with 9677e63, Chromium and ffmpeg.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const base = "http://localhost:5174";
const dataUrl = (code) =>
  "data:text/javascript;base64," +
  Buffer.from(stripTypeScriptTypes(code)).toString("base64");
const previousHarmonic = dataUrl(
  execFileSync("git", ["show", "9677e63:src/harmonics.ts"], {
    encoding: "utf8",
  }),
);
const previousAudio = dataUrl(
  execFileSync("git", ["show", "9677e63:src/audio.ts"], { encoding: "utf8" })
    .replace('"./harmonics.ts"', JSON.stringify(previousHarmonic))
    .replaceAll(
      '"./percussion.ts"',
      JSON.stringify(base + "/src/percussion.ts"),
    )
    .replaceAll('"./pitch.ts"', JSON.stringify(base + "/src/pitch.ts")),
);
const browser = await chromium.launch();
const folder = mkdtempSync(join(tmpdir(), "stringflow-tones-"));
try {
  const page = await browser.newPage();
  await page.goto(base);
  for (const kind of [
    "harmonic-previous",
    "harmonic-dry",
    "harmonic-space",
    "pm-previous",
    "pm-current",
  ]) {
    const channels = await page.evaluate(
      async ({ kind, previousAudio, base }) => {
        const { AudioEngine } = await import(
          kind.endsWith("previous") ? previousAudio : base + "/src/audio.ts"
        );
        const pm = kind.startsWith("pm"),
          rate = 44100;
        const ctx = new OfflineAudioContext(2, rate * (pm ? 5 : 10), rate),
          engine = new AudioEngine();
        engine.context = ctx;
        if (!kind.endsWith("previous"))
          engine.setHarmonicSpace(kind.endsWith("space") ? 0.38 : 0);
        const hz = (m) => 440 * 2 ** ((m - 69) / 12);
        if (pm) {
          const chords = [[41], [41, 48, 57], [43, 50, 59], [45, 52, 60]];
          chords.forEach((notes, i) =>
            notes.forEach((m, n) =>
              engine.guitarNote(hz(m), 0.15 + i * 0.9, (0.5 * 60) / 112, {
                string: 6 - n,
                volume: 1 / Math.sqrt(notes.length),
                palmMute: true,
              }),
            ),
          );
        } else {
          [72, 74, 79].forEach((m, i) => {
            engine.harmonicNote(hz(m), 0.15 + 1.65 * i, {
              string: 3 - i,
              volume: 1,
              attack: "tap",
            });
            engine.dampString(3 - i, 1.6 + 1.65 * i);
          });
          [72, 74, 79].forEach((m, i) =>
            engine.harmonicNote(hz(m), 5.4, {
              string: 3 - i,
              volume: 1 / Math.sqrt(3),
              attack: "tap",
            }),
          );
        }
        const buffer = await ctx.startRendering();
        return [
          Array.from(buffer.getChannelData(0)),
          Array.from(buffer.getChannelData(1)),
        ];
      },
      { kind, previousAudio, base },
    );
    // Match first single-note energy (700 ms); keep that gain for the entire example.
    const rate = 44100,
      from = Math.round(0.15 * rate),
      to = Math.round(0.85 * rate);
    const rms = Math.sqrt(
        channels[0].slice(from, to).reduce((s, v) => s + v * v, 0) /
          (to - from),
      ),
      gain = 0.035 / rms;
    const wav = Buffer.alloc(44 + channels[0].length * 4);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(2, 22);
    wav.writeUInt32LE(rate, 24);
    wav.writeUInt32LE(rate * 4, 28);
    wav.writeUInt16LE(4, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(wav.length - 44, 40);
    let peak = 0;
    channels[0].forEach((_, i) =>
      channels.forEach((channel, c) => {
        const x = channel[i] * gain;
        peak = Math.max(peak, Math.abs(x));
        if (Math.abs(x) >= 1) throw new Error("Clipping " + kind);
        wav.writeInt16LE(Math.round(x * 32767), 44 + i * 4 + c * 2);
      }),
    );
    const path = join(folder, kind + ".wav");
    writeFileSync(path, wav);
    mkdirSync("public/audio", { recursive: true });
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      path,
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      "public/audio/" + kind + ".mp3",
    ]);
    console.log(kind, "peak", peak.toFixed(3));
  }
} finally {
  await browser.close();
  rmSync(folder, { recursive: true, force: true });
}
