import { detectPitch } from "./pitch.ts";
export class AudioEngine {
  context: AudioContext | null = null;
  private sources = new Set<OscillatorNode>();
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
  tone(hz: number, time: number, duration: number, click = false) {
    const ctx = this.context!;
    const osc = ctx.createOscillator(),
      gain = ctx.createGain();
    osc.type = click ? "sine" : "triangle";
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(click ? 0.12 : 0.13, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      time + Math.max(0.03, duration),
    );
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + duration + 0.02);
    this.sources.add(osc);
    osc.onended = () => {
      this.sources.delete(osc);
      osc.disconnect();
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
