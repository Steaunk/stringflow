// Start Vite on port 5174. Uses the last deployed engine (27f7ddf) as reference.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
const base = "http://localhost:5174";
const frozen = new Map();
function snapshot(path) {
  if (frozen.has(path)) return frozen.get(path);
  let code = stripTypeScriptTypes(
    execFileSync("git", ["show", `27f7ddf:${path}`], { encoding: "utf8" }),
  );
  code = code.replace(
    /from\s+(["'])(\.\.?\/[^"']+\.ts)\1/g,
    (_, quote, ref) =>
      "from " +
      JSON.stringify(
        snapshot(posix.normalize(posix.join(posix.dirname(path), ref))),
      ),
  );
  const url =
    "data:text/javascript;base64," + Buffer.from(code).toString("base64");
  frozen.set(path, url);
  return url;
}
const previousAudio = snapshot("src/audio.ts");
const browser = await chromium.launch();
const temp = mkdtempSync(join(tmpdir(), "stringflow-slap-"));
try {
  const page = await browser.newPage();
  await page.goto(base);
  for (const name of [
    "slap-before",
    "slap-after-dry",
    "slap-after-space",
    "bar32-before",
    "bar32-after",
    "bars29-32-before",
    "bars29-32-after",
  ]) {
    const channels = await page.evaluate(
      async ({ name, base, previousAudio }) => {
        const previous = name.endsWith("before");
        const { AudioEngine } = await import(
          previous ? previousAudio : base + "/src/audio.ts"
        );
        const { SOMETHING_JUST_LIKE_THIS: score } = await import(
          base + "/src/songs/something-just-like-this.ts"
        );
        const { eventPitch, starts } = await import(base + "/src/score.ts");
        const { connections, strokeNotes } = await import(
          base + "/src/techniques.ts"
        );
        const isolated = name.startsWith("slap"),
          passage = name.startsWith("bars");
        const rate = 44100,
          length = isolated ? 10 : passage ? 12 : 6;
        const ctx = new OfflineAudioContext(2, rate * length, rate),
          engine = new AudioEngine();
        engine.context = ctx;
        engine.setHarmonicSpace(name.endsWith("dry") ? 0 : 0.38);
        const hz = (m) => 440 * 2 ** ((m - 69) / 12);
        if (isolated) {
          const play = (notes, t) => {
            if (!previous) engine.harmonicSlap(t);
            notes.forEach(([m, s]) =>
              engine.harmonicNote(hz(m), t, {
                string: s,
                volume: 1 / Math.sqrt(notes.length),
                attack: "tap",
                contact: previous,
              }),
            );
          };
          [
            [72, 3],
            [74, 2],
            [79, 1],
          ].forEach((n, i) => {
            play([n], 0.15 + 1.65 * i);
            engine.dampString(n[1], 1.6 + 1.65 * i);
          });
          play(
            [
              [72, 3],
              [74, 2],
              [79, 1],
            ],
            5.4,
          );
        } else {
          const beats = starts(score),
            links = connections(score),
            begin = passage ? 112 : 124,
            end = 128;
          score.events.forEach((event, i) => {
            if (beats[i] < begin || beats[i] >= end) return;
            const when = 0.15 + ((beats[i] - begin) * 60) / score.bpm;
            const strokes = strokeNotes(event),
              muted = strokes.filter((s) => s.note.technique === "muted");
            const pitched = event.notes.filter((n) => n.technique !== "muted");
            if (!previous) {
              if (event.strum && muted.length && !event.percussion)
                engine.mutedBrush(
                  when + muted[0].offset,
                  muted.length,
                  muted.at(-1).offset - muted[0].offset,
                );
              if (event.notes.some((n) => n.harmonicAttack === "tap"))
                engine.harmonicSlap(when);
            }
            if (!event.notes.length && event.percussion !== "body-tap")
              engine.dampAll(when);
            if (event.percussion) engine.percussion(when, event.percussion);
            for (const { note: n, offset } of strokes) {
              const t = when + offset,
                volume =
                  (n.ghost ? 0.4 : 1) / Math.sqrt(Math.max(1, pitched.length));
              if (n.technique === "muted") {
                engine.dampString(n.string, t);
                if (!event.percussion && (previous || !event.strum))
                  engine.percussion(
                    t,
                    "muted",
                    (n.ghost ? 0.35 : 1) / Math.sqrt(event.notes.length),
                  );
              } else if (n.technique === "harmonic")
                engine.harmonicNote(hz(eventPitch(score, n)), t, {
                  string: n.string,
                  volume,
                  attack: n.harmonicAttack,
                  contact: previous,
                  palmMute: event.palmMute,
                });
              else
                engine.guitarNote(
                  hz(eventPitch(score, n)),
                  t,
                  (event.beats * 60) / score.bpm,
                  {
                    string: n.string,
                    volume,
                    palmMute: event.palmMute,
                    letRing: score.letRing,
                    link: n.link,
                    strummed: !previous && Boolean(event.strum),
                    continueToLink: links.some(
                      (l) => l.from === i && l.string === n.string,
                    ),
                  },
                );
            }
          });
        }
        const rendered = await ctx.startRendering();
        return [
          Array.from(rendered.getChannelData(0)),
          Array.from(rendered.getChannelData(1)),
        ];
      },
      { name, base, previousAudio },
    );
    const rate = 44100,
      from = Math.round(rate * 0.15),
      to = Math.round(rate * 0.85);
    const rms = Math.sqrt(
      channels[0].slice(from, to).reduce((s, v) => s + v * v, 0) / (to - from),
    );
    const gain = 0.035 / rms;
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
        if (Math.abs(x) >= 1) throw Error("clipping " + name);
        wav.writeInt16LE(Math.round(x * 32767), 44 + i * 4 + c * 2);
      }),
    );
    const path = join(temp, name + ".wav");
    writeFileSync(path, wav);
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
      "public/audio/" + name + ".mp3",
    ]);
    console.log(name, { peak: peak.toFixed(3) });
  }
} finally {
  await browser.close();
  rmSync(temp, { recursive: true, force: true });
}
