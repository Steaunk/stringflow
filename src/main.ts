import {
  connections,
  techniqueMarkup,
  techniqueDescription,
  strokeNotes,
} from "./techniques.ts";
import "./style.css";
import { AudioEngine } from "./audio.ts";
import { beatX, rhythmMarkup, restSymbol } from "./notation.ts";
import { ScoreFollower } from "./follower.ts";
import { ListeningAnalyzer, targetMatch } from "./listening.ts";
import {
  PRESETS,
  centsFrom,
  frequency,
  midiFromHz,
  noteName,
} from "./music.ts";
import {
  ASCII_EXAMPLE,
  DEMOS,
  beatsPerBar,
  eventPitch,
  parseScore,
  starts,
  validateScore,
} from "./score.ts";
import type { Score, TabNote } from "./score.ts";
import { SOMETHING_JUST_LIKE_THIS } from "./songs/something-just-like-this.ts";
const LIBRARY = [...DEMOS, SOMETHING_JUST_LIKE_THIS];

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const audio = new AudioEngine(),
  follower = new ScoreFollower(),
  listening = new ListeningAnalyzer();
let score: Score = structuredClone(DEMOS[0]);
try {
  const saved = localStorage.getItem("stringflow-score");
  if (saved) score = validateScore(JSON.parse(saved));
} catch {
  /* Ignore obsolete or malformed saved scores. */
}
const requestedSong = LIBRARY.find(
  (s) => s.id && s.id === new URLSearchParams(location.search).get("song"),
);
if (requestedSong) score = structuredClone(requestedSong);
let links = connections(score);
let eventStarts = starts(score),
  index = 0,
  playing = false,
  mode: "tempo" | "follow" = "tempo";
let startTime = 0,
  startBeat = 0,
  nextEvent = 0,
  nextClick = 0,
  endBeat = 0,
  timer = 0,
  frame = 0,
  restUntil = 0;
let mic: "off" | "tuner" | "follow" = "off",
  micPending = false,
  playPending = false,
  playGeneration = 0;
let selectedString = -1,
  lastBar = -1;
let micRequest = 0;
let completed = false;
const iconPlay =
  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m8 5 11 7-11 7z"/></svg>';
const iconPause =
  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
