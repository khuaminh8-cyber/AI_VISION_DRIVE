export interface OnnxModelReport {
  backend: string;
  inputShape: Array<number | string>;
  outputShape: number[];
  inputSize: number;
  outputFormat: "yolo-v8" | "yolo-v10";
  classCount: number;
  warmupMs: number;
}

export interface SavedOnnxModel {
  name: string;
  classNames: string[];
  classMap: number[];
  blob: Blob;
  inputSize: number;
  updatedAt: number;
}

const CLASS_ALIASES: Record<number, string[]> = {
  0: ["person", "pedestrian", "nguoi", "nguoidi"],
  1: ["bicycle", "bike", "xedap", "xedapdien"],
  2: ["car", "oto", "automobile", "xehoi"],
  3: ["motorcycle", "motorbike", "moto", "xemay", "scooter"],
  5: ["bus", "xebuyt"],
  7: ["truck", "xetai", "lorry"],
  9: ["trafficlight", "light", "dengiaothong"],
  11: ["stopsign", "sign", "biendung"],
};

const normalize = (name: string) => name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]/g, "");

/** Converts model class names, in model order, to the canonical ADAS class IDs. */
export function mapModelClasses(names: string[]): { classMap: number[]; error: string | null } {
  if (!names.length || names.some((name) => !name.trim())) return { classMap: [], error: "Nhập đầy đủ tên từng lớp theo đúng thứ tự trong model." };
  const classMap: number[] = [];
  for (const name of names) {
    const value = normalize(name);
    const match = Object.entries(CLASS_ALIASES).find(([, aliases]) => aliases.includes(value));
    if (!match) return { classMap: [], error: `Lớp “${name}” chưa được ADAS hỗ trợ; hãy dùng tên người, xe đạp, ô tô, xe máy, xe buýt, xe tải, đèn giao thông hoặc biển STOP.` };
    classMap.push(Number(match[0]));
  }
  return { classMap, error: null };
}

/** Validates the runtime input and the supported YOLO tensor layouts. */
export function inspectOnnxShapes(inputShape: Array<number | string>, outputShape: number[], classCount: number): { inputSize: number; outputFormat: OnnxModelReport["outputFormat"] } | null {
  if (inputShape.length !== 4 || inputShape[1] !== 3) return null;
  const inputHeight = typeof inputShape[2] === "number" ? inputShape[2] : 640;
  const inputWidth = typeof inputShape[3] === "number" ? inputShape[3] : 640;
  if (inputHeight !== inputWidth || inputHeight < 160 || inputHeight > 1280 || inputHeight % 32 !== 0) return null;
  if (outputShape.length !== 3 || outputShape[0] !== 1 || classCount < 1) return null;
  if (outputShape[1] === 4 + classCount && outputShape[2] > 6) return { inputSize: inputHeight, outputFormat: "yolo-v8" };
  if (outputShape[2] === 6 && outputShape[1] > 6) return { inputSize: inputHeight, outputFormat: "yolo-v10" };
  return null;
}