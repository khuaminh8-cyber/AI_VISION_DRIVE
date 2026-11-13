import { useMemo, useState } from "react";
import { Download, FileCode, NotebookPen } from "lucide-react";
import type { ImageMeta } from "@/lib/training/yolo";
import { MODELS, colabNotebook, readiness, trainPy } from "@/lib/training/notebook";

function save(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function TrainingGenerator({ images, classes }: { images: ImageMeta[]; classes: string[] }) {
  const [model, setModel] = useState("yolo11n.pt");
  const [epochs, setEpochs] = useState(80);
  const [batch, setBatch] = useState(16);
  const [imgsz, setImgsz] = useState(640);
  const r = useMemo(() => readiness(images), [images]);
  const cfg = { model, epochs, batch, imgsz, zipName: "adas_dataset.zip" };
  const field = "rounded border border-border bg-background px-2 py-1 text-sm";

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <section className="rounded-lg border border-border bg-card p-4 text-sm">
        <h2 className="mb-2 font-semibold">Dữ liệu hiện có</h2>
        <p className="text-muted-foreground">{r.usable} ảnh dùng được · Train {r.train} · Val {r.val} · {classes.length} class: {classes.join(", ") || "—"}</p>
        {r.problems.map((p) => <p key={p} className="mt-1 text-warning">⚠ {p}</p>)}
      </section>

      <section className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-card p-4 text-sm sm:grid-cols-4">
        <label className="flex flex-col gap-1">Model gốc
          <select className={field} value={model} onChange={(e) => setModel(e.target.value)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1">Epochs
          <input type="number" min={1} max={1000} className={field} value={epochs} onChange={(e) => setEpochs(Math.max(1, Number(e.target.value) || 1))} />
        </label>
        <label className="flex flex-col gap-1">Batch
          <select className={field} value={batch} onChange={(e) => setBatch(Number(e.target.value))}>{[4, 8, 16, 32].map((b) => <option key={b}>{b}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1">Kích thước ảnh
          <select className={field} value={imgsz} onChange={(e) => setImgsz(Number(e.target.value))}>{[320, 480, 640].map((s) => <option key={s}>{s}</option>)}</select>
        </label>
      </section>

      <div className="flex flex-wrap gap-2">
        <button disabled={!r.ok} onClick={() => save(colabNotebook(classes, cfg), "adas_train_colab.ipynb", "application/x-ipynb+json")}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"><NotebookPen className="size-4" />Tải Google Colab (.ipynb)</button>
        <button disabled={!r.ok} onClick={() => save(trainPy(classes, cfg), "train.py", "text/x-python")}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs disabled:opacity-50"><FileCode className="size-4" />Tải train.py</button>
      </div>

      <section className="rounded-lg border border-border bg-card p-4 text-sm">
        <h2 className="mb-2 flex items-center gap-1.5 font-semibold"><Download className="size-4" />Cách dùng</h2>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Tab DATASET → bấm “Xuất ZIP Ultralytics”.</li>
          <li>Tải file .ipynb ở trên, mở colab.research.google.com → File → Upload notebook.</li>
          <li>Runtime → Change runtime type → GPU, rồi Runtime → Run all.</li>
          <li>Khi được hỏi, chọn file ZIP dataset. Cuối cùng Colab tự tải về best.onnx.</li>
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">Trang này chỉ tạo script — việc huấn luyện chạy trên Colab, không có số liệu giả ở đây.</p>
      </section>
    </main>
  );
}