$("#app").innerHTML = `
<div id="sidebar-shade" hidden></div><aside id="library-panel" class="sidebar" inert><button id="close-library" class="icon-button" aria-label="关闭曲库">×</button><a class="brand" href="${import.meta.env.BASE_URL}" aria-label="Stringflow 首页"><span class="brand-icon">≋</span>stringflow<span class="brand-dot">.</span></a><div class="nav-active"><span>♫</span> 六线谱练习室</div><div class="sidebar-label library-label">我的曲谱</div><div id="library"></div><button id="sidebar-import" class="sidebar-import">＋ 导入自己的曲谱</button></aside>
<main><header class="topbar"><button id="toggle-library" class="button secondary" aria-expanded="false" aria-controls="library-panel">☰ 曲库</button><span class="app-name">stringflow<span>.</span></span><div class="top-right"><button id="open-tuner" class="button secondary">♮ 调音器</button><button id="import-button" class="button secondary">导入曲谱</button><button id="edit-button" class="text-button">编辑</button></div></header>
<div class="content">
<section class="song-card"><div class="song-info"><h1 id="song-title"></h1><p id="song-artist"></p></div><div class="tags"><span id="tuning-tag"></span><span id="time-tag"></span><span id="capo-tag"></span></div></section>
<div class="workspace"><div class="practice-column"><section class="transport card"><div class="mode-tabs" role="group" aria-label="播放模式"><button id="tempo-mode" class="selected">◷ 节拍播放</button><button id="follow-mode">⌁ 智能跟奏 <span>MIC</span></button></div><div class="transport-controls"><button id="rewind" class="icon-button" aria-label="回到开头">↤</button><button id="play" class="play-button" aria-label="播放">${iconPlay}</button><div class="tempo-control"><label for="bpm">速度 <span>♩ = BPM</span></label><div><button id="slower" aria-label="减慢速度">−</button><input id="bpm" type="number" min="30" max="240" aria-label="每分钟四分音符数"/><button id="faster" aria-label="加快速度">＋</button></div></div><div class="transport-divider"></div><label class="check-control"><input id="metronome" type="checkbox" checked/>节拍器</label><label class="check-control"><input id="sound" type="checkbox" checked/>示范音</label><label class="count-control">预备<select id="count-in" aria-label="预备小节"><option value="1">1 小节</option><option value="0">无</option><option value="2">2 小节</option></select></label></div><div class="transport-bottom"><span id="mode-help">按设定速度播放，谱面随当前音符自动滚动。</span><span id="beat-dots"></span></div></section>
<section id="follow-panel" class="follow-panel card" hidden aria-label="跟奏状态"><div class="follow-feedback"><b id="target-note"></b><span id="follow-heard">点击播放开启麦克风</span></div><div class="follow-input"><meter id="follow-level" min="0" max="1" value="0" aria-label="麦克风输入音量"></meter><span id="follow-signal">未开启</span></div><button id="follow-next" class="text-button" aria-label="手动跳到下一音">跳过 ›</button></section><section class="score-card card"><div class="score-toolbar"><div><span class="section-icon">≡</span><b>六线谱</b><span id="bar-position" class="muted"></span><span id="ring-tag" class="muted" hidden>let ring</span></div><div class="score-actions"><label class="zoom-control">谱面<select id="score-size" aria-label="谱面大小"><option value="normal">标准</option><option value="large">放大</option></select></label><button id="focus-score" class="text-button" aria-pressed="false">专注</button><label class="check-control"><input id="loop" type="checkbox"/>循环</label><select id="loop-start" aria-label="循环起始小节"></select><span>—</span><select id="loop-end" aria-label="循环结束小节"></select><button id="export" class="icon-button" aria-label="导出 JSON 曲谱">↓</button></div></div><div class="progress-track"><div id="progress"></div></div><div id="score" class="score-scroll" tabindex="0" aria-label="六线谱，点击音符或小节从此播放"></div><div class="score-footer"><details class="notation-key"><summary>谱面记号</summary><p id="notation-note"></p><p>下方数字是拍点，&amp; 是半拍。单符杠：八分音符；双符杠：十六分音符；圆点：附点。</p></details><span>点击音符 / 小节播放 · 空格暂停 / 继续</span></div></section>
<div id="status" class="status" role="status" aria-live="polite">已就绪。</div></div>
</div></div></main><dialog id="tuner" aria-label="随谱调音"><section class="tuner-card card"><div class="panel-heading"><h3>调音器</h3><button id="close-tuner" class="icon-button" aria-label="关闭调音器">×</button></div><p class="panel-description">按谱面定弦调音。</p><select id="tuning-preset" aria-label="调弦方案"></select><div class="tuner-display"><span id="tuner-state" class="tuner-state">等待麦克风</span><div id="detected-note" class="detected-note">—<small>轻拨一根空弦</small></div><div class="tuner-scale"><span>偏低</span><span>准</span><span>偏高</span><div class="scale-lines"></div><div id="needle" class="needle"></div></div><div id="cents" class="cents">— cents</div><div id="frequency" class="frequency">A4 = 440 Hz</div></div><div id="strings" class="strings"></div><label class="check-control capo-check"><input id="tune-capo" type="checkbox"/>已夹变调夹，按夹后空弦调音</label><button id="mic-button" class="button mic-button">◉ 开启麦克风</button><button id="reference" class="text-button reference">♪ 播放选中弦的参考音</button><p id="tuner-hint" class="fineprint"></p></section>
<p id="tuner-feedback" role="status"></p></dialog>
<dialog id="editor"><form method="dialog"><div class="dialog-heading"><div><h2>导入 / 编辑曲谱</h2></div><button class="icon-button" aria-label="关闭编辑器">×</button></div></form><p>支持 JSON 曲谱与等时值文本六线谱；图片、PDF 和 Guitar Pro 尚未支持。</p><div class="editor-actions"><label class="button secondary file-button">选择文件<input id="file" type="file" accept=".json,.txt,.tab"/></label><button id="ascii-example" class="text-button">文本谱示例</button><button id="json-current" class="text-button">当前谱 JSON</button></div><textarea id="score-input" spellcheck="false" aria-label="曲谱内容"></textarea><p class="fineprint">文本谱：1 弦到 6 弦排列，品数按列对齐；@step 以四分音符为单位。@tuning 从低音 6 弦到高音 1 弦。变调夹用 @capo 指定。</p><p id="editor-error" class="error" role="alert"></p><div class="dialog-footer"><span>只保存于当前浏览器</span><button id="apply-score" class="button primary">载入曲谱 →</button></div></dialog>`;

