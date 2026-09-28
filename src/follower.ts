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
