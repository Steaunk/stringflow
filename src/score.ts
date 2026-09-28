import { STANDARD, parseNote } from "./music.ts";
export interface TabNote {
  string: number;
  fret: number;
}
export interface TabEvent {
  beats: number;
  notes: TabNote[];
}
export interface Score {
  version: 1;
  title: string;
  artist: string;
  bpm: number;
  timeSignature: [number, number];
  tuning: number[];
  capo: number;
  events: TabEvent[];
}
export const beatsPerBar = (s: Score) =>
  (s.timeSignature[0] * 4) / s.timeSignature[1];
export const eventPitch = (s: Score, n: TabNote) =>
  s.tuning[6 - n.string] + s.capo + n.fret;
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
      seen.add(n.string);
    }
  }
  if (s.events.reduce((sum, e) => sum + e.beats, 0) / beatsPerBar(s) > 512)
    fail("曲谱最多支持 512 小节，请分段导入。");
  return structuredClone(s);
}
export function parseScore(text: string): Score {
  if (text.trimStart().startsWith("{")) return validateScore(JSON.parse(text));
  const lines = text.trim().split(/\r?\n/);
  const meta: Record<string, string> = {};
  const rows: string[] = [];
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("//")) continue;
    const m = /^@(\w+)\s+(.+)$/.exec(line.trim());
    if (m) meta[m[1]] = m[2];
    else rows.push(line);
  }
  if (!rows.length || rows.length % 6)
    throw new Error("文本谱每组须为六行，从 1 弦（高音）到 6 弦（低音）。");
  const events: TabEvent[] = [];
  const step = Number(meta.step ?? 0.5);
  const signature = (meta.time ?? "4/4").split("/").map(Number) as [
    number,
    number,
  ];
  const barBeats = (signature[0] * 4) / signature[1];
  for (let b = 0; b < rows.length; b += 6) {
    const block = rows.slice(b, b + 6).map((row) => {
      const pipe = row.indexOf("|");
      if (pipe < 0) throw new Error("每行须包含 | 小节线。");
      const body = row.slice(pipe + 1).trimEnd();
      if (!body.endsWith("|") || /[^\d\-|\s]/.test(body))
        throw new Error(
          "文本谱仅支持品数、短横线和小节线；复杂节奏请用 JSON。",
        );
      return body.slice(0, -1).split("|");
    });
    if (block.some((row) => row.length !== block[0].length))
      throw new Error("六根弦的小节数须一致。");
    for (let bar = 0; bar < block[0].length; bar++) {
      const parts = block.map((row) => row[bar]);
      if (parts.some((p) => p.length !== parts[0].length))
        throw new Error("六根弦的每小节字符数须一致，请对齐品数。");
      const columns = new Map<number, TabNote[]>();
      parts.forEach((part, stringIndex) => {
        for (const match of part.matchAll(/\d+/g)) {
          const col = match.index!;
          columns.set(col, [
            ...(columns.get(col) ?? []),
            { string: stringIndex + 1, fret: Number(match[0]) },
          ]);
        }
      });
      const positions = [...columns.keys()].sort((a, b) => a - b);
      if (
        !positions.length ||
        Math.abs(positions.length * step - barBeats) > 1e-6
      )
        throw new Error(
          `文本谱每小节需 ${barBeats / step} 个起音列（@step ${step}）；不等长节奏与休止请用 JSON。`,
        );
      positions.forEach((p) =>
        events.push({ beats: step, notes: columns.get(p)! }),
      );
    }
  }
  return validateScore({
    version: 1,
    title: meta.title ?? "我的练习曲",
    artist: meta.artist ?? "导入的文本谱",
    bpm: Number(meta.tempo ?? 80),
    timeSignature: signature,
    tuning: meta.tuning ? meta.tuning.split(/\s+/).map(parseNote) : STANDARD,
    capo: Number(meta.capo ?? 0),
    events,
  });
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
export const ASCII_EXAMPLE = `@title 我的第一段旋律\n@artist 自定义文本谱\n@tempo 80\n@time 4/4\n@tuning E2 A2 D3 G3 B3 E4\n@capo 0\n@step 1\ne|--0--1--3--0--|\nB|--------------|\nG|--------------|\nD|--------------|\nA|--------------|\nE|--------------|`;
