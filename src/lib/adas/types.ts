export type ObjKind = "car" | "truck" | "bus" | "moto" | "bike" | "person" | "light" | "sign";
export type Risk = "safe" | "warning" | "danger" | "na";

/** Raw detection in source-frame pixel coordinates. */
export interface Det {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
  cls: number;
}

/** COCO classes relevant to ADAS, with real-world reference heights (m) for monocular ranging. */
/** Typical real widths (m) used when a box is cut by the frame top/bottom. */
export const CLASS_WIDTH: Record<string, number> = { person: 0.5, bike: 0.6, car: 1.8, moto: 0.8, bus: 2.5, truck: 2.5 };

export const ADAS_CLASSES: Record<number, { label: string; kind: ObjKind; height: number }> = {
  0: { label: "NGƯỜI", kind: "person", height: 1.7 },
  1: { label: "XE ĐẠP", kind: "bike", height: 1.5 },
  2: { label: "Ô TÔ", kind: "car", height: 1.5 },
  3: { label: "XE MÁY", kind: "moto", height: 1.4 },
  5: { label: "XE BUÝT", kind: "bus", height: 3.2 },
  7: { label: "XE TẢI", kind: "truck", height: 3.0 },
  9: { label: "ĐÈN GIAO THÔNG", kind: "light", height: 0.9 },
  11: { label: "BIỂN DỪNG", kind: "sign", height: 0.75 },
};

export const VEHICLE_KINDS: ObjKind[] = ["car", "truck", "bus", "moto", "bike"];

export interface Track {
  id: number;
  name: string; // e.g. "CAR 01"
  cls: number;
  kind: ObjKind;
  label: string;
  score: number;
  /** filtered center/size in source pixels */
  cx: number;
  cy: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  /** display box, interpolated on the render loop */
  disp: { x1: number; y1: number; x2: number; y2: number } | null;
  hits: number;
  lastSeen: number;
  lastUpdate: number;
  trail: { x: number; y: number }[];
  dist: number | null;
  lateral: number | null;
  distHist: { t: number; d: number }[];
  relSpeed: number | null; // m/s, positive = approaching
  ttc: number | null;
  risk: Risk;
  inEgoLane: boolean;
}

export interface LaneLine {
  xb: number; // normalized x at bottom of ROI
  xt: number; // normalized x at top of ROI
}

export interface LaneResult {
  left: LaneLine | null;
  right: LaneLine | null;
  yb: number;
  yt: number;
}

export interface FlowVec {
  x: number;
  y: number;
  dx: number;
  dy: number;
}