function status(message: string, error = false) {
  $("#status").textContent = message;
  $("#tuner-feedback").textContent = message;
  $("#status").classList.toggle("error", error);
}
function persist() {
  try {
    localStorage.setItem("stringflow-score", JSON.stringify(score));
  } catch {
    status("浏览器无法保存曲谱；仍可练习或导出 JSON。");
  }
}
function totalBeats() {
  return score.events.reduce((n, e) => n + e.beats, 0);
}
function totalBars() {
  return Math.ceil(totalBeats() / beatsPerBar(score));
}
function bounds() {
  if (!$<HTMLInputElement>("#loop").checked)
    return { start: 0, end: totalBeats() };
  return {
    start:
      (Number($<HTMLSelectElement>("#loop-start").value) - 1) *
      beatsPerBar(score),
    end: Math.min(
      Number($<HTMLSelectElement>("#loop-end").value) * beatsPerBar(score),
      totalBeats(),
    ),
  };
}
function tuningName() {
  return (
    Object.entries(PRESETS).find(([, v]) =>
      v.every((m, i) => m === score.tuning[i]),
    )?.[0] ?? "自定义定弦"
  );
}
function renderStrings() {
  const capo = $<HTMLInputElement>("#tune-capo").checked ? score.capo : 0;
  $("#strings").innerHTML = score.tuning
    .map(
      (m, i) =>
        `<button class="string-button ${selectedString === i ? "selected" : ""}" data-string="${i}" aria-label="${6 - i} 弦 ${noteName(m + capo)}"><small>${6 - i} 弦</small><b>${noteName(m + capo)}</b></button>`,
    )
    .join("");
  $("#tuner-hint").textContent =
    `${score.capo ? `谱面 Capo ${score.capo}：${capo ? "按夹后空弦音高调音" : "先取下变调夹调准空弦，再夹到指定品位"}。` : "点击弦锁定目标，再次点击恢复自动选弦。"} 调音时请暂停示范音。`;
}
function fretLabel(n: TabNote) {
  const value =
    n.technique === "muted"
      ? "×"
      : n.technique === "harmonic"
        ? `◇${n.fret}`
        : String(n.fret);
  return n.ghost ? `(${value})` : value;
}
function renderScore() {
  eventStarts = starts(score);
  const bar = beatsPerBar(score);
  $("#song-title").textContent = score.title;
  $("#ring-tag").hidden = !score.letRing;
  const hasTechniques = score.events.some(
    (e) =>
      e.palmMute ||
      e.percussion ||
      e.strum ||
      e.notes.some((n) => n.technique || n.ghost || n.link),
  );
  $("#notation-note").hidden = !hasTechniques;
  $("#notation-note").textContent =
    "H + 弧线：击弦 · P + 弧线：勾弦 · S + 斜线：滑音 · ↑：6→1 弦下扫 · ↓：1→6 弦上扫 · 拍：拍琴身 · 拍弦 / ×：无固定音高的弦击打 · P.M.：掌根制音 · ◇12：自然泛音 · ( )：弱奏 · let ring：保留余音。";

  $("#song-artist").textContent = score.artist;
  $("#tuning-tag").textContent =
    `${tuningName()} · ${score.tuning.map(noteName).join(" ")}`;
  $("#time-tag").textContent = `${score.timeSignature.join("/")} 拍`;
  $("#capo-tag").textContent = score.capo ? `Capo ${score.capo}` : "无变调夹";
  $<HTMLInputElement>("#bpm").value = String(score.bpm);
  $("#tuning-preset").innerHTML =
    Object.keys(PRESETS)
      .map(
        (n) => `<option ${n === tuningName() ? "selected" : ""}>${n}</option>`,
      )
      .join("") +
    (tuningName() === "自定义定弦"
      ? "<option selected>自定义定弦</option>"
      : "");
  $("#loop-start").innerHTML = $("#loop-end").innerHTML = Array.from(
    { length: totalBars() },
    (_, i) => `<option value="${i + 1}">${i + 1} 小节</option>`,
  ).join("");
  $<HTMLSelectElement>("#loop-end").value = String(totalBars());
  links = connections(score);
  const bars = Array.from({ length: totalBars() }, (_, b) => {
    const notes = score.events
      .map((event, i) => ({ event, i, beat: eventStarts[i] }))
      .filter((e) => e.beat >= b * bar && e.beat < (b + 1) * bar);
    return `<div class="tab-bar ${notes.some(({ event }) => event.palmMute || event.percussion) ? "with-techniques" : ""}" id="bar-${b}"><div class="bar-heading"><button class="bar-start" data-bar-start="${notes[0]?.i ?? ""}" aria-label="从第 ${b + 1} 小节播放" ${notes.length ? "" : "disabled"}>${String(b + 1).padStart(2, "0")}</button><span>${escape(score.barAnnotations?.[String(b + 1)] ?? (b === 0 ? tuningName() : ""))}</span></div><div class="staff"><div class="staff-labels">${[
      ...score.tuning,
    ]
      .reverse()
      .map((n) => `<span>${noteName(n).replace(/\d/g, "")}</span>`)
      .join(
        "",
      )}</div><div class="staff-body">${Array.from({ length: 6 }, (_, i) => `<div class="staff-line" style="top:${i * 22 + 10}px"></div>`).join("")}${notes.map(({ event, i, beat }) => `<button class="tab-event" data-event="${i}" aria-label="音符 ${i + 1}，${event.notes.length ? event.notes.map((n) => `${n.string} 弦 ${fretLabel(n)}`).join("，") : event.percussion ? "拍击" : "休止"}${techniqueDescription(event) ? `，${techniqueDescription(event)}` : ""}" title="${event.beats} 拍${techniqueDescription(event) ? ` · ${techniqueDescription(event)}` : ""}" style="left:${beatX(beat - b * bar, bar)}%">${event.notes.length ? event.notes.map((n) => `<span class="fret ${n.technique ?? ""} ${n.ghost ? "ghost" : ""}" style="top:${(n.string - 1) * 22}px">${fretLabel(n)}</span>`).join("") : event.percussion ? `<span class="percussion-hit">${event.percussion === "body-tap" ? "✦" : "×"}</span>` : `<span class="rest">${restSymbol(event.beats)}</span>`}</button>`).join("")}${techniqueMarkup(score, eventStarts, b, bar, links)}${rhythmMarkup(notes, b * bar, bar, score.timeSignature)}<div class="beat-labels">${Array.from({ length: score.timeSignature[0] * 2 }, (_, i) => `<span class="${i % 2 ? "offbeat" : "onbeat"}" style="left:${beatX(i * (2 / score.timeSignature[1]), bar)}%">${i % 2 ? "&" : i / 2 + 1}</span>`).join("")}</div><div class="beat-grid" aria-hidden="true">${Array.from({ length: score.timeSignature[0] }, (_, i) => `<i style="left:${beatX(i * (4 / score.timeSignature[1]), bar)}%"></i>`).join("")}</div><div class="playhead" aria-hidden="true"></div></div></div></div>`;
  });
  $("#score").innerHTML = bars.join("");
  $("#score").scrollTop = 0;
  $("#beat-dots").innerHTML = Array.from(
    { length: score.timeSignature[0] },
    (_, i) => `<i>${i + 1}</i>`,
  ).join("");
  renderStrings();
  updatePosition(false);
  persist();
}
function updatePosition(scroll = true) {
  document.querySelector(".tab-event.current")?.classList.remove("current");
  const current = $(`[data-event="${index}"]`);
  current?.classList.add("current");
  const b = Math.floor((eventStarts[index] ?? 0) / beatsPerBar(score));
  $("#bar-position").textContent = `${b + 1} / ${totalBars()} 小节`;
  $("#progress").style.width =
    `${((eventStarts[index] ?? 0) / totalBeats()) * 100}%`;
  const e = score.events[index];
  const pitches = e.notes.filter((n) => n.technique !== "muted");
  $("#target-note").textContent = pitches.length
    ? `等待 ${pitches.map((n) => noteName(eventPitch(score, n))).join(" + ")}${e.percussion ? " · 拍击" : ""}`
    : e.percussion || e.notes.length
      ? "等待拍击 / 闷弦起音"
      : "休止";
  if (scroll && b !== lastBar) {
    const bar = $(`#bar-${b}`),
      container = $("#score");
    const top = bar.offsetTop;
    if (
      top < container.scrollTop ||
      top + bar.offsetHeight > container.scrollTop + container.clientHeight
    )
      container.scrollTo({
        top: top - 12,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  }
  lastBar = b;
  showBeat(eventStarts[index] ?? 0);
}
function showBeat(beat: number) {
  const barBeats = beatsPerBar(score);
  const b = Math.floor(beat / barBeats);
  const bar = $(`#bar-${b}`);
  document
    .querySelector(".tab-bar.playing-bar")
    ?.classList.remove("playing-bar");
  bar?.classList.add("playing-bar");
  const head = bar?.querySelector<HTMLElement>(".playhead");
  if (head) head.style.left = `${beatX(beat - b * barBeats, barBeats)}%`;
  const pulse = Math.floor(
    (beat - b * barBeats) / (4 / score.timeSignature[1]),
  );
  bar
    ?.querySelectorAll(".onbeat")
    .forEach((el, i) => el.classList.toggle("active", i === pulse));
}
function stopMic() {
  $("#follow-heard").textContent = "麦克风未开启";
  $("#follow-signal").textContent = "未开启";
  $<HTMLMeterElement>("#follow-level").value = 0;
  $("#follow-panel").classList.remove("matching");
  micRequest++;
  audio.stopMic();
  mic = "off";
  micPending = false;
  $("#mic-button").textContent = "◉ 开启麦克风";
  $("#tuner-state").textContent = "等待麦克风";
  $("#detected-note").innerHTML = "—<small>轻拨一根空弦</small>";
  $("#cents").textContent = "— cents";
  $("#needle").style.left = "50%";
  $("#frequency").textContent = "A4 = 440 Hz";
  document
    .querySelectorAll(".string-button")
    .forEach((el) => el.classList.remove("hearing"));
  $("#tuner-state").classList.remove("in-tune");
}
function pause() {
  playGeneration++;
  playPending = false;
  playing = false;
  clearInterval(timer);
  cancelAnimationFrame(frame);
  audio.silence();
  follower.reset();
  restUntil = 0;
  $("#play").innerHTML = iconPlay;
  $("#play").setAttribute("aria-label", "播放");
  if (mic === "follow" || micPending) stopMic();
  document
    .querySelectorAll("#beat-dots i")
    .forEach((d) => d.classList.remove("active"));
}
function onPitch(p: ReturnType<typeof import("./pitch.ts").detectPitch>) {
  if (p) {
    const capo = $<HTMLInputElement>("#tune-capo").checked ? score.capo : 0;
    const closest =
      selectedString < 0
        ? score.tuning.reduce(
            (best, m, i) =>
              Math.abs(centsFrom(p.hz, m + capo)) <
              Math.abs(centsFrom(p.hz, score.tuning[best] + capo))
                ? i
                : best,
            0,
          )
        : selectedString;
    const followNote =
      mic === "follow" ? score.events[index].notes[0] : undefined;
    const target = followNote
      ? eventPitch(score, followNote)
      : score.tuning[closest] + capo;
    const cents = centsFrom(p.hz, target);
    $("#detected-note").innerHTML =
      `${noteName(midiFromHz(p.hz))}<small>${followNote ? "跟奏目标" : `目标 ${6 - closest} 弦`} · ${noteName(target)}</small>`;
    $("#cents").textContent =
      `${cents > 0 ? "+" : ""}${Math.round(cents)} cents`;
    $("#frequency").textContent =
      `${p.hz.toFixed(1)} Hz · 目标 ${frequency(target).toFixed(1)} Hz`;
    $("#needle").style.left =
      `${50 + Math.max(-50, Math.min(50, cents)) * 0.8}%`;
    $("#tuner-state").textContent =
      mic === "follow"
        ? Math.abs(cents) < 45
          ? "已匹配 · 继续演奏"
          : "正在聆听目标音"
        : Math.abs(cents) < 5
          ? "音准刚刚好"
          : cents < 0
            ? "偏低 · 轻轻拧紧"
            : "偏高 · 轻轻放松";
    $("#tuner-state").classList.toggle("in-tune", Math.abs(cents) < 5);
    document
      .querySelectorAll(".string-button")
      .forEach((el, i) =>
        el.classList.toggle(
          "hearing",
          i === (followNote ? 6 - followNote.string : closest),
        ),
      );
  } else {
    $("#tuner-state").textContent = "聆听中 · 请单独拨弦";
    $("#tuner-state").classList.remove("in-tune");
    $("#detected-note").innerHTML = "—<small>轻拨一根空弦</small>";
    $("#cents").textContent = "— cents";
    $("#frequency").textContent = "A4 = 440 Hz";
    $("#needle").style.left = "50%";
    document
      .querySelectorAll(".string-button")
      .forEach((el) => el.classList.remove("hearing"));
  }
}
function onFollowFrame(samples: Float32Array, sampleRate: number, now: number) {
  if (!playing || mode !== "follow") return;
  const frame = listening.analyze(samples, sampleRate);
  const event = score.events[index];
  const expected = event.notes
    .filter((n) => n.technique !== "muted")
    .map((n) => eventPitch(score, n));
  const percussive = Boolean(
    event.percussion || event.notes.some((n) => n.technique === "muted"),
  );
  $<HTMLMeterElement>("#follow-level").value = Math.min(1, frame.peak * 5);
  $("#follow-heard").textContent = frame.pitches.length
    ? `检测音高 ${frame.pitches.slice(0, 6).map(noteName).join(" · ")}`
    : frame.rms < 0.0025
      ? "输入较小，请靠近麦克风拨弦"
      : "已收到声音，等待目标音高或拍击";
  $("#follow-signal").textContent =
    frame.rms < 0.0025
      ? "输入较小"
      : frame.peak > 0.8
        ? "输入过强"
        : targetMatch(frame, expected)
          ? "匹配中"
          : "聆听中";
  $("#follow-panel").classList.toggle("matching", targetMatch(frame, expected));
  if (follower.update(frame, expected, percussive, now)) advanceFollow();
}
async function startMic(purpose: "tuner" | "follow") {
  if (mic === purpose) return true;
  stopMic();
  micPending = true;
  const request = micRequest;
  $("#mic-button").textContent = "正在请求麦克风…";
  if (purpose === "follow")
    $("#follow-heard").textContent = "正在请求麦克风权限…";
  try {
    const started = await audio.listen(
      onPitch,
      () => {
        pause();
        stopMic();
        status("麦克风已断开，请重新开启。", true);
      },
      purpose === "follow" ? onFollowFrame : undefined,
    );
    if (!started || request !== micRequest) return false;
    mic = purpose;
    micPending = false;
    $("#mic-button").textContent = "◉ 关闭麦克风";
    $("#tuner-state").textContent = "聆听中";
    return true;
  } catch (e) {
    if (request !== micRequest) return false;
    stopMic();
    const name = e instanceof DOMException ? e.name : "";
    status(
      name === "NotAllowedError"
        ? "麦克风访问被拒绝，请在浏览器站点设置中允许。"
        : name === "NotFoundError"
          ? "没有找到麦克风，请连接音频输入设备。"
          : e instanceof Error
            ? e.message
            : "无法访问麦克风。",
      true,
    );
    return false;
  }
}
function finish() {
  pause();
  $("#progress").style.width = "100%";
  status("这一遍完成了。");
  completed = true;
}
function advanceFollow() {
  const { start, end } = bounds();
  if (index + 1 >= score.events.length || eventStarts[index + 1] >= end) {
    if ($<HTMLInputElement>("#loop").checked) {
      index = eventStarts.findIndex((b) => b >= start);
      restUntil = 0;
      updatePosition();
    } else finish();
  } else {
    index++;
    restUntil = 0;
    updatePosition();
  }
}
function schedule() {
  if (!playing || !audio.context) return;
  const ctx = audio.context,
    seconds = 60 / score.bpm,
    lookAhead = ctx.currentTime + 0.22;
  while (nextEvent < score.events.length && eventStarts[nextEvent] < endBeat) {
    const t = startTime + (eventStarts[nextEvent] - startBeat) * seconds;
    if (t > lookAhead) break;
    if (t >= ctx.currentTime - 0.03 && $<HTMLInputElement>("#sound").checked) {
      const event = score.events[nextEvent];
      const when = Math.max(t, ctx.currentTime);
      const pitched = event.notes.filter((n) => n.technique !== "muted");
      if (!event.notes.length && event.percussion !== "body-tap")
        audio.dampAll(when);
      if (event.percussion) audio.percussion(when, event.percussion);
      for (const { note: n, offset } of strokeNotes(event)) {
        const onset = when + offset;
        const volume =
          (n.ghost ? 0.4 : 1) / Math.sqrt(Math.max(1, pitched.length));
        if (n.technique === "muted") {
          audio.dampString(n.string, onset);
          if (!event.percussion)
            audio.percussion(
              onset,
              "muted",
              (n.ghost ? 0.35 : 1) / Math.sqrt(event.notes.length),
            );
        } else if (n.technique === "harmonic") {
          audio.tone(
            frequency(eventPitch(score, n)),
            onset,
            event.beats * seconds,
            false,
            volume,
            true,
            n.string,
          );
        } else {
          const connection = n.link
            ? links.find((l) => l.to === nextEvent && l.string === n.string)
            : undefined;
          // A loop/seek beginning inside a connection has no preceding source attack.
          if (connection && eventStarts[connection.from] < startBeat)
            audio.dampString(n.string, onset);
          audio.guitarNote(
            frequency(eventPitch(score, n)),
            onset,
            event.beats * seconds,
            {
              string: n.string,
              volume,
              palmMute: event.palmMute,
              letRing: score.letRing,
              link: n.link,
            },
          );
        }
      }
    }
    nextEvent++;
  }
  const unit = 4 / score.timeSignature[1];
  while (nextClick < endBeat) {
    const t = startTime + (nextClick - startBeat) * seconds;
    if (t > lookAhead) break;
    if (
      t >= ctx.currentTime - 0.03 &&
      (nextClick < startBeat || $<HTMLInputElement>("#metronome").checked)
    )
      audio.tone(
        Math.abs(
          nextClick / beatsPerBar(score) -
            Math.round(nextClick / beatsPerBar(score)),
        ) < 0.001
          ? 1400
          : 950,
        Math.max(t, ctx.currentTime),
        0.045,
        true,
      );
    nextClick += unit;
  }
}
function beginTempo(countIn: boolean, anchor?: number) {
  const ctx = audio.context!,
    b = bounds();
  startBeat = eventStarts[index];
  endBeat = b.end;
  const count = countIn
    ? Number($<HTMLSelectElement>("#count-in").value) * beatsPerBar(score)
    : 0;
  startTime = anchor ?? ctx.currentTime + 0.07 + (count * 60) / score.bpm;
  nextEvent = index;
  const unit = 4 / score.timeSignature[1];
  nextClick = Math.ceil((startBeat - count) / unit) * unit;
  schedule();
}
function animate() {
  if (!playing) return;
  if (mode === "tempo") {
    const beat =
      startBeat + ((audio.context!.currentTime - startTime) * score.bpm) / 60;
    if (beat >= endBeat) {
      if ($<HTMLInputElement>("#loop").checked) {
        index = eventStarts.findIndex((v) => v >= bounds().start);
        beginTempo(false, startTime + ((endBeat - startBeat) * 60) / score.bpm);
        updatePosition();
      } else {
        finish();
        return;
      }
    } else if (beat >= startBeat) {
      let next = index;
      while (next + 1 < score.events.length && eventStarts[next + 1] <= beat)
        next++;
      if (next !== index) {
        index = next;
        updatePosition();
      }
      $("#progress").style.width =
        `${(Math.max(0, beat) / totalBeats()) * 100}%`;
      showBeat(beat);
      const pulse =
        Math.floor(beat / (4 / score.timeSignature[1])) %
        score.timeSignature[0];
      document
        .querySelectorAll("#beat-dots i")
        .forEach((el, i) => el.classList.toggle("active", i === pulse));
      if ($("#status").textContent?.startsWith("预备"))
        status("正在按节拍播放。");
    }
  } else if (
    !score.events[index].notes.length &&
    !score.events[index].percussion
  ) {
    if (!restUntil)
      restUntil =
        performance.now() + (score.events[index].beats * 60000) / score.bpm;
    if (performance.now() >= restUntil) advanceFollow();
  }
  frame = requestAnimationFrame(animate);
}
async function play(countIn = true) {
  if (playing || playPending) {
    pause();
    status("已暂停。");
    return;
  }
  if (completed) {
    index = 0;
    completed = false;
  }
  const b = bounds();
  if (!eventStarts.some((v) => v >= b.start && v < b.end)) {
    status("此循环范围没有起音，请选择包含音符的小节。", true);
    return;
  }
  if (eventStarts[index] < b.start || eventStarts[index] >= b.end)
    index = eventStarts.findIndex((v) => v >= b.start);
  playPending = true;
  const generation = ++playGeneration;
  try {
    await audio.ready();
    if (generation !== playGeneration) return;
    if (mode === "follow") {
      if (!(await startMic("follow"))) {
        playPending = false;
        return;
      }
    } else if (mic !== "off" || micPending) stopMic();
    if (generation !== playGeneration) return;
    playPending = false;
    playing = true;
    setLibrary(false);
    follower.reset();
    restUntil = 0;
    $("#play").innerHTML = iconPause;
    $("#play").setAttribute("aria-label", "暂停");
    updatePosition();
    if (mode === "tempo") {
      beginTempo(countIn);
      timer = window.setInterval(schedule, 25);
      status(
        countIn && Number($<HTMLSelectElement>("#count-in").value)
          ? "预备拍… 跟着节拍进入。"
          : "正在按节拍播放。",
      );
    } else status("跟奏已开启：单音 / 和弦按音高推进；拍击按新起音推进。");
    frame = requestAnimationFrame(animate);
  } catch (e) {
    pause();
    status(e instanceof Error ? e.message : "音频无法启动。", true);
  }
}
function changeScore(next: Score) {
  setLibrary(false);
  pause();
  stopMic();
  score = next;
  const url = new URL(location.href);
  if (score.id) url.searchParams.set("song", score.id);
  else url.searchParams.delete("song");
  history.replaceState(null, "", url);
  completed = false;
  index = 0;
  selectedString = -1;
  lastBar = -1;
  renderScore();
  status("曲谱已载入，定弦与变调夹已同步。");
}
function openEditor(current: boolean) {
  setLibrary(false);
  $<HTMLTextAreaElement>("#score-input").value = current
    ? JSON.stringify(score, null, 2)
    : ASCII_EXAMPLE;
  $("#editor-error").textContent = "";
  $<HTMLDialogElement>("#editor").showModal();
}
$("#library").innerHTML = LIBRARY.map(
  (s, i) =>
    `<button class="library-item" data-demo="${i}" title="${escape(s.title)}" aria-label="载入 ${escape(s.title)}"><span class="library-art art-${i}">♫</span><span class="library-title">${escape(s.title)}<small>${i === 0 ? "Standard tuning" : i === 1 ? "Drop D" : i === 2 ? "DADGAD · Capo 2" : "CGDGAD · Capo 5"}</small></span><span class="library-arrow">↗</span></button>`,
).join("");
$("#library").addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>("[data-demo]");
  if (button)
    changeScore(structuredClone(LIBRARY[Number(button.dataset.demo)]));
});
$("#play").onclick = () => void play();
$("#rewind").onclick = () => {
  pause();
  index = Math.max(
    0,
    eventStarts.findIndex((v) => v >= bounds().start),
  );
  updatePosition();
  status("已回到起点。");
};
for (const next of ["tempo", "follow"] as const) {
  $(`#${next}-mode`).onclick = () => {
    pause();
    mode = next;
    $("#follow-panel").hidden = next !== "follow";
    $<HTMLInputElement>("#sound").disabled = next === "follow";
    $<HTMLInputElement>("#metronome").disabled = next === "follow";
    $("#tempo-mode").classList.toggle("selected", next === "tempo");
    $("#follow-mode").classList.toggle("selected", next === "follow");
    $("#mode-help").textContent =
      next === "tempo"
        ? "按设定速度播放，谱面随当前音符自动滚动。"
        : "弹对再前进 · 示范音与节拍器自动静音，避免干扰识别。";
    status(
      next === "follow"
        ? "点击播放并允许麦克风。和弦按主要音高匹配，拍击按新起音推进。"
        : "已切换为节拍播放。",
    );
  };
}
function setBpm(n: number) {
  if (!Number.isFinite(n) || n < 30 || n > 240) {
    $<HTMLInputElement>("#bpm").value = String(score.bpm);
    status("速度范围为 30–240 BPM。", true);
    return;
  }
  pause();
  score.bpm = Math.round(n);
  $<HTMLInputElement>("#bpm").value = String(score.bpm);
  persist();
  status(`速度已设为 ${score.bpm} BPM。`);
}
$<HTMLInputElement>("#bpm").onchange = (e) =>
  setBpm(Number((e.target as HTMLInputElement).value));
