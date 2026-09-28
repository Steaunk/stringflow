import { centsFrom } from "./music.ts";
/** Require a stable match and a fresh onset/pitch transition before each repeated note. */
export class Follower {
  private stable = 0;
  private armed = true;
  private quiet = 0;
  private priorRms = 0;
  private lastAccepted: number | null = null;
  reset() {
    this.stable = 0;
    this.armed = true;
    this.quiet = 0;
    this.priorRms = 0;
    this.lastAccepted = null;
  }
  update(
    hz: number | null,
    rms: number,
    expected: number,
    now: number,
  ): boolean {
    if (!hz) {
      this.stable = 0;
      if (!this.quiet) this.quiet = now;
      if (now - this.quiet >= 100) this.armed = true;
      this.priorRms = rms;
      return false;
    }
    this.quiet = 0;
    const changed =
      this.lastAccepted !== null &&
      Math.abs(centsFrom(hz, this.lastAccepted)) > 85;
    const onset = this.priorRms > 0 && rms > this.priorRms * 1.8;
    if (changed || onset) this.armed = true;
    this.priorRms = rms;
    if (!this.armed || Math.abs(centsFrom(hz, expected)) > 45) {
      this.stable = 0;
      return false;
    }
    if (!this.stable) {
      this.stable = now;
      return false;
    }
    if (now - this.stable < 100) return false;
    this.armed = false;
    this.lastAccepted = expected;
    this.stable = 0;
    return true;
  }
}

import type { ListeningFrame } from "./listening.ts";
import { targetMatch } from "./listening.ts";
/** Score-guided chord/onset gate. A held chord cannot consume its constituent notes. */
export class ScoreFollower {
  private armed = true;
  private stable: number | null = null;
  private quiet: number | null = null;
  private lastAccepted = -Infinity;
  private lastAttack = -Infinity;
  private priorPeak: number | null = null;
  private priorStrengths: Record<number, number> = {};
  private acceptedPitches = new Set<number>();
  reset() {
    this.armed = true;
    this.stable = null;
    this.quiet = null;
    this.lastAccepted = -Infinity;
    this.lastAttack = -Infinity;
    this.priorPeak = null;
    this.priorStrengths = {};
    this.acceptedPitches.clear();
  }
  update(
    frame: ListeningFrame,
    expected: number[],
    percussive: boolean,
    now: number,
  ) {
    if (frame.rms < 0.0025) {
      this.stable = null;
      this.quiet ??= now;
      if (now - this.quiet >= 80) this.armed = true;
      this.priorPeak = frame.peak;
      this.priorStrengths = frame.strengths;
      return false;
    }
    this.quiet = null;
    const attack =
      this.priorPeak !== null &&
      frame.peak > 0.006 &&
      frame.peak > Math.max(0.003, this.priorPeak) * 1.5 &&
      now - this.lastAttack > 90;
    const restrike =
      now - this.lastAttack > 180 &&
      expected.some(
        (n) =>
          (frame.strengths[n] ?? 0) >
          Math.max(0.006, (this.priorStrengths[n] ?? 0) * 1.5),
      );
    if (attack || restrike) {
      this.armed = true;
      this.lastAttack = now;
    }
    this.priorPeak = frame.peak;
    this.priorStrengths = frame.strengths;
    if (now - this.lastAccepted < 90) return false;
    const novel = expected.some(
      (n) => frame.pitches.includes(n) && !this.acceptedPitches.has(n),
    );
    const matched =
      percussive && !expected.length ? attack : targetMatch(frame, expected);
    if (!matched || (!this.armed && !novel)) {
      this.stable = null;
      return false;
    }
    if (!percussive || expected.length) {
      if (this.stable === null) {
        this.stable = now;
        return false;
      }
      if (now - this.stable < 55) return false;
    }
    this.armed = false;
    this.stable = null;
    this.lastAccepted = now;
    this.acceptedPitches = new Set(frame.pitches);
    return true;
  }
}
