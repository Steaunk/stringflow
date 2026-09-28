import type { TabEvent } from "./score.ts";

// All horizontal coordinates share the same time axis (quarter-note beats).
export const beatX = (beat: number, barBeats: number) =>
  5 + (beat / barBeats) * 90;

export function rhythmValue(beats: number) {
  for (const base of [4, 2, 1, 0.5, 0.25, 0.125]) {
    for (const dots of [0, 1, 2]) {
      if (Math.abs(beats - base * (2 - 2 ** -dots)) < 0.00001)
        return { base, dots, flags: Math.max(0, -Math.log2(base)) };
    }
  }
  return null;
}

export function rhythmMarkup(
  notes: { event: TabEvent; beat: number }[],
  barStart: number,
  barBeats: number,
  signature: [number, number],
) {
  const group = signature[1] === 8 && signature[0] % 3 === 0 ? 1.5 : 1;
  const values = notes.map(({ event }) => rhythmValue(event.beats));
  const linked = (a: number, b: number, level: number) => {
    if (a < 0 || b >= notes.length) return false;
    return Boolean(
      (notes[a].event.notes.length || notes[a].event.percussion) &&
      (notes[b].event.notes.length || notes[b].event.percussion) &&
      (values[a]?.flags ?? 0) >= level &&
      (values[b]?.flags ?? 0) >= level &&
      Math.floor((notes[a].beat - barStart) / group) ===
        Math.floor((notes[b].beat - barStart) / group) &&
      Math.abs(notes[a].beat + notes[a].event.beats - notes[b].beat) < 0.00001,
    );
  };
  return `<div class="rhythm-lane" aria-hidden="true">${notes
    .map(({ event, beat }, i) => {
      const x = beatX(beat - barStart, barBeats);
      const v = values[i];
      if (!v)
        return `<span class="duration-label" style="left:${x}%">${event.beats}拍</span>`;
      const dots = v.dots
        ? `<span class="rhythm-dot" style="left:${x}%">${"·".repeat(v.dots)}</span>`
        : "";
      if (!event.notes.length && !event.percussion) {
        const rest = (
          { 4: "𝄻", 2: "𝄼", 1: "𝄽", 0.5: "𝄾", 0.25: "𝄿", 0.125: "𝅀" } as Record<
            number,
            string
          >
        )[v.base];
        return `<span class="rhythm-rest" style="left:${x}%">${rest}</span>${dots}`;
      }
      let markup =
        v.base < 4
          ? `<span class="rhythm-stem" style="left:${x}%"></span>`
          : "";
      if (v.base >= 2)
        markup += `<span class="rhythm-open" style="left:${x}%"></span>`;
      markup += dots;
      for (let level = 1; level <= v.flags; level++) {
        const bottom = (level - 1) * 6;
        if (linked(i, i + 1, level)) {
          const width = beatX(notes[i + 1].beat - barStart, barBeats) - x;
          markup += `<span class="rhythm-beam" data-level="${level}" style="left:${x}%;width:${width}%;bottom:${bottom}px"></span>`;
        } else if (!linked(i - 1, i, level)) {
          const left = linked(i - 1, i, 1) && !linked(i, i + 1, 1);
          markup += `<span class="rhythm-beam beam-hook" data-level="${level}" style="left:${x}%;bottom:${bottom}px;${left ? "transform:translateX(-100%)" : ""}"></span>`;
        }
      }
      return markup;
    })
    .join("")}</div>`;
}

export function restSymbol(beats: number) {
  return (
    { 4: "𝄻", 2: "𝄼", 1: "𝄽", 0.5: "𝄾", 0.25: "𝄿", 0.125: "𝅀" } as Record<
      number,
      string
    >
  )[rhythmValue(beats)?.base ?? 1];
}