$("#slower").onclick = () => setBpm(Math.max(30, score.bpm - 5));
$("#faster").onclick = () => setBpm(Math.min(240, score.bpm + 5));
function seekTo(next: number) {
  if (!Number.isInteger(next) || next < 0 || next >= score.events.length)
    return;
  pause();
  completed = false;
  index = next;
  const range = bounds();
  if (eventStarts[index] < range.start || eventStarts[index] >= range.end)
    $<HTMLInputElement>("#loop").checked = false;
  updatePosition();
  // A direct seek plays immediately; the transport button retains count-in.
  void play(false);
}
$("#score").onclick = (e) => {
  const target = e.target as HTMLElement;
  const note = target.closest<HTMLElement>("[data-event]");
  if (note) return seekTo(Number(note.dataset.event));
  const bar = target.closest<HTMLButtonElement>("[data-bar-start]");
  if (bar && !bar.disabled) return seekTo(Number(bar.dataset.barStart));
  const staff = target.closest<HTMLElement>(".staff-body");
  if (!staff) return;
  // Also accept taps in the whitespace between note columns.
  const notes = [...staff.querySelectorAll<HTMLElement>("[data-event]")];
  const nearest = notes.reduce<HTMLElement | undefined>((best, candidate) => {
    const rect = candidate.getBoundingClientRect();
    const distance = Math.abs(e.clientX - (rect.left + rect.width / 2));
    if (!best) return candidate;
    const previous = best.getBoundingClientRect();
    return distance < Math.abs(e.clientX - (previous.left + previous.width / 2))
      ? candidate
      : best;
  }, undefined);
  if (nearest) seekTo(Number(nearest.dataset.event));
};
["#loop", "#loop-start", "#loop-end"].forEach((id) => {
  $(id).onchange = () => {
    pause();
    if (
      Number($<HTMLSelectElement>("#loop-start").value) >
      Number($<HTMLSelectElement>("#loop-end").value)
    )
      $<HTMLSelectElement>("#loop-end").value =
        $<HTMLSelectElement>("#loop-start").value;
    status("循环范围已更新。");
  };
});
$("#mic-button").onclick = () => {
  if (mic !== "off" || micPending) {
    if (playing) pause();
    stopMic();
    status("麦克风已关闭。");
  } else {
    pause();
    void startMic("tuner");
  }
};
$("#strings").onclick = (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-string]");
  if (el) {
    const n = Number(el.dataset.string);
    selectedString = selectedString === n ? -1 : n;
    renderStrings();
  }
};
$("#tune-capo").onchange = renderStrings;
$<HTMLSelectElement>("#tuning-preset").onchange = (e) => {
  const value = (e.target as HTMLSelectElement).value;
  if (PRESETS[value]) changeScore({ ...score, tuning: [...PRESETS[value]] });
};
$("#reference").onclick = async () => {
  pause();
  stopMic();
  try {
    const ctx = await audio.ready();
    const i = selectedString < 0 ? 0 : selectedString;
    audio.tone(
      frequency(
        score.tuning[i] +
          ($<HTMLInputElement>("#tune-capo").checked ? score.capo : 0),
      ),
      ctx.currentTime,
      1.5,
    );
    status(`参考音：${6 - i} 弦。播放后可重新开启麦克风调音。`);
  } catch {
    status("无法启动参考音，请重试。", true);
  }
};
$("#import-button").onclick = $("#sidebar-import").onclick = () =>
  openEditor(false);
