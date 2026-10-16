import { octaveHarmonicMidi } from "./harmonics.ts";
import type { HarmonicAttack } from "./harmonics.ts";
import { STANDARD } from "./music.ts";
export type NoteLink = "hammer" | "pull" | "slide" | "tie";
export interface TabNote {
  string: number;
  fret: number;
  technique?: "harmonic" | "muted";
  harmonicAttack?: HarmonicAttack;
  ghost?: boolean;
  link?: NoteLink;
}
export interface TabEvent {
  beats: number;
  notes: TabNote[];
  palmMute?: boolean;
  strum?: "down" | "up";
  percussion?: "body-tap" | "string-slap";
}
export interface Score {
  version: 1;
  id?: string;
  barAnnotations?: Record<string, string>;
  title: string;
  artist: string;
  bpm: number;
  timeSignature: [number, number];
  tuning: number[];
  capo: number;
  letRing?: boolean;
  events: TabEvent[];
}
export const beatsPerBar = (s: Score) =>
  (s.timeSignature[0] * 4) / s.timeSignature[1];
export const eventPitch = (s: Score, n: TabNote) =>
  n.technique === "harmonic"
    ? octaveHarmonicMidi(s.tuning[6 - n.string], s.capo)
    : s.tuning[6 - n.string] + s.capo + n.fret;
