import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ScanSearch, Square, Download, FileArchive, Film, ImagePlus, Trash2, Upload } from "lucide-react";
import { allMeta, clearAll, getClasses, getThumb, putImage, putMeta, removeImage, setClasses as saveClasses } from "@/lib/training/db";
import { exportZip, readZip } from "@/lib/training/zip";
import { needsScan, type ImageMeta } from "@/lib/training/yolo";
import { autoLabel } from "@/lib/training/autolabel";
import { deleteCloudImage, deleteCloudImages, downloadImage, listCloudIds, uploadImage } from "@/lib/training/cloud";
import { getDeviceId } from "@/lib/training/device";
import Annotator from "./Annotator";
import Validation from "./Validation";
import TrainingGenerator from "./TrainingGenerator";
import OnnxExport from "./OnnxExport";

const TABS = ["DATASET", "GÁN NHÃN", "KIỂM TRA", "HUẤN LUYỆN", "XUẤT ONNX"] as const;
const IMG_RE = /\.(jpe?g|png|webp)$/i, VID_RE = /\.(mp4|webm)$/i;
const THUMB = 256, MAX_FRAME = 1280;
const uid = () => crypto.randomUUID();

async function jpeg(src: CanvasImageSource, w: number, h: number, max: number, q: number) {
  const s = Math.min(1, max / Math.max(w, h));
  const c = new OffscreenCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return { blob: await c.convertToBlob({ type: "image/jpeg", quality: q }), w: c.width, h: c.height };
}
const idle = () => new Promise<void>((r) => (window.requestIdleCallback ? window.requestIdleCallback(() => r(), { timeout: 100 }) : setTimeout(r, 0)));

/** Thumbnail url cache shared by grid + filmstrip; loaded lazily from IndexedDB. */
const thumbUrls = new Map<string, string>();
function useThumb(id: string) {
  const [url, setUrl] = useState(thumbUrls.get(id) ?? "");
  useEffect(() => {
    if (url) return;
    let alive = true;
    void getThumb(id).then((b) => { if (b && alive) { const u = URL.createObjectURL(b); thumbUrls.set(id, u); setUrl(u); } });
    return () => { alive = false; };
  }, [id, url]);
  return url;
}

const Thumb = memo(function Thumb({ it, onRemove, onOpen }: { it: ImageMeta; onRemove: (id: string) => void; onOpen: (id: string) => void }) {
  const url = useThumb(it.id);
  return (
    <figure className="group relative overflow-hidden rounded-md border border-border bg-card [content-visibility:auto] [contain-intrinsic-size:160px]">
      <button onClick={() => onOpen(it.id)} className="block w-full">{url ? <img src={url} alt={it.name} loading="lazy" decoding="async" className="aspect-video w-full object-cover" /> : <div className="aspect-video w-full bg-muted" />}</button>
      <figcaption className="flex gap-1 truncate px-2 py-1 font-mono text-[10px] text-muted-foreground">
        <span className={it.status === "done" ? "text-success" : it.error ? "text-danger" : it.suggest?.length ? "text-warning" : ""}>{it.status === "done" ? "✓" : it.error ? "!" : it.suggest?.length ? "AI" : "○"} {it.status !== "done" && it.suggest?.length ? it.suggest.length : it.boxes.length}</span>
        <span className="truncate">{it.name}</span>{it.split !== "none" && <span className="ml-auto">{it.split}</span>}
      </figcaption>
      <button onClick={() => onRemove(it.id)} aria-label="Xoá" className="absolute right-1 top-1 rounded bg-background/80 p-1 opacity-0 transition group-hover:opacity-100"><Trash2 className="size-3.5 text-danger" /></button>
    </figure>
  );
});

