import { ScoreFollower } from "./follower.ts";
import type { FollowTarget } from "./follower.ts";
import type { ListeningFrame } from "./listening.ts";
import { eventPitch, starts } from "./score.ts";
import type { Score } from "./score.ts";
export interface PracticeTarget extends FollowTarget {
  beat: number;
}
export type TimingResult = "pending" | "early" | "on-time" | "late" | "unheard";
export interface TimingRow extends PracticeTarget {
  result: TimingResult;
  offsetMs?: number;
}
export interface PracticeReport {
  title: string;
  date: string;
  bpm: number;
  barBeats: number;
  beatUnit: number;
  startBeat: number;
  endBeat: number;
  completed: boolean;
  latencyMs: number;
  rows: TimingRow[];
}
export function practiceTargets(score: Score): PracticeTarget[] {
  const beats = starts(score);
  return score.events
    .map((event, index) => ({
      index,
      beat: beats[index],
      pitches: event.notes
        .filter((n) => n.technique !== "muted" && n.link !== "tie")
        .map((n) => eventPitch(score, n)),
      percussive: Boolean(
        event.percussion || event.notes.some((n) => n.technique === "muted"),
      ),
      legato: event.notes.some((n) => n.link && n.link !== "tie"),
    }))
    .filter((t) => t.pitches.length || t.percussive);
}
/** Clock-led alignment. Missing a note never stalls the clock or later matches. */
export class TimingPractice {
  readonly rows: TimingRow[];
  readonly toleranceMs = 80;
  private gate: ScoreFollower;
  private secondsPerBeat: number;
  private windowBeats: number;
  readonly bpm: number;
  readonly startBeat: number;
  readonly endBeat: number;
  readonly latencyMs: number;
  constructor(
    targets: PracticeTarget[],
    bpm: number,
    startBeat: number,
    endBeat: number,
    latencyMs = 0,
    gate = new ScoreFollower(),
  ) {
    this.gate = gate;
    this.bpm = bpm;
    this.startBeat = startBeat;
    this.endBeat = endBeat;
    this.latencyMs = latencyMs;
    this.rows = targets
      .filter((t) => t.beat >= startBeat && t.beat < endBeat)
      .map((t) => ({ ...t, result: "pending" }));
    this.secondsPerBeat = 60 / bpm;
    this.windowBeats = Math.max(0.75, 0.35 / this.secondsPerBeat);
  }
  expire(beat: number) {
    for (const row of this.rows)
      if (row.result === "pending" && beat > row.beat + this.windowBeats)
        row.result = "unheard";
  }
  update(frame: ListeningFrame, now: number, beat: number) {
    // The spectrum stabilizes after the attack; leave enough time for confirmation.
    this.expire(beat - 0.2 / this.secondsPerBeat);
    const candidates = this.rows
      .filter(
        (r) =>
          r.result === "pending" &&
          r.beat - beat <= this.windowBeats &&
          beat - r.beat <= this.windowBeats + 0.2 / this.secondsPerBeat,
      )
      .sort((a, b) => Math.abs(a.beat - beat) - Math.abs(b.beat - beat));
    const found = this.gate.locate(frame, candidates, now);
    if (!found) return null;
    const row = this.rows.find((r) => r.index === found.index)!;
    // Latest short-window energy attack is timestamped separately from stable pitch.
    const offset =
      (beat - row.beat) * this.secondsPerBeat * 1000 -
      (now - found.at) -
      this.latencyMs;
    row.offsetMs = Math.round(offset);
    row.result =
      offset < -this.toleranceMs
        ? "early"
        : offset > this.toleranceMs
          ? "late"
          : "on-time";
    return row;
  }
  finish(beat: number, complete: boolean) {
    return this.rows
      .filter((r) => complete || r.beat <= beat || r.offsetMs !== undefined)
      .map((r) => ({
        ...r,
        result: r.result === "pending" ? ("unheard" as const) : r.result,
      }));
  }
}
