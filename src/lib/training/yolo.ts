/** Pure YOLO dataset logic (no DOM) — parse, serialize, validate, split. */
export type Split = "train" | "val" | "test" | "none";
export interface Box { cls: number; cx: number; cy: number; w: number; h: number }
export interface ImageMeta {
  id: string; name: string; w: number; h: number; source: "image" | "frame" | "import";
  split: Split; status: "todo" | "done"; boxes: Box[]; error?: string; createdAt: number;
  /** AI pre-label suggestions — NOT training labels until the user saves them. */
  suggest?: Box[]; scanned?: boolean;
}

export const DEFAULT_CLASSES = ["person", "bicycle", "car", "motorcycle", "bus", "truck", "traffic_light", "stop_sign"];

const r6 = (n: number) => Number(n.toFixed(6));
export function serializeLabels(boxes: Box[]) {
  return boxes.map((b) => `${b.cls} ${r6(b.cx)} ${r6(b.cy)} ${r6(b.w)} ${r6(b.h)}`).join("\n") + (boxes.length ? "\n" : "");
}

export interface LineIssue { line: number; msg: string }
export function parseLabels(text: string): { boxes: Box[]; issues: LineIssue[] } {
  const boxes: Box[] = [], issues: LineIssue[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const s = raw.trim();
    if (!s) return;
    const p = s.split(/\s+/);
    if (p.length !== 5) { issues.push({ line: i + 1, msg: `cần 5 giá trị, có ${p.length}` }); return; }
    const n = p.map(Number);
    if (n.some((v) => !Number.isFinite(v)) || !Number.isInteger(n[0])) { issues.push({ line: i + 1, msg: "giá trị không phải số hợp lệ" }); return; }
    boxes.push({ cls: n[0], cx: n[1], cy: n[2], w: n[3], h: n[4] });
  });
  return { boxes, issues };
}

/** Pixel rect -> normalized YOLO box, clamped to image. */
export function toYolo(cls: number, x1: number, y1: number, x2: number, y2: number, W: number, H: number): Box {
  const a = Math.max(0, Math.min(x1, x2)), b = Math.max(0, Math.min(y1, y2));
  const c = Math.min(W, Math.max(x1, x2)), d = Math.min(H, Math.max(y1, y2));
  return { cls, cx: (a + c) / 2 / W, cy: (b + d) / 2 / H, w: (c - a) / W, h: (d - b) / H };
}

export type IssueKind = "syntax" | "bad_class" | "out_of_range" | "unlabeled" | "bad_file";
export interface Issue { imageId: string; name: string; kind: IssueKind; msg: string }

export function validateBox(b: Box, nc: number): { kind: IssueKind; msg: string } | null {
  if (!Number.isInteger(b.cls) || b.cls < 0 || b.cls >= nc) return { kind: "bad_class", msg: `class ${b.cls} không có (0–${nc - 1})` };
  if (b.w <= 0 || b.h <= 0) return { kind: "out_of_range", msg: "w/h ≤ 0" };
  const e = 1e-6;
  if ([b.cx, b.cy, b.w, b.h].some((v) => v < -e || v > 1 + e) || b.cx - b.w / 2 < -e || b.cx + b.w / 2 > 1 + e || b.cy - b.h / 2 < -e || b.cy + b.h / 2 > 1 + e)
    return { kind: "out_of_range", msg: "box ngoài phạm vi 0–1" };
  return null;
}

export function validateDataset(images: ImageMeta[], nc: number) {
  const issues: Issue[] = [];
  const counts = new Array(nc).fill(0) as number[];
  for (const im of images) {
    if (im.error) { issues.push({ imageId: im.id, name: im.name, kind: im.error.startsWith("syntax") ? "syntax" : "bad_file", msg: im.error }); }
    if (im.status !== "done" && im.boxes.length === 0) issues.push({ imageId: im.id, name: im.name, kind: "unlabeled", msg: "chưa gán nhãn" });
    for (const b of im.boxes) {
      const v = validateBox(b, nc);
      if (v) issues.push({ imageId: im.id, name: im.name, ...v });
      else counts[b.cls]++;
    }
  }
  return { issues, counts };
}

/** Deterministic seeded shuffle split by ratios. */
export function assignSplits(ids: string[], ratio: [number, number, number], seed = 42): Record<string, Split> {
  const a = [...ids];
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  const tot = ratio[0] + ratio[1] + ratio[2] || 1;
  const nTr = Math.round((a.length * ratio[0]) / tot), nVa = Math.round((a.length * ratio[1]) / tot);
  const out: Record<string, Split> = {};
  a.forEach((id, i) => (out[id] = i < nTr ? "train" : i < nTr + nVa ? "val" : "test"));
  return out;
}

export function dataYaml(names: string[]) {
  return `path: .\ntrain: images/train\nval: images/val\ntest: images/test\nnc: ${names.length}\nnames:\n${names.map((n, i) => `  ${i}: ${n}`).join("\n")}\n`;
}

export function parseYamlNames(y: string): string[] | null {
  const inline = y.match(/^names:\s*\[(.*)\]\s*$/m);
  if (inline) return inline[1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  const blk = y.match(/^names:\s*\n((?:[ \t]+.*\n?)+)/m);
  if (!blk) return null;
  const out: string[] = [];
  blk[1].split("\n").forEach((l) => {
    const m = l.match(/^\s+(?:(\d+)\s*:\s*|-\s*)(.+?)\s*$/);
    if (m) out[m[1] ? Number(m[1]) : out.length] = m[2].replace(/^['"]|['"]$/g, "");
  });
  return out.length ? out : null;
}

/** COCO ids the pretrained detector returns, by canonical name (for auto-label mapping). */
const COCO_NAMES: Record<number, string[]> = {
  0: ["person", "pedestrian", "nguoi"], 1: ["bicycle", "bike", "xedap"], 2: ["car", "oto"], 3: ["motorcycle", "motorbike", "moto", "xemay"],
  5: ["bus", "xebuyt"], 7: ["truck", "xetai"], 9: ["trafficlight", "light", "dengiaothong"], 11: ["stopsign", "sign", "biendung"],
};
const canon = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]/g, "");
/** Map a COCO class id to the dataset class index by name; -1 if the dataset has no such class. */
export function mapCocoToClass(cocoId: number, classes: string[]): number {
  const names = COCO_NAMES[cocoId]; if (!names) return -1;
  const c = classes.map(canon);
  for (const n of names) { const i = c.indexOf(n); if (i >= 0) return i; }
  return -1;
}
/** Images eligible for auto-scan: never scanned, not finished, readable, no labels yet. */
export const needsScan = (m: ImageMeta) => !m.scanned && m.status !== "done" && !m.error && m.boxes.length === 0;