export default function TrainingCenter() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("DATASET");
  const [items, setItems] = useState<ImageMeta[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [fps, setFps] = useState(1);
  const [drag, setDrag] = useState(false);
  const [idx, setIdx] = useState(0);
  const [deviceId, setDeviceId] = useState("");
  useEffect(() => { setDeviceId(getDeviceId()); }, []);
  const inputRef = useRef<HTMLInputElement>(null), zipRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void Promise.all([allMeta(), getClasses()]).then(([m, c]) => {
      setItems(m.sort((a, b) => a.createdAt - b.createdAt)); setClasses(c); setLoaded(true);
      const last = Number(localStorage.getItem("annot_idx") ?? 0); setIdx(Math.min(last, Math.max(0, m.length - 1)));
      void (async () => {
        const have = new Set(m.map((x) => x.id));
        const ids = (await listCloudIds()).filter((id) => !have.has(id));
        const got: ImageMeta[] = [];
        for (let i = 0; i < ids.length; i++) {
          setBusy(`Tải ảnh từ Cloud ${i + 1}/${ids.length}`);
          try {
            const blob = await downloadImage(ids[i]);
            const bmp = await createImageBitmap(blob);
            const meta: ImageMeta = { id: ids[i], name: `${ids[i]}.jpg`, w: bmp.width, h: bmp.height, source: "image", split: "none", status: "todo", boxes: [], createdAt: Date.now() + i };
            const t = await jpeg(bmp, bmp.width, bmp.height, THUMB, 0.75); bmp.close();
            await putImage(meta, blob, t.blob); got.push(meta);
          } catch { /* skip broken */ }
        }
        if (got.length) setItems((a) => [...a, ...got]);
        setBusy(null);
      })().catch(() => setBusy(null));
    }).catch((e) => { setMsg("Không mở được IndexedDB: " + e); setLoaded(true); });
  }, []);
  useEffect(() => { localStorage.setItem("annot_idx", String(idx)); }, [idx]);

  const push = useCallback((batch: ImageMeta[]) => { if (batch.length) setItems((a) => [...a, ...batch]); }, []);
  const save = useCallback(async (meta: ImageMeta, blob: Blob, thumbSrc: CanvasImageSource, w: number, h: number) => {
    const t = await jpeg(thumbSrc, w, h, THUMB, 0.75);
    await putImage(meta, blob, t.blob);
  }, []);

  const addImages = useCallback(async (files: File[]) => {
    let batch: ImageMeta[] = [];
    for (let i = 0; i < files.length; i++) {
      setBusy(`Đang lưu ảnh ${i + 1}/${files.length}`);
      const meta: ImageMeta = { id: uid(), name: files[i].name, w: 0, h: 0, source: "image", split: "none", status: "todo", boxes: [], createdAt: Date.now() + i };
      try {
        const bmp = await createImageBitmap(files[i]);
        const full = await jpeg(bmp, bmp.width, bmp.height, 1920, 0.9);
        meta.w = full.w; meta.h = full.h;
        await save(meta, full.blob, bmp, bmp.width, bmp.height);
        try { await uploadImage(meta.id, full.blob); } catch (e) { setMsg("Chưa tải lên Cloud được: " + (e as Error).message); }
        bmp.close();
      } catch {
        meta.error = "File ảnh lỗi / không đọc được";
        await putImage(meta, files[i], new Blob());
      }
      batch.push(meta);
      if (batch.length >= 12) { push(batch); batch = []; await idle(); }
    }
    push(batch);
  }, [push, save]);

  const addVideo = useCallback(async (file: File) => {
    const src = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.src = src;
    try {
      await new Promise<void>((ok, bad) => { v.onloadedmetadata = () => ok(); v.onerror = () => bad(new Error("video")); });
      const step = 1 / fps, total = Math.floor(v.duration / step);
      let batch: ImageMeta[] = [];
      for (let i = 0; i <= total; i++) {
        setBusy(`Trích xuất ${file.name}: ${i + 1}/${total + 1} khung`);
        v.currentTime = Math.min(v.duration - 0.01, i * step);
        await new Promise<void>((r) => { v.onseeked = () => r(); });
        const full = await jpeg(v, v.videoWidth, v.videoHeight, MAX_FRAME, 0.9);
        const meta: ImageMeta = { id: uid(), name: `${file.name.replace(VID_RE, "")}_${String(i).padStart(4, "0")}.jpg`, w: full.w, h: full.h, source: "frame", split: "none", status: "todo", boxes: [], createdAt: Date.now() + i };
        await save(meta, full.blob, v, v.videoWidth, v.videoHeight);
        batch.push(meta);
        if (batch.length >= 12) { push(batch); batch = []; await idle(); }
      }
      push(batch);
    } catch { setMsg(`Không đọc được video ${file.name} (codec không hỗ trợ)`); } finally { URL.revokeObjectURL(src); v.removeAttribute("src"); }
  }, [fps, push, save]);

  const handle = useCallback(async (list: FileList | null) => {
    if (!list || busy) return;
    setMsg(null);
    const files = [...list];
    try {
      await addImages(files.filter((f) => IMG_RE.test(f.name)));
      for (const f of files.filter((x) => VID_RE.test(x.name))) await addVideo(f);
    } catch (e) { setMsg("Lỗi lưu dữ liệu (bộ nhớ trình duyệt đầy?): " + e); }
    setBusy(null);
  }, [addImages, addVideo, busy]);

  const importZip = async (f: File | undefined) => {
    if (!f || busy) return;
    setMsg(null); setBusy("Đang giải nén ZIP…");
    try {
      const { names, items: imp, orphanLabels } = await readZip(f);
      if (names?.length) { setClasses(names); await saveClasses(names); }
      let batch: ImageMeta[] = [];
      for (let i = 0; i < imp.length; i++) {
        const it = imp[i];
        setBusy(`Nhập ${i + 1}/${imp.length}`);
        const meta: ImageMeta = { id: uid(), name: it.name, w: 0, h: 0, source: "import", split: it.split, status: it.hasLabel && !it.labelError ? "done" : "todo", boxes: it.boxes, createdAt: Date.now() + i, ...(it.labelError ? { error: it.labelError } : {}) };
        try { const bmp = await createImageBitmap(it.blob); meta.w = bmp.width; meta.h = bmp.height; await save(meta, it.blob, bmp, bmp.width, bmp.height); bmp.close(); }
        catch { meta.error = "File ảnh lỗi / không đọc được"; meta.status = "todo"; await putImage(meta, it.blob, new Blob()); }
        batch.push(meta);
        if (batch.length >= 12) { push(batch); batch = []; await idle(); }
      }
      push(batch);
      setMsg(`Đã nhập ${imp.length} ảnh${names ? `, ${names.length} class từ data.yaml` : " (không có data.yaml — giữ class hiện tại)"}${orphanLabels ? `, ${orphanLabels} file nhãn không có ảnh` : ""}.`);
    } catch (e) { setMsg("ZIP lỗi: " + e); }
    setBusy(null);
  };

  const doExport = async () => {
    setMsg(null); setBusy("Đang đóng gói…");
    try {
      const { blob, skipped } = await exportZip(classes, setBusy);
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "adas_dataset_yolo.zip"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setMsg(`Đã xuất ZIP (${(blob.size / 1e6).toFixed(1)} MB).${skipped ? ` Bỏ qua ${skipped} ảnh chưa chia split.` : ""}`);
    } catch (e) { setMsg("Xuất lỗi: " + e); }
    setBusy(null);
  };

  const remove = useCallback((id: string) => { void removeImage(id); void deleteCloudImage(id); const u = thumbUrls.get(id); if (u) { URL.revokeObjectURL(u); thumbUrls.delete(id); } setItems((a) => a.filter((i) => i.id !== id)); }, []);
  const clear = async () => { if (!confirm("Xoá toàn bộ ảnh và nhãn đã lưu?")) return; const ids = items.map((i) => i.id); await clearAll(); void deleteCloudImages(ids).catch(() => {}); thumbUrls.forEach((u) => URL.revokeObjectURL(u)); thumbUrls.clear(); setItems([]); setIdx(0); };
  const onSaved = useCallback((m: ImageMeta) => setItems((a) => a.map((i) => (i.id === m.id ? m : i))), []);
  const open = useCallback((id: string) => { setItems((a) => { const i = a.findIndex((x) => x.id === id); if (i >= 0) setIdx(i); return a; }); setTab("GÁN NHÃN"); }, []);
  const editClasses = async () => {
    const s = prompt("Danh sách class (cách nhau bởi dấu phẩy, thứ tự = class_id):", classes.join(", "));
    if (!s) return;
    const c = s.split(",").map((x) => x.trim()).filter(Boolean);
    if (c.length) { setClasses(c); await saveClasses(c); }
  };
  void putMeta;

  const [scan, setScan] = useState<string | null>(null);
  const [conf, setConf] = useState(0.35);
  const cancel = useRef({ cancel: false });
  const toScan = items.filter(needsScan);
  const pendingReview = items.filter((i) => i.status !== "done" && (i.suggest?.length ?? 0) > 0).length;
  const runScan = async () => {
    if (!toScan.length || scan) return;
    cancel.current = { cancel: false }; setMsg(null);
    try {
      const n = await autoLabel(toScan, classes, conf, (d, t, st) => setScan(st ?? `Đang quét ${d}/${t} ảnh – ${Math.round((d / t) * 100)}%`), onSaved, cancel.current);
      setMsg(`Đã quét ${n} ảnh mới. Nhãn gợi ý CHƯA được lưu vào dữ liệu huấn luyện — mở từng ảnh, sửa nếu cần rồi bấm "Lưu nhãn".`);
    } catch (e) { setMsg("Không quét được (không tải được mô hình?): " + (e instanceof Error ? e.message : e)); }
    setScan(null);
  };

  const done = items.filter((i) => i.status === "done").length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 lg:px-6">
        <Link to="/" className="grid size-9 place-items-center rounded-md border border-border hover:bg-muted"><ArrowLeft className="size-4" /></Link>
        <div>
          <h1 className="font-display text-lg font-bold leading-none tracking-[0.18em]">AI TRAINING CENTER</h1>
          <p className="mt-1 text-[11px] tracking-widest text-muted-foreground">QUẢN LÝ DATASET & FINE-TUNE YOLO</p>
        </div>
        {deviceId && (
          <button type="button" title="Không gian dữ liệu riêng của thiết bị này — bấm để sao chép mã" onClick={() => { void navigator.clipboard?.writeText(deviceId); setMsg("Đã sao chép mã thiết bị. Ảnh bạn tải lên chỉ thiết bị này xem được."); }} className="rounded border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground">
            Thiết bị: {deviceId.slice(0, 12)}…
          </button>
        )}
        <nav className="ml-auto flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded px-3 py-1.5 text-[11px] font-semibold tracking-widest ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{t}</button>
          ))}
        </nav>
      </header>
      {msg && <p className="border-b border-border bg-card px-4 py-2 text-xs text-warning lg:px-6">{msg}</p>}

      {!loaded ? <p className="p-16 text-center text-sm text-muted-foreground">Đang tải dataset đã lưu…</p> : tab === "DATASET" ? (
        <main className="space-y-4 p-4 lg:p-6">
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); void handle(e.dataTransfer.files); }}
            className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition ${drag ? "border-primary bg-primary/10" : "border-border bg-card"}`}
          >
            <Upload className="size-8 text-primary" />
            <p className="text-sm">Kéo thả ảnh (JPG, PNG, WebP) hoặc video (MP4, WebM) vào đây</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button disabled={!!busy} onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"><ImagePlus className="size-4" />Chọn file</button>
              <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Film className="size-4" />Trích xuất
                <select value={fps} onChange={(e) => setFps(Number(e.target.value))} className="rounded border border-border bg-background px-1 py-0.5">
                  {[0.5, 1, 2, 5].map((f) => <option key={f} value={f}>{f} khung/giây</option>)}
                </select>
              </label>
              <button disabled={!!busy} onClick={() => zipRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50"><FileArchive className="size-4" />Nhập ZIP YOLO</button>
              <button disabled={!!busy || !items.length} onClick={doExport} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50"><Download className="size-4" />Xuất ZIP Ultralytics</button>
            </div>
            <input ref={inputRef} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.mp4,.webm" className="hidden" onChange={(e) => { void handle(e.target.files); e.target.value = ""; }} />
            <input ref={zipRef} type="file" accept=".zip" className="hidden" onChange={(e) => { void importZip(e.target.files?.[0]); e.target.value = ""; }} />
            {busy && <p className="font-mono text-xs text-warning">{busy}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 text-xs">
            <ScanSearch className="size-5 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Quét nhãn tự động (chạy ngay trên máy, miễn phí, không cần mạng sau lần tải mô hình đầu)</p>
              <p className="text-muted-foreground">Chỉ quét ảnh mới chưa quét: <b className="text-foreground">{toScan.length}</b> ảnh · {pendingReview} ảnh có gợi ý đang chờ bạn duyệt</p>
              {scan && <p className="font-mono text-warning">{scan}</p>}
            </div>
            <label className="flex items-center gap-1 text-muted-foreground">Độ tin cậy
              <select value={conf} onChange={(e) => setConf(Number(e.target.value))} className="rounded border border-border bg-background px-1 py-0.5">
                {[0.25, 0.35, 0.5, 0.65].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            {scan ? (
              <button onClick={() => { cancel.current.cancel = true; }} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5"><Square className="size-3.5" />Dừng</button>
            ) : (
              <button disabled={!!busy || !toScan.length} onClick={runScan} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-50"><ScanSearch className="size-4" />Quét {toScan.length} ảnh mới</button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{items.length} ảnh · {items.filter((i) => i.source === "frame").length} khung từ video · {done} hoàn thành · {classes.length} class <button onClick={editClasses} className="text-primary hover:underline">(sửa)</button> · lưu trong IndexedDB</span>
            {items.length > 0 && <button onClick={clear} className="text-danger hover:underline">Xoá tất cả</button>}
          </div>
          {items.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Chưa có dữ liệu.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
              {items.map((it) => <Thumb key={it.id} it={it} onRemove={remove} onOpen={open} />)}
            </div>
          )}
        </main>
      ) : tab === "GÁN NHÃN" ? (
        <Annotator images={items} classes={classes} index={Math.min(idx, Math.max(0, items.length - 1))} setIndex={setIdx} onSaved={onSaved} />
      ) : tab === "KIỂM TRA" ? (
        <Validation images={items} classes={classes} onOpen={open} onBulk={setItems} />
      ) : tab === "HUẤN LUYỆN" ? (
        <TrainingGenerator images={items} classes={classes} />
      ) : (
        <OnnxExport images={items} classes={classes} />
      )}
    </div>
  );
}