export const starts = (s: Score) => {
  let t = 0;
  return s.events.map((e) => {
    const start = t;
    t += e.beats;
    return start;
  });
};
export function validateScore(raw: unknown): Score {
  const s = raw as Score;
  const fail = (message: string): never => {
    throw new Error(message);
  };
  if (!s || s.version !== 1) fail("谱子需要 version: 1。");
  if (
    s.id !== undefined &&
    (typeof s.id !== "string" || !/^[a-z0-9-]{1,80}$/.test(s.id))
  )
    fail("曲目 id 只能包含小写字母、数字和短横线。");
  if (
    s.barAnnotations !== undefined &&
    (typeof s.barAnnotations !== "object" ||
      s.barAnnotations === null ||
      Array.isArray(s.barAnnotations) ||
      Object.entries(s.barAnnotations).some(
        ([bar, text]) =>
          !/^[1-9]\d{0,2}$/.test(bar) ||
          Number(bar) > 512 ||
          typeof text !== "string" ||
          text.length > 120,
      ))
  )
    fail("小节提示格式无效。");
  if (typeof s.title !== "string" || !s.title.trim() || s.title.length > 120)
    fail("标题须为 1–120 个字符。");
  if (typeof s.artist !== "string" || s.artist.length > 120)
    fail("artist 须为最多 120 个字符的文本。");
  if (!Number.isFinite(s.bpm) || s.bpm < 30 || s.bpm > 240)
    fail("速度须为 30–240 BPM。");
  if (
    !Array.isArray(s.timeSignature) ||
    s.timeSignature.length !== 2 ||
    !Number.isInteger(s.timeSignature[0]) ||
    s.timeSignature[0] < 1 ||
    s.timeSignature[0] > 12 ||
    ![2, 4, 8, 16].includes(s.timeSignature[1])
  )
    fail("拍号须为 [1–12, 2/4/8/16]。");
  if (
    !Array.isArray(s.tuning) ||
    s.tuning.length !== 6 ||
    s.tuning.some((n) => !Number.isInteger(n) || n < 28 || n > 76)
  )
    fail("tuning 须为六根弦从低到高的 MIDI 音高（28–76）。");
  if (!Number.isInteger(s.capo) || s.capo < 0 || s.capo > 12)
    fail("变调夹须为 0–12 品。");
  if (!Array.isArray(s.events) || !s.events.length || s.events.length > 2048)
    fail("谱子需要 1–2048 个事件。");
  if (s.letRing !== undefined && typeof s.letRing !== "boolean")
    fail("letRing 须为布尔值。");
  const previous = new Map<number, TabNote>();
  for (const e of s.events) {
    if (
      !e ||
      !Number.isFinite(e.beats) ||
      e.beats < 0.125 ||
      e.beats > 16 ||
      !Number.isInteger(e.beats * 8)
    )
      fail("每个事件的 beats 须为 0.125–16，且为 0.125 的倍数。");
    if (!Array.isArray(e.notes) || e.notes.length > 6)
      fail("每个事件最多六个音；空数组表示休止。");
    if (e.palmMute !== undefined && typeof e.palmMute !== "boolean")
      fail("palmMute 须为布尔值。");
    if (e.strum !== undefined && !["down", "up"].includes(e.strum))
      fail("strum 须为 down / up。");
    if (
      e.percussion !== undefined &&
      !["body-tap", "string-slap"].includes(e.percussion)
    )
      fail("percussion 须为 body-tap / string-slap。");
    if (e.strum && e.notes.length < 2) fail("扫弦至少需要两根弦。");
    if (!e.notes.length && !e.percussion) previous.clear();
    const seen = new Set<number>();
    for (const n of e.notes) {
      if (
        !n ||
        !Number.isInteger(n.string) ||
        n.string < 1 ||
        n.string > 6 ||
        !Number.isInteger(n.fret) ||
        n.fret < 0 ||
        n.fret > 24 ||
        seen.has(n.string)
      )
        fail("音符需要不重复的 string 1–6，以及 fret 0–24。");
      if (
        n.technique !== undefined &&
        !["harmonic", "muted"].includes(n.technique)
      )
        fail("technique 仅支持 harmonic / muted。");
      if (n.technique === "harmonic" && n.fret !== 12)
        fail("目前只支持相对变调夹第 12 品的八度泛音。");
      if (
        n.harmonicAttack !== undefined &&
        (n.technique !== "harmonic" ||
          !["pluck", "tap"].includes(n.harmonicAttack))
      )
        fail("harmonicAttack 仅用于泛音，须为 pluck / tap。");
      if (n.ghost !== undefined && typeof n.ghost !== "boolean")
        fail("ghost 须为布尔值。");
      if (n.link !== undefined) {
        if (!["hammer", "pull", "slide", "tie"].includes(n.link))
          fail("link 须为 hammer / pull / slide / tie。");
        const source = previous.get(n.string);
        if (!source || source.technique || n.technique)
          fail("连音需要同弦的前一个普通音。");
        if (
          (n.link === "hammer" && n.fret <= source!.fret) ||
          (n.link === "pull" && n.fret >= source!.fret) ||
          (n.link === "slide" && n.fret === source!.fret) ||
          (n.link === "tie" && n.fret !== source!.fret)
        )
          fail("连音方向或品位不匹配。");
      }
      previous.set(n.string, n);
      seen.add(n.string);
    }
  }
  if (s.events.reduce((sum, e) => sum + e.beats, 0) / beatsPerBar(s) > 512)
    fail("曲谱最多支持 512 小节。");
  return structuredClone(s);
}
const melody = [
  [6, 0],
  [4, 2],
  [3, 0],
  [2, 0],
  [1, 0],
  [2, 0],
  [3, 0],
  [4, 2],
  [5, 3],
  [4, 2],
  [3, 0],
  [2, 1],
  [1, 0],
  [2, 1],
  [3, 0],
  [4, 2],
  [5, 0],
  [4, 2],
  [3, 2],
  [2, 1],
  [1, 0],
  [2, 1],
  [3, 2],
  [4, 2],
  [6, 3],
  [5, 2],
  [4, 0],
  [3, 0],
  [2, 0],
  [3, 0],
  [4, 0],
  [5, 2],
];
export const DEMOS: Score[] = [
  {
    version: 1,
    title: "晚风练习曲",
    artist: "Stringflow 原创 · 分解和弦练习",
    bpm: 80,
    timeSignature: [4, 4],
    tuning: STANDARD,
    capo: 0,
    events: [...melody, ...melody].map(([string, fret]) => ({
      beats: 0.5,
      notes: [{ string, fret }],
    })),
  },
  {
    version: 1,
    title: "低音漫步",
    artist: "Stringflow 原创 · Drop D 练习",
    bpm: 72,
    timeSignature: [4, 4],
    tuning: [38, 45, 50, 55, 59, 64],
    capo: 0,
    events: [0, 0, 3, 5, 7, 5, 3, 0, 0, 3, 5, 7, 10, 7, 5, 3].map((fret) => ({
      beats: 1,
      notes: [{ string: 6, fret }],
    })),
  },
  {
    version: 1,
    title: "山间回声",
    artist: "Stringflow 原创 · DADGAD / 6/8",
    bpm: 90,
    timeSignature: [6, 8],
    tuning: [38, 45, 50, 55, 57, 62],
    capo: 2,
    events: [
      ...melody.slice(0, 6),
      ...melody.slice(8, 14),
      ...melody.slice(16, 22),
      ...melody.slice(24, 30),
    ].map(([string, fret]) => ({ beats: 0.5, notes: [{ string, fret }] })),
  },
];
