import "./style.css";
import { AudioEngine } from "./audio.ts";
import { Follower } from "./follower.ts";
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
import type { Score } from "./score.ts";

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
  follower = new Follower();
let score: Score = structuredClone(DEMOS[0]);
try {
  const saved = localStorage.getItem("stringflow-score");
  if (saved) score = validateScore(JSON.parse(saved));
} catch {
  /* Ignore obsolete or malformed saved scores. */
}
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
<aside class="sidebar"><a class="brand" href="/" aria-label="Stringflow 首页"><span class="brand-icon">≋</span>stringflow<span class="brand-dot">.</span></a><div class="sidebar-label">YOUR PRACTICE SPACE</div><div class="nav-active"><span>♫</span> 六线谱练习室 <span class="nav-pill">BETA</span></div><div class="sidebar-label library-label">我的曲谱</div><div id="library"></div><button id="sidebar-import" class="sidebar-import">＋ 导入自己的曲谱</button><div class="sidebar-footer"><div class="live-dot"></div><div>每天一点，弹得更好<small>让练习，顺着你的节奏。</small></div></div></aside>
<main><header class="topbar"><span>工作空间 <span class="slash">/</span> <b>练习室</b></span><div class="top-right"><span class="local-dot"></span> 本地音频处理 <span class="avatar">S</span></div></header>
<div class="content"><section class="page-heading"><div><div class="eyebrow">LESS SCROLLING. MORE PLAYING.</div><h1>让音乐，自然流动<span>。</span></h1><p>把翻谱交给我们，专注指尖的每一个音。</p></div><button id="import-button" class="button secondary"><span>↥</span> 导入曲谱</button></section>
<section class="song-card"><div class="song-art"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M30 80Q5 58 29 42q12-5 19 1l27-29 11 11-30 28q5 12-5 23-11 14-21 4Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="39" cy="60" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="m24 74 51-51m-47 54 51-51M22 68l13 12" stroke="currentColor"/></svg></div><div class="song-info"><div class="song-eyebrow">ACOUSTIC GUITAR <span>·</span> 六线谱</div><h2 id="song-title"></h2><p id="song-artist"></p><div class="tags"><span id="tuning-tag"></span><span id="time-tag"></span><span id="capo-tag"></span></div></div><button id="edit-button" class="text-button">编辑曲谱 ↗</button></section>
<div class="workspace"><div class="practice-column"><section class="transport card"><div class="mode-tabs" role="group" aria-label="播放模式"><button id="tempo-mode" class="selected">◷ 节拍播放</button><button id="follow-mode">⌁ 智能跟奏 <span>MIC</span></button></div><div class="transport-controls"><button id="rewind" class="icon-button" aria-label="回到开头">↤</button><button id="play" class="play-button" aria-label="播放">${iconPlay}</button><div class="tempo-control"><label for="bpm">速度 <span>♩ = BPM</span></label><div><button id="slower" aria-label="减慢速度">−</button><input id="bpm" type="number" min="30" max="240" aria-label="每分钟四分音符数"/><button id="faster" aria-label="加快速度">＋</button></div></div><div class="transport-divider"></div><label class="check-control"><input id="metronome" type="checkbox" checked/>节拍器</label><label class="check-control"><input id="sound" type="checkbox" checked/>示范音</label><label class="count-control">预备<select id="count-in" aria-label="预备小节"><option value="1">1 小节</option><option value="0">无</option><option value="2">2 小节</option></select></label></div><div class="transport-bottom"><span id="mode-help">按设定速度播放，谱面随当前音符自动滚动。</span><span id="beat-dots"></span></div></section>
<section class="score-card card"><div class="score-toolbar"><div><span class="section-icon">≡</span><b>六线谱</b><span id="bar-position" class="muted"></span></div><div class="score-actions"><label class="check-control"><input id="loop" type="checkbox"/>循环</label><select id="loop-start" aria-label="循环起始小节"></select><span>—</span><select id="loop-end" aria-label="循环结束小节"></select><button id="export" class="icon-button" aria-label="导出 JSON 曲谱">↓</button></div></div><div class="progress-track"><div id="progress"></div></div><div id="score" class="score-scroll" tabindex="0" aria-label="六线谱，点击音符跳转"></div><div class="score-footer"><span><i class="legend-dot"></i> 当前音符</span><span>点击音符定位 · 空格播放 / 暂停</span></div></section>
<div id="status" class="status" role="status" aria-live="polite">准备好了，从第一个音开始。</div><div class="practice-note"><span>✦</span><div><b>慢一点，也是在进步。</b><p>先让每一个音清晰，再一点点加快速度。</p></div><span class="note-lines">////</span></div></div>
<aside class="right-column"><section class="tuner-card card"><div class="panel-heading"><h3>随谱调音</h3><span class="small-tag">TUNER</span></div><p class="panel-description">自动读取谱面定弦，找到准确的声音。</p><select id="tuning-preset" aria-label="调弦方案"></select><div class="tuner-display"><span id="tuner-state" class="tuner-state">等待麦克风</span><div id="detected-note" class="detected-note">—<small>轻拨一根空弦</small></div><div class="tuner-scale"><span>偏低</span><span>准</span><span>偏高</span><div class="scale-lines"></div><div id="needle" class="needle"></div></div><div id="cents" class="cents">— cents</div><div id="frequency" class="frequency">A4 = 440 Hz</div></div><div id="strings" class="strings"></div><label class="check-control capo-check"><input id="tune-capo" type="checkbox"/>已夹变调夹，按夹后空弦调音</label><button id="mic-button" class="button mic-button">◉ 开启麦克风</button><button id="reference" class="text-button reference">♪ 播放选中弦的参考音</button><p id="tuner-hint" class="fineprint"></p></section>
<section class="follow-card"><div class="follow-icon">⌁</div><h3>谱子，跟着你走。</h3><p>选择「智能跟奏」，麦克风听到目标音后，自动走向下一个音。</p><div id="target-note" class="target-note"></div><p class="fineprint">首版支持单音与分解和弦。连续同音请重新拨弦；整和弦请使用节拍播放。</p></section></aside></div><footer class="page-footer"><span>STRINGFLOW / 练习的每一分钟，都算数。</span><span>音频仅在设备上分析，不上传录音。</span></footer></div></main>
<dialog id="editor"><form method="dialog"><div class="dialog-heading"><div><div class="eyebrow">YOUR MUSIC, YOUR PACE</div><h2>把你的谱子带进来</h2></div><button class="icon-button" aria-label="关闭编辑器">×</button></div></form><p>支持 JSON 曲谱与等时值文本六线谱；图片、PDF 和 Guitar Pro 尚未支持。</p><div class="editor-actions"><label class="button secondary file-button">选择文件<input id="file" type="file" accept=".json,.txt,.tab"/></label><button id="ascii-example" class="text-button">文本谱示例</button><button id="json-current" class="text-button">当前谱 JSON</button></div><textarea id="score-input" spellcheck="false" aria-label="曲谱内容"></textarea><p class="fineprint">文本谱：1 弦到 6 弦排列，品数按列对齐；@step 以四分音符为单位。@tuning 从低音 6 弦到高音 1 弦。变调夹用 @capo 指定。</p><p id="editor-error" class="error" role="alert"></p><div class="dialog-footer"><span>只保存于当前浏览器</span><button id="apply-score" class="button primary">载入曲谱 →</button></div></dialog>`;

function status(message: string, error = false) {
  $("#status").textContent = message;
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
function renderScore() {
  eventStarts = starts(score);
  const bar = beatsPerBar(score);
  $("#song-title").textContent = score.title;
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
  const bars = Array.from({ length: totalBars() }, (_, b) => {
    const notes = score.events
      .map((event, i) => ({ event, i, beat: eventStarts[i] }))
      .filter((e) => e.beat >= b * bar && e.beat < (b + 1) * bar);
    return `<div class="tab-bar" id="bar-${b}"><div class="bar-heading"><span>${String(b + 1).padStart(2, "0")}</span><span>${b === 0 ? escape(tuningName()) : ""}</span></div><div class="staff"><div class="staff-labels">${[
      ...score.tuning,
    ]
      .reverse()
      .map((n) => `<span>${noteName(n).replace(/\d/g, "")}</span>`)
      .join(
        "",
      )}</div><div class="staff-body">${Array.from({ length: 6 }, (_, i) => `<div class="staff-line" style="top:${i * 28 + 12}px"></div>`).join("")}${notes.map(({ event, i, beat }) => `<button class="tab-event" data-event="${i}" aria-label="音符 ${i + 1}，${event.notes.length ? event.notes.map((n) => `${n.string} 弦 ${n.fret} 品`).join("，") : "休止"}" style="left:${4 + ((beat - b * bar) / bar) * 90}%;width:${Math.min((event.beats / bar) * 90, 18)}%">${event.notes.length ? event.notes.map((n) => `<span class="fret" style="top:${(n.string - 1) * 28}px">${n.fret}</span>`).join("") : '<span class="rest">𝄽</span>'}<span class="rhythm">${event.beats < 1 ? "♪" : "♩"}</span></button>`).join("")}<div class="beat-labels">${Array.from({ length: score.timeSignature[0] }, (_, i) => `<span>${i + 1}</span>`).join("")}</div></div></div></div>`;
  });
  $("#score").innerHTML = bars.join("");
  $("#beat-dots").innerHTML = Array.from(
    { length: score.timeSignature[0] },
    () => "<i></i>",
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
  $("#target-note").textContent = e.notes.length
    ? `下一个音 · ${e.notes.map((n) => noteName(eventPitch(score, n))).join(" + ")}`
    : "下一拍 · 休止";
  if (scroll && b !== lastBar) {
    const bar = $(`#bar-${b}`),
      container = $("#score");
    container.scrollTo({
      top: bar.offsetTop - 16,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  lastBar = b;
}
function stopMic() {
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
  if (playing && mode === "follow") {
    const e = score.events[index];
    if (e.notes.length !== 1) return;
    if (
      follower.update(
        p?.hz ?? null,
        p?.rms ?? 0,
        eventPitch(score, e.notes[0]),
        performance.now(),
      )
    )
      advanceFollow();
  }
}
async function startMic(purpose: "tuner" | "follow") {
  if (mic === purpose) return true;
  stopMic();
  micPending = true;
  const request = micRequest;
  $("#mic-button").textContent = "正在请求麦克风…";
  try {
    const started = await audio.listen(onPitch, () => {
      pause();
      stopMic();
      status("麦克风已断开，请重新开启。", true);
    });
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
  status("这一遍完成了。做得不错，再练一遍吧。");
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
    lookAhead = ctx.currentTime + 0.1;
  while (nextEvent < score.events.length && eventStarts[nextEvent] < endBeat) {
    const t = startTime + (eventStarts[nextEvent] - startBeat) * seconds;
    if (t > lookAhead) break;
    if (t >= ctx.currentTime - 0.03 && $<HTMLInputElement>("#sound").checked) {
      for (const n of score.events[nextEvent].notes)
        audio.tone(
          frequency(eventPitch(score, n)),
          Math.max(t, ctx.currentTime),
          Math.min(score.events[nextEvent].beats * seconds * 0.9, 1.4),
        );
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
      const pulse =
        Math.floor(beat / (4 / score.timeSignature[1])) %
        score.timeSignature[0];
      document
        .querySelectorAll("#beat-dots i")
        .forEach((el, i) => el.classList.toggle("active", i === pulse));
      if ($("#status").textContent?.startsWith("预备"))
        status("正在按节拍播放。");
    }
  } else if (!score.events[index].notes.length) {
    if (!restUntil)
      restUntil =
        performance.now() + (score.events[index].beats * 60000) / score.bpm;
    if (performance.now() >= restUntil) advanceFollow();
  }
  frame = requestAnimationFrame(animate);
}
async function play() {
  if (playing || playPending) {
    pause();
    status("已暂停。");
    return;
  }
  if (mode === "follow" && score.events.some((e) => e.notes.length > 1)) {
    status(
      "这份谱子包含同时发声的和弦，当前跟奏仅支持单音。请切换节拍播放。",
      true,
    );
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
    follower.reset();
    restUntil = 0;
    $("#play").innerHTML = iconPause;
    $("#play").setAttribute("aria-label", "暂停");
    updatePosition();
    if (mode === "tempo") {
      beginTempo(true);
      timer = window.setInterval(schedule, 25);
      status(
        Number($<HTMLSelectElement>("#count-in").value)
          ? "预备拍… 跟着节拍进入。"
          : "正在按节拍播放。",
      );
    } else status("正在聆听：弹出高亮音符后，谱面自动前进。");
    frame = requestAnimationFrame(animate);
  } catch (e) {
    pause();
    status(e instanceof Error ? e.message : "音频无法启动。", true);
  }
}
function changeScore(next: Score) {
  pause();
  stopMic();
  score = next;
  completed = false;
  index = 0;
  selectedString = -1;
  lastBar = -1;
  renderScore();
  status("曲谱已载入，定弦与变调夹已同步。");
}
function openEditor(current: boolean) {
  $<HTMLTextAreaElement>("#score-input").value = current
    ? JSON.stringify(score, null, 2)
    : ASCII_EXAMPLE;
  $("#editor-error").textContent = "";
  $<HTMLDialogElement>("#editor").showModal();
}
$("#library").innerHTML = DEMOS.map(
  (s, i) =>
    `<button class="library-item" data-demo="${i}"><span class="library-art art-${i}">♫</span><span>${escape(s.title)}<small>${i === 0 ? "Standard tuning" : i === 1 ? "Drop D" : "DADGAD · Capo 2"}</small></span><span class="library-arrow">↗</span></button>`,
).join("");
$("#library").addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>("[data-demo]");
  if (button) changeScore(structuredClone(DEMOS[Number(button.dataset.demo)]));
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
    $("#tempo-mode").classList.toggle("selected", next === "tempo");
    $("#follow-mode").classList.toggle("selected", next === "follow");
    $("#mode-help").textContent =
      next === "tempo"
        ? "按设定速度播放，谱面随当前音符自动滚动。"
        : "弹对再前进 · 示范音与节拍器自动静音，避免干扰识别。";
    status(
      next === "follow"
        ? "点击播放并允许麦克风，开始单音跟奏。"
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
$("#score").onclick = (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-event]");
  if (el) {
    pause();
    completed = false;
    index = Number(el.dataset.event);
    updatePosition();
    status(`已定位到音符 ${index + 1}。`);
  }
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
    !$<HTMLDialogElement>("#editor").open &&
    !["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(
      (e.target as HTMLElement).tagName,
    )
  ) {
    e.preventDefault();
    void play();
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
