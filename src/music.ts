export const NAMES = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
];
export const STANDARD = [40, 45, 50, 55, 59, 64]; // low to high; MIDI
export const PRESETS: Record<string, number[]> = {
  Standard: STANDARD,
  "Drop D": [38, 45, 50, 55, 59, 64],
  DADGAD: [38, 45, 50, 55, 57, 62],
  CGDGAD: [36, 43, 50, 55, 57, 62],
  "Open G": [38, 43, 50, 55, 59, 62],
};
export const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
export const midiFromHz = (hz: number) => 69 + 12 * Math.log2(hz / 440);
export const centsFrom = (hz: number, midi: number) =>
  1200 * Math.log2(hz / frequency(midi));
export const noteName = (midi: number) =>
  `${NAMES[((Math.round(midi) % 12) + 12) % 12]}${Math.floor(Math.round(midi) / 12) - 1}`;
export function parseNote(value: string): number {
  const m = /^([A-Ga-g])([#♯b♭]?)(-?\d)$/.exec(value.trim());
  if (!m) throw new Error(`无法识别音名 ${value}，请使用 E2、F#2 等格式。`);
  return (
    { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()]! +
    (m[2] === "#" || m[2] === "♯" ? 1 : m[2] ? -1 : 0) +
    (Number(m[3]) + 1) * 12
  );
}
