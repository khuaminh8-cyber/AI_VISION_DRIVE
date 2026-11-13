import { Tracker } from "./tracker";
import type { Det, FlowVec, LaneResult, Risk, Track } from "./types";

export type ModeKey =
  | "detect" | "track" | "lane" | "seg" | "depth" | "collision" | "blind" | "sign" | "flow" | "scene3d";

export interface Settings {
  modes: Record<ModeKey, boolean>;
  conf: number;
  aiFps: number;
  fovDeg: number;
  ttcWarn: number;
  ttcDanger: number;
  sound: boolean;
  perf: boolean;
  /** Office/CPU-only laptops: 4 AI fps, small frames, no dense models/flow/3D. */
  lite: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  modes: { detect: true, track: true, lane: true, seg: false, depth: false, collision: true, blind: true, sign: true, flow: false, scene3d: false },
  conf: 0.42, aiFps: 8, fovDeg: 70, ttcWarn: 4, ttcDanger: 2, sound: true, perf: false, lite: true,
};

/** A track must be confirmed on this many AI frames before it is drawn. */
export const MIN_VISIBLE_HITS = 2;

export const CAMERA_MAX_FPS = 30;
export const ANALYSIS_MAX_EDGE = 640;

export function cameraConstraints(width: number, height: number, lowPower = false): MediaTrackConstraints {
  return {
    width: { ideal: width },
    height: { ideal: height },
    frameRate: lowPower ? { ideal: 15, max: 20 } : { ideal: 24, max: CAMERA_MAX_FPS },
    facingMode: "environment",
  };
}

export function modelBackendPreference(lowPower: boolean): "wasm" | undefined {
  return lowPower ? "wasm" : undefined;
}

