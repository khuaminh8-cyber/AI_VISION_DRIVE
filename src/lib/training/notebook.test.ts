import { describe, expect, it } from "vitest";
import { colabNotebook, dataYamlFor, readiness, trainPy } from "./notebook";

const cfg = { model: "yolo11n.pt", epochs: 80, batch: 16, imgsz: 640, zipName: "d.zip" };

describe("notebook", () => {
  it("notebook is valid nbformat 4 JSON with user settings", () => {
    const nb = JSON.parse(colabNotebook(["car", "person"], cfg));
    expect(nb.nbformat).toBe(4);
    const src = nb.cells.map((c: { source: string[] }) => c.source.join("")).join("\n");
    expect(src).toContain('epochs=80, batch=16, imgsz=640');
    expect(src).toContain('format="onnx"');
  });
  it("data.yaml keeps class order", () => {
    expect(dataYamlFor(["car", "person"])).toContain('nc: 2\nnames: ["car", "person"]');
  });
  it("train.py uses chosen model", () => {
    expect(trainPy(["car"], cfg)).toContain('YOLO("yolo11n.pt")');
  });
  it("not ready without train and val images", () => {
    const r = readiness([{ split: "train", boxes: [1], status: "done" }]);
    expect(r.ok).toBe(false);
    expect(readiness([{ split: "train", boxes: [], status: "done" }, { split: "val", boxes: [1], status: "todo" }]).ok).toBe(true);
    expect(readiness([{ split: "train", boxes: [], status: "todo" }]).usable).toBe(0);
  });
});
