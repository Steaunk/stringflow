import { harmonicSamples } from "./harmonics.ts";
import { detectPitch } from "./pitch.ts";
export class AudioEngine {
  context: AudioContext | null = null;
  private sources = new Set<AudioScheduledSourceNode>();
  private strings = new Map<
    number,
    { source: AudioScheduledSourceNode; gain: GainNode }
  >();
  private harmonicBuffers = new Map<number, AudioBuffer>();
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
    if (string !== undefined) this.dampString(string, time);
    if (harmonic && !click) {
      let buffer = this.harmonicBuffers.get(hz);
      if (!buffer) {
        const samples = harmonicSamples(hz, ctx.sampleRate);
        buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
        buffer.copyToChannel(samples, 0);
        this.harmonicBuffers.set(hz, buffer);
      }
      const source = ctx.createBufferSource(),
        gain = ctx.createGain();
      source.buffer = buffer;
      gain.gain.value = 0.14 * volume;
      source.connect(gain).connect(ctx.destination);
      this.track(source, gain, string);
      source.start(time);
      return;
    }
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
  private track(
    source: AudioScheduledSourceNode,
    gain: GainNode,
    string?: number,
  ) {
    this.sources.add(source);
    if (string !== undefined) this.strings.set(string, { source, gain });
    source.onended = () => {
      this.sources.delete(source);
      if (string !== undefined && this.strings.get(string)?.source === source)
        this.strings.delete(string);
      source.disconnect();
      gain.disconnect();
    };
  }
  dampString(string: number, time: number) {
    const voice = this.strings.get(string);
    if (!voice) return;
    voice.gain.gain.cancelScheduledValues(time);
    voice.gain.gain.setTargetAtTime(0.00001, time, 0.006);
    voice.source.stop(time + 0.04);
    this.strings.delete(string);
  }
  percussion(time: number) {
    const ctx = this.context!,
      duration = 0.07;
    const source = ctx.createBufferSource(),
      gain = ctx.createGain();
    const buffer = ctx.createBuffer(
      1,
      Math.ceil(ctx.sampleRate * duration),
      ctx.sampleRate,
    );
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++)
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.16));
    source.buffer = buffer;
    gain.gain.value = 0.13;
    source.connect(gain).connect(ctx.destination);
    source.start(time);
    source.stop(time + duration);
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      gain.disconnect();
    };
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
    this.analyser.fftSize = 4096;
    this.input.connect(this.analyser);
    stream.getAudioTracks().forEach((t) => {
      t.onended = () => {
        this.stopMic();
        onEnded();
      };
    });
    const data = new Float32Array(4096);
    let last = 0;
    const tick = (now: number) => {
      if (!this.analyser) return;
      if (now - last >= 45) {
        this.analyser.getFloatTimeDomainData(data);
        onPitch(detectPitch(data, ctx.sampleRate));
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
