import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, PerformanceMonitor } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { AdasEngine } from "@/lib/adas/engine";
import { PAL } from "@/lib/adas/overlay";
import type { ObjKind } from "@/lib/adas/types";

const POOL = 16;
const LANE_W = 3.5;
const ROAD_LEN = 160;

function roadTexture() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2a2f36"; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const v = 30 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v + 3},${v + 8},0.5)`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  // 3 lanes over 512px width → lane = 512/3
  const lw = 512 / 3;
  g.fillStyle = "#e9edf2";
  g.fillRect(6, 0, 7, 512); g.fillRect(512 - 13, 0, 7, 512);
  for (const x of [lw, lw * 2]) for (let y = 0; y < 512; y += 128) g.fillRect(x - 3, y, 6, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, ROAD_LEN / 12);
  t.anisotropy = 4; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const shared = (() => {
  let cache: ReturnType<typeof make> | null = null;
  function make() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 16).rotateZ(Math.PI / 2);
    const ring = new THREE.RingGeometry(0.9, 1.15, 48).rotateX(-Math.PI / 2);
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const m = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35, ...o });
    return {
      box, cyl, ring, plane,
      paints: ["#c7ccd4", "#3a6ea5", "#b83a3a", "#2e2f33", "#d9d4c7", "#5b7d5a"].map((c) => m(c, { metalness: 0.6, roughness: 0.3 })),
      glass: m("#0e1824", { metalness: 0.9, roughness: 0.1 }),
      tire: m("#111214", { roughness: 0.9, metalness: 0 }),
      light: new THREE.MeshStandardMaterial({ color: "#ff3b3b", emissive: "#ff2a2a", emissiveIntensity: 1.5 }),
      ego: m("#e8edf3", { metalness: 0.7, roughness: 0.25 }),
      skin: m("#d6a77a", { metalness: 0 }),
      risk: {
        safe: new THREE.MeshBasicMaterial({ color: PAL.safe, transparent: true, opacity: 0.7, depthWrite: false }),
        warning: new THREE.MeshBasicMaterial({ color: PAL.warning, transparent: true, opacity: 0.8, depthWrite: false }),
        danger: new THREE.MeshBasicMaterial({ color: PAL.danger, transparent: true, opacity: 0.9, depthWrite: false }),
        na: new THREE.MeshBasicMaterial({ color: PAL.cyan, transparent: true, opacity: 0.5, depthWrite: false }),
      },
      zone: new THREE.MeshBasicMaterial({ color: PAL.safe, transparent: true, opacity: 0.18, depthWrite: false }),
      path: new THREE.MeshBasicMaterial({ color: PAL.warning, transparent: true, opacity: 0.45, depthWrite: false }),
    };
  }
  return () => (cache ??= make());
})();

function Part({ geo, mat, p, s }: { geo: THREE.BufferGeometry; mat: THREE.Material; p: [number, number, number]; s: [number, number, number] }) {
  return <mesh geometry={geo} material={mat} position={p} scale={s} castShadow receiveShadow />;
}

