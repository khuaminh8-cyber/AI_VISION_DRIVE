import { useMemo, useState } from "react";
import { assignSplits, validateDataset, type ImageMeta, type IssueKind } from "@/lib/training/yolo";
import { putMetas } from "@/lib/training/db";

const KIND: Record<IssueKind, string> = { syntax: "Sai cú pháp nhãn", bad_class: "Class ID không hợp lệ", out_of_range: "Box ngoài phạm vi", unlabeled: "Ảnh thiếu nhãn", bad_file: "File lỗi" };

export default function Validation({ images, classes, onOpen, onBulk }: { images: ImageMeta[]; classes: string[]; onOpen: (id: string) => void; onBulk: (m: ImageMeta[]) => void }) {
  const { issues, counts } = useMemo(() => validateDataset(images, classes.length), [images, classes.length]);
  const [ratio, setRatio] = useState<[number, number, number]>([70, 20, 10]);
  const [filter, setFilter] = useState<IssueKind | "all">("all");
  const byKind = useMemo(() => { const m: Partial<Record<IssueKind, number>> = {}; issues.forEach((i) => (m[i.kind] = (m[i.kind] ?? 0) + 1)); return m; }, [issues]);
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const done = images.filter((i) => i.status === "done").length;
  const splitN = (s: string) => images.filter((i) => i.split === s).length;
  const shown = (filter === "all" ? issues : issues.filter((i) => i.kind === filter)).slice(0, 300);

  const doSplit = async () => {
    const ok = images.filter((i) => !i.error && (i.status === "done" || i.boxes.length));
    const map = assignSplits(ok.map((i) => i.id), ratio, Date.now() & 0xffff);
    const next = images.map((i) => ({ ...i, split: map[i.id] ?? "none" }));
    await putMetas(next); onBulk(next);
  };

  return (
    <main className="grid gap-4 p-4 lg:grid-cols-2 lg:p-6">
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-xs font-semibold tracking-widest">TỔNG QUAN</h2>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <Stat k="Ảnh" v={images.length} /><Stat k="Hoàn thành" v={done} /><Stat k="Box hợp lệ" v={total} />
        </div>
        <h3 className="mb-2 mt-4 text-[11px] font-semibold tracking-widest text-muted-foreground">PHÂN BỐ CLASS</h3>
        <div className="space-y-1">
          {classes.map((n, i) => (
            <div key={i} className="grid grid-cols-[110px_1fr_70px] items-center gap-2 text-xs">
              <span className="truncate font-mono">{i} {n}</span>
              <div className="h-2 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{ width: `${(counts[i] / max) * 100}%` }} /></div>
              <span className="text-right font-mono">{counts[i]}{total ? ` · ${Math.round((counts[i] / total) * 100)}%` : ""}</span>
            </div>
          ))}
        </div>
        {total > 0 && counts.some((c) => c > 0 && c < max / 10) && <p className="mt-2 text-[11px] text-warning">Cảnh báo: dữ liệu mất cân bằng (có class &lt; 10% class lớn nhất).</p>}

        <h3 className="mb-2 mt-5 text-[11px] font-semibold tracking-widest text-muted-foreground">CHIA TRAIN / VAL / TEST</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {(["Train", "Val", "Test"] as const).map((l, i) => (
            <label key={l} className="flex items-center gap-1">{l}
              <input type="number" min={0} max={100} value={ratio[i]} onChange={(e) => { const r = [...ratio] as [number, number, number]; r[i] = Math.max(0, Number(e.target.value)); setRatio(r); }} className="w-14 rounded border border-border bg-background px-1 py-0.5" />%
            </label>
          ))}
          <button onClick={doSplit} className="rounded bg-primary px-3 py-1 font-semibold text-primary-foreground">Phân chia ngẫu nhiên</button>
        </div>
        <p className="mt-2 font-mono text-xs text-muted-foreground">train {splitN("train")} · val {splitN("val")} · test {splitN("test")} · chưa chia {splitN("none")}</p>
        <p className="text-[11px] text-muted-foreground">Chỉ ảnh có box hoặc đã đánh dấu hoàn thành mới được chia.</p>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-xs font-semibold tracking-widest">LỖI DATASET ({issues.length})</h2>
        <div className="mb-2 flex flex-wrap gap-1 text-[11px]">
          <Chip on={filter === "all"} onClick={() => setFilter("all")}>Tất cả {issues.length}</Chip>
          {(Object.keys(KIND) as IssueKind[]).map((k) => <Chip key={k} on={filter === k} onClick={() => setFilter(k)}>{KIND[k]} {byKind[k] ?? 0}</Chip>)}
        </div>
        {issues.length === 0 ? <p className="py-8 text-center text-sm text-success">{images.length ? "Không phát hiện lỗi." : "Chưa có dữ liệu."}</p> : (
          <ul className="max-h-[60vh] divide-y divide-border overflow-auto text-xs">
            {shown.map((i, n) => (
              <li key={n}><button onClick={() => onOpen(i.imageId)} className="flex w-full gap-2 px-1 py-1.5 text-left hover:bg-muted">
                <span className="w-32 shrink-0 text-warning">{KIND[i.kind]}</span><span className="truncate font-mono">{i.name}</span><span className="ml-auto truncate text-muted-foreground">{i.msg}</span>
              </button></li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
const Stat = ({ k, v }: { k: string; v: number }) => <div className="rounded border border-border p-2"><div className="font-mono text-lg">{v}</div><div className="text-muted-foreground">{k}</div></div>;
const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => <button onClick={onClick} className={`rounded px-2 py-0.5 ${on ? "bg-primary text-primary-foreground" : "border border-border"}`}>{children}</button>;
