import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CheckCircle2, Maximize, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { getBlob, putMeta } from "@/lib/training/db";
import { toYolo, type ImageMeta } from "@/lib/training/yolo";

const COLORS = ["#f97316", "#22d3ee", "#a3e635", "#f43f5e", "#eab308", "#c084fc", "#34d399", "#60a5fa", "#fb7185", "#facc15"];
const colorOf = (c: number) => COLORS[c % COLORS.length];
interface PBox { cls: number; x1: number; y1: number; x2: number; y2: number }
type Drag = { t: "draw"; sx: number; sy: number } | { t: "move"; i: number; sx: number; sy: number; o: PBox } | { t: "resize"; i: number; h: string; o: PBox } | { t: "pan"; sx: number; sy: number; ox: number; oy: number };
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export default function Annotator({ images, classes, index, setIndex, onSaved }: {
  images: ImageMeta[]; classes: string[]; index: number; setIndex: (i: number) => void; onSaved: (m: ImageMeta) => void;
}) {
  const meta = images[index];
  const wrap = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null);
  const bmp = useRef<ImageBitmap | null>(null);
  const view = useRef({ s: 1, ox: 0, oy: 0 });
  const boxes = useRef<PBox[]>([]);
  const drag = useRef<Drag | null>(null);
  const space = useRef(false);
  const dirty = useRef(true);
  const [sel, setSel] = useState(-1);
  const [cls, setCls] = useState(0);
  const [count, setCount] = useState(0);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const selRef = useRef(sel); selRef.current = sel;
  const metaRef = useRef(meta); metaRef.current = meta;
  const saveT = useRef<ReturnType<typeof setTimeout>>(undefined);

  const redraw = () => { dirty.current = true; };

  const fit = useCallback(() => {
    const c = cv.current, b = bmp.current; if (!c || !b) return;
    const s = Math.min(c.clientWidth / b.width, c.clientHeight / b.height) * 0.95;
    view.current = { s, ox: (c.clientWidth - b.width * s) / 2, oy: (c.clientHeight - b.height * s) / 2 };
    redraw();
  }, []);

  const persist = useCallback((patch: Partial<ImageMeta> = {}) => {
    const m = metaRef.current; if (!m) return;
    const list = boxes.current.filter((b) => Math.abs(b.x2 - b.x1) > 1 && Math.abs(b.y2 - b.y1) > 1).map((b) => toYolo(b.cls, b.x1, b.y1, b.x2, b.y2, m.w, m.h));
    // While AI suggestions are unreviewed, edits stay in `suggest` — they become training labels only on "Lưu nhãn".
    const pending = m.status !== "done" && m.suggest !== undefined && m.boxes.length === 0;
    const next: ImageMeta = pending ? { ...m, suggest: list, ...patch } : { ...m, boxes: list, ...patch };
    metaRef.current = next;
    clearTimeout(saveT.current);
    saveT.current = setTimeout(() => { void putMeta(next).then(() => onSaved(next)); }, 250);
    setCount(boxes.current.length);
  }, [onSaved]);

  // load image (full-res blob, decoded off-thread by createImageBitmap)
  useEffect(() => {
    if (!meta) return;
    let alive = true;
    setSel(-1); setLoadErr(null);
    const src = meta.status !== "done" && meta.boxes.length === 0 && meta.suggest ? meta.suggest : meta.boxes;
    boxes.current = src.map((b) => ({ cls: b.cls, x1: (b.cx - b.w / 2) * meta.w, y1: (b.cy - b.h / 2) * meta.h, x2: (b.cx + b.w / 2) * meta.w, y2: (b.cy + b.h / 2) * meta.h }));
    setCount(boxes.current.length);
    void getBlob(meta.id).then(async (blob) => {
      if (!blob) throw new Error("thiếu file ảnh");
      const b = await createImageBitmap(blob);
      if (!alive) return b.close();
      bmp.current?.close(); bmp.current = b; fit();
    }).catch((e) => alive && setLoadErr(String(e.message ?? e)));
    return () => { alive = false; clearTimeout(saveT.current); if (metaRef.current) void putMeta(metaRef.current).then(() => onSaved(metaRef.current)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta?.id]);

  // render loop: draws only when dirty, stops when tab hidden
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const c = cv.current; if (!c || !dirty.current || document.hidden) return;
      dirty.current = false;
      const dpr = Math.min(devicePixelRatio, 1.5);
      const W = c.clientWidth, H = c.clientHeight;
      if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const { s, ox, oy } = view.current;
      if (bmp.current) { g.imageSmoothingEnabled = s < 2; g.drawImage(bmp.current, ox, oy, bmp.current.width * s, bmp.current.height * s); }
      boxes.current.forEach((b, i) => {
        const x = ox + Math.min(b.x1, b.x2) * s, y = oy + Math.min(b.y1, b.y2) * s, w = Math.abs(b.x2 - b.x1) * s, h = Math.abs(b.y2 - b.y1) * s;
        const col = colorOf(b.cls);
        g.strokeStyle = col; g.lineWidth = i === selRef.current ? 2.5 : 1.5;
        g.fillStyle = col + (i === selRef.current ? "33" : "14");
        g.fillRect(x, y, w, h); g.strokeRect(x, y, w, h);
        const label = `${b.cls} ${classes[b.cls] ?? "?"}`;
        g.font = "11px ui-monospace, monospace";
        const tw = g.measureText(label).width + 6;
        g.fillStyle = col; g.fillRect(x, y - 15, tw, 15);
        g.fillStyle = "#000"; g.fillText(label, x + 3, y - 4);
        if (i === selRef.current) handlePts(b).forEach(([, hx, hy]) => { g.fillStyle = "#fff"; g.fillRect(ox + hx * s - 4, oy + hy * s - 4, 8, 8); g.strokeRect(ox + hx * s - 4, oy + hy * s - 4, 8, 8); });
      });
    };
    raf = requestAnimationFrame(tick);
    const ro = new ResizeObserver(() => redraw());
    if (cv.current) ro.observe(cv.current);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [classes]);
  useEffect(redraw, [sel]);
  useEffect(() => () => bmp.current?.close(), []);

  const toImg = (e: { clientX: number; clientY: number }) => {
    const r = cv.current!.getBoundingClientRect(), { s, ox, oy } = view.current;
    return [(e.clientX - r.left - ox) / s, (e.clientY - r.top - oy) / s];
  };
  const clampPt = (x: number, y: number) => [Math.max(0, Math.min(meta.w, x)), Math.max(0, Math.min(meta.h, y))];

  const onDown = (e: React.PointerEvent) => {
    if (!bmp.current) return;
    cv.current!.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || space.current) { drag.current = { t: "pan", sx: e.clientX, sy: e.clientY, ox: view.current.ox, oy: view.current.oy }; return; }
    const [x, y] = toImg(e), tol = 7 / view.current.s;
    const si = selRef.current;
    if (si >= 0) {
      const h = handlePts(boxes.current[si]).find(([, hx, hy]) => Math.abs(hx - x) < tol && Math.abs(hy - y) < tol);
      if (h) { drag.current = { t: "resize", i: si, h: h[0], o: norm(boxes.current[si]) }; return; }
    }
    for (let i = boxes.current.length - 1; i >= 0; i--) {
      const b = norm(boxes.current[i]);
      if (x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2) { setSel(i); drag.current = { t: "move", i, sx: x, sy: y, o: b }; return; }
    }
    const [cx, cy] = clampPt(x, y);
    boxes.current.push({ cls, x1: cx, y1: cy, x2: cx, y2: cy });
    setSel(boxes.current.length - 1);
    drag.current = { t: "draw", sx: cx, sy: cy };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    if (d.t === "pan") { view.current.ox = d.ox + e.clientX - d.sx; view.current.oy = d.oy + e.clientY - d.sy; redraw(); return; }
    const [x, y] = clampPt(...(toImg(e) as [number, number]));
    if (d.t === "draw") { const b = boxes.current[boxes.current.length - 1]; b.x2 = x; b.y2 = y; }
    else if (d.t === "move") {
      const dx = Math.max(-d.o.x1, Math.min(meta.w - d.o.x2, x - d.sx)), dy = Math.max(-d.o.y1, Math.min(meta.h - d.o.y2, y - d.sy));
      Object.assign(boxes.current[d.i], { x1: d.o.x1 + dx, x2: d.o.x2 + dx, y1: d.o.y1 + dy, y2: d.o.y2 + dy });
    } else if (d.t === "resize") {
      const b = { ...d.o };
      if (d.h.includes("w")) b.x1 = x; if (d.h.includes("e")) b.x2 = x;
      if (d.h.includes("n")) b.y1 = y; if (d.h.includes("s")) b.y2 = y;
      boxes.current[d.i] = b;
    }
    redraw();
  };
  const onUp = () => {
    const d = drag.current; drag.current = null; if (!d || d.t === "pan") return;
    const i = d.t === "draw" ? boxes.current.length - 1 : d.i;
    const b = norm(boxes.current[i]);
    if (b.x2 - b.x1 < 3 || b.y2 - b.y1 < 3) { boxes.current.splice(i, 1); setSel(-1); }
    else boxes.current[i] = b;
    persist(); redraw();
  };
  const onWheel = (e: React.WheelEvent) => {
    const r = cv.current!.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, mx, my);
  };
  const zoomAt = (f: number, mx: number, my: number) => {
    const v = view.current, ns = Math.max(0.05, Math.min(30, v.s * f));
    v.ox = mx - ((mx - v.ox) * ns) / v.s; v.oy = my - ((my - v.oy) * ns) / v.s; v.s = ns; redraw();
  };
  const zoomCenter = (f: number) => { const c = cv.current!; zoomAt(f, c.clientWidth / 2, c.clientHeight / 2); };

  const del = useCallback(() => { const i = selRef.current; if (i < 0) return; boxes.current.splice(i, 1); setSel(-1); persist(); redraw(); }, [persist]);
  const setBoxCls = useCallback((c: number) => { setCls(c); const i = selRef.current; if (i >= 0) { boxes.current[i].cls = c; persist(); redraw(); } }, [persist]);
  const toggleDone = useCallback(() => {
    const m = metaRef.current; if (!m) return;
    if (m.status !== "done" && boxes.current.length === 0 && !confirm("Ảnh này không có box nào. Xác nhận đây là ảnh nền (không có đối tượng)?")) return;
    if (m.status !== "done" && m.suggest !== undefined && m.boxes.length === 0) {
      persist({ status: "done", boxes: boxes.current.map((b) => toYolo(b.cls, b.x1, b.y1, b.x2, b.y2, m.w, m.h)).filter((b) => b.w > 0 && b.h > 0), suggest: undefined });
    } else persist({ status: m.status === "done" ? "todo" : "done" });
  }, [persist]);
  const go = useCallback((d: number) => setIndex(Math.max(0, Math.min(images.length - 1, index + d))), [images.length, index, setIndex]);

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName?.match(/INPUT|SELECT|TEXTAREA/)) return;
      const k = e.key;
      if (k === " ") { space.current = true; e.preventDefault(); }
      else if (k === "ArrowRight" || k === "d" || k === "D") go(1);
      else if (k === "ArrowLeft" || k === "a" || k === "A") go(-1);
      else if (k === "Delete" || k === "Backspace") { e.preventDefault(); del(); }
      else if (k === "Escape") setSel(-1);
      else if (k === "f" || k === "F") fit();
      else if (k === "+" || k === "=") zoomCenter(1.25);
      else if (k === "-") zoomCenter(0.8);
      else if (k === "Enter") toggleDone();
      else if (/^[0-9]$/.test(k) && Number(k) < classes.length) setBoxCls(Number(k));
    };
    const ku = (e: KeyboardEvent) => { if (e.key === " ") space.current = false; };
    addEventListener("keydown", kd); addEventListener("keyup", ku);
    return () => { removeEventListener("keydown", kd); removeEventListener("keyup", ku); };
  }, [go, del, fit, toggleDone, setBoxCls, classes.length]);

  if (!meta) return <p className="p-16 text-center text-sm text-muted-foreground">Chưa có ảnh. Hãy thêm ảnh ở tab DATASET.</p>;
  const done = meta.status === "done";
  const reviewing = !done && meta.boxes.length === 0 && meta.suggest !== undefined;

  return (
    <div className="grid gap-3 p-3 lg:grid-cols-[1fr_240px] lg:p-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button onClick={() => go(-1)} disabled={index === 0} className="rounded border border-border p-1.5 disabled:opacity-40" aria-label="Ảnh trước"><ChevronLeft className="size-4" /></button>
          <span className="font-mono">{index + 1}/{images.length}</span>
          <button onClick={() => go(1)} disabled={index >= images.length - 1} className="rounded border border-border p-1.5 disabled:opacity-40" aria-label="Ảnh sau"><ChevronRight className="size-4" /></button>
          <span className="truncate font-mono text-muted-foreground">{meta.name} · {meta.w}×{meta.h}</span>
          <div className="ml-auto flex gap-1">
            <button onClick={() => zoomCenter(1.25)} className="rounded border border-border p-1.5" aria-label="Phóng to"><ZoomIn className="size-4" /></button>
            <button onClick={() => zoomCenter(0.8)} className="rounded border border-border p-1.5" aria-label="Thu nhỏ"><ZoomOut className="size-4" /></button>
            <button onClick={fit} className="rounded border border-border p-1.5" aria-label="Vừa khung"><Maximize className="size-4" /></button>
            <button onClick={toggleDone} className={`inline-flex items-center gap-1 rounded px-2 py-1 font-semibold ${done ? "bg-success text-background" : "border border-border"}`}><CheckCircle2 className="size-4" />{done ? "ĐÃ HOÀN THÀNH" : reviewing ? "Lưu nhãn (Enter)" : "Đánh dấu hoàn thành"}</button>
            {reviewing && <span className="rounded bg-warning/15 px-2 py-1 font-semibold text-warning">Nhãn AI gợi ý — chưa lưu. Sửa/xoá/vẽ thêm rồi bấm Lưu nhãn</span>}
          </div>
        </div>
        <div ref={wrap} className="relative h-[62vh] overflow-hidden rounded-md border border-border bg-muted/30">
          <canvas ref={cv} data-testid="annot-canvas" className={`size-full touch-none ${space.current ? "cursor-grab" : "cursor-crosshair"}`}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()} />
          {loadErr && <p className="absolute inset-0 grid place-items-center text-sm text-danger">Lỗi file ảnh: {loadErr}</p>}
        </div>
        <p className="text-[11px] text-muted-foreground">Kéo để vẽ box · bấm box để chọn/di chuyển · kéo ô vuông để đổi kích thước · Space/chuột phải + kéo: di chuyển ảnh · lăn chuột: zoom · F: vừa khung · A/D ←/→: chuyển ảnh · 0–9: class · Del: xoá · Enter: hoàn thành · Esc: bỏ chọn</p>
      </div>
      <aside className="space-y-3">
        <div>
          <h3 className="mb-1 text-[11px] font-semibold tracking-widest text-muted-foreground">CLASS {sel >= 0 ? "(box đang chọn)" : "(box mới)"}</h3>
          <div className="grid gap-1">
            {classes.map((n, i) => {
              const active = sel >= 0 ? boxes.current[sel]?.cls === i : cls === i;
              return (
                <button key={i} onClick={() => setBoxCls(i)} className={`flex items-center gap-2 rounded px-2 py-1 text-left text-xs ${active ? "bg-primary/20 ring-1 ring-primary" : "hover:bg-muted"}`}>
                  <span className="size-3 rounded-sm" style={{ background: colorOf(i) }} />
                  <span className="font-mono text-muted-foreground">{i}</span>{n}
                </button>
              );
            })}
          </div>
        </div>
        <div className="rounded border border-border p-2 text-xs">
          <div className="flex justify-between"><span>{count} box</span>{sel >= 0 && <button onClick={del} className="inline-flex items-center gap-1 text-danger"><Trash2 className="size-3.5" />Xoá box</button>}</div>
          <p className="mt-1 text-muted-foreground">Trạng thái: {done ? "hoàn thành" : "chưa hoàn thành"} · tự lưu</p>
        </div>
      </aside>
    </div>
  );
}

function norm(b: PBox): PBox { return { cls: b.cls, x1: Math.min(b.x1, b.x2), y1: Math.min(b.y1, b.y2), x2: Math.max(b.x1, b.x2), y2: Math.max(b.y1, b.y2) }; }
function handlePts(b0: PBox): [string, number, number][] {
  const b = norm(b0), mx = (b.x1 + b.x2) / 2, my = (b.y1 + b.y2) / 2;
  const p: Record<string, [number, number]> = { nw: [b.x1, b.y1], n: [mx, b.y1], ne: [b.x2, b.y1], e: [b.x2, my], se: [b.x2, b.y2], s: [mx, b.y2], sw: [b.x1, b.y2], w: [b.x1, my] };
  return HANDLES.map((h) => [h, ...p[h]]);
}