/** Simple but recognizable vehicle shapes; front faces −Z. */
function VehicleBody({ kind, paint }: { kind: "car" | "truck" | "moto" | "person"; paint: THREE.Material }) {
  const S = shared();
  if (kind === "car")
    return (
      <group>
        <Part geo={S.box} mat={paint} p={[0, 0.55, 0]} s={[1.8, 0.6, 4.3]} />
        <Part geo={S.box} mat={S.glass} p={[0, 1.05, 0.2]} s={[1.55, 0.5, 2.2]} />
        <Part geo={S.box} mat={S.light} p={[0, 0.65, 2.16]} s={[1.5, 0.12, 0.04]} />
        {[[-0.85, -1.35], [0.85, -1.35], [-0.85, 1.35], [0.85, 1.35]].map(([x, z], i) => (
          <Part key={i} geo={S.cyl} mat={S.tire} p={[x, 0.33, z]} s={[0.25, 0.66, 0.66]} />
        ))}
      </group>
    );
  if (kind === "truck")
    return (
      <group>
        <Part geo={S.box} mat={paint} p={[0, 1.2, -3.3]} s={[2.4, 2.0, 2.0]} />
        <Part geo={S.box} mat={S.glass} p={[0, 1.6, -4.31]} s={[2.1, 0.8, 0.04]} />
        <Part geo={S.box} mat={S.paints[4]} p={[0, 1.75, 1.1]} s={[2.5, 2.8, 6.6]} />
        <Part geo={S.box} mat={S.light} p={[0, 0.6, 4.41]} s={[2.2, 0.15, 0.04]} />
        {[-3.3, -0.2, 1.4, 3.2].map((z, i) => [-1.1, 1.1].map((x) => (
          <Part key={`${i}${x}`} geo={S.cyl} mat={S.tire} p={[x, 0.5, z]} s={[0.35, 1, 1]} />
        )))}
      </group>
    );
  if (kind === "moto")
    return (
      <group>
        <Part geo={S.box} mat={paint} p={[0, 0.7, 0]} s={[0.4, 0.4, 1.4]} />
        <Part geo={S.cyl} mat={S.tire} p={[0, 0.33, -0.75]} s={[0.15, 0.66, 0.66]} />
        <Part geo={S.cyl} mat={S.tire} p={[0, 0.33, 0.75]} s={[0.15, 0.66, 0.66]} />
        <Part geo={S.box} mat={S.paints[3]} p={[0, 1.25, 0.15]} s={[0.45, 0.75, 0.35]} />
        <Part geo={S.box} mat={S.skin} p={[0, 1.75, 0.1]} s={[0.28, 0.28, 0.28]} />
      </group>
    );
  return (
    <group>
      <Part geo={S.box} mat={S.paints[1]} p={[0, 0.45, 0]} s={[0.35, 0.9, 0.25]} />
      <Part geo={S.box} mat={paint} p={[0, 1.2, 0]} s={[0.5, 0.65, 0.3]} />
      <Part geo={S.box} mat={S.skin} p={[0, 1.68, 0]} s={[0.25, 0.28, 0.25]} />
    </group>
  );
}

/** Ego front bumper z (camera mount) and each body's half-length: the measured range is camera→rear of target. */
const EGO_FRONT = 2.15;
const halfLen = (k: ObjKind) => (k === "truck" || k === "bus" ? 0.6 : k === "car" ? 0.15 : 0);
const bodyFor = (k: ObjKind): "car" | "truck" | "moto" | "person" =>
  k === "truck" || k === "bus" ? "truck" : k === "moto" || k === "bike" ? "moto" : k === "person" ? "person" : "car";

/** GPU text label (canvas texture sprite) — redrawn only when text changes; no per-frame DOM work. */
const RISK_HEX: Record<string, string> = { safe: PAL.safe, warning: PAL.warning, danger: PAL.danger, na: PAL.cyan };
function makeLabel(w = 256, h = 48) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 10;
  const draw = (text: string, risk: string, plain = false) => {
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, w, h);
    g.font = `600 ${plain ? 26 : 22}px "JetBrains Mono", monospace`;
    const tw = Math.min(w - 8, g.measureText(text).width + (plain ? 0 : 20));
    const x0 = (w - tw) / 2;
    if (!plain) {
      g.fillStyle = "rgba(6,16,28,0.85)"; g.fillRect(x0, 6, tw, h - 12);
      g.fillStyle = RISK_HEX[risk] ?? PAL.safe; g.fillRect(x0, 6, 5, h - 12);
    }
    g.fillStyle = plain ? PAL.cyan : risk === "danger" ? PAL.danger : "#e6f1fb";
    g.textBaseline = "middle"; g.textAlign = "center";
    g.fillText(text, w / 2 + (plain ? 0 : 3), h / 2, w - 12);
    tex.needsUpdate = true;
  };
  return { sprite, draw, dispose: () => { tex.dispose(); mat.dispose(); } };
}
type Label = ReturnType<typeof makeLabel>;

