import { useEffect, useRef } from "react";
import type { AdasEngine } from "@/lib/adas/engine";
import { PAL, riskColor } from "@/lib/adas/overlay";

/** Sparkline that redraws from engine history (no React state). */
export function Sparkline({ engine, series, color, max }: { engine: AdasEngine; series: "fps" | "lat"; color: string; max: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const id = setInterval(() => {
      const c = ref.current;
      if (!c || document.hidden || !c.offsetParent) return;
      const w = (c.width = c.clientWidth * devicePixelRatio), h = (c.height = c.clientHeight * devicePixelRatio);
      const g = c.getContext("2d")!;
      const data = series === "fps" ? engine.fpsHist : engine.latHist;
      const m = Math.max(max, ...data);
      g.clearRect(0, 0, w, h);
      g.strokeStyle = "rgba(159,179,200,0.12)";
      for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, (h * i) / 4); g.lineTo(w, (h * i) / 4); g.stroke(); }
      if (data.length < 2) return;
      const pts = data.map((v, i) => [(i / 59) * w, h - (v / m) * h * 0.9] as const);
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, color + "55"); grad.addColorStop(1, color + "00");
      g.beginPath(); g.moveTo(pts[0][0], h); pts.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(pts[pts.length - 1][0], h);
      g.fillStyle = grad; g.fill();
      g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.strokeStyle = color; g.lineWidth = 2 * devicePixelRatio; g.stroke();
    }, 500);
    return () => clearInterval(id);
  }, [engine, series, color, max]);
  return <canvas ref={ref} className="h-full w-full" />;
}

/** 2D bird's-eye radar (used when 3D SCENE MODE is off). */
export function Radar2D({ engine }: { engine: AdasEngine }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0, last = 0, vis = true;
    const io = new IntersectionObserver(([e]) => { vis = !!e?.isIntersecting; });
    if (ref.current) io.observe(ref.current);
    const loop = (now = 0) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 32 || document.hidden || !vis) return; // ~30 fps is plenty for a radar
      last = now;
      const c = ref.current;
      if (!c) return;
      const dpr = Math.min(devicePixelRatio, 1.5);
      const w = c.clientWidth * dpr, h = c.clientHeight * dpr;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const g = c.getContext("2d")!;
      g.clearRect(0, 0, w, h);
      const ppm = h / 60; // 60 m visible
      const ox = w / 2, oy = h - 4 * ppm;
      g.fillStyle = "#1c232c"; g.fillRect(ox - 5.25 * ppm, 0, 10.5 * ppm, h);
      g.strokeStyle = "#dfe6ee"; g.setLineDash([3 * ppm, 3 * ppm]); g.lineWidth = 2 * dpr;
      for (const x of [-1.75, 1.75]) { g.beginPath(); g.moveTo(ox + x * ppm, 0); g.lineTo(ox + x * ppm, h); g.stroke(); }
      g.setLineDash([]);
      g.font = `${11 * dpr}px "JetBrains Mono", monospace`;
      for (let d = 10; d <= 50; d += 10) {
        g.fillStyle = "rgba(56,217,240,0.5)"; g.fillRect(ox - 5.25 * ppm, oy - d * ppm, 10.5 * ppm, 1);
        g.fillText(`${d}m`, ox + 5.6 * ppm, oy - d * ppm + 4 * dpr);
      }
      g.fillStyle = PAL.cyan; g.fillRect(ox - 0.9 * ppm, oy - 2.2 * ppm, 1.8 * ppm, 4.4 * ppm);
      for (const t of engine.visibleTracks()) {
        if (t.dist == null || t.kind === "light" || t.kind === "sign") continue;
        const x = ox + (t.lateral ?? 0) * ppm, y = oy - (t.dist + 2.2) * ppm;
        g.fillStyle = riskColor(t.risk === "na" ? "safe" : t.risk);
        const big = t.kind === "truck" || t.kind === "bus";
        const sw = (t.kind === "moto" || t.kind === "bike" || t.kind === "person" ? 0.6 : big ? 2.5 : 1.8) * ppm;
        const sh = (big ? 9 : t.kind === "car" ? 4.3 : 1.6) * ppm;
        g.fillRect(x - sw / 2, y - sh / 2, sw, sh);
        g.fillStyle = "#e6f1fb"; g.fillText(`${t.name} ${t.dist.toFixed(0)}m`, x + sw / 2 + 4 * dpr, y);
      }
    };
    loop();
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [engine]);
  return <canvas ref={ref} className="h-full w-full" />;
}
