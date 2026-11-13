import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Laptop,
  AlertTriangle, Camera, Cpu, Download, FileVideo, Gauge, Maximize, Monitor, Pause, Play,
  RotateCcw, ScanLine, Upload, Volume2, VolumeX, Zap,
} from "lucide-react";
import { AdasEngine, AUX_MODELS, boundedVideoSize, cameraConstraints, type AuxKind, DEFAULT_MODEL_URL, DEFAULT_SETTINGS, modelBackendPreference, type ModeKey, type ModelState, type Settings } from "@/lib/adas/engine";
import { drawOverlay, PAL } from "@/lib/adas/overlay";
import type { Risk } from "@/lib/adas/types";
import type { SavedOnnxModel } from "@/lib/adas/model-config";
import { getActiveModel } from "@/lib/training/db";
import { Radar2D, Sparkline } from "./Canvases";
const AIChat = lazy(() => import("./AIChat"));

const Scene3DLazy = lazy(() => import("./Scene3D"));

type GLLevel = "webgl2" | "webgl" | "none";

/** Probe WebGL leniently (allow software/weak GPUs) and release the probe context immediately. */
function probeWebGL(): GLLevel {
  const attrs: WebGLContextAttributes = { failIfMajorPerformanceCaveat: false, powerPreference: "default" };
  for (const kind of ["webgl2", "webgl", "experimental-webgl"] as const) {
    try {
      const c = document.createElement("canvas");
      const ctx = c.getContext(kind, attrs) as WebGLRenderingContext | null;
      if (ctx) {
        ctx.getExtension("WEBGL_lose_context")?.loseContext();
        return kind === "webgl2" ? "webgl2" : "webgl";
      }
    } catch { /* try next */ }
  }
  return "none";
}

class GLBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(e: unknown) { console.warn("3D disabled:", e); }
  override render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function Scene3D(props: Omit<React.ComponentProps<typeof Scene3DLazy>, "lite" | "onLost" | "paused">) {
  const [level, setLevel] = useState<GLLevel | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setLevel(probeWebGL()); }, [attempt]);
  useEffect(() => {
    const update = () => setPageVisible(!document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    const el = boxRef.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => setOnScreen(!!e?.isIntersecting), { rootMargin: "100px" });
    io.observe(el); return () => io.disconnect();
  }, [level]);
  if (level === null) return <div ref={boxRef} className="absolute inset-0" />;
  const retry = () => { setFailed(false); setLevel(null); setAttempt((a) => a + 1); };
  const fallback = (
    <div className="absolute inset-0">
      <Radar2D engine={props.engine} />
      <div className="absolute inset-x-0 top-2 flex flex-col items-center gap-1 px-3 text-center text-xs text-muted-foreground">
        <span>Không khởi tạo được 3D — đang dùng Radar 2D.</span>
        <span className="text-[10px]">Chrome/Edge: bật "Dùng tăng tốc phần cứng" trong Cài đặt → Hệ thống, rồi tải lại.</span>
        <button onClick={retry} className="seg-btn seg-on mt-1 rounded border border-border px-2 py-0.5">Thử lại 3D</button>
      </div>
    </div>
  );
  if (level === "none" || failed) return fallback;
  return (
    <div ref={boxRef} className="absolute inset-0">
      <GLBoundary key={attempt} fallback={fallback}>
        <Scene3DLazy {...props} paused={!onScreen || !pageVisible} lite={props.perf || level === "webgl"} onLost={() => setFailed(true)} />
      </GLBoundary>
    </div>
  );
}

type Source = "none" | "camera" | "screen" | "file";

const MODES: { key: ModeKey; label: string; needs?: "model" | "unavailable" | "aux"; note: string }[] = [
  { key: "detect", label: "NHẬN DIỆN VẬT THỂ", needs: "model", note: "YOLO ONNX trong Web Worker" },
  { key: "track", label: "THEO DÕI PHƯƠNG TIỆN", needs: "model", note: "Alpha-beta (Kalman) + IoU, ID ổn định" },
  { key: "lane", label: "NHẬN DIỆN LÀN ĐƯỜNG", note: "Gray → Blur → Canny → ROI → Hough" },
  { key: "seg", label: "PHÂN VÙNG MẶT ĐƯỜNG", needs: "aux", note: "SegFormer-B0 ONNX · tô vùng xe chạy được" },
  { key: "depth", label: "ƯỚC LƯỢNG ĐỘ SÂU", needs: "aux", note: "Depth Anything V2 · bản đồ nhiệt gần/xa" },
  { key: "collision", label: "DỰ ĐOÁN VA CHẠM", needs: "model", note: "TTC = khoảng cách / tốc độ tiếp cận" },
  { key: "blind", label: "CẢNH BÁO ĐIỂM MÙ", needs: "model", note: "Vật thể sát mép khung hình < 6 m" },
  { key: "sign", label: "NHẬN DIỆN BIỂN BÁO", needs: "model", note: "Đèn giao thông & biển STOP (COCO)" },
  { key: "flow", label: "LUỒNG CHUYỂN ĐỘNG", note: "Block-matching giữa các frame" },
  { key: "scene3d", label: "3D SCENE MODE", note: "Tắt để xem radar 2D" },
];

