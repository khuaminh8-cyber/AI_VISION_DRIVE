/// <reference lib="webworker" />
// Classic CV worker: lane detection (gray → Gaussian blur → Canny → ROI → Hough)
// and block-matching optical flow. Pure TypeScript, no network.
import type { FlowVec, LaneLine, LaneResult } from "../lib/adas/types";

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let gray = new Float32Array(0), tmp = new Float32Array(0), blur = new Float32Array(0);
let mag = new Float32Array(0), dir = new Uint8Array(0), edges = new Uint8Array(0);
let prevSmall: Float32Array | null = null;

const ROI_TOP = 0.6, ROI_BOT = 0.96;
const T_LO = 18, T_HI = 72; // theta search ranges (deg) for lane-like lines
const COS = new Float32Array(180), SIN = new Float32Array(180);
for (let i = 0; i < 180; i++) { COS[i] = Math.cos((i * Math.PI) / 180); SIN[i] = Math.sin((i * Math.PI) / 180); }

function ensure(n: number) {
  if (gray.length !== n) {
    gray = new Float32Array(n); tmp = new Float32Array(n); blur = new Float32Array(n);
    mag = new Float32Array(n); dir = new Uint8Array(n); edges = new Uint8Array(n);
    prevSmall = null;
  }
}

function gaussian(W: number, H: number) {
  const k = [1, 4, 6, 4, 1];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, ws = 0;
    for (let i = -2; i <= 2; i++) { const xx = x + i; if (xx < 0 || xx >= W) continue; s += gray[y * W + xx] * k[i + 2]; ws += k[i + 2]; }
    tmp[y * W + x] = s / ws;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, ws = 0;
    for (let i = -2; i <= 2; i++) { const yy = y + i; if (yy < 0 || yy >= H) continue; s += tmp[yy * W + x] * k[i + 2]; ws += k[i + 2]; }
    blur[y * W + x] = s / ws;
  }
}

function inRoi(x: number, y: number, W: number, H: number) {
  const yt = H * ROI_TOP, yb = H * ROI_BOT;
  if (y < yt || y > yb) return false;
  const f = (y - yt) / (yb - yt);
  const half = W * (0.08 + f * 0.42);
  return Math.abs(x - W / 2) < half;
}

function canny(W: number, H: number) {
  let sum = 0, cnt = 0;
  const y0 = Math.floor(H * ROI_TOP) - 1;
  for (let y = Math.max(1, y0); y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const gx = -blur[i - W - 1] - 2 * blur[i - 1] - blur[i + W - 1] + blur[i - W + 1] + 2 * blur[i + 1] + blur[i + W + 1];
    const gy = -blur[i - W - 1] - 2 * blur[i - W] - blur[i - W + 1] + blur[i + W - 1] + 2 * blur[i + W] + blur[i + W + 1];
    const m = Math.abs(gx) + Math.abs(gy);
    mag[i] = m; sum += m; cnt++;
    const a = Math.atan2(gy, gx) * (180 / Math.PI);
    const aa = a < 0 ? a + 180 : a;
    dir[i] = aa < 22.5 || aa >= 157.5 ? 0 : aa < 67.5 ? 1 : aa < 112.5 ? 2 : 3;
  }
  const hi = Math.max(60, (sum / Math.max(1, cnt)) * 3.2), lo = hi * 0.45;
  edges.fill(0);
  const stack: number[] = [];
  for (let y = Math.max(1, y0 + 1); y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, m = mag[i];
    if (m < lo) continue;
    let a = 0, b = 0;
    switch (dir[i]) {
      case 0: a = mag[i - 1]; b = mag[i + 1]; break;
      case 1: a = mag[i - W - 1]; b = mag[i + W + 1]; break;
      case 2: a = mag[i - W]; b = mag[i + W]; break;
      default: a = mag[i - W + 1]; b = mag[i + W - 1];
    }
    if (m < a || m < b) continue;
    edges[i] = m >= hi ? 2 : 1;
    if (m >= hi) stack.push(i);
  }
  while (stack.length) {
    const i = stack.pop()!;
    for (const o of [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1]) if (edges[i + o] === 1) { edges[i + o] = 2; stack.push(i + o); }
  }
}

