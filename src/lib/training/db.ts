/** IndexedDB persistence: image blobs, thumbnails, metadata+annotations, config. */
import type { ImageMeta } from "./yolo";
import { DEFAULT_CLASSES } from "./yolo";
import type { SavedOnnxModel } from "@/lib/adas/model-config";

const DB = "adas_training", VER = 2;
let dbp: Promise<IDBDatabase> | null = null;

function open() {
  return (dbp ??= new Promise((ok, bad) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "id" });
      if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs");
      if (!d.objectStoreNames.contains("thumbs")) d.createObjectStore("thumbs");
      if (!d.objectStoreNames.contains("config")) d.createObjectStore("config");
      if (!d.objectStoreNames.contains("models")) d.createObjectStore("models");
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  }));
}

function req<T>(r: IDBRequest<T>) { return new Promise<T>((ok, bad) => { r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); }); }
async function store(name: string, mode: IDBTransactionMode = "readonly") { return (await open()).transaction(name, mode).objectStore(name); }

export async function putImage(meta: ImageMeta, blob: Blob, thumb: Blob) {
  const t = (await open()).transaction(["meta", "blobs", "thumbs"], "readwrite");
  t.objectStore("meta").put(meta); t.objectStore("blobs").put(blob, meta.id); t.objectStore("thumbs").put(thumb, meta.id);
  await new Promise<void>((ok, bad) => { t.oncomplete = () => ok(); t.onerror = () => bad(t.error); });
}
export async function putMeta(meta: ImageMeta) { await req((await store("meta", "readwrite")).put(meta)); }
export async function putMetas(metas: ImageMeta[]) {
  const t = (await open()).transaction("meta", "readwrite");
  metas.forEach((m) => t.objectStore("meta").put(m));
  await new Promise<void>((ok, bad) => { t.oncomplete = () => ok(); t.onerror = () => bad(t.error); });
}
export async function allMeta() { return (await req((await store("meta")).getAll())) as ImageMeta[]; }
export async function getBlob(id: string) { return (await req((await store("blobs")).get(id))) as Blob | undefined; }
export async function getThumb(id: string) { return (await req((await store("thumbs")).get(id))) as Blob | undefined; }
export async function removeImage(id: string) {
  const t = (await open()).transaction(["meta", "blobs", "thumbs"], "readwrite");
  ["meta", "blobs", "thumbs"].forEach((s) => t.objectStore(s).delete(id));
  await new Promise<void>((ok) => { t.oncomplete = () => ok(); });
}
export async function clearAll() {
  const t = (await open()).transaction(["meta", "blobs", "thumbs"], "readwrite");
  ["meta", "blobs", "thumbs"].forEach((s) => t.objectStore(s).clear());
  await new Promise<void>((ok) => { t.oncomplete = () => ok(); });
}
export async function getClasses(): Promise<string[]> { return ((await req((await store("config")).get("classes"))) as string[] | undefined) ?? DEFAULT_CLASSES; }
export async function setClasses(c: string[]) { await req((await store("config", "readwrite")).put(c, "classes")); }

export async function getActiveModel(): Promise<SavedOnnxModel | undefined> {
  return (await req((await store("models")).get("active"))) as SavedOnnxModel | undefined;
}
export async function saveActiveModel(model: SavedOnnxModel) {
  await req((await store("models", "readwrite")).put(model, "active"));
}
export async function removeActiveModel() {
  await req((await store("models", "readwrite")).delete("active"));
}
