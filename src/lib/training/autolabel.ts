/** Offline pre-labeling: runs the pretrained YOLO ONNX model in a Web Worker, one image at a time. No API calls. */
import { DEFAULT_MODEL_URL } from "@/lib/adas/engine";
import { getBlob, putMeta } from "./db";
import { mapCocoToClass, toYolo, type Box, type ImageMeta } from "./yolo";

interface Det { x1: number; y1: number; x2: number; y2: number; score: number; cls: number }

export async function autoLabel(
  targets: ImageMeta[], classes: string[], conf: number,
  onProgress: (done: number, total: number, status?: string) => void,
  onItem: (m: ImageMeta) => void, signal: { cancel: boolean },
) {
  const w = new Worker(new URL("../../workers/detector.worker.ts", import.meta.url), { type: "module" });
  let pending: ((d: Det[] | null) => void) | null = null;
  let loadRes: (() => void) | null = null, loadRej: ((e: Error) => void) | null = null;
  w.onmessage = (e) => {
    const m = e.data;
    if (m.type === "progress" && m.total) onProgress(0, targets.length, `Tải mô hình ${Math.round((m.loaded / m.total) * 100)}%`);
    else if (m.type === "loaded") loadRes?.();
    else if (m.type === "result") { pending?.(m.dets); pending = null; }
    else if (m.type === "error") { if (pending) { pending(null); pending = null; } else loadRej?.(new Error(m.message)); }
  };
  try {
    onProgress(0, targets.length, "Đang tải mô hình YOLO (một lần, ~9 MB)…");
    await new Promise<void>((ok, bad) => { loadRes = ok; loadRej = bad; w.postMessage({ type: "load", url: DEFAULT_MODEL_URL }); });
    let n = 0;
    for (const m of targets) {
      if (signal.cancel) break;
      const blob = await getBlob(m.id);
      let suggest: Box[] = [];
      if (blob) {
        const bitmap = await createImageBitmap(blob);
        const dets = await new Promise<Det[] | null>((r) => { pending = r; w.postMessage({ type: "infer", bitmap, conf, id: n }, [bitmap]); });
        suggest = (dets ?? []).flatMap((d) => { const c = mapCocoToClass(d.cls, classes); return c < 0 ? [] : [toYolo(c, d.x1, d.y1, d.x2, d.y2, m.w, m.h)]; })
          .filter((b) => b.w > 0.002 && b.h > 0.002);
      }
      const next: ImageMeta = { ...m, suggest, scanned: true };
      await putMeta(next);
      onItem(next);
      onProgress(++n, targets.length);
      await new Promise((r) => setTimeout(r, 0)); // yield to UI
    }
    return n;
  } finally { w.terminate(); }
}