function DistMark({ d }: { d: number }) {
  const l = useMemo(() => { const x = makeLabel(96, 40); x.draw(`${d}m`, "na", true); x.sprite.material.opacity = 0.75; x.sprite.scale.set(3.6, 1.5, 1); return x; }, [d]);
  useEffect(() => () => l.dispose(), [l]);
  return <primitive object={l.sprite} position={[LANE_W * 1.5 + 1.6, 0.5, 0]} />;
}

interface Slot {
  group: THREE.Group | null;
  bodies: Record<string, THREE.Group | null>;
  ring: THREE.Mesh | null;
  path: THREE.Mesh | null;
  label: Label | null;
  trackId: number | null;
  x: number; z: number; yaw: number; vis: number; lastText: string;
}

function Traffic({ engine }: { engine: AdasEngine }) {
  const S = shared();
  const slots = useRef<Slot[]>(Array.from({ length: POOL }, () => ({ group: null, bodies: {}, ring: null, path: null, label: null, trackId: null, x: 0, z: -40, yaw: 0, vis: 0, lastText: "" })));
  if (!slots.current[0].label && typeof document !== "undefined") for (const s of slots.current) s.label = makeLabel();
  useEffect(() => () => { for (const s of slots.current) { s.label?.dispose(); } }, []);
  const road = useRef<THREE.Group>(null);
  const zone = useRef<THREE.Mesh>(null);
  const roadOff = useRef(0);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const k = 1 - Math.exp(-dt * 6);
    const kz = 1 - Math.exp(-dt * 14); // distance follows fast so 3D never lags the measured range
    const nowS = performance.now() / 1000;
    const tracks = engine.settings.modes.detect ? engine.visibleTracks().filter((t) => t.dist != null && t.kind !== "light" && t.kind !== "sign") : [];
    const live = new Map(tracks.map((t) => [t.id, t]));
    const pool = slots.current;
    // release slots whose track disappeared
    for (const s of pool) if (s.trackId != null && !live.has(s.trackId)) s.trackId = -s.trackId; // fading
    for (const t of tracks) {
      if (pool.some((s) => s.trackId === t.id)) continue;
      const free = pool.find((s) => s.trackId == null || (s.trackId < 0 && s.vis < 0.02));
      if (free) { free.trackId = t.id; free.vis = 0; const z = -(t.dist! + EGO_FRONT + halfLen(t.kind)); free.x = t.lateral ?? 0; free.z = z; }
    }
    for (const s of pool) {
      if (!s.group) continue;
      const t = s.trackId != null && s.trackId > 0 ? live.get(s.trackId) : undefined;
      if (t) {
        const tx = THREE.MathUtils.clamp(t.lateral ?? 0, -14, 14), lead = t.relSpeed != null ? THREE.MathUtils.clamp(t.relSpeed * Math.min(0.3, Math.max(0, nowS - t.lastUpdate) + engine.stats.latency / 1000), -1.5, 1.5) : 0,
          d = Math.max(0.5, t.dist! - lead), tz = -(Math.min(d, 120) + EGO_FRONT + halfLen(t.kind));
        const dx = tx - s.x;
        s.x += dx * k; s.z += (tz - s.z) * kz;
        s.yaw += (THREE.MathUtils.clamp(-dx * 0.6, -0.35, 0.35) - s.yaw) * k;
        s.vis += (1 - s.vis) * k;
        const body = bodyFor(t.kind);
        for (const key in s.bodies) if (s.bodies[key]) s.bodies[key]!.visible = key === body;
        if (s.ring) s.ring.material = S.risk[engine.settings.modes.collision ? t.risk : "na"];
        if (s.path) {
          const show = engine.settings.modes.collision && t.relSpeed != null && t.relSpeed > 0.3;
          s.path.visible = show;
          if (show) { const len = Math.min(t.relSpeed! * 2, t.dist!); s.path.scale.set(1.2, 1, len); s.path.position.set(0, 0.03, len / 2); s.path.material = t.risk === "danger" ? S.risk.danger : S.path; }
        }
        if (s.label) {
          const txt = `${t.name} · ${t.dist!.toFixed(1)}m${t.ttc != null && engine.settings.modes.collision ? ` · ${t.ttc.toFixed(1)}s` : ""}`;
          const key = txt + t.risk;
          if (key !== s.lastText) { s.label.draw(txt, t.risk); s.lastText = key; }
          s.label.sprite.visible = true;
        }
      } else {
        s.vis += (0 - s.vis) * Math.min(1, dt * 6);
        if (s.label) s.label.sprite.visible = false;
        if (s.vis < 0.02) s.trackId = null;
      }
      s.group.visible = s.vis > 0.02;
      s.group.position.set(s.x, 0, s.z);
      s.group.rotation.y = s.yaw;
      s.group.scale.setScalar(0.6 + 0.4 * s.vis);
    }
    // road follows lane offset (ego is fixed at origin)
    const off = engine.lane.offsetM ?? 0;
    roadOff.current += (off - roadOff.current) * k;
    if (road.current) road.current.position.x = roadOff.current;
    // forward danger zone
    if (zone.current) {
      const w = engine.stats.worstRisk;
      const m = zone.current.material as THREE.MeshBasicMaterial;
      m.color.set(w === "danger" ? PAL.danger : w === "warning" ? PAL.warning : PAL.safe);
      m.opacity = w === "danger" ? 0.22 + 0.12 * Math.sin(state.clock.elapsedTime * 7) : 0.16;
      const near = engine.stats.nearest?.dist;
      const len = THREE.MathUtils.clamp(near ?? 25, 4, 40);
      zone.current.scale.set(LANE_W * 0.9, 1, len);
      zone.current.position.set(0, 0.02, -2.2 - len / 2);
    }
  });

  const tex = useMemo(() => roadTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);

  return (
    <>
      <group ref={road}>
        <mesh rotation-x={-Math.PI / 2} position={[0, 0, -ROAD_LEN / 2 + 20]} receiveShadow>
          <planeGeometry args={[LANE_W * 3 + 0.6, ROAD_LEN]} />
          <meshStandardMaterial map={tex} roughness={0.95} metalness={0} />
        </mesh>
        {[-1, 1].map((side) => (
          <group key={side}>
            <mesh rotation-x={-Math.PI / 2} position={[side * (LANE_W * 1.5 + 6), -0.02, -ROAD_LEN / 2 + 20]} receiveShadow>
              <planeGeometry args={[12, ROAD_LEN]} />
              <meshStandardMaterial color="#26352c" roughness={1} />
            </mesh>
            <mesh position={[side * (LANE_W * 1.5 + 0.6), 0.35, -ROAD_LEN / 2 + 20]} castShadow>
              <boxGeometry args={[0.12, 0.3, ROAD_LEN]} />
              <meshStandardMaterial color="#9aa6b2" metalness={0.8} roughness={0.3} />
            </mesh>
          </group>
        ))}
      </group>
      {/* distance marks */}
      {[10, 20, 30, 40, 50].map((d) => (
        <group key={d} position={[0, 0.01, -d - 2.2]}>
          <mesh geometry={S.plane} scale={[LANE_W * 3, 1, 0.06]}>
            <meshBasicMaterial color={PAL.cyan} transparent opacity={0.22} />
          </mesh>
          <DistMark d={d} />
        </group>
      ))}
      <mesh ref={zone} geometry={S.plane} material={S.zone} />
      {/* ego vehicle */}
      <group position={[0, 0, 0]}>
        <VehicleBody kind="car" paint={S.ego} />
        <mesh geometry={S.ring} material={S.risk.na} position={[0, 0.03, 0]} scale={[1.4, 1, 2.4]} />
      </group>
      {slots.current.map((s, i) => (
        <group key={i} ref={(g) => { s.group = g; }} visible={false}>
          {(["car", "truck", "moto", "person"] as const).map((b) => (
            <group key={b} ref={(g) => { s.bodies[b] = g; }} visible={b === "car"}>
              <VehicleBody kind={b} paint={S.paints[i % S.paints.length]} />
            </group>
          ))}
          <mesh ref={(m) => { s.ring = m; }} geometry={S.ring} material={S.risk.safe} position={[0, 0.03, 0]} scale={[1.4, 1, 2.4]} />
          <mesh ref={(m) => { s.path = m; }} geometry={S.plane} material={S.path} visible={false} />
          {s.label && <primitive object={s.label.sprite} position={[0, 2.8, 0]} scale={[4.2, 0.8, 1]} visible={false} />}
        </group>
      ))}
    </>
  );
}

