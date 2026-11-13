import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Cpu, Trash2, Upload, Zap } from "lucide-react";
import { getActiveModel, getBlob, removeActiveModel, saveActiveModel } from "@/lib/training/db";
import { inspectOnnxShapes, mapModelClasses, type OnnxModelReport } from "@/lib/adas/model-config";
import { ADAS_CLASSES } from "@/lib/adas/types";
import type { ImageMeta } from "@/lib/training/yolo";

interface Det { cls: number; score: number }
interface Bench { name: string; ms: number; dets: Det[] }

export default function OnnxExport({ images, classes }: { images: ImageMeta[]; classes: string[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [names, setNames] = useState(classes.join(", "));
  const [report, setReport] = useState<OnnxModelReport | null>(null);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [bench, setBench] = useState<Bench[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const w = useRef<Worker | null>(null);
  const inRef = useRef<HTMLInputElement>(null);

  useEffect(() => { getActiveModel().then((m) => setActive(m?.name ?? null)); return () => w.current?.terminate(); }, []);
  useEffect(() => { setNames(classes.join(", ")); }, [classes]);

  const classList = names.split(",").map((s) => s.trim()).filter(Boolean);
  const mapping = mapModelClasses(classList);

  const call = (msg: unknown, transfer: Transferable[] = []) => new Promise<any>((ok, bad) => {
    const wk = w.current!;
    wk.onmessage = (e) => {
      const m = e.data;
      if (m.type === "status") setStatus(m.text);
      else if (m.type === "error") bad(new Error(m.message));
      else if (m.type === "loaded" || m.type === "result") ok(m);
    };
    wk.postMessage(msg, transfer);
  });

  async function inspect(f: File) {
    setFile(f); setReport(null); setBench(null); setErr("");
    if (mapping.error) { setErr(mapping.error); return; }
    w.current?.terminate();
    w.current = new Worker(new URL("../../workers/detector.worker.ts", import.meta.url), { type: "module" });
    try {
      setStatus("Đang nạp mô hình…");
      const buf = await f.arrayBuffer();
      const m = await call({ type: "load", buffer: buf, classMap: mapping.classMap, size: 640 }, [buf]);
      const shape = inspectOnnxShapes(m.inputShape, m.outputShape, classList.length);
      if (!shape) throw new Error(`Cấu trúc không hỗ trợ: input [${m.inputShape.join("×")}], output [${m.outputShape.join("×")}] với ${classList.length} lớp.`);
      setReport({ backend: m.backend, inputShape: m.inputShape, outputShape: m.outputShape, inputSize: shape.inputSize, outputFormat: shape.outputFormat, classCount: classList.length, warmupMs: m.warmup });
      setStatus("");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setStatus(""); }
  }

  async function runBench() {
    const sample = images.filter((i) => !i.error).slice(0, 3);
    const out: Bench[] = [];
    try {
      for (const im of sample) {
        setStatus(`Chạy thử ${im.name}…`);
        const blob = await getBlob(im.id);
        if (!blob) continue;
        const bitmap = await createImageBitmap(blob);
        const r = await call({ type: "infer", bitmap, conf: 0.35, id: 1 }, [bitmap]);
        out.push({ name: im.name, ms: r.ms, dets: r.dets });
      }
      setBench(out);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setStatus("");
  }

  async function activate() {
    if (!file || !report) return;
    await saveActiveModel({ name: file.name, classNames: classList, classMap: mapping.classMap, blob: file, inputSize: report.inputSize, updatedAt: Date.now() });
    setActive(file.name);
  }

  const lbl = (c: number) => ADAS_CLASSES[c]?.label ?? String(c);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 text-sm">
      {active && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-card p-3 text-xs">
          <CheckCircle2 className="size-4 text-primary" />
          <span className="flex-1">Đang kích hoạt cho ADAS: <b>{active}</b> — trang lái thử sẽ tự dùng mô hình này.</span>
          <Link to="/" className="text-primary hover:underline">Lái thử →</Link>
          <button onClick={async () => { await removeActiveModel(); setActive(null); }} className="inline-flex items-center gap-1 text-danger hover:underline"><Trash2 className="size-3.5" />Gỡ</button>
        </div>
      )}

      <label className="block text-xs text-muted-foreground">Tên lớp theo đúng thứ tự trong mô hình (cách nhau bởi dấu phẩy)
        <input value={names} onChange={(e) => setNames(e.target.value)} className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-foreground" />
      </label>
      {mapping.error && <p className="text-xs text-warning">{mapping.error}</p>}

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void inspect(f); }}
        onClick={() => inRef.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-10 text-center ${drag ? "border-primary bg-primary/5" : "border-border bg-card"}`}
      >
        <Upload className="mx-auto mb-2 size-6 text-primary" />
        <p className="font-semibold">Kéo thả hoặc bấm để chọn tệp best.onnx</p>
        {file && <p className="mt-1 font-mono text-xs text-muted-foreground">{file.name} · {(file.size / 1e6).toFixed(1)} MB</p>}
      </div>
      <input ref={inRef} type="file" accept=".onnx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void inspect(f); e.target.value = ""; }} />

      {status && <p className="font-mono text-xs text-warning">{status}</p>}
      {err && <p className="rounded border border-danger/40 p-2 text-xs text-danger">{err}</p>}

      {report && (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-3">
            <div><span className="text-muted-foreground">Input</span><br />{report.inputShape.join("×")}</div>
            <div><span className="text-muted-foreground">Output</span><br />{report.outputShape.join("×")}</div>
            <div><span className="text-muted-foreground">Định dạng</span><br />{report.outputFormat}</div>
            <div><span className="text-muted-foreground">Số lớp</span><br />{report.classCount}</div>
            <div><span className="text-muted-foreground">Chạy bằng</span><br />{report.backend}</div>
            <div><span className="text-muted-foreground">Khởi động</span><br />{report.warmupMs.toFixed(0)} ms</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={!!status || !images.length} onClick={runBench} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50"><Cpu className="size-4" />Chạy thử trên {Math.min(3, images.length)} ảnh dataset</button>
            <button disabled={!!status} onClick={activate} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"><Zap className="size-4" />Kích hoạt vào ADAS</button>
          </div>
          {!images.length && <p className="text-xs text-muted-foreground">Chưa có ảnh trong dataset — chỉ kiểm tra được cấu trúc mô hình.</p>}
          {bench && (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground"><tr><th className="text-left">Ảnh</th><th className="text-right">Thời gian</th><th className="text-left pl-3">Phát hiện</th></tr></thead>
              <tbody>{bench.map((b) => (
                <tr key={b.name} className="border-t border-border"><td className="py-1 font-mono">{b.name}</td><td className="text-right font-mono">{b.ms.toFixed(0)} ms</td>
                  <td className="pl-3">{b.dets.length ? b.dets.map((d) => `${lbl(d.cls)} ${(d.score * 100).toFixed(0)}%`).join(", ") : "không có"}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </main>
  );
}
