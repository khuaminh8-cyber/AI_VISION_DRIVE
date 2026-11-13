// Pure generators for the Colab notebook / train.py. No fake metrics: only scripts.
export interface TrainConfig { model: string; epochs: number; batch: number; imgsz: number; zipName: string }
export const MODELS = ["yolov8n.pt", "yolov10n.pt", "yolo11n.pt", "yolov8s.pt", "yolo11s.pt"];

export function readiness(images: { split: string; boxes: unknown[]; status: string; error?: string }[]) {
  const usable = images.filter((m) => !m.error && (m.status === "done" || m.boxes.length));
  const train = usable.filter((m) => m.split === "train").length;
  const val = usable.filter((m) => m.split === "val").length;
  const problems: string[] = [];
  if (!train) problems.push("Chưa có ảnh nào thuộc tập Train (chia Train/Val ở tab KIỂM TRA).");
  if (!val) problems.push("Chưa có ảnh nào thuộc tập Validation.");
  return { usable: usable.length, train, val, ok: problems.length === 0, problems };
}

export function dataYamlFor(names: string[], root = "/content/dataset") {
  return [`path: ${root}`, "train: images/train", "val: images/val", "test: images/test", `nc: ${names.length}`,
    `names: [${names.map((n) => JSON.stringify(n)).join(", ")}]`].join("\n") + "\n";
}

function trainCall(c: TrainConfig, data: string) {
  return `model = YOLO(${JSON.stringify(c.model)})\nmodel.train(data=${JSON.stringify(data)}, epochs=${c.epochs}, batch=${c.batch}, imgsz=${c.imgsz}, project="runs", name="adas", exist_ok=True)`;
}
// Ultralytics may save to runs/adas, runs/detect/adas or runs/detect/runs/adas — locate best.pt instead of hardcoding.
const exportCall = (c: TrainConfig) =>
  `import glob, os\npts = sorted(glob.glob("**/runs/**/weights/best.pt", recursive=True) + glob.glob("runs/**/weights/best.pt", recursive=True), key=os.path.getmtime)\nif not pts:\n    raise FileNotFoundError("Không tìm thấy best.pt — hãy chạy xong ô Huấn luyện trước.")\nbest_pt = pts[-1]\nprint("Dùng:", best_pt)\nbest = YOLO(best_pt)\nonnx_path = best.export(format="onnx", imgsz=${c.imgsz}, opset=12, simplify=True, dynamic=False)\nprint("ONNX:", onnx_path)`;

export function trainPy(names: string[], c: TrainConfig) {
  return `# AI Vision Drive — fine-tune YOLO (máy có GPU NVIDIA)
# Cài: pip install ultralytics onnx onnxslim
# Giải nén ${c.zipName} vào thư mục ./dataset rồi chạy: python train.py
from pathlib import Path
from ultralytics import YOLO

root = Path("dataset").resolve()
(root / "data.yaml").write_text("""${dataYamlFor(names, "__ROOT__")}""".replace("__ROOT__", str(root)))

${trainCall(c, "dataset/data.yaml")}
metrics = model.val()
print("mAP50:", metrics.box.map50, "mAP50-95:", metrics.box.map)
${exportCall(c)}
`;
}

const lines = (s: string) => s.split("\n").map((l, i, a) => (i < a.length - 1 ? l + "\n" : l));
const md = (s: string) => ({ cell_type: "markdown", metadata: {}, source: lines(s) });
const code = (s: string) => ({ cell_type: "code", metadata: {}, execution_count: null, outputs: [], source: lines(s) });

export function colabNotebook(names: string[], c: TrainConfig) {
  const cells = [
    md(`# AI Vision Drive — Fine-tune YOLO\nModel gốc: **${c.model}** · ${c.epochs} epochs · batch ${c.batch} · ảnh ${c.imgsz}px · ${names.length} class\n\nVào **Runtime → Change runtime type → GPU (T4)** trước khi chạy.`),
    code("!nvidia-smi"),
    code("!pip install -q ultralytics onnx onnxslim"),
    md(`## Tải dataset\nChạy ô dưới rồi chọn file **${c.zipName}** đã xuất từ tab DATASET.`),
    code(`from google.colab import files\nimport zipfile, os\nup = files.upload()\nzname = next(iter(up))\nos.makedirs("/content/dataset", exist_ok=True)\nzipfile.ZipFile(zname).extractall("/content/dataset")\nprint(os.listdir("/content/dataset"))`),
    code(`open("/content/dataset/data.yaml", "w").write("""${dataYamlFor(names)}""")\nprint(open("/content/dataset/data.yaml").read())`),
    md("## Huấn luyện"),
    code(`from ultralytics import YOLO\n${trainCall(c, "/content/dataset/data.yaml")}`),
    md("## Đánh giá"),
    code(`metrics = model.val()\nprint("mAP50:", metrics.box.map50, "mAP50-95:", metrics.box.map)`),
    md("## Xuất ONNX\nTải `best.onnx` về để nạp vào AI Vision Drive."),
    code(`from google.colab import files\n${exportCall(c)}\nfiles.download(str(onnx_path))`),
  ];
  return JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { accelerator: "GPU", colab: { provenance: [] }, kernelspec: { name: "python3", display_name: "Python 3" } }, cells }, null, 1);
}