const RES = { "480p": [854, 480], "720p": [1280, 720], "1080p": [1920, 1080] } as const;

const riskText = (r: Risk) => (r === "danger" ? "NGUY HIỂM" : r === "warning" ? "CẢNH BÁO" : r === "safe" ? "AN TOÀN" : "KHÔNG CÓ");

export default function Dashboard() {
  const engineRef = useRef<AdasEngine | null>(null);
  if (!engineRef.current) engineRef.current = new AdasEngine();
  const engine = engineRef.current;

  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneCanvas = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const modelFileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const overlayVisible = useRef(true);

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    const n = navigator as Navigator & { deviceMemory?: number };
    const mobile = /Android|iPhone|iPad/i.test(n.userAgent);
    const weak = (n.hardwareConcurrency ?? 8) <= 4 || (n.deviceMemory ?? 8) <= 4 || mobile;
    if (weak) setSettings((x) => ({ ...x, perf: true, lite: true }));
    if (mobile) setRes("480p");
  }, []);
  const [source, setSource] = useState<Source>("none");
  const [paused, setPaused] = useState(false);
  const [viewOff, setViewOff] = useState(false);
  const [res, setRes] = useState<keyof typeof RES>("480p");
  const [model, setModel] = useState<ModelState>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState(engine.stats);
  const [lane, setLane] = useState(engine.lane);
  const [videoSize, setVideoSize] = useState<[number, number] | null>(null);
  const [customUrl, setCustomUrl] = useState("");
  const [gpu, setGpu] = useState<string>("checking");
  const [aux, setAux] = useState<Record<AuxKind, ModelState>>({ seg: { status: "idle" }, depth: { status: "idle" } });

  engine.settings = settings;
  const savedRef = useRef<SavedOnnxModel | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
  useEffect(() => { getActiveModel().then((m) => { savedRef.current = m ?? null; setSavedName(m?.name ?? null); }).catch(() => {}); }, []);
  const loadModel = (src: Parameters<AdasEngine["loadModel"]>[0], prefer?: "wasm") =>
    engine.loadModel(src, modelBackendPreference(settings.lite) ?? prefer);
  const autoLoad = () => {
    const m = savedRef.current;
    if (m) loadModel({ file: new File([m.blob], m.name), classMap: m.classMap, size: m.inputSize });
    else loadModel({ url: DEFAULT_MODEL_URL });
  };

  useEffect(() => {
    engine.init();
    engine.onModel = setModel;
    engine.onAux = (k, st) => setAux((a) => ({ ...a, [k]: st }));
    engine.onError = (m) => setError(m);
    let raf = 0, last = performance.now();
    const ctx = overlayRef.current!.getContext("2d")!;
    let lastDraw = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      engine.tick(now);
      const minGap = engine.settings.perf || engine.settings.lite ? 1000 / 30 : 0;
      if (now - lastDraw < minGap) return;
      lastDraw = now;
      const dt = Math.min(0.08, (now - last) / 1000); last = now;
      const v = engine.video;
      if (v && v.videoWidth && overlayVisible.current && !document.hidden) drawOverlay(ctx, engine, dt, now);
    };
    raf = requestAnimationFrame(loop);
    const io = new IntersectionObserver(([e]) => { overlayVisible.current = !!e?.isIntersecting; });
    io.observe(overlayRef.current!);
    const iv = setInterval(() => { if (document.hidden) return; setStats({ ...engine.stats }); setLane({ ...engine.lane }); }, 250);
    return () => { io.disconnect(); cancelAnimationFrame(raf); clearInterval(iv); engine.dispose(); streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, [engine]);

  useEffect(() => {
    if (settings.lite) {
      setGpu("CPU LITE");
      return;
    }
    const nav = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } };
    if (!nav.gpu) setGpu("unsupported");
    else nav.gpu.requestAdapter().then((a) => setGpu(a ? "available" : "no adapter")).catch(() => setGpu("error"));
  }, [settings.lite]);

  // count real decoded camera frames
  useEffect(() => {
    const v = videoRef.current as (HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (n: number) => void }) | null;
    if (!v?.requestVideoFrameCallback || source === "none") return;
    let id = 0;
    const cb = () => { engine.countCamFrame(); id = v.requestVideoFrameCallback!(cb); };
    id = v.requestVideoFrameCallback(cb);
    return () => v.cancelVideoFrameCallback?.(id);
  }, [engine, source]);

  const ensureModel = useCallback(() => {
    if (settings.modes.detect && (model.status === "idle" || model.status === "error")) autoLoad();
  }, [engine, model.status, settings.modes.detect, settings.lite]);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current!;
    v.pause(); v.srcObject = null;
    if (v.src) { URL.revokeObjectURL(v.src); v.removeAttribute("src"); v.load(); }
  };

  const attach = async (kind: Source, stream?: MediaStream, file?: File) => {
    const v = videoRef.current!;
    stopStream();
    engine.reset();
    if (stream) { v.srcObject = stream; streamRef.current = stream; v.muted = true; stream.getVideoTracks()[0].onended = () => { setSource("none"); engine.video = null; }; }
    if (file) { v.src = URL.createObjectURL(file); v.loop = true; v.muted = true; }
    await v.play();
    engine.video = v;
    setSource(kind); setPaused(false); setError(null);
    ensureModel();
  };

  const startCamera = async (r = res) => {
    engine.unlockAudio();
    try {
      const [w, h] = RES[r];
      const s = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(w, h, settings.lite), audio: false });
      await attach("camera", s);
    } catch (e) { setError(permMsg(e, "camera")); }
  };
  const startScreen = async () => {
    engine.unlockAudio();
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: settings.lite
        ? { frameRate: { ideal: 12, max: 15 }, width: { max: 854 }, height: { max: 480 } }
        : { frameRate: { ideal: 15, max: 24 }, width: { max: 1280 }, height: { max: 720 } }, audio: false });
      await attach("screen", s);
    } catch (e) { setError(permMsg(e, "screen")); }
  };
  const onFile = async (f?: File) => { if (f) { engine.unlockAudio(); try { await attach("file", undefined, f); } catch (e) { setError(String(e)); } } };

  const toggleSound = () => {
    const enabling = !settings.sound;
    if (enabling) engine.unlockAudio();
    setSettings((s) => ({ ...s, sound: !s.sound }));
  };

  const togglePause = () => {
    const v = videoRef.current!;
    if (v.paused) { v.play(); setPaused(false); } else { v.pause(); setPaused(true); }
  };

  const setMode = (k: ModeKey, on: boolean) => {
    setSettings((s) => ({ ...s, modes: { ...s.modes, [k]: on } }));
    if (k === "detect" && on && source !== "none" && (model.status === "idle" || model.status === "error")) autoLoad();
  };

  const snapshot = (withScene: boolean) => {
    const v = videoRef.current!;
    if (!v.videoWidth) return;
    const [W, H] = boundedVideoSize(v.videoWidth, v.videoHeight);
    if (!W || !H) return;
    const sc = withScene && sceneCanvas.current ? sceneCanvas.current : null;
    const sw = sc ? Math.round((sc.width / sc.height) * H) : 0;
    const c = document.createElement("canvas");
    c.width = W + sw; c.height = H;
    const g = c.getContext("2d")!;
    g.drawImage(v, 0, 0, W, H);
    g.drawImage(overlayRef.current!, 0, 0, W, H);
    if (sc) g.drawImage(sc, W, 0, sw, H);
    g.font = `600 ${Math.round(H / 40)}px "JetBrains Mono", monospace`;
    g.fillStyle = PAL.cyan;
    g.fillText(`AI VISION DRIVE · ${new Date().toLocaleString()}`, 16, H - 16);
    const a = document.createElement("a");
    a.download = `ai-vision-drive-${Date.now()}.png`;
    a.href = c.toDataURL("image/png"); a.click();
  };

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else rootRef.current?.requestFullscreen?.();
  };

  const active = source !== "none";
  const modelReady = model.status === "ready";
  const banner: Risk =
    stats.worstRisk === "danger" || lane.departure === "danger" ? "danger" : stats.worstRisk === "warning" || lane.departure === "warning" ? "warning" : "na";
  const n = stats.nearest;

  return (
    <div ref={rootRef} className="adas-root min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 lg:px-6">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-md border border-primary/40 bg-primary/10"><ScanLine className="size-5 text-primary" /></div>
          <div>
            <h1 className="font-display text-lg font-bold leading-none tracking-[0.18em]">AI VISION DRIVE</h1>
            <p className="mt-1 text-[11px] tracking-widest text-muted-foreground">MÔ PHỎNG HỖ TRỢ LÁI THỜI GIAN THỰC · CHẠY TRÊN MÁY</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Link to="/training" className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold tracking-widest text-primary hover:bg-primary/20">AI TRAINING CENTER</Link>
          <Chip tone={gpu === "available" ? "safe" : "warning"} icon={<Cpu className="size-3.5" />}>WebGPU {gpu === "available" ? "OK" : gpu.toUpperCase()}</Chip>
          <Chip tone={modelReady ? "safe" : model.status === "error" ? "danger" : "muted"}>
            {modelReady ? `${model.backend}` : model.status === "loading" ? "ĐANG TẢI MÔ HÌNH" : "CHƯA TẢI MÔ HÌNH"}
          </Chip>
          <IconBtn active={settings.perf} onClick={() => setSettings((s) => ({ ...s, perf: !s.perf }))} title="Chế độ hiệu năng"><Zap className="size-4" /><span className="hidden sm:inline">HIỆU NĂNG</span></IconBtn>
          <IconBtn active={settings.lite} onClick={() => setSettings((s) => ({ ...s, lite: !s.lite }))} title="Máy văn phòng / cấu hình thấp: AI 4 FPS, ảnh nhỏ, tắt độ sâu, phân vùng, 3D"><Laptop className="size-4" /><span className="hidden sm:inline">{settings.lite ? "VĂN PHÒNG · 4 FPS" : "VĂN PHÒNG"}</span></IconBtn>
          <IconBtn active={settings.sound} onClick={toggleSound} title="Âm thanh cảnh báo">{settings.sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}</IconBtn>
          <IconBtn onClick={() => snapshot(true)} disabled={!active} title="Chụp dashboard"><Download className="size-4" /></IconBtn>
          <IconBtn onClick={() => engine.reset()} title="Đặt lại mô phỏng"><RotateCcw className="size-4" /></IconBtn>
          <IconBtn onClick={fullscreen} title="Toàn màn hình"><Maximize className="size-4" /></IconBtn>
        </div>
      </header>

      {banner !== "na" && (
        <div className={`alert-banner mx-4 mt-3 lg:mx-6 ${banner === "danger" ? "alert-danger" : "alert-warning"}`}>
          <AlertTriangle className="size-5 shrink-0" />
          <span className="font-display text-base font-bold tracking-widest">
            {stats.worstRisk === banner ? (banner === "danger" ? "CẢNH BÁO VA CHẠM" : "CHÚ Ý PHÍA TRƯỚC") : "CẢNH BÁO LỆCH LÀN"}
          </span>
          <span className="font-mono text-sm opacity-90">
            {stats.worstRisk === banner && n ? `${n.name} · ${n.dist?.toFixed(1)} m · TTC ${n.ttc != null ? n.ttc.toFixed(1) + " s" : "—"}` : lane.offsetM != null ? `Lệch tâm ${lane.offsetM.toFixed(2)} m` : ""}
          </span>
        </div>
      )}

      <main className="grid gap-4 p-4 lg:grid-cols-[3fr_2fr] lg:p-6">
        {/* Camera */}
        <section className="panel flex flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
            <span className="flex items-center gap-2 font-display text-sm font-bold tracking-widest">
              <span className={`size-2 rounded-full ${active && !paused ? "bg-danger live-dot" : "bg-muted-foreground"}`} /> LIVE CAMERA
            </span>
            <span className={`text-[11px] font-semibold tracking-widest ${active ? "text-safe" : "text-muted-foreground"}`}>{active ? (paused ? "TẠM DỪNG" : "CAMERA ĐANG CHẠY") : "CHƯA CÓ NGUỒN"}</span>
            <Metric label="FPS" value={active ? stats.camFps.toFixed(0) : "—"} />
            <Metric label="ĐPG" value={videoSize ? `${videoSize[0]}×${videoSize[1]}` : "—"} />
            <Metric label="AI" value={modelReady && active ? `${stats.latency.toFixed(0)} ms` : "—"} />
            <div className="ml-auto flex flex-wrap gap-1.5">
              <IconBtn onClick={() => startCamera()} active={source === "camera"} title="Bật camera"><Camera className="size-4" /></IconBtn>
              <IconBtn onClick={startScreen} active={source === "screen"} title="Chia sẻ màn hình"><Monitor className="size-4" /></IconBtn>
              <IconBtn onClick={() => fileRef.current?.click()} active={source === "file"} title="Chọn video"><FileVideo className="size-4" /></IconBtn>
              <IconBtn onClick={togglePause} disabled={!active} title="Dừng / phát">{paused ? <Play className="size-4" /> : <Pause className="size-4" />}</IconBtn>
              <IconBtn onClick={() => snapshot(false)} disabled={!active} title="Chụp ảnh phân tích"><ScanLine className="size-4" /></IconBtn>
            </div>
            <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
          <div className="viewport relative aspect-video w-full">
            <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-contain"
              onLoadedMetadata={(e) => setVideoSize([e.currentTarget.videoWidth, e.currentTarget.videoHeight])} />
            <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
            {active && (stats.blindLeft || stats.blindRight) && settings.modes.blind && modelReady && (
              <>
                {stats.blindLeft && <div className="blind-zone left-0">ĐIỂM MÙ</div>}
                {stats.blindRight && <div className="blind-zone right-0">ĐIỂM MÙ</div>}
              </>
            )}
            {active && settings.modes.detect && !modelReady && (
              <div className="absolute left-3 top-3 rounded-md border border-warning/40 bg-background/80 px-3 py-2 font-mono text-xs text-warning">
                {model.status === "loading" ? `ĐANG TẢI MÔ HÌNH · ${model.text}` : model.status === "error" ? `LỖI MÔ HÌNH · ${model.message}` : "CHƯA TẢI MÔ HÌNH — chưa có nhận diện"}
              </div>
            )}
            {!active && (
              <div className="absolute inset-0 grid place-items-center p-6">
                <div className="max-w-md text-center">
                  <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full border border-primary/40 bg-primary/10"><Camera className="size-6 text-primary" /></div>
                  <h2 className="font-display text-xl font-bold tracking-wider">Chọn nguồn video</h2>
                  <p className="mt-2 text-sm text-muted-foreground">Mọi xử lý AI chạy ngay trên trình duyệt của bạn. Video không được gửi lên máy chủ.</p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <button className="btn-primary" onClick={() => startCamera()}><Camera className="size-4" /> Bật camera</button>
                    <button className="btn-ghost" onClick={startScreen}><Monitor className="size-4" /> Chia sẻ màn hình</button>
                    <button className="btn-ghost" onClick={() => fileRef.current?.click()}><FileVideo className="size-4" /> Chọn video</button>
                  </div>
                  <p className="mt-4 text-xs text-muted-foreground">Mẹo: mở một video dashcam trên YouTube rồi chọn “Chia sẻ màn hình”.</p>
                </div>
              </div>
            )}
            {lane.offsetM != null && settings.modes.lane && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md border border-border bg-background/75 px-3 py-1.5 font-mono text-xs">
                LANE OFFSET <span className={lane.departure === "danger" ? "text-danger" : lane.departure === "warning" ? "text-warning" : "text-safe"}>{lane.offsetM > 0 ? "R " : "L "}{Math.abs(lane.offsetM).toFixed(2)} m</span>
              </div>
            )}
          </div>
          <div className="border-t border-warning/40 bg-warning/10 px-4 py-3 text-sm leading-relaxed text-foreground sm:text-base">
            <span className="font-bold text-warning">Lưu ý: </span>
            Hệ thống cảnh báo liên tục là do đang ở chế độ <b>Demo</b>. Khi đưa vào thực tế sẽ tinh chỉnh tuỳ nơi — ví dụ trên cao tốc dùng khoảng cách an toàn đúng chuẩn cao tốc, trong phố dùng khoảng cách ngắn hơn.
          </div>
          {error && <div className="border-t border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">{error}</div>}
        </section>

        {/* 3D + chat */}
        <div className="flex flex-col gap-4">
        <section className="panel flex min-h-[340px] flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
            <span className="font-display text-sm font-bold tracking-widest">{viewOff ? "MÔ HÌNH TẮT" : settings.modes.scene3d ? "3D SCENE" : "2D RADAR"}</span>
            <span className="text-[11px] tracking-widest text-muted-foreground">{stats.objects} TRACKED</span>
            <div className="ml-auto flex rounded-md border border-border p-0.5 text-[11px] font-semibold">
              <button onClick={() => setViewOff(true)} className={`seg-btn ${viewOff ? "seg-on" : ""}`}>TẮT</button>
              {(["2D", "3D"] as const).map((m) => (
                <button key={m} onClick={() => { setViewOff(false); setMode("scene3d", m === "3D"); }} className={`seg-btn ${!viewOff && (m === "3D") === settings.modes.scene3d ? "seg-on" : ""}`}>{m}</button>
              ))}
            </div>
          </div>
          <div className="relative flex-1">
            {viewOff ? (
              <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">Mô hình đang tắt để máy chạy mượt hơn. Bấm 2D hoặc 3D để bật lại.</div>
            ) : settings.modes.scene3d ? (
              <Suspense fallback={<div className="grid h-full place-items-center text-sm text-muted-foreground">Đang khởi tạo 3D…</div>}>
                <div className="absolute inset-0"><Scene3D engine={engine} perf={settings.perf || settings.lite} canvasRef={sceneCanvas} /></div>
              </Suspense>
            ) : (
              <div className="absolute inset-0"><Radar2D engine={engine} /></div>
            )}
            {!active && !viewOff && <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-muted-foreground">Mô hình 3D sẽ hiển thị phương tiện khi AI nhận diện</div>}
          </div>
        </section>
        <Suspense fallback={<div className="panel h-[420px]" />}><AIChat /></Suspense>
        </div>

        {/* HUD */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:col-span-2">
          <Hud label="AI FPS" value={modelReady && active ? stats.aiFps.toFixed(0) : "—"} />
          <Hud label="THỜI GIAN SUY LUẬN" value={modelReady && active ? stats.latency.toFixed(0) : "—"} unit="ms" />
          <Hud label="ĐỘ PHÂN GIẢI" value={videoSize ? `${videoSize[0]}×${videoSize[1]}` : "—"} />
          <Hud label="SỐ VẬT THỂ" value={modelReady && active ? String(stats.objects) : "—"} />
          <Hud label="ĐỘ LỆCH LÀN" value={lane.offsetM != null ? lane.offsetM.toFixed(2) : "—"} unit={lane.offsetM != null ? "m" : ""} tone={lane.departure} />
          <Hud label="VẬT THỂ GẦN NHẤT" value={n?.dist != null ? n.dist.toFixed(1) : "—"} unit={n ? "m" : ""} sub={n?.name} />
          <Hud label="TỐC ĐỘ TƯƠNG ĐỐI" value={n?.relSpeed != null ? (n.relSpeed * 3.6).toFixed(0) : "—"} unit={n?.relSpeed != null ? "km/h" : ""} sub={n?.relSpeed != null ? (n.relSpeed > 0 ? "đang tiến gần" : "đang xa dần") : undefined} />
          <Hud label="THỜI GIAN VA CHẠM" value={n?.ttc != null ? n.ttc.toFixed(1) : "—"} unit={n?.ttc != null ? "s" : ""} tone={n?.risk} sub={n ? riskText(n.risk) : undefined} />
          <Hud label="WEBGPU" value={modelReady ? model.backend : gpu === "available" ? "SẴN SÀNG" : "KHÔNG CÓ"} small />
          <Hud label="THEO DÕI" value={!modelReady ? "TẮT" : stats.objects ? "ĐÃ KHÓA" : "ĐANG TÌM"} small sub={stats.signs.length && settings.modes.sign ? stats.signs.join(", ") : undefined} />
        </section>

        {/* Modes */}
        <section className="panel p-4 [contain:layout_paint]">
          <h3 className="panel-title">CHẾ ĐỘ AI</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {MODES.map((m) => {
              const on = settings.modes[m.key];
              const unavailable = m.needs === "unavailable";
              const needModel = m.needs === "model" && !modelReady;
              if (m.needs === "aux") {
                const k = m.key as AuxKind;
                const st = aux[k];
                return (
                  <div key={m.key} className={`mode-row ${on && st.status === "ready" ? "mode-on" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold tracking-widest">{m.label}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {st.status === "idle" && <span className="text-warning">CHƯA TẢI · {AUX_MODELS[k].size} · </span>}
                        {st.status === "loading" && <span className="text-primary">{Math.round(st.progress * 100)}% · {st.text}</span>}
                        {st.status === "error" && <span className="text-danger">Lỗi: {st.message}</span>}
                        {st.status === "ready" && <span className="text-safe">● {st.backend} · </span>}
                        {st.status !== "loading" && st.status !== "error" && m.note}
                      </div>
                      {st.status === "loading" && <div className="mt-1 h-1 overflow-hidden rounded bg-border"><div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(st.progress * 100)}%` }} /></div>}
                    </div>
                    {st.status === "ready" ? (
                      <div className="flex items-center gap-2">
                        <button type="button" className="text-[10px] font-semibold tracking-widest text-muted-foreground hover:text-danger" onClick={() => { setMode(m.key, false); engine.unloadAux(k); }}>GỠ</button>
                        <input type="checkbox" className="toggle" checked={on} onChange={(e) => setMode(m.key, e.target.checked)} aria-label={m.label} />
                      </div>
                    ) : (
                      <button type="button" className="btn-ghost shrink-0 px-2 py-1 text-[11px]" disabled={st.status === "loading"} onClick={() => { engine.loadAux(k); setMode(m.key, true); }}>
                        <Download className="size-3.5" /> {st.status === "error" ? "THỬ LẠI" : st.status === "loading" ? "ĐANG TẢI" : "TẢI"}
                      </button>
                    )}
                  </div>
                );
              }
              return (
                <label key={m.key} className={`mode-row ${on && !unavailable ? "mode-on" : ""}`}>
                  <div className="min-w-0">
                    <div className="text-xs font-bold tracking-widest">{m.label}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {unavailable ? <span className="text-warning">CHƯA TẢI MÔ HÌNH · </span> : needModel && on ? <span className="text-warning">CHỜ MODEL · </span> : null}
                      {m.note}
                    </div>
                  </div>
                  <input type="checkbox" className="toggle" disabled={unavailable} checked={on && !unavailable} onChange={(e) => setMode(m.key, e.target.checked)} />
                </label>
              );
            })}
          </div>
        </section>

        {/* Settings + model + charts */}
        <section className="panel space-y-4 p-4 [contain:layout_paint]">
          <div>
            <h3 className="panel-title">MÔ HÌNH AI</h3>
            <div className="mt-2 rounded-md border border-border bg-background/40 p-3 text-sm">
              {model.status === "ready" && <p className="text-safe">● {model.name} · {model.backend}</p>}
              {model.status === "idle" && <p className="text-muted-foreground">CHƯA TẢI MÔ HÌNH — tải YOLOv10n (9.4 MB, COCO) chạy cục bộ.</p>}
              {model.status === "error" && <p className="text-danger">Lỗi: {model.message}</p>}
              {model.status === "loading" && (
                <div>
                  <p className="text-muted-foreground">{model.text}</p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${Math.round(model.progress * 100)}%` }} /></div>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {savedName && <button className="btn-primary" disabled={model.status === "loading"} onClick={autoLoad}><Download className="size-4" /> {savedName}</button>}
                <button className={savedName ? "btn-ghost" : "btn-primary"} disabled={model.status === "loading"} onClick={() => loadModel({ url: DEFAULT_MODEL_URL })}><Download className="size-4" /> YOLOv10n</button>
                <button className="btn-ghost" disabled={model.status === "loading"} onClick={() => modelFileRef.current?.click()}><Upload className="size-4" /> Tệp .onnx</button>
                <button className="btn-ghost" disabled={model.status === "loading"} onClick={() => loadModel({ url: DEFAULT_MODEL_URL }, "wasm")}><Cpu className="size-4" /> CPU</button>
              </div>
              <div className="mt-2 flex gap-2">
                <input value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="URL model ONNX (YOLOv8/10/11, 640×640)" className="field flex-1" />
                <button className="btn-ghost" disabled={!customUrl || model.status === "loading"} onClick={() => loadModel({ url: customUrl })}>Tải</button>
              </div>
              <input ref={modelFileRef} type="file" accept=".onnx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadModel({ file: f }); }} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Slider label="Độ tin cậy" value={settings.conf} min={0.1} max={0.9} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setSettings((s) => ({ ...s, conf: v }))} />
            <Slider label="AI FPS (tối đa)" value={settings.aiFps} min={5} max={30} step={1} fmt={(v) => `${v}`} onChange={(v) => setSettings((s) => ({ ...s, aiFps: v }))} />
            <Slider label="Ngưỡng cảnh báo TTC" value={settings.ttcWarn} min={2} max={8} step={0.5} fmt={(v) => `${v}s`} onChange={(v) => setSettings((s) => ({ ...s, ttcWarn: Math.max(v, s.ttcDanger + 0.5) }))} />
            <Slider label="Ngưỡng nguy hiểm TTC" value={settings.ttcDanger} min={0.5} max={4} step={0.5} fmt={(v) => `${v}s`} onChange={(v) => setSettings((s) => ({ ...s, ttcDanger: Math.min(v, s.ttcWarn - 0.5) }))} />
            <Slider label="Góc nhìn camera (ước lượng khoảng cách)" value={settings.fovDeg} min={40} max={120} step={1} fmt={(v) => `${v}°`} onChange={(v) => setSettings((s) => ({ ...s, fovDeg: v }))} />
            <div>
              <div className="mb-1 text-[11px] font-semibold tracking-widest text-muted-foreground">ĐỘ PHÂN GIẢI CAMERA</div>
              <div className="flex rounded-md border border-border p-0.5 text-xs font-semibold">
                {(Object.keys(RES) as (keyof typeof RES)[]).map((r) => (
                  <button key={r} className={`seg-btn flex-1 ${res === r ? "seg-on" : ""}`} onClick={() => { setRes(r); if (source === "camera") startCamera(r); }}>{r}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border border-border p-2">
              <div className="flex justify-between text-[11px] tracking-widest text-muted-foreground"><span>AI FPS</span><Gauge className="size-3.5" /></div>
              <div className="h-16"><Sparkline engine={engine} series="fps" color={PAL.cyan} max={30} /></div>
            </div>
            <div className="rounded-md border border-border p-2">
              <div className="flex justify-between text-[11px] tracking-widest text-muted-foreground"><span>ĐỘ TRỄ ms</span><Cpu className="size-3.5" /></div>
              <div className="h-16"><Sparkline engine={engine} series="lat" color={PAL.warning} max={100} /></div>
            </div>
          </div>
        </section>
      </main>
      <footer className="px-6 pb-6 text-[11px] leading-relaxed text-muted-foreground">
        Khoảng cách ước lượng bằng mô hình camera pinhole (chiều cao thực của vật thể ÷ chiều cao khung) — chỉnh FOV cho đúng camera của bạn. Đây là bản mô phỏng nghiên cứu, không dùng thay hệ thống an toàn thật.
      </footer>
    </div>
  );
}

function permMsg(e: unknown, what: "camera" | "screen") {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError") return what === "camera" ? "Bạn đã từ chối quyền camera. Hãy cho phép trong thanh địa chỉ trình duyệt rồi thử lại." : "Đã huỷ chia sẻ màn hình.";
  if (name === "NotFoundError") return "Không tìm thấy camera trên thiết bị này.";
  if (name === "NotReadableError") return "Camera đang được ứng dụng khác sử dụng.";
  return `Không mở được ${what === "camera" ? "camera" : "màn hình"}: ${(e as Error)?.message ?? e}`;
}

function Chip({ children, tone, icon }: { children: React.ReactNode; tone: "safe" | "warning" | "danger" | "muted"; icon?: React.ReactNode }) {
  return <span className={`chip chip-${tone}`}>{icon}{children}</span>;
}
function IconBtn({ children, onClick, active, disabled, title }: { children: React.ReactNode; onClick: () => void; active?: boolean; disabled?: boolean; title: string }) {
  return <button title={title} aria-label={title} onClick={onClick} disabled={disabled} className={`icon-btn ${active ? "icon-btn-on" : ""}`}>{children}</button>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return <span className="font-mono text-xs text-muted-foreground">{label} <span className="text-foreground">{value}</span></span>;
}
function Hud({ label, value, unit, tone, sub, small }: { label: string; value: string; unit?: string; tone?: Risk; sub?: string; small?: boolean }) {
  const c = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "safe" ? "text-safe" : "text-foreground";
  return (
    <div className={`hud-card ${tone === "danger" ? "hud-danger" : ""}`}>
      <div className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono ${small ? "text-base" : "text-2xl"} font-semibold ${c}`}>{value}<span className="ml-1 text-xs text-muted-foreground">{unit}</span></div>
      {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
function Slider({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-[11px] font-semibold tracking-widest text-muted-foreground"><span>{label.toUpperCase()}</span><span className="font-mono text-primary">{fmt(value)}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="range" />
    </label>
  );
}
