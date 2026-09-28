import type { Score, TabNote, NoteLink, TabEvent } from "./score.ts";
import { beatX } from "./notation.ts";
export interface Connection {
  from: number;
  to: number;
  string: number;
  kind: NoteLink;
  fromFret: number;
  toFret: number;
}
export function connections(score: Score): Connection[] {
  const previous = new Map<number, { note: TabNote; index: number }>();
  const links: Connection[] = [];
  score.events.forEach((event, index) => {
    if (!event.notes.length && !event.percussion) previous.clear();
    for (const note of event.notes) {
      const source = previous.get(note.string);
      if (note.link && source)
        links.push({
          from: source.index,
          to: index,
          string: note.string,
          kind: note.link,
          fromFret: source.note.fret,
          toFret: note.fret,
        });
      previous.set(note.string, { note, index });
    }
  });
  return links;
}
export const LINK_NAMES: Record<NoteLink, string> = {
  hammer: "击弦",
  pull: "勾弦",
  slide: "滑音",
  tie: "延音",
};
export function techniqueDescription(event: TabEvent) {
  return [
    event.notes.some((n) => n.harmonicAttack === "tap") ? "拍泛音" : "",
    event.palmMute ? "掌根制音" : "",
    event.strum
      ? event.strum === "down"
        ? "下扫 6 弦到 1 弦"
        : "上扫 1 弦到 6 弦"
      : "",
    event.percussion === "body-tap"
      ? "拍琴身"
      : event.percussion === "string-slap"
        ? "拍弦"
        : "",
    ...event.notes
      .filter((n) => n.link)
      .map((n) => `${n.string} 弦${LINK_NAMES[n.link!]}`),
  ]
    .filter(Boolean)
    .join("，");
}
export function strokeNotes(event: TabEvent) {
  const ordered = [...event.notes];
  if (event.strum)
    ordered.sort((a, b) =>
      event.strum === "down" ? b.string - a.string : a.string - b.string,
    );
  return ordered.map((note, i) => ({
    note,
    offset: event.strum ? i * 0.012 : 0,
  }));
}
export function techniqueMarkup(
  score: Score,
  starts: number[],
  barIndex: number,
  barBeats: number,
  links: Connection[],
) {
  const begin = barIndex * barBeats,
    end = begin + barBeats;
  const items: string[] = [];
  score.events.forEach((event, i) => {
    if (starts[i] < begin || starts[i] >= end) return;
    const x = beatX(starts[i] - begin, barBeats);
    const label = [
      event.notes.some((n) => n.harmonicAttack === "tap") ? "T.H." : "",
      event.palmMute ? "P.M." : "",
      event.percussion === "body-tap"
        ? "拍"
        : event.percussion === "string-slap"
          ? "拍弦"
          : "",
    ]
      .filter(Boolean)
      .join(" · ");
    if (label)
      items.push(
        `<span class="event-technique ${event.percussion ?? ""}" style="left:${x}%" title="${techniqueDescription(event)}">${label}</span>`,
      );
    if (event.strum) {
      const strings = event.notes.map((n) => n.string),
        top = (Math.min(...strings) - 1) * 22 + 3;
      items.push(
        `<span class="strum-arrow ${event.strum}" data-strum="${event.strum}" style="left:calc(${x}% - 17px);top:${top}px;height:${Math.max(15, (Math.max(...strings) - Math.min(...strings)) * 22 + 12)}px" title="${techniqueDescription(event)}"></span>`,
      );
    }
  });
  for (const link of links) {
    const from = starts[link.from],
      to = starts[link.to];
    if (to < begin || from >= end || (to === begin && from === to)) continue;
    const x1 = from < begin ? 0 : beatX(from - begin, barBeats);
    const x2 = to >= end ? 99 : beatX(to - begin, barBeats);
    if (x2 <= x1) continue;
    const label = { hammer: "H", pull: "P", slide: "S", tie: "⌒" }[link.kind];
    const path =
      link.kind === "slide"
        ? link.toFret > link.fromFret
          ? "M 3 15 L 97 3"
          : "M 3 3 L 97 15"
        : "M 2 16 Q 50 -5 98 16";
    items.push(
      `<span class="note-link ${link.kind}" data-link="${link.kind}" data-link-from="${link.from}" data-link-to="${link.to}" data-link-string="${link.string}" style="left:${x1}%;width:${x2 - x1}%;top:${(link.string - 1) * 22 - 12}px" title="${LINK_NAMES[link.kind]}"><svg viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true"><path d="${path}" vector-effect="non-scaling-stroke"/></svg><b>${label}</b></span>`,
    );
  }
  return `<div class="technique-overlay" aria-hidden="true">${items.join("")}</div>`;
}
