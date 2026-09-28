import { percussionSamples } from "./percussion.ts";
import type { PercussionKind } from "./percussion.ts";
import type { NoteLink } from "./score.ts";
import { harmonicSamples } from "./harmonics.ts";
import type { HarmonicAttack } from "./harmonics.ts";
import { detectPitch } from "./pitch.ts";
interface GuitarVoice {
  pitch: AudioParam;
  hz: number;
  started: number;
  end: number;
  filter: BiquadFilterNode;
}
export interface GuitarOptions {
  string: number;
  volume: number;
  palmMute?: boolean;
  letRing?: boolean;
  link?: NoteLink;
}
export class AudioEngine {
  context: AudioContext | null = null;
  private sources = new Set<AudioScheduledSourceNode>();
  private strings = new Map<
    number,
    { source: AudioScheduledSourceNode; gain: GainNode; guitar?: GuitarVoice }
  >();
  private guitarWave: PeriodicWave | null = null;
  private harmonicBuffers = new Map<string, AudioBuffer>();
  private stream: MediaStream | null = null;
  private input: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private frame = 0;
  private generation = 0;
  async ready() {
    this.context ??= new AudioContext();
    if (this.context.state !== "running") await this.context.resume();
    return this.context;
  }
  tone(
    hz: number,
    time: number,
    duration: number,
    click = false,
    volume = 1,
    harmonic = false,
    string?: number,
  ) {
    const ctx = this.context!;
    if (harmonic && !click) {
      this.harmonicNote(hz, time, { string: string ?? 1, volume });
      return;
    }
    if (string !== undefined) this.dampString(string, time);
    const osc = ctx.createOscillator(),
      gain = ctx.createGain();
    osc.type = click ? "sine" : "triangle";
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(
      (click ? 0.12 : 0.13) * volume,
      time + 0.005,
    );
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      time + Math.max(0.03, duration),
    );
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + duration + 0.02);
    this.track(osc, gain, string);
  }
  harmonicNote(
    hz: number,
    time: number,
    options: {
      string: number;
      volume: number;
      attack?: HarmonicAttack;
      palmMute?: boolean;
    },
  ) {
    const ctx = this.context!;
    const attack = options.attack ?? "pluck";
    this.dampString(options.string, time);
    const buffer = this.harmonicBuffer(hz, options.string, attack);
    const source = ctx.createBufferSource(),
      gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(0.19 * options.volume, time);
    source.connect(gain).connect(ctx.destination);
    this.track(source, gain, options.string);
    source.start(time);
    if (options.palmMute) this.dampString(options.string, time + 0.12);
  }
  private harmonicBuffer(hz: number, string: number, attack: HarmonicAttack) {
    const ctx = this.context!;
    const key = `${ctx.sampleRate}:${hz}:${string}:${attack}`;
    let buffer = this.harmonicBuffers.get(key);
    if (!buffer) {
      const samples = harmonicSamples(hz, ctx.sampleRate, attack, string);
      buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.copyToChannel(samples, 0);
      // Bound memory when many different imported scores are auditioned.
      if (this.harmonicBuffers.size >= 48)
        this.harmonicBuffers.delete(this.harmonicBuffers.keys().next().value!);
      this.harmonicBuffers.set(key, buffer);
    }
    return buffer;
  }
  prepareHarmonics(
    notes: { hz: number; string: number; attack?: HarmonicAttack }[],
  ) {
    for (const note of notes)
      this.harmonicBuffer(note.hz, note.string, note.attack ?? "pluck");
  }
  guitarNote(
    hz: number,
    time: number,
    duration: number,
    options: GuitarOptions,
  ) {
    const ctx = this.context!;
    const sustain = options.palmMute
      ? Math.min(0.18, Math.max(0.09, duration))
      : options.letRing
        ? Math.max(1.5, Math.min(3.8, 3.2 * Math.sqrt(220 / hz)))
        : Math.max(0.08, duration);
    const volume = 0.12 * options.volume * (options.palmMute ? 0.72 : 1);
    const previous = this.strings.get(options.string);
    if (
      options.link &&
      previous?.guitar &&
      previous.guitar.end > ctx.currentTime
    ) {
      const voice = previous.guitar;
      if (options.link === "slide") {
        // Schedule the glide before its destination; the scheduler looks ahead 220 ms.
        const begin = Math.max(
          ctx.currentTime,
          voice.started + 0.015,
          time - 0.12,
        );
        voice.pitch.cancelScheduledValues(begin);
        voice.pitch.setValueAtTime(voice.hz, begin);
        voice.pitch.exponentialRampToValueAtTime(
          hz,
          Math.max(begin + 0.001, time),
        );
      } else if (options.link !== "tie") voice.pitch.setValueAtTime(hz, time);
      previous.gain.gain.cancelAndHoldAtTime(time);
      if (options.link === "hammer" || options.link === "pull")
        previous.gain.gain.linearRampToValueAtTime(
          volume * (options.link === "hammer" ? 0.7 : 0.8),
          time + 0.008,
        );
      previous.gain.gain.exponentialRampToValueAtTime(0.0001, time + sustain);
      previous.source.stop(time + sustain + 0.025);
      voice.hz = hz;
      voice.end = time + sustain;
      voice.started = time;
      return;
    }
    this.dampString(options.string, time);
    const osc = ctx.createOscillator(),
      gain = ctx.createGain(),
      filter = ctx.createBiquadFilter();
    if (!this.guitarWave) {
      const real = new Float32Array(20),
        imag = new Float32Array(20);
      for (let n = 1; n < imag.length; n++)
        imag[n] = Math.sin(Math.PI * n * 0.23) / n ** 1.35;
      this.guitarWave = ctx.createPeriodicWave(real, imag);
    }
    osc.setPeriodicWave(this.guitarWave);
    osc.frequency.value = hz;
    filter.type = "lowpass";
    filter.Q.value = 0.55;
    filter.frequency.setValueAtTime(
      Math.min(11000, hz * (options.palmMute ? 3 : 12)),
      time,
    );
    filter.frequency.exponentialRampToValueAtTime(
      Math.min(9000, hz * 2.5),
      time + Math.min(0.3, sustain),
    );
    gain.gain.setValueAtTime(0, time);
    // Direct seeks into a legato target still produce that target, with a softer attack.
    gain.gain.linearRampToValueAtTime(
      volume * (options.link ? 0.75 : 1),
      time + (options.link ? 0.012 : 0.003),
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, time + sustain);
    osc.connect(filter).connect(gain).connect(ctx.destination);
    this.track(osc, gain, options.string, {
      pitch: osc.frequency,
      hz,
      started: time,
      end: time + sustain,
      filter,
    });
    osc.start(time);
    osc.stop(time + sustain + 0.025);
  }
  private track(
    source: AudioScheduledSourceNode,
    gain: GainNode,
    string?: number,
    guitar?: GuitarVoice,
  ) {
    this.sources.add(source);
    if (string !== undefined)
      this.strings.set(string, { source, gain, guitar });
    source.onended = () => {
      this.sources.delete(source);
      if (string !== undefined && this.strings.get(string)?.source === source)
        this.strings.delete(string);
      source.disconnect();
      gain.disconnect();
      guitar?.filter.disconnect();
    };
  }
  dampString(string: number, time: number) {
    const voice = this.strings.get(string);
    if (!voice) return;
    voice.gain.gain.cancelAndHoldAtTime(time);
    voice.gain.gain.setTargetAtTime(0.00001, time, 0.006);
    voice.source.stop(time + 0.04);
    this.strings.delete(string);
  }
  dampAll(time: number) {
    for (const string of [...this.strings.keys()])
      this.dampString(string, time);
  }
  percussion(time: number, kind: PercussionKind = "muted", volume = 1) {
    const ctx = this.context!,
      samples = percussionSamples(kind, ctx.sampleRate);
    const source = ctx.createBufferSource(),
      gain = ctx.createGain();
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.copyToChannel(samples, 0);
    source.buffer = buffer;
    gain.gain.value = (kind === "body-tap" ? 0.38 : 0.22) * volume;
    source.connect(gain).connect(ctx.destination);
    this.track(source, gain);
    source.start(time);
  }
  silence() {
    for (const osc of this.sources) {
      try {
        osc.stop();
      } catch {}
    }
    this.sources.clear();
    this.strings.clear();
  }
  async listen(
    onPitch: (pitch: ReturnType<typeof detectPitch>) => void,
    onEnded: () => void,
    onFrame?: (samples: Float32Array, sampleRate: number, now: number) => void,
  ) {
    this.stopMic();
    const generation = this.generation;
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error("麦克风需要 HTTPS 或 localhost，请使用安全地址打开。");
    const ctx = await this.ready();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    this.stream = stream;
    this.input = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = onFrame ? 8192 : 4096;
    this.input.connect(this.analyser);
    stream.getAudioTracks().forEach((t) => {
      t.onended = () => {
        this.stopMic();
        onEnded();
      };
    });
    const data = new Float32Array(this.analyser.fftSize);
    let last = 0;
    const tick = (now: number) => {
      if (!this.analyser) return;
      if (now - last >= (onFrame ? 35 : 45)) {
        this.analyser.getFloatTimeDomainData(data);
        if (onFrame) onFrame(data, ctx.sampleRate, now);
        else onPitch(detectPitch(data, ctx.sampleRate));
        last = now;
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
    return true;
  }
  stopMic() {
    this.generation++;
    cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.input?.disconnect();
    this.analyser?.disconnect();
    this.stream = null;
    this.input = null;
    this.analyser = null;
  }
}