$("#edit-button").onclick = () => openEditor(true);
$("#ascii-example").onclick = () => {
  $<HTMLTextAreaElement>("#score-input").value = ASCII_EXAMPLE;
};
$("#json-current").onclick = () => {
  $<HTMLTextAreaElement>("#score-input").value = JSON.stringify(score, null, 2);
};
$<HTMLInputElement>("#file").onchange = async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 1_000_000) {
    $("#editor-error").textContent = "曲谱文件请小于 1 MB。";
    return;
  }
  try {
    $<HTMLTextAreaElement>("#score-input").value = await file.text();
    $("#editor-error").textContent = "";
  } catch {
    $("#editor-error").textContent = "无法读取文件，请重试。";
  }
};
$("#apply-score").onclick = () => {
  try {
    changeScore(parseScore($<HTMLTextAreaElement>("#score-input").value));
    $<HTMLDialogElement>("#editor").close();
  } catch (e) {
    $("#editor-error").textContent =
      e instanceof Error ? e.message : "无法读取曲谱。";
  }
};
$("#export").onclick = () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(score, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${score.title.replace(/[^\p{L}\p{N}_-]/gu, "_")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
document.addEventListener("keydown", (e) => {
  if (
    e.code === "Space" &&
    !document.querySelector("dialog[open]") &&
    (!["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(
      (e.target as HTMLElement).tagName,
    ) ||
      Boolean(
        (e.target as HTMLElement).closest("[data-event], [data-bar-start]"),
      ))
  ) {
    e.preventDefault();
    if (!e.repeat) void play();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pause();
    stopMic();
    status("页面已进入后台，播放与麦克风已暂停。");
  }
});
window.addEventListener("pagehide", () => {
  pause();
  stopMic();
});
renderScore();

function setLibrary(open: boolean) {
  $("main").inert = open;
  $("#library-panel").inert = !open;
  $("#sidebar-shade").hidden = !open;
  $("#toggle-library").setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("library-open", open);
  if (open) $("#close-library").focus();
  else if ($("#library-panel").contains(document.activeElement))
    $("#toggle-library").focus();
}
$("#toggle-library").onclick = () =>
  setLibrary(!document.body.classList.contains("library-open"));
$("#close-library").onclick = $("#sidebar-shade").onclick = () =>
  setLibrary(false);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setLibrary(false);
});
$("#open-tuner").onclick = () => {
  pause();
  setLibrary(false);
  $("#tuner-feedback").textContent = "";
  $<HTMLDialogElement>("#tuner").showModal();
};
$("#close-tuner").onclick = () => $<HTMLDialogElement>("#tuner").close();
$("#tuner").addEventListener("close", () => {
  stopMic();
  audio.silence();
});
$("#focus-score").onclick = () => {
  const focused = document.body.classList.toggle("score-focus");
  $("#focus-score").setAttribute("aria-pressed", String(focused));
  $("#focus-score").textContent = focused ? "退出专注" : "专注";
};
$("#score-size").onchange = () => {
  $("#score").classList.toggle(
    "large-score",
    $<HTMLSelectElement>("#score-size").value === "large",
  );
  lastBar = -1;
  requestAnimationFrame(() => updatePosition());
};

$("#follow-next").onclick = () => {
  if (mode !== "follow") return;
  follower.reset();
  advanceFollow();
};