function Ready() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const id = requestAnimationFrame(() => gl.domElement.parentElement?.parentElement?.setAttribute("data-scene-ready", "true"));
    return () => cancelAnimationFrame(id);
  }, [gl]);
  return null;
}

export default function Scene3D({ engine, perf, canvasRef, lite = false, onLost, paused = false }: { engine: AdasEngine; perf: boolean; canvasRef: React.MutableRefObject<HTMLCanvasElement | null>; lite?: boolean; onLost?: () => void; paused?: boolean }) {
  const low = perf || lite;
  const maxDpr = typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, low ? 1 : 1.25);
  const [dpr, setDpr] = useState(Math.min(low ? 1 : 1.25, maxDpr));
  const [envOn, setEnvOn] = useState(false);
  useEffect(() => setDpr(Math.min(low ? 1 : 1.25, maxDpr)), [low, maxDpr]);
  return (
    <Canvas
      shadows={false}
      frameloop={paused ? "never" : "always"}
      dpr={dpr}
      camera={{ position: [0, 13, 14], fov: 45, near: 0.5, far: 400 }}
      gl={{ antialias: !low, preserveDrawingBuffer: true, powerPreference: "default", failIfMajorPerformanceCaveat: false, stencil: false }}
      onCreated={({ gl }) => {
        canvasRef.current = gl.domElement;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        let lostTimer: ReturnType<typeof setTimeout> | undefined;
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          lostTimer = setTimeout(() => onLost?.(), 2500);
        });
        gl.domElement.addEventListener("webglcontextrestored", () => clearTimeout(lostTimer));
      }}
    >
      <PerformanceMonitor onDecline={() => { setDpr(Math.min(1, maxDpr)); setEnvOn(false); }} onIncline={() => setDpr(maxDpr)} flipflops={3} onFallback={() => { setDpr(Math.min(0.9, maxDpr)); setEnvOn(false); }} />
      <color attach="background" args={["#0b1220"]} />
      <fog attach="fog" args={["#0b1220", 45, 120]} />
      <hemisphereLight args={["#bcd7ff", "#1b2a22", envOn ? 0.5 : 1.1]} />
      {!envOn && <ambientLight intensity={0.6} />}
      <directionalLight position={[12, 22, 8]} intensity={2.2} castShadow={false} shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-25} shadow-camera-right={25} shadow-camera-top={25} shadow-camera-bottom={-60} />
      {envOn && (
        <Environment resolution={64}>
          <Lightformer intensity={2} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[20, 20, 1]} />
          <Lightformer intensity={1.2} color="#8fd8ff" position={[-8, 2, -4]} rotation-y={Math.PI / 2} scale={[30, 2, 1]} />
          <Lightformer intensity={0.8} color="#ffd2a1" position={[8, 2, 4]} rotation-y={-Math.PI / 2} scale={[30, 2, 1]} />
        </Environment>
      )}
      <Traffic engine={engine} />
      <OrbitControls target={[0, 0, -14]} enableDamping maxPolarAngle={Math.PI / 2.2} minDistance={8} maxDistance={70} enablePan={false} />
      <Ready />
    </Canvas>
  );
}
