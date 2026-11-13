import { describe, expect, it } from "vitest";
import { classifyTtc, computeTtc, distanceSlope, estimateDistance, focalPx, Tracker } from "./tracker";

describe("collision thresholds (defaults 4s / 2s)", () => {
  it("TTC above 4s is SAFE", () => expect(classifyTtc(5, 4, 2)).toBe("safe"));
  it("TTC between 2 and 4s is WARNING", () => expect(classifyTtc(3, 4, 2)).toBe("warning"));
  it("TTC below 2s is DANGER", () => expect(classifyTtc(1.5, 4, 2)).toBe("danger"));
  it("missing TTC is N/A, never invented", () => expect(classifyTtc(null, 4, 2)).toBe("na"));
  it("custom thresholds apply", () => expect(classifyTtc(5, 6, 3)).toBe("warning"));
});

describe("ranging", () => {
  it("1.5m car, 100px tall, 70° FOV on 1280px frame ≈ 13.7m", () => {
    const d = estimateDistance(100, 1.5, focalPx(1280, 70))!;
    expect(d).toBeCloseTo(13.71, 1);
  });
  it("TTC = distance / closing speed", () => expect(computeTtc(20, 5)).toBe(4));
  it("no TTC when not approaching", () => expect(computeTtc(20, -1)).toBeNull());
  it("slope needs enough history", () => expect(distanceSlope([{ t: 0, d: 10 }, { t: 0.1, d: 9 }])).toBeNull());
});

describe("tracker", () => {
  it("keeps the same ID across frames", () => {
    const tr = new Tracker();
    const cfg = { fovDeg: 70, ttcWarn: 4, ttcDanger: 2, laneHalfWidth: 1.8 };
    for (let i = 0; i < 5; i++) tr.update([{ x1: 600 + i * 2, y1: 400, x2: 700 + i * 2, y2: 480, score: 0.9, cls: 2 }], i * 0.066, 1280, cfg);
    expect(tr.tracks).toHaveLength(1);
    expect(tr.tracks[0].name).toBe("Ô TÔ 01");
  });
});

import { rangeFromBox, NEAR_DANGER_M, NEAR_WARN_M } from "./tracker";
describe("cut-off boxes & proximity", () => {
  const f = focalPx(1280, 70);
  it("warns within 10 m and marks danger within 6 m", () => {
    expect(NEAR_WARN_M).toBe(10);
    expect(NEAR_DANGER_M).toBe(6);
  });
  it("box cut at frame bottom uses width, not shortened height", () => {
    const wpx = (1.8 * f) / 3; // car 3 m away, full width visible
    const d = rangeFromBox({ x1: 400, y1: 500, x2: 400 + wpx, y2: 720 }, 1.5, 1.8, f, 1280, 720)!;
    expect(d).toBeCloseTo(3, 1);
  });
  it("uncut box uses height", () => {
    const d = rangeFromBox({ x1: 500, y1: 300, x2: 600, y2: 400 }, 1.5, 1.8, f, 1280, 720)!;
    expect(d).toBeCloseTo(estimateDistance(100, 1.5, f)!, 5);
  });
  it("car at 3 m with no TTC is DANGER", () => {
    const tr = new Tracker();
    const h = (1.5 * f) / 3;
    tr.update([{ x1: 600, y1: 300, x2: 700, y2: 300 + h, score: 0.9, cls: 2 }], 0, 1280, { fovDeg: 70, ttcWarn: 4, ttcDanger: 2, laneHalfWidth: 1.75 }, 2000);
    expect(tr.tracks[0].dist!).toBeLessThan(NEAR_DANGER_M);
    expect(tr.tracks[0].risk).toBe("danger");
  });
  it("a close car in the next lane is SAFE (no false alarm)", () => {
    const tr = new Tracker();
    const distance = 5.9;
    const h = (1.5 * f) / distance;
    const w = (1.8 * f) / distance;
    const cx = 640 + (2 * f) / distance;
    tr.update([{ x1: cx - w / 2, y1: 100, x2: cx + w / 2, y2: 100 + h, score: 0.9, cls: 2 }], 0, 1280, { fovDeg: 70, ttcWarn: 4, ttcDanger: 2, laneHalfWidth: 1.75 }, 720);
    expect(tr.tracks[0].dist).toBeCloseTo(distance, 1);
    expect(tr.tracks[0].inEgoLane).toBe(false);
    expect(tr.tracks[0].risk).toBe("safe");
  });
});

describe("slow AI frames", () => {
  it("keeps a far car's track when AI takes 1.25 s per frame", () => {
    const tr = new Tracker();
    const cfg = { fovDeg: 70, ttcWarn: 4, ttcDanger: 2, laneHalfWidth: 1.8 };
    for (let i = 0; i < 4; i++) tr.update([{ x1: 640 + i * 6, y1: 350, x2: 670 + i * 6, y2: 372, score: 0.3, cls: 2 }], i * 1.25, 1280, cfg);
    expect(tr.tracks).toHaveLength(1);
    expect(tr.tracks[0].hits).toBe(4);
  });
});

describe("noise filtering", () => {
  const cfg = { fovDeg: 70, ttcWarn: 4, ttcDanger: 2, laneHalfWidth: 1.8 };
  it("a 1-frame blip is dropped as soon as it is missed", () => {
    const tr = new Tracker();
    tr.update([{ x1: 100, y1: 100, x2: 150, y2: 150, score: 0.5, cls: 2 }], 0, 1280, cfg);
    tr.update([], 0.1, 1280, cfg);
    expect(tr.tracks).toHaveLength(0);
  });
  it("a confirmed track (2+ hits) survives a short miss", () => {
    const tr = new Tracker();
    const d = { x1: 100, y1: 100, x2: 150, y2: 150, score: 0.9, cls: 2 };
    tr.update([d], 0, 1280, cfg); tr.update([d], 0.1, 1280, cfg); tr.update([], 0.2, 1280, cfg);
    expect(tr.tracks).toHaveLength(1);
  });
});
