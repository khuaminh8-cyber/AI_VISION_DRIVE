/** Ultralytics-layout ZIP export/import. */
import { unzip, zip, type Unzipped } from "fflate";
import { allMeta, getBlob } from "./db";
import { dataYaml, parseLabels, parseYamlNames, serializeLabels, type Box } from "./yolo";

const enc = new TextEncoder(), dec = new TextDecoder();
const idle = () => new Promise<void>((r) => setTimeout(r, 0));

export async function exportZip(names: string[], onProgress: (s: string) => void): Promise<{ blob: Blob; skipped: number }> {
  const metas = (await allMeta()).filter((m) => !m.error && (m.status === "done" || m.boxes.length));
  const files: Record<string, Uint8Array> = { "data.yaml": enc.encode(dataYaml(names)) };
  let skipped = 0;
  for (let i = 0; i < metas.length; i++) {
    const m = metas[i];
    if (m.split === "none") { skipped++; continue; }
    const b = await getBlob(m.id);
    if (!b) { skipped++; continue; }
    const ext = b.type === "image/png" ? "png" : b.type === "image/webp" ? "webp" : "jpg";
    const base = m.name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_") + "_" + m.id.slice(0, 6);
    files[`images/${m.split}/${base}.${ext}`] = new Uint8Array(await b.arrayBuffer());
    files[`labels/${m.split}/${base}.txt`] = enc.encode(serializeLabels(m.boxes));
    if (i % 20 === 0) { onProgress(`Đóng gói ${i + 1}/${metas.length}`); await idle(); }
  }
  const out = await new Promise<Uint8Array>((ok, bad) => zip(files, { level: 0 }, (e, d) => (e ? bad(e) : ok(d))));
  return { blob: new Blob([out as BlobPart], { type: "application/zip" }), skipped };
}

export interface ImportedItem { name: string; split: "train" | "val" | "test" | "none"; blob: Blob; boxes: Box[]; labelError?: string; hasLabel: boolean }

export async function readZip(file: File): Promise<{ names: string[] | null; items: ImportedItem[]; orphanLabels: number }> {
  const u = await new Promise<Unzipped>(async (ok, bad) => unzip(new Uint8Array(await file.arrayBuffer()), (e, d) => (e ? bad(e) : ok(d))));
  const keys = Object.keys(u).filter((k) => !k.startsWith("__MACOSX") && !k.endsWith("/"));
  const yamlKey = keys.find((k) => /(^|\/)data\.ya?ml$/i.test(k));
  const names = yamlKey ? parseYamlNames(dec.decode(u[yamlKey])) : null;
  const labels = new Map<string, string>();
  for (const k of keys) if (/(^|\/)labels\/.+\.txt$/i.test(k)) labels.set(k.replace(/(^|\/)labels\//, "$1images/").replace(/\.txt$/i, ""), k);
  const items: ImportedItem[] = [];
  const used = new Set<string>();
  for (const k of keys) {
    const m = k.match(/(^|\/)images\/(?:(train|val|valid|test)\/)?(.+)\.(jpe?g|png|webp)$/i);
    if (!m) continue;
    const split = (m[2]?.toLowerCase() === "valid" ? "val" : (m[2]?.toLowerCase() as ImportedItem["split"])) ?? "none";
    const lk = labels.get(k.replace(/\.[^.]+$/, ""));
    const ext = m[4].toLowerCase();
    const blob = new Blob([u[k] as BlobPart], { type: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg" });
    let boxes: Box[] = [], labelError: string | undefined;
    if (lk) {
      used.add(lk);
      const r = parseLabels(dec.decode(u[lk]));
      boxes = r.boxes;
      if (r.issues.length) labelError = "syntax: " + r.issues.map((i) => `dòng ${i.line} ${i.msg}`).join("; ");
    }
    items.push({ name: m[3].split("/").pop() + "." + ext, split, blob, boxes, labelError, hasLabel: !!lk });
  }
  return { names, items, orphanLabels: labels.size - used.size };
}
