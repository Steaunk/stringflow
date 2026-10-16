import type { ListeningFrame } from "./listening.ts";
import { targetMatch } from "./listening.ts";
export interface FollowTarget {
  index: number;
  pitches: number[];
  percussive: boolean;
  legato?: boolean;
}
/** One fresh gesture may consume only one target, including after a missed note. */
export class ScoreFollower {
  private armedUntil = Infinity;
  private initial = true;
  private stable: number | null = null;
  private stableKey = "";
  private quiet: number | null = null;
  private lastAccepted = -Infinity;
  private lastAttack = -Infinity;
  private priorPeak: number | null = null;
  private acceptedPeak = 0;
  private priorStrengths: Record<number, number> = {};
  private attackBaseline: Record<number, number> = {};
  private acceptedPitches = new Set<number>();
  matchedAt = 0;
  reset() {
    this.armedUntil = Infinity;
    this.initial = true;
    this.stable = null;
    this.stableKey = "";
    this.quiet = null;
    this.lastAccepted = -Infinity;
    this.lastAttack = -Infinity;
    this.priorPeak = null;
    this.acceptedPeak = 0;
    this.priorStrengths = {};
    this.attackBaseline = {};
    this.acceptedPitches.clear();
  }
  locate(frame: ListeningFrame, targets: FollowTarget[], now: number) {
    // Prefer a full chord over a sustaining constituent note. The caller orders
    // equally plausible targets by score position (free) or beat distance (timed).
    const matches = targets.filter((t) => targetMatch(frame, t.pitches));
    let target =
      matches.reduce<FollowTarget | undefined>((best, t) => {
        const evidence = (v: FollowTarget) =>
          v.pitches.reduce((sum, n) => sum + (frame.strengths[n] ?? 0), 0);
        return !best || evidence(t) > evidence(best) * 1.2 ? t : best;
      }, undefined) ?? targets.find((t) => t.percussive && !t.pitches.length);
    const stableTarget = matches.find(
      (t) => String(t.index) === this.stableKey,
    );
    if (
      this.stable !== null &&
      stableTarget &&
      target &&
      stableTarget.pitches.join(",") === target.pitches.join(",")
    )
      target = stableTarget;
    if (
      this.update(
        frame,
        target?.pitches ?? [],
        target?.percussive ?? false,
        now,
        target?.legato,
        String(target?.index ?? "none"),
      )
    )
      return { index: target!.index, at: this.matchedAt };
    return null;
  }
  update(
    frame: ListeningFrame,
    expected: number[],
    percussive: boolean,
    now: number,
    legato = false,
    key = expected.join(","),
  ) {
    if (frame.rms < 0.0025) {
      this.stable = null;
      this.quiet ??= now;
      this.priorPeak = frame.peak;
      this.priorStrengths = frame.strengths;
      return false;
    }
    const fromSilence = this.quiet !== null && now - this.quiet >= 80;
    this.quiet = null;
    const attack =
      this.priorPeak !== null &&
      frame.peak > 0.006 &&
      frame.peak > Math.max(0.003, this.priorPeak) * 1.5 &&
      frame.peak > this.acceptedPeak * 0.25 &&
      now - this.lastAttack > 120;
    if (attack || fromSilence) {
      this.armedUntil = now + 260;
      this.lastAttack = now;
      this.attackBaseline = fromSilence ? {} : { ...this.priorStrengths };
    }
    this.priorPeak = frame.peak;
    this.priorStrengths = frame.strengths;
    if (now - this.lastAccepted < 100) return false;
    const strongestNew = Math.max(
      0,
      ...expected
        .filter(
          (n) =>
            !this.acceptedPitches.has(n) &&
            (legato ||
              [...this.acceptedPitches].every((old) => {
                const ratio = 2 ** ((n - old) / 12);
                return (
                  ratio < 1.8 || Math.abs(ratio - Math.round(ratio)) > 0.035
                );
              })),
        )
        .map((n) => frame.strengths[n] ?? 0),
    );
    const oldStrength = Math.max(
      0,
      ...[...this.acceptedPitches].map((n) => frame.strengths[n] ?? 0),
    );
    // A new dominant pitch permits hammer/pull transitions; late-emerging partials
    // and a chord thinning down to one of its old notes do not open the gate.
    const transition = strongestNew > Math.max(0.006, oldStrength * 1.8);
    const refreshed = expected.some(
      (n) =>
        (frame.strengths[n] ?? 0) >
        Math.max(0.004, (this.attackBaseline[n] ?? 0) * 1.3),
    );
    const matched =
      percussive && !expected.length ? attack : targetMatch(frame, expected);
    const permitted =
      this.initial || transition || (now <= this.armedUntil && refreshed);
    if (!matched || (!(percussive && !expected.length) && !permitted)) {
      this.stable = null;
      return false;
    }
    if (expected.length) {
      if (this.stable === null || this.stableKey !== key) {
        this.stable = now;
        this.stableKey = key;
        return false;
      }
      if (now - this.stable < 55) return false;
    }
    this.matchedAt =
      now <= this.armedUntil && this.lastAttack > this.lastAccepted
        ? this.lastAttack
        : (this.stable ?? now);
    this.initial = false;
    this.armedUntil = -Infinity;
    this.stable = null;
    this.lastAccepted = now;
    this.acceptedPeak = frame.peak;
    this.acceptedPitches = new Set([...frame.pitches, ...expected]);
    return true;
  }
}
