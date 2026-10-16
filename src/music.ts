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
