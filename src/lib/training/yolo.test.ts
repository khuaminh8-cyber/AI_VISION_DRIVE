import { describe, expect, it } from "vitest";
import { assignSplits, dataYaml, parseLabels, parseYamlNames, serializeLabels, toYolo, validateDataset, type ImageMeta } from "./yolo";

const img = (p: Partial<ImageMeta>): ImageMeta => ({ id: "a", name: "a.jpg", w: 100, h: 100, source: "image", split: "none", status: "todo", boxes: [], createdAt: 0, ...p });

describe("yolo format", () => {
  it("normalizes pixel rect to 0-1 center format", () => {
    expect(toYolo(2, 10, 20, 50, 60, 100, 200)).toEqual({ cls: 2, cx: 0.3, cy: 0.2, w: 0.4, h: 0.2 });
  });
  it("round-trips labels", () => {
    const b = [{ cls: 1, cx: 0.5, cy: 0.25, w: 0.1, h: 0.2 }];
    expect(serializeLabels(b)).toBe("1 0.5 0.25 0.1 0.2\n");
    expect(parseLabels(serializeLabels(b)).boxes).toEqual(b);
  });
  it("flags malformed lines", () => {
    const r = parseLabels("0 0.5 0.5 0.1\n1 a 0.5 0.1 0.1\n2 0.5 0.5 0.1 0.1");
    expect(r.issues.map((i) => i.line)).toEqual([1, 2]);
    expect(r.boxes).toHaveLength(1);
  });
});

describe("validation", () => {
  it("detects bad class, out of range and unlabeled; never counts unlabeled as done", () => {
    const { issues, counts } = validateDataset([
      img({ id: "1", boxes: [{ cls: 9, cx: 0.5, cy: 0.5, w: 0.1, h: 0.1 }] }),
      img({ id: "2", boxes: [{ cls: 0, cx: 0.95, cy: 0.5, w: 0.2, h: 0.1 }] }),
      img({ id: "3" }),
      img({ id: "4", boxes: [{ cls: 1, cx: 0.5, cy: 0.5, w: 0.2, h: 0.2 }] }),
    ], 3);
    expect(issues.map((i) => i.kind)).toEqual(["bad_class", "out_of_range", "unlabeled"]);
    expect(counts).toEqual([0, 1, 0]);
  });
  it("accepts a confirmed empty (background) image", () => {
    expect(validateDataset([img({ status: "done" })], 3).issues).toEqual([]);
  });
});

describe("split & yaml", () => {
  it("splits 70/20/10 deterministically", () => {
    const ids = Array.from({ length: 10 }, (_, i) => String(i));
    const s = Object.values(assignSplits(ids, [70, 20, 10]));
    expect(s.filter((x) => x === "train")).toHaveLength(7);
    expect(s.filter((x) => x === "val")).toHaveLength(2);
    expect(s.filter((x) => x === "test")).toHaveLength(1);
  });
  it("parses names from generated and inline yaml", () => {
    expect(parseYamlNames(dataYaml(["car", "bus"]))).toEqual(["car", "bus"]);
    expect(parseYamlNames("nc: 2\nnames: ['a', 'b']\n")).toEqual(["a", "b"]);
  });
});

import { mapCocoToClass, needsScan } from "./yolo";
describe("auto-label rules", () => {
  it("maps COCO ids to dataset classes by name", () => {
    expect(mapCocoToClass(2, ["person", "car"])).toBe(1);
    expect(mapCocoToClass(3, ["Xe máy"])).toBe(0);
    expect(mapCocoToClass(7, ["person"])).toBe(-1);
  });
  it("only scans new, unlabeled, unscanned images", () => {
    const b = { id: "a", name: "a", w: 1, h: 1, source: "image" as const, split: "none" as const, status: "todo" as const, boxes: [], createdAt: 0 };
    expect(needsScan(b)).toBe(true);
    expect(needsScan({ ...b, scanned: true })).toBe(false);
    expect(needsScan({ ...b, status: "done" })).toBe(false);
  });
});