function hough(W: number, H: number): LaneResult {
  const maxR = Math.ceil(Math.hypot(W, H));
  const R = 2 * maxR + 1;
  const acc = new Int32Array(180 * R);
  const thetas: number[] = [];
  for (let t = T_LO; t <= T_HI; t++) thetas.push(t, 180 - t);
  for (let y = Math.floor(H * ROI_TOP); y < H; y++) for (let x = 0; x < W; x++) {
    if (edges[y * W + x] !== 2 || !inRoi(x, y, W, H)) continue;
    for (const t of thetas) acc[t * R + Math.round(x * COS[t] + y * SIN[t]) + maxR]++;
  }
  const yb = H * ROI_BOT, yt = H * ROI_TOP;
  const sides: { l: [number, number, number][]; r: [number, number, number][] } = { l: [], r: [] };
  const minVotes = Math.max(14, H * 0.09);
  for (const t of thetas) for (let r = 1; r < R - 1; r++) {
    const v = acc[t * R + r];
    if (v < minVotes || v < acc[t * R + r - 1] || v < acc[t * R + r + 1]) continue;
    const rho = r - maxR;
    if (Math.abs(COS[t]) < 1e-3) continue;
    const xb = (rho - yb * SIN[t]) / COS[t], xt = (rho - yt * SIN[t]) / COS[t];
    if (xt > xb && xb < W * 0.6 && xb > -W * 0.4) sides.l.push([v, xb, xt]);
    else if (xt < xb && xb > W * 0.4 && xb < W * 1.4) sides.r.push([v, xb, xt]);
  }
  const pick = (arr: [number, number, number][]): LaneLine | null => {
    if (!arr.length) return null;
    arr.sort((a, b) => b[0] - a[0]);
    const top = arr.slice(0, 5);
    let s = 0, xb = 0, xt = 0;
    for (const [v, b, tt] of top) { s += v; xb += v * b; xt += v * tt; }
    return { xb: xb / s / W, xt: xt / s / W };
  };
  return { left: pick(sides.l), right: pick(sides.r), yb: ROI_BOT, yt: ROI_TOP };
}

function flow(W: number, H: number): FlowVec[] {
  // downsample ×2
  const w = W >> 1, h = H >> 1;
  const cur = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cur[y * w + x] = blur[(y * 2) * W + x * 2];
  const out: FlowVec[] = [];
  const prev = prevSmall;
  prevSmall = cur;
  if (!prev || prev.length !== cur.length) return out;
  const B = 4, S = 5, step = 10;
  for (let y = B + S; y < h - B - S; y += step) for (let x = B + S; x < w - B - S; x += step) {
    let best = Infinity, bdx = 0, bdy = 0, zero = 0;
    for (let dy = -S; dy <= S; dy++) for (let dx = -S; dx <= S; dx++) {
      let sad = 0;
      for (let j = -B; j < B; j++) for (let i = -B; i < B; i++) sad += Math.abs(cur[(y + j) * w + x + i] - prev[(y + j - dy) * w + x + i - dx]);
      if (dx === 0 && dy === 0) zero = sad;
      if (sad < best) { best = sad; bdx = dx; bdy = dy; }
    }
    if (zero - best < 40) continue; // textureless / static
    out.push({ x: x / w, y: y / h, dx: bdx / w, dy: bdy / h });
  }
  return out;
}

self.onmessage = (e: MessageEvent) => {
  const { bitmap, lane, flow: wantFlow } = e.data as { bitmap: ImageBitmap; lane: boolean; flow: boolean };
  const t0 = performance.now();
  const W = bitmap.width, H = bitmap.height;
  if (!canvas || canvas.width !== W || canvas.height !== H) {
    canvas = new OffscreenCanvas(W, H);
    ctx = canvas.getContext("2d", { willReadFrequently: true });
  }
  ctx!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const px = ctx!.getImageData(0, 0, W, H).data;
  ensure(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) gray[i] = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
  gaussian(W, H);
  let laneRes: LaneResult | null = null;
  let edgeCount = 0;
  if (lane) {
    canny(W, H);
    for (let i = 0; i < edges.length; i++) if (edges[i] === 2) edgeCount++;
    laneRes = hough(W, H);
  }
  const vecs = wantFlow ? flow(W, H) : null;
  if (!wantFlow) prevSmall = null;
  (self as unknown as Worker).postMessage({ lane: laneRes, flow: vecs, edgeCount, ms: performance.now() - t0 });
};
