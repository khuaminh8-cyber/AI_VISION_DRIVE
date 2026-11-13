import { ADAS_CLASSES, CLASS_WIDTH, VEHICLE_KINDS, type Det, type Risk, type Track } from "./types";

export interface TrackerConfig {
  fovDeg: number;
  ttcWarn: number;
  ttcDanger: number;
  laneHalfWidth: number;
}

const ALPHA = 0.55; // position gain (alpha-beta / steady-state Kalman)
const BETA = 0.22; // velocity gain
const MIN_MAX_AGE = 1.8; // s before a lost track is dropped (grows with AI frame gap)

/** Track lifetime adapts to the real gap between AI frames so slow inference never drops a track early. */
export function maxTrackAge(frameGap: number) {
  return Math.max(MIN_MAX_AGE, frameGap * 2.2);
}
const HIST_SPAN = 1.2; // s of distance history for speed regression

/** TTC → risk level. Null TTC means not enough data: "na". */
export function classifyTtc(ttc: number | null, warn: number, danger: number): Risk {
  if (ttc == null || !isFinite(ttc)) return "na";
  if (ttc < danger) return "danger";
  if (ttc <= warn) return "warning";
  return "safe";
}

/** Focal length in pixels for a horizontal FOV. */
export function focalPx(frameW: number, fovDeg: number) {
  return frameW / 2 / Math.tan(((fovDeg * Math.PI) / 180) / 2);
}

/** Pinhole range estimate from box height and known object height. */
export function estimateDistance(boxH: number, realH: number, f: number) {
  if (boxH < 2) return null;
  return (f * realH) / boxH;
}

/** Proximity alert: very close objects are risky even without a TTC (stopped / just appeared). */
export const NEAR_DANGER_M = 6;
export const NEAR_WARN_M = 10;

/**
 * Range from a box that may be cut by the frame edge. A cut dimension is shorter than
 * the real one, so it overestimates distance; we use the uncut dimension, or the
 * smaller (closer) estimate when both are cut.
 */
export function rangeFromBox(
  b: { x1: number; y1: number; x2: number; y2: number },
  realH: number, realW: number | undefined, f: number, frameW: number, frameH: number,
) {
  const m = 3;
  const cutV = b.y1 <= m || (frameH > 0 && b.y2 >= frameH - m);
  const cutH = b.x1 <= m || b.x2 >= frameW - m;
  const dh = estimateDistance(b.y2 - b.y1, realH, f);
  const dw = realW ? estimateDistance(b.x2 - b.x1, realW, f) : null;
  if (!cutV || dw == null) return dh;
  if (!cutH) return dw;
  return dh == null ? dw : Math.min(dh, dw);
}

/** Least-squares slope of d(t). Returns null if too few / too short samples. */
export function distanceSlope(hist: { t: number; d: number }[]): number | null {
  const n = hist.length;
  if (n < 4) return null;
  const span = hist[n - 1].t - hist[0].t;
  if (span < 0.4) return null;
  let st = 0, sd = 0, stt = 0, std = 0;
  const t0 = hist[0].t;
  for (const p of hist) {
    const t = p.t - t0;
    st += t; sd += p.d; stt += t * t; std += t * p.d;
  }
  const den = n * stt - st * st;
  if (Math.abs(den) < 1e-9) return null;
  return (n * std - st * sd) / den;
}

/** Time-to-collision from distance and closing speed (m/s, positive = approaching). */
export function computeTtc(dist: number | null, closing: number | null): number | null {
  if (dist == null || closing == null || closing < 0.3) return null;
  return dist / closing;
}

function iou(a: number[], b: number[]) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return ua > 0 ? inter / ua : 0;
}

const group = (cls: number) => {
  const k = ADAS_CLASSES[cls]?.kind;
  return k && VEHICLE_KINDS.includes(k) && k !== "bike" && k !== "moto" ? "veh" : String(cls);
};

export class Tracker {
  tracks: Track[] = [];
  private nextId = 1;
  private counters: Record<string, number> = {};

  reset() {
    this.tracks = [];
    this.nextId = 1;
    this.lastT = null;
    this.gap = 0.1;
    this.counters = {};
  }

  private frameH = 0;
  private lastBox = new Map<number, { x1: number; y1: number; x2: number; y2: number }>();

  private lastT: number | null = null;
  private gap = 0.1;