export function boundedVideoSize(width: number, height: number, maxWidth = 1280, maxHeight = 720): readonly [number, number] {
  if (width <= 0 || height <= 0) return [0, 0];
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

export const DEFAULT_MODEL_URL = "https://huggingface.co/onnx-community/yolov10n/resolve/main/onnx/model.onnx";

export type ModelState =
  | { status: "idle" }
  | { status: "loading"; progress: number; text: string }
  | { status: "ready"; backend: string; name: string }
  | { status: "error"; message: string };

export type AuxKind = "seg" | "depth";
export const AUX_MODELS: Record<AuxKind, { url: string; name: string; size: string }> = {
  seg: { url: "https://huggingface.co/Xenova/segformer-b0-finetuned-ade-512-512/resolve/main/onnx/model_quantized.onnx", name: "SegFormer-B0 (ADE20K)", size: "~4 MB" },
  depth: { url: "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx", name: "Depth Anything V2 Small", size: "~27 MB" },
};

export interface AuxMask { canvas: HTMLCanvasElement; t: number; roadFrac: number; ms: number }

export interface LaneState {
  left: { xb: number; xt: number; seen: number } | null;
  right: { xb: number; xt: number; seen: number } | null;
  yb: number; yt: number;
  offsetM: number | null;
  departure: Risk;
}

export interface Stats {
  aiFps: number; latency: number; camFps: number; renderFps: number; laneMs: number;
  objects: number; nearest: Track | null; worstRisk: Risk; blindLeft: boolean; blindRight: boolean;
  signs: string[];
}

const RISK_ORDER: Risk[] = ["na", "safe", "warning", "danger"];

export class AdasEngine {
  tracker = new Tracker();
  settings: Settings = DEFAULT_SETTINGS;
  video: HTMLVideoElement | null = null;
  lane: LaneState = { left: null, right: null, yb: 0.96, yt: 0.6, offsetM: null, departure: "na" };
  flow: FlowVec[] | null = null;
  stats: Stats = { aiFps: 0, latency: 0, camFps: 0, renderFps: 0, laneMs: 0, objects: 0, nearest: null, worstRisk: "na", blindLeft: false, blindRight: false, signs: [] };
  fpsHist: number[] = [];
  latHist: number[] = [];
  modelReady = false;
  onModel: (s: ModelState) => void = () => {};
  onError: (msg: string) => void = () => {};

  aux: Record<AuxKind, { worker: Worker | null; busy: boolean; ready: boolean; last: number; mask: AuxMask | null }> = {
    seg: { worker: null, busy: false, ready: false, last: 0, mask: null },
    depth: { worker: null, busy: false, ready: false, last: 0, mask: null },
  };
  onAux: (k: AuxKind, s: ModelState) => void = () => {};

  loadAux(k: AuxKind) {
    const a = this.aux[k];
    if (!a.worker) {
      a.worker = new Worker(new URL("../../workers/auxiliary.worker.ts", import.meta.url), { type: "module" });
      a.worker.onmessage = (e) => this.onAuxMsg(k, e.data);
    }
    a.ready = false; a.busy = false;
    this.onAux(k, { status: "loading", progress: 0, text: "Đang tải model…" });
    a.worker.postMessage({ type: "load", kind: k, url: AUX_MODELS[k].url });
  }

  /** Free GPU/CPU memory: terminate the worker entirely. */
  unloadAux(k: AuxKind) {
    const a = this.aux[k];
    a.worker?.terminate(); a.worker = null; a.ready = false; a.busy = false; a.mask = null;
    this.onAux(k, { status: "idle" });
  }

  private onAuxMsg(k: AuxKind, m: any) {
    const a = this.aux[k];
    if (m.type === "progress") this.onAux(k, { status: "loading", progress: m.total ? m.loaded / m.total : 0, text: `Đang tải ${(m.loaded / 1e6).toFixed(1)} MB${m.total ? ` / ${(m.total / 1e6).toFixed(1)} MB` : ""}` });
    else if (m.type === "status") this.onAux(k, { status: "loading", progress: 1, text: m.text });
    else if (m.type === "loaded") { a.ready = true; this.onAux(k, { status: "ready", backend: m.backend, name: AUX_MODELS[k].name }); }
    else if (m.type === "skip") a.busy = false;
    else if (m.type === "error") {
      a.busy = false;
      if (m.during === "load") { a.ready = false; this.onAux(k, { status: "error", message: m.message }); }
    } else if (m.type === "result") {
      a.busy = false;
      const c = a.mask?.canvas ?? document.createElement("canvas");
      if (c.width !== m.w || c.height !== m.h) { c.width = m.w; c.height = m.h; }
      c.getContext("2d")!.putImageData(new ImageData(m.rgba, m.w, m.h), 0, 0);
      a.mask = { canvas: c, t: performance.now(), roadFrac: m.roadFrac, ms: m.ms };
    }
  }

  private det: Worker | null = null;
  private vis: Worker | null = null;
  private detBusy = false;
  private visBusy = false;
  private lastDetSent = 0;
  private lastVisSent = 0;
  private aiStamps: number[] = [];
  private camFrames = 0;
  private camT = performance.now();
  private renderFrames = 0;
  private renderT = performance.now();
  private reqId = 0;
  private audio: AudioContext | null = null;
  private lastBeep = 0;
  private lastVoiceAlert = 0;

  init() {
    this.vis = new Worker(new URL("../../workers/vision.worker.ts", import.meta.url), { type: "module" });
    this.vis.onmessage = (e) => this.onVision(e.data);
  }

  loadModel(src: { url?: string; file?: File; classMap?: number[]; size?: number }, prefer?: "wasm") {
    if (!this.det) {
      this.det = new Worker(new URL("../../workers/detector.worker.ts", import.meta.url), { type: "module" });
      this.det.onmessage = (e) => this.onDet(e.data);
    }
    this.modelReady = false;
    this.detBusy = false;
    const name = src.file ? src.file.name : src.url!.includes("yolov10n") ? "YOLOv10n (COCO)" : src.url!.split("/").pop() ?? "custom";
    this.modelName = name;
    this.onModel({ status: "loading", progress: 0, text: "Đang tải model…" });
    if (src.file) src.file.arrayBuffer().then((buffer) => this.det!.postMessage({ type: "load", buffer, prefer, classMap: src.classMap, size: src.size }, [buffer]));
    else this.det.postMessage({ type: "load", url: src.url, prefer });
  }
  private modelName = "";

  private onDet(m: any) {
    if (m.type === "progress") {
      this.onModel({ status: "loading", progress: m.total ? m.loaded / m.total : 0, text: `Đang tải ${(m.loaded / 1e6).toFixed(1)} MB${m.total ? ` / ${(m.total / 1e6).toFixed(1)} MB` : ""}` });
    } else if (m.type === "status") {
      this.onModel({ status: "loading", progress: 1, text: m.text });
    } else if (m.type === "loaded") {
      this.modelReady = true;
      this.onModel({ status: "ready", backend: m.backend, name: this.modelName });
    } else if (m.type === "error") {
      this.detBusy = false;
      if (m.during === "load") { this.modelReady = false; this.onModel({ status: "error", message: m.message }); }
      else this.onError(m.message);
    } else if (m.type === "result") {
      this.detBusy = false;
      const now = performance.now();
      this.aiStamps.push(now);
      while (this.aiStamps.length && now - this.aiStamps[0] > 1000) this.aiStamps.shift();
      this.stats.latency = this.stats.latency * 0.7 + m.ms * 0.3;
      const v = this.video;
      if (!v || !v.videoWidth) return;
      const sx = v.videoWidth / m.bw, sy = v.videoHeight / m.bh;
      const dets: Det[] = m.dets.map((d: Det) => ({ ...d, x1: d.x1 * sx, x2: d.x2 * sx, y1: d.y1 * sy, y2: d.y2 * sy }));
      this.tracker.update(dets, now / 1000, v.videoWidth, {
        fovDeg: this.settings.fovDeg, ttcWarn: this.settings.ttcWarn, ttcDanger: this.settings.ttcDanger, laneHalfWidth: 1.75,
      }, v.videoHeight);
      this.summarize();
    }
  }

  private onVision(m: { lane: LaneResult | null; flow: FlowVec[] | null; ms: number }) {
    this.visBusy = false;
    this.stats.laneMs = this.stats.laneMs * 0.7 + m.ms * 0.3;
    this.flow = m.flow;
    const now = performance.now();
    const L = this.lane;
    if (m.lane) {
      const sm = (prev: LaneState["left"], cur: { xb: number; xt: number } | null) => {
        if (!cur) return prev && now - prev.seen < 600 ? prev : null;
        if (!prev || now - prev.seen > 600) return { ...cur, seen: now };
        // reject outliers (jumps > 15% of width) unless persistent
        if (Math.abs(cur.xb - prev.xb) > 0.15) return { ...prev, xb: prev.xb + 0.08 * (cur.xb - prev.xb), xt: prev.xt + 0.08 * (cur.xt - prev.xt) };
        return { xb: prev.xb + 0.3 * (cur.xb - prev.xb), xt: prev.xt + 0.3 * (cur.xt - prev.xt), seen: now };
      };
      L.left = sm(L.left, m.lane.left);
      L.right = sm(L.right, m.lane.right);
      L.yb = m.lane.yb; L.yt = m.lane.yt;
      if (L.left && L.right && L.right.xb - L.left.xb > 0.2) {
        const center = (L.left.xb + L.right.xb) / 2;
        const off = ((0.5 - center) / (L.right.xb - L.left.xb)) * 3.5;
        L.offsetM = L.offsetM == null ? off : L.offsetM + 0.3 * (off - L.offsetM);
        const a = Math.abs(L.offsetM);
        L.departure = a > 0.8 ? "danger" : a > 0.45 ? "warning" : "safe";
      } else { L.offsetM = null; L.departure = "na"; }
    } else {
      L.left = L.right = null; L.offsetM = null; L.departure = "na";
    }
  }

  private summarize() {
    const tracks = this.tracker.tracks.filter((t) => t.hits >= 1);
    const S = this.stats;
    S.objects = tracks.length;
    let nearest: Track | null = null, worst: Risk = "na";
    let bl = false, br = false;
    const signs = new Set<string>();
    const vw = this.video?.videoWidth ?? 1;
    for (const t of tracks) {
      if (t.kind === "light" || t.kind === "sign") { signs.add(t.label); continue; }
      if (t.dist != null && t.inEgoLane && (!nearest || t.dist < nearest.dist!)) nearest = t;
      if (this.settings.modes.collision && RISK_ORDER.indexOf(t.risk) > RISK_ORDER.indexOf(worst)) worst = t.risk;
      // Blind-spot proxy: large object hugging the frame edge, beside us (< 6 m).
      if (t.dist != null && t.dist < 6) {
        if (t.cx - t.w / 2 < vw * 0.04) bl = true;
        if (t.cx + t.w / 2 > vw * 0.96) br = true;
      }
    }
    S.nearest = nearest; S.worstRisk = worst; S.blindLeft = bl; S.blindRight = br; S.signs = [...signs];
    const alertKey = !this.settings.sound ? null
      : worst === "danger" ? "collision-danger"
      : this.lane.departure === "danger" ? "lane-danger"
      : worst === "warning" ? "collision-warning"
      : this.lane.departure === "warning" ? "lane-warning" : null;
    this.handleAlert(alertKey);
    if (!alertKey && this.settings.sound && this.settings.modes.sign) this.announceSigns(tracks);
  }

  /** Announce each newly seen sign/light once (front or roadside), with an 8 s cooldown between announcements. */
  private announcedSigns = new Set<number>();
  private lastSignAt = 0;
  private announceSigns(tracks: Track[]) {
    const live = new Set(tracks.map((t) => t.id));
    for (const id of this.announcedSigns) if (!live.has(id)) this.announcedSigns.delete(id);
    const fresh = tracks.find((t) => t.kind === "sign" && t.hits >= 2 && !this.announcedSigns.has(t.id));
    if (!fresh) return;
    const now = performance.now();
    if (now - this.lastSignAt < 8000) return;
    this.lastSignAt = now;
    for (const t of tracks) if (t.kind === "sign") this.announcedSigns.add(t.id);
    const msg = fresh.label === "BIỂN DỪNG" ? "Phía trước có biển dừng!" : "Phía trước có biển báo!";
    this.lastBeep = 0; this.lastVoiceAlert = 0;
    this.beep(840);
    this.speakAlert(msg);
  }

  /** Alert once when a situation appears; while it persists, re-check and repeat at most every 5 s; clear when gone. */
  private activeAlert: string | null = null;
  private activeAlertAt = 0;
  private handleAlert(key: string | null) {
    if (!key) { this.activeAlert = null; return; }
    const now = performance.now();
    if (key === this.activeAlert && now - this.activeAlertAt < 5000) return;
    this.activeAlert = key; this.activeAlertAt = now;
    const messages: Record<string, string> = {
      "collision-danger": "Nguy hiểm! Chú ý xe phía trước!",
      "lane-danger": "Chú ý lệch làn!",
      "collision-warning": "Giữ khoảng cách!",
      "lane-warning": "Chú ý lệch làn!",
    };
    this.lastBeep = 0; this.lastVoiceAlert = 0;
    this.beep(key.endsWith("danger") ? 1000 : 720);
    this.speakAlert(messages[key]);
  }

  visibleTracks() {
    return this.tracker.tracks.filter((t) => t.hits >= MIN_VISIBLE_HITS);
  }

  /** Called from the single rAF loop. */
  tick(now: number) {
    this.renderFrames++;
    if (now - this.renderT >= 1000) {
      this.stats.renderFps = (this.renderFrames * 1000) / (now - this.renderT);
      this.stats.camFps = (this.camFrames * 1000) / (now - this.renderT);
      this.renderFrames = 0; this.camFrames = 0; this.renderT = now;
      this.stats.aiFps = this.aiStamps.length;
      this.fpsHist.push(this.stats.aiFps); this.latHist.push(this.modelReady ? this.stats.latency : 0);
      if (this.fpsHist.length > 60) { this.fpsHist.shift(); this.latHist.shift(); }
    }
    const v = this.video;
    if (!v || v.readyState < 2 || v.paused || !v.videoWidth) return;
    const s = this.settings;
    const aiFps = s.lite ? Math.min(4, s.aiFps) : s.perf ? Math.min(10, s.aiFps) : s.aiFps;
    let grabbed = false;
    if (s.modes.detect && this.modelReady && !this.detBusy && now - this.lastDetSent >= 1000 / aiFps) {
      grabbed = true;
      this.detBusy = true; this.lastDetSent = now;
      const sc = Math.min(1, (s.lite ? 416 : ANALYSIS_MAX_EDGE) / Math.max(v.videoWidth, v.videoHeight));
      createImageBitmap(v, { resizeWidth: Math.round(v.videoWidth * sc), resizeHeight: Math.round(v.videoHeight * sc), resizeQuality: "low" })
        .then((bitmap) => this.det!.postMessage({ type: "infer", bitmap, conf: s.conf, id: ++this.reqId }, [bitmap]))
        .catch(() => { this.detBusy = false; });
    }
    if (!s.modes.detect && this.tracker.tracks.length) { this.tracker.reset(); this.summarize(); }
    const visFps = s.lite ? 4 : s.perf ? 6 : 10;
    if (!grabbed && (s.modes.lane || (s.modes.flow && !s.lite)) && !this.visBusy && now - this.lastVisSent >= 1000 / visFps) {
      this.visBusy = true; this.lastVisSent = now;
      const w = s.perf || s.lite ? 192 : 320;
      createImageBitmap(v, { resizeWidth: w, resizeHeight: Math.round((w * v.videoHeight) / v.videoWidth), resizeQuality: "low" })
        .then((bitmap) => this.vis!.postMessage({ bitmap, lane: s.modes.lane, flow: s.modes.flow && !s.lite }, [bitmap]))
        .catch(() => { this.visBusy = false; });
    }
    if (!s.modes.lane && this.lane.left) { this.lane.left = this.lane.right = null; this.lane.offsetM = null; this.lane.departure = "na"; }
    if (!s.modes.flow || s.lite) this.flow = null;
    // Dense models run at low rate, one in flight each, and never while a detection is pending on weak/perf mode.
    for (const k of ["seg", "depth"] as AuxKind[]) {
      const a = this.aux[k];
      if (grabbed || s.lite || !s.modes[k] || !a.ready || a.busy) continue;
      const fps = s.perf ? 3 : k === "seg" ? 6 : 5;
      if (now - a.last < 1000 / fps || (s.perf && this.detBusy)) continue;
      a.busy = true; a.last = now;
      const w = k === "seg" ? 384 : 252;
      createImageBitmap(v, { resizeWidth: w, resizeHeight: w, resizeQuality: "low" })
        .then((bitmap) => a.worker ? a.worker.postMessage({ type: "infer", bitmap }, [bitmap]) : (bitmap.close(), a.busy = false))
        .catch(() => { a.busy = false; });
    }
  }

  countCamFrame() { this.camFrames++; }

  unlockAudio() {
    try {
      this.audio ??= new AudioContext();
      if (this.audio.state === "suspended") void this.audio.resume();
    } catch { /* audio unavailable */ }
  }

  private speakAlert(message: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const now = performance.now();
    if (now - this.lastVoiceAlert < 2800) return;
    this.lastVoiceAlert = now;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = "vi-VN";
      const vietnameseVoice = window.speechSynthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith("vi"));
      if (vietnameseVoice) utterance.voice = vietnameseVoice;
      window.speechSynthesis.speak(utterance);
    } catch { /* speech unavailable */ }
  }

  beep(freq: number) {
    const now = performance.now();
    if (now - this.lastBeep < 900) return;
    this.lastBeep = now;
    try {
      this.unlockAudio();
      const a = this.audio;
      if (!a) return;
      for (let i = 0; i < 2; i++) {
        const start = a.currentTime + i * 0.18;
        const o = a.createOscillator(), g = a.createGain();
        o.type = "sine"; o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(0.18, start + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
        o.connect(g).connect(a.destination); o.start(start); o.stop(start + 0.13);
      }
    } catch { /* audio unavailable */ }
  }

  reset() {
    this.tracker.reset();
    this.lane = { left: null, right: null, yb: 0.96, yt: 0.6, offsetM: null, departure: "na" };
    this.flow = null; this.fpsHist = []; this.latHist = [];
    this.summarize();
  }

  dispose() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    this.det?.terminate(); this.vis?.terminate(); this.audio?.close();
    for (const k of ["seg", "depth"] as AuxKind[]) { this.aux[k].worker?.terminate(); this.aux[k].worker = null; this.aux[k].ready = false; }
    this.det = this.vis = null;
  }
}
