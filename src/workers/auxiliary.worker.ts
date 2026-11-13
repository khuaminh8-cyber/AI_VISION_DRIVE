/// <reference lib="webworker" />
// On-demand dense models: road segmentation (SegFormer-B0 ADE20K) and monocular depth (Depth Anything V2 small).
// Output is a tiny RGBA mask (≤128 px) so transfer + drawing stays cheap on weak devices.
import * as ort from "onnxruntime-web/webgpu";

ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/";

type Kind = "seg" | "depth";
const post = (m: unknown, t?: Transferable[]) => (self as unknown as Worker).postMessage(m, t ?? []);

const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
// ADE20K classes treated as drivable surface: road, sidewalk? (no), floor-like road surfaces.
const ROAD = new Set([6, 52]); // 6=road, 52=path
const SIZE: Record<Kind, number> = { seg: 384, depth: 252 }; // depth must be a multiple of 14

let session: ort.InferenceSession | null = null;
let kind: Kind = "seg";
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let input: Float32Array | null = null;
let prevDepth: Float32Array | null = null;

async function fetchWithProgress(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} khi tải model`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0, lastPost = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    const now = performance.now();
    if (now - lastPost > 120) { lastPost = now; post({ type: "progress", loaded: got, total }); }
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function load(m: { kind: Kind; url: string }) {
  await session?.release(); session = null; prevDepth = null;
  kind = m.kind;
  const bytes = await fetchWithProgress(m.url);
  post({ type: "status", text: "Đang khởi tạo runtime…" });
  let backend = "";
  if ((self.navigator as Navigator & { gpu?: unknown }).gpu) {
    try { session = await ort.InferenceSession.create(bytes, { executionProviders: ["webgpu"], graphOptimizationLevel: "all" }); backend = "WebGPU"; }
    catch { /* fall back */ }
  }
  if (!session) {
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(2, navigator.hardwareConcurrency || 2) : 1;
    session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    backend = "WASM (CPU)";
  }
  const s = SIZE[kind];
  canvas = new OffscreenCanvas(s, s);
  ctx = canvas.getContext("2d", { willReadFrequently: true });
  input = new Float32Array(3 * s * s);
  post({ type: "loaded", backend });
}

async function infer(bitmap: ImageBitmap) {
  if (!session || !ctx || !input) { bitmap.close(); post({ type: "skip" }); return; }
  const t0 = performance.now();
  const s = SIZE[kind];
  ctx.drawImage(bitmap, 0, 0, s, s); // stretch: masks are drawn back stretched, so geometry matches
  bitmap.close();
  const px = ctx.getImageData(0, 0, s, s).data;
  const area = s * s;
  for (let i = 0, p = 0; i < area; i++, p += 4) {
    input[i] = (px[p] / 255 - MEAN[0]) / STD[0];
    input[i + area] = (px[p + 1] / 255 - MEAN[1]) / STD[1];
    input[i + 2 * area] = (px[p + 2] / 255 - MEAN[2]) / STD[2];
  }
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, s, s]) });
  const o = out[session.outputNames[0]];
  const d = o.data as Float32Array;
  let w: number, h: number, rgba: Uint8ClampedArray;
  let roadFrac = 0;
  if (kind === "seg") {
    const C = o.dims[1], H = o.dims[2], W = o.dims[3], n = H * W;
    w = W; h = H; rgba = new Uint8ClampedArray(n * 4);
    let road = 0;
    for (let i = 0; i < n; i++) {
      let best = -Infinity, bc = 0;
      for (let c = 0; c < C; c++) { const v = d[c * n + i]; if (v > best) { best = v; bc = c; } }
      if (ROAD.has(bc)) { rgba[i * 4] = 61; rgba[i * 4 + 1] = 220; rgba[i * 4 + 2] = 151; rgba[i * 4 + 3] = 110; road++; }
    }
    roadFrac = road / n;
  } else {
    const H = o.dims[o.dims.length - 2], W = o.dims[o.dims.length - 1];
    // downsample to ≤126 px for cheap transfer
    const step = Math.max(1, Math.round(W / 126));
    w = Math.floor(W / step); h = Math.floor(H / step);
    const n = w * h;
    const cur = new Float32Array(n);
    let mn = Infinity, mx = -Infinity;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = d[y * step * W + x * step];
      cur[y * w + x] = v; if (v < mn) mn = v; if (v > mx) mx = v;
    }
    // temporal smoothing kills flicker when the camera shakes
    if (prevDepth && prevDepth.length === n) for (let i = 0; i < n; i++) cur[i] = prevDepth[i] * 0.5 + cur[i] * 0.5;
    prevDepth = cur;
    const r = mx - mn || 1;
    rgba = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      const t = (cur[i] - mn) / r; // 1 = near (relative inverse depth)
      rgba[i * 4] = Math.round(255 * Math.min(1, t * 1.6));
      rgba[i * 4 + 1] = Math.round(255 * Math.max(0, 1 - Math.abs(t - 0.5) * 2) * 0.9);
      rgba[i * 4 + 2] = Math.round(255 * Math.max(0, 1 - t * 1.6));
      rgba[i * 4 + 3] = 150;
    }
  }
  post({ type: "result", w, h, rgba, roadFrac, ms: performance.now() - t0 }, [rgba.buffer]);
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === "load") await load(m);
    else if (m.type === "infer") await infer(m.bitmap);
    else if (m.type === "unload") { await session?.release(); session = null; prevDepth = null; post({ type: "unloaded" }); }
  } catch (err) {
    post({ type: "error", during: m.type, message: err instanceof Error ? err.message : String(err) });
  }
};