  update(dets: Det[], t: number, frameW: number, cfg: TrackerConfig, frameH = 0) {
    this.frameH = frameH;
    if (this.lastT != null && t > this.lastT) this.gap += 0.3 * (t - this.lastT - this.gap);
    this.lastT = t;
    const minIou = this.gap > 0.4 ? 0.05 : 0.15;
    const f = focalPx(frameW, cfg.fovDeg);
    // predict
    const preds = this.tracks.map((tr) => {
      const dt = Math.min(0.3, t - tr.lastUpdate);
      const cx = tr.cx + tr.vx * dt, cy = tr.cy + tr.vy * dt;
      return [cx - tr.w / 2, cy - tr.h / 2, cx + tr.w / 2, cy + tr.h / 2];
    });
    const pairs: [number, number, number][] = [];
    for (let i = 0; i < this.tracks.length; i++)
      for (let j = 0; j < dets.length; j++) {
        if (group(this.tracks[i].cls) !== group(dets[j].cls)) continue;
        const d = dets[j];
        const v = iou(preds[i], [d.x1, d.y1, d.x2, d.y2]);
        if (v > minIou) pairs.push([v, i, j]);
      }
    pairs.sort((a, b) => b[0] - a[0]);
    const usedT = new Set<number>(), usedD = new Set<number>();
    for (const [, i, j] of pairs) {
      if (usedT.has(i) || usedD.has(j)) continue;
      usedT.add(i); usedD.add(j);
      const tr = this.tracks[i], d = dets[j];
      const dt = Math.max(1 / 60, Math.min(0.3, t - tr.lastUpdate));
      const pcx = tr.cx + tr.vx * dt, pcy = tr.cy + tr.vy * dt;
      const mcx = (d.x1 + d.x2) / 2, mcy = (d.y1 + d.y2) / 2;
      const rx = mcx - pcx, ry = mcy - pcy;
      tr.cx = pcx + ALPHA * rx; tr.cy = pcy + ALPHA * ry;
      tr.vx += (BETA * rx) / dt; tr.vy += (BETA * ry) / dt;
      tr.w += ALPHA * (d.x2 - d.x1 - tr.w);
      tr.h += ALPHA * (d.y2 - d.y1 - tr.h);
      tr.score = d.score; tr.hits++; tr.lastSeen = t; tr.lastUpdate = t;
      this.lastBox.set(tr.id, d);
      this.measure(tr, t, f, frameW, cfg);
    }
    // coast unmatched
    this.tracks.forEach((tr, i) => {
      if (usedT.has(i)) return;
      const dt = Math.min(0.3, t - tr.lastUpdate);
      tr.cx += tr.vx * dt; tr.cy += tr.vy * dt;
      tr.vx *= 0.7; tr.vy *= 0.7;
      tr.lastUpdate = t;
    });
    this.tracks = this.tracks.filter((tr) => (tr.hits >= 2 ? t - tr.lastSeen < maxTrackAge(this.gap) : tr.lastSeen === t) || (this.lastBox.delete(tr.id), false));
    // births
    dets.forEach((d, j) => {
      if (usedD.has(j)) return;
      const meta = ADAS_CLASSES[d.cls];
      if (!meta) return;
      const n = (this.counters[meta.label] = (this.counters[meta.label] ?? 0) + 1);
      const tr: Track = {
        id: this.nextId++, name: `${meta.label} ${String(n).padStart(2, "0")}`,
        cls: d.cls, kind: meta.kind, label: meta.label, score: d.score,
        cx: (d.x1 + d.x2) / 2, cy: (d.y1 + d.y2) / 2, w: d.x2 - d.x1, h: d.y2 - d.y1,
        vx: 0, vy: 0, disp: null, hits: 1, lastSeen: t, lastUpdate: t, trail: [],
        dist: null, lateral: null, distHist: [], relSpeed: null, ttc: null, risk: "na", inEgoLane: false,
      };
      this.lastBox.set(tr.id, d);
      this.measure(tr, t, f, frameW, cfg);
      this.tracks.push(tr);
    });
  }

  private measure(tr: Track, t: number, f: number, frameW: number, cfg: TrackerConfig) {
    const meta = ADAS_CLASSES[tr.cls];
    const box = this.lastBox.get(tr.id) ?? { x1: tr.cx - tr.w / 2, y1: tr.cy - tr.h / 2, x2: tr.cx + tr.w / 2, y2: tr.cy + tr.h / 2 };
    const raw = rangeFromBox(box, meta.height, CLASS_WIDTH[meta.kind], f, frameW, this.frameH);
    if (raw != null) {
      // Approaching updates fast (safety), receding updates slowly (noise).
      const g = tr.dist != null && raw < tr.dist ? 0.6 : 0.3;
      tr.dist = tr.dist == null ? raw : tr.dist + g * (raw - tr.dist);
      // Lateral from the visible edge nearest the image centre when the box is cut at a side.
      let ax = tr.cx;
      if (box.x1 <= 3) ax = box.x2 - Math.min(tr.w, ((CLASS_WIDTH[meta.kind] ?? 1) * f) / Math.max(tr.dist, 0.5)) / 2;
      else if (box.x2 >= frameW - 3) ax = box.x1 + Math.min(tr.w, ((CLASS_WIDTH[meta.kind] ?? 1) * f) / Math.max(tr.dist, 0.5)) / 2;
      tr.lateral = ((ax - frameW / 2) * tr.dist) / f;
      tr.distHist.push({ t, d: tr.dist });
      while (tr.distHist.length && t - tr.distHist[0].t > HIST_SPAN) tr.distHist.shift();
    }
    const slope = distanceSlope(tr.distHist);
    if (slope != null) {
      const closing = -slope;
      tr.relSpeed = tr.relSpeed == null ? closing : tr.relSpeed + 0.4 * (closing - tr.relSpeed);
    }
    tr.ttc = computeTtc(tr.dist, tr.relSpeed);
    tr.inEgoLane = tr.lateral != null && Math.abs(tr.lateral) < cfg.laneHalfWidth;
    let r = classifyTtc(tr.ttc, cfg.ttcWarn, cfg.ttcDanger);
    if (tr.dist != null && meta.kind !== "light" && meta.kind !== "sign") {
      const near: Risk = tr.dist < NEAR_DANGER_M ? "danger" : tr.dist < NEAR_WARN_M ? "warning" : "na";
      const ord = ["na", "safe", "warning", "danger"];
      if (ord.indexOf(near) > ord.indexOf(r)) r = near;
    }
    // Only objects in our path get escalated; others show at most "warning".
    // Cars beside us (left/right lane, parked at the kerb) are not a forward-collision threat.
    tr.risk = !tr.inEgoLane && r !== "na" ? "safe" : r;
    tr.trail.push({ x: tr.cx, y: tr.cy + tr.h / 2 });
    if (tr.trail.length > 30) tr.trail.shift();
  }
}
