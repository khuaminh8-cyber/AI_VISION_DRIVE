/// <reference lib="webworker" />
// Object detection worker: ONNX Runtime Web (WebGPU → WASM fallback).
// Supports YOLOv10 ([1,N,6] xyxy,score,cls — NMS-free) and YOLOv5/8/11 ([1,84,N] cxcywh + 80 scores).
import * as ort from "onnxruntime-web/webgpu";
import { ADAS_CLASSES } from "../lib/adas/types";

ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/";

let session: ort.InferenceSession | null = null;
let inputName = "";
let size = 640;
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let input: Float32Array | null = null;
let classMap: number[] | null = null;

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

async function fetchWithProgress(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} khi tải model`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    post({ type: "progress", loaded: got, total });
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function load(m: { url?: string; buffer?: ArrayBuffer; prefer?: string; size?: number; classMap?: number[] }) {
  session?.release();
  session = null;
  size = m.size ?? 640;
  classMap = m.classMap?.length ? m.classMap : null;
  const bytes = m.buffer ? new Uint8Array(m.buffer) : await fetchWithProgress(m.url!);
  post({ type: "status", text: "Đang khởi tạo runtime…" });
  let backend = "";
  const hasGpu = !!(self.navigator as Navigator & { gpu?: unknown }).gpu;
  if (hasGpu && m.prefer !== "wasm") {
    try {
      session = await ort.InferenceSession.create(bytes, { executionProviders: ["webgpu"], graphOptimizationLevel: "all" });
      backend = "WebGPU";
    } catch (e) {
      post({ type: "status", text: "WebGPU lỗi, chuyển sang WASM…" });
      console.warn("webgpu failed", e);
    }
  }
  if (!session) {
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(2, navigator.hardwareConcurrency || 2) : 1;
    session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    backend = "WASM (CPU)";
  }
  inputName = session.inputNames[0];
  canvas = new OffscreenCanvas(size, size);
  ctx = canvas.getContext("2d", { willReadFrequently: true });
  input = new Float32Array(3 * size * size);
  // warm-up
  const t0 = performance.now();
  const wo = await session.run({ [inputName]: new ort.Tensor("float32", input, [1, 3, size, size]) });
  const outputShape = [...wo[session.outputNames[0]].dims];
  const meta = (session as unknown as { inputMetadata?: Array<{ shape?: Array<number | string> }> }).inputMetadata;
  const inputShape = meta?.[0]?.shape ?? [1, 3, size, size];
  post({ type: "loaded", backend, warmup: performance.now() - t0, hasGpu, inputShape, outputShape });
}

function nms(boxes: number[][], thr: number) {
  boxes.sort((a, b) => b[4] - a[4]);
  const keep: number[][] = [];
  for (const b of boxes) {
    let ok = true;
    for (const k of keep) {
      if (k[5] !== b[5]) continue;
      const x1 = Math.max(b[0], k[0]), y1 = Math.max(b[1], k[1]);
      const x2 = Math.min(b[2], k[2]), y2 = Math.min(b[3], k[3]);
      const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
      const u = (b[2] - b[0]) * (b[3] - b[1]) + (k[2] - k[0]) * (k[3] - k[1]) - inter;
      if (u > 0 && inter / u > thr) { ok = false; break; }
    }
    if (ok) keep.push(b);
    if (keep.length >= 60) break;
  }
  return keep;
}

const ADAS_IDS = Object.keys(ADAS_CLASSES).map(Number);

async function infer(m: { bitmap: ImageBitmap; conf: number; id: number }) {
  if (!session || !ctx || !input) { m.bitmap.close(); return; }
  const t0 = performance.now();
  const bw = m.bitmap.width, bh = m.bitmap.height;
  const s = Math.min(size / bw, size / bh);
  const nw = Math.round(bw * s), nh = Math.round(bh * s);
  const px = (size - nw) / 2, py = (size - nh) / 2;
  ctx.fillStyle = "rgb(114,114,114)";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(m.bitmap, px, py, nw, nh);
  m.bitmap.close();
  const px_ = ctx.getImageData(0, 0, size, size).data;
  const area = size * size;
  const inv = 1 / 255;
  for (let i = 0, p = 0; i < area; i++, p += 4) {
    input[i] = px_[p] * inv;
    input[i + area] = px_[p + 1] * inv;
    input[i + 2 * area] = px_[p + 2] * inv;
  }
  const out = await session.run({ [inputName]: new ort.Tensor("float32", input, [1, 3, size, size]) });
  const o = out[session.outputNames[0]];
  const d = o.data as Float32Array;
  const dims = o.dims;
  const raw: number[][] = [];
  if (dims.length === 3 && dims[2] === 6) {
    for (let i = 0; i < dims[1]; i++) {
      const sc = d[i * 6 + 4];
      const rc = Math.round(d[i * 6 + 5]);
      const c = classMap ? classMap[rc] ?? -1 : rc;
      if (sc < m.conf || !ADAS_CLASSES[c]) continue;
      raw.push([d[i * 6], d[i * 6 + 1], d[i * 6 + 2], d[i * 6 + 3], sc, c]);
    }
  } else if (classMap && dims.length === 3 && dims[1] === 4 + classMap.length) {
    const n = dims[2];
    for (let a = 0; a < n; a++) {
      let best = 0, bk = -1;
      for (let k = 0; k < classMap.length; k++) {
        const v = d[(4 + k) * n + a];
        if (v > best) { best = v; bk = k; }
      }
      if (best < m.conf || bk < 0) continue;
      const cx = d[a], cy = d[n + a], w = d[2 * n + a], h = d[3 * n + a];
      raw.push([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, best, classMap[bk]]);
    }
  } else if (dims.length === 3 && dims[1] >= 84) {
    const n = dims[2];
    for (let a = 0; a < n; a++) {
      // fast reject: skip anchor unless some ADAS class clears the base threshold
      let adasBest = 0;
      for (let j = 0; j < ADAS_IDS.length; j++) { const v = d[(4 + ADAS_IDS[j]) * n + a]; if (v > adasBest) adasBest = v; }
      if (adasBest < m.conf) continue;
      // argmax over ALL classes; keep only if the winner is an ADAS class
      let best = 0, bc = -1;
      const nc = dims[1] - 4;
      for (let k = 0; k < nc; k++) {
        const v = d[(4 + k) * n + a];
        if (v > best) { best = v; bc = k; }
      }
      const meta = ADAS_CLASSES[bc];
      if (!meta) continue;
      const minConf = meta.kind === "light" || meta.kind === "sign" ? Math.max(m.conf, 0.5) : m.conf;
      if (best < minConf) continue;
      const cx = d[a], cy = d[n + a], w = d[2 * n + a], h = d[3 * n + a];
      raw.push([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, best, bc]);
    }
  } else {
    post({ type: "error", message: `Định dạng output không hỗ trợ: [${dims.join(",")}]` });
    return;
  }
  const kept = nms(raw, 0.45);
  const dets = kept.map((b) => ({
    x1: Math.max(0, (b[0] - px) / s), y1: Math.max(0, (b[1] - py) / s),
    x2: Math.min(bw, (b[2] - px) / s), y2: Math.min(bh, (b[3] - py) / s),
    score: b[4], cls: b[5],
  }));
  post({ type: "result", id: m.id, dets, bw, bh, ms: performance.now() - t0 });
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === "load") await load(m);
    else if (m.type === "infer") await infer(m);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err), during: m.type });
  }
};
