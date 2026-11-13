import type { AdasEngine } from "./engine";
import type { Risk } from "./types";

/** Hex palette for canvas & WebGL (mirrors --primary/--safe/--warning/--danger in styles.css). */
export const PAL = {
  cyan: "#38d9f0",
  safe: "#3ddc97",
  warning: "#f5a524",
  danger: "#ff4d4f",
  dim: "#9fb3c8",
  ink: "#06101c",
};
export const riskColor = (r: Risk) => (r === "danger" ? PAL.danger : r === "warning" ? PAL.warning : r === "safe" ? PAL.safe : PAL.cyan);

/** Draw all overlays onto a canvas sized to the video's intrinsic resolution. */
export function drawOverlay(ctx: CanvasRenderingContext2D, eng: AdasEngine, dt: number, now: number) {
  const v = eng.video!;
  const W = v.videoWidth, H = v.videoHeight;
  const cs = Math.min(1, 960 / Math.max(W, H));
  const cw = Math.round(W * cs), ch = Math.round(H * cs);
  if (ctx.canvas.width !== cw || ctx.canvas.height !== ch) { ctx.canvas.width = cw; ctx.canvas.height = ch; }
  ctx.setTransform(cs, 0, 0, cs, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const s = eng.settings;
  const u = Math.max(1, W / 1280); // ui scale
  ctx.lineJoin = "round";

  // Dense masks (drawn stretched; tiny canvases → GPU upscale is cheap)
  ctx.imageSmoothingEnabled = true;
  if (s.modes.depth && eng.aux.depth.mask) { ctx.globalAlpha = 0.55; ctx.drawImage(eng.aux.depth.mask.canvas, 0, 0, W, H); ctx.globalAlpha = 1; }
  if (s.modes.seg && eng.aux.seg.mask) ctx.drawImage(eng.aux.seg.mask.canvas, 0, 0, W, H);

  // Lane
  const L = eng.lane;
  if (s.modes.lane && (L.left || L.right)) {
    const yb = L.yb * H, yt = L.yt * H;
    const leftCol = L.departure !== "na" && (L.offsetM ?? 0) < -0.45 ? riskColor(L.departure) : PAL.cyan;
    const rightCol = L.departure !== "na" && (L.offsetM ?? 0) > 0.45 ? riskColor(L.departure) : PAL.cyan;
    if (L.left && L.right) {
      ctx.fillStyle = L.departure === "danger" ? "rgba(255,77,79,0.16)" : L.departure === "warning" ? "rgba(245,165,36,0.14)" : "rgba(56,217,240,0.13)";
      ctx.beginPath();
      ctx.moveTo(L.left.xb * W, yb); ctx.lineTo(L.left.xt * W, yt); ctx.lineTo(L.right.xt * W, yt); ctx.lineTo(L.right.xb * W, yb);
      ctx.closePath(); ctx.fill();
    }
    ctx.lineWidth = 5 * u;
    for (const [ln, col] of [[L.left, leftCol], [L.right, rightCol]] as const) {
      if (!ln) continue;
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(ln.xb * W, yb); ctx.lineTo(ln.xt * W, yt); ctx.stroke();
    }
  }

  // Forward danger corridor (ego path)
  if (s.modes.collision) {
    const worst = eng.stats.worstRisk;
    const pulse = worst === "danger" ? 0.5 + 0.5 * Math.sin(now / 160) : 1;
    ctx.strokeStyle = riskColor(worst === "na" ? "safe" : worst);
    ctx.globalAlpha = 0.55 * pulse;
    ctx.setLineDash([10 * u, 10 * u]);
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.moveTo(W * 0.3, H); ctx.lineTo(W * 0.46, H * 0.62); ctx.lineTo(W * 0.54, H * 0.62); ctx.lineTo(W * 0.7, H);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Optical flow
  if (eng.flow && s.modes.flow) {
    ctx.strokeStyle = "rgba(160,220,255,0.75)";
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath();
    for (const f of eng.flow) {
      const x = f.x * W, y = f.y * H;
      ctx.moveTo(x, y); ctx.lineTo(x + f.dx * W * 3, y + f.dy * H * 3);
    }
    ctx.stroke();
  }

  if (!s.modes.detect) return;
  const k = 1 - Math.exp(-dt * 18);
  ctx.font = `600 ${13 * u}px "JetBrains Mono", monospace`;
  for (const t of eng.visibleTracks()) {
    if (t.kind === "light" || t.kind === "sign") continue;
    const ext = Math.min(0.12, now / 1000 - t.lastUpdate);
    const cx = t.cx + t.vx * ext, cy = t.cy + t.vy * ext;
    const tgt = { x1: cx - t.w / 2, y1: cy - t.h / 2, x2: cx + t.w / 2, y2: cy + t.h / 2 };
    if (!t.disp) t.disp = { ...tgt };
    else { t.disp.x1 += (tgt.x1 - t.disp.x1) * k; t.disp.y1 += (tgt.y1 - t.disp.y1) * k; t.disp.x2 += (tgt.x2 - t.disp.x2) * k; t.disp.y2 += (tgt.y2 - t.disp.y2) * k; }
    const b = t.disp;
    const col = s.modes.collision ? riskColor(t.risk === "na" ? "safe" : t.risk) : PAL.safe;
    const fade = now / 1000 - t.lastSeen > 0.25 ? 0.45 : 1;
    ctx.globalAlpha = fade;

    // trail
    if (s.modes.track && t.trail.length > 2) {
      ctx.strokeStyle = col; ctx.lineWidth = 2 * u; ctx.globalAlpha = 0.5 * fade;
      ctx.beginPath(); t.trail.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
      ctx.globalAlpha = fade;
    }
    // box with corner brackets
    const bw = b.x2 - b.x1, bh = b.y2 - b.y1, c = Math.min(bw, bh) * 0.22;
    ctx.strokeStyle = col; ctx.lineWidth = 1.2 * u;
    ctx.globalAlpha = 0.5 * fade; ctx.strokeRect(b.x1, b.y1, bw, bh); ctx.globalAlpha = fade;
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1 + c); ctx.lineTo(b.x1, b.y1); ctx.lineTo(b.x1 + c, b.y1);
    ctx.moveTo(b.x2 - c, b.y1); ctx.lineTo(b.x2, b.y1); ctx.lineTo(b.x2, b.y1 + c);
    ctx.moveTo(b.x2, b.y2 - c); ctx.lineTo(b.x2, b.y2); ctx.lineTo(b.x2 - c, b.y2);
    ctx.moveTo(b.x1 + c, b.y2); ctx.lineTo(b.x1, b.y2); ctx.lineTo(b.x1, b.y2 - c);
    ctx.stroke();
    if (t.risk === "danger" && s.modes.collision) {
      ctx.fillStyle = "rgba(255,77,79,0.12)"; ctx.fillRect(b.x1, b.y1, bw, bh);
      // predicted collision line to ego
      ctx.setLineDash([6 * u, 6 * u]); ctx.lineWidth = 2 * u;
      ctx.beginPath(); ctx.moveTo((b.x1 + b.x2) / 2, b.y2); ctx.lineTo(W / 2, H); ctx.stroke(); ctx.setLineDash([]);
    }
    // label
    const parts = [s.modes.track ? t.name : t.label, `${Math.round(t.score * 100)}%`];
    if (t.dist != null) parts.push(`${t.dist.toFixed(1)}m`);
    if (t.relSpeed != null && Math.abs(t.relSpeed) > 0.3) parts.push(`${t.relSpeed > 0 ? "−" : "+"}${Math.abs(t.relSpeed * 3.6).toFixed(0)}km/h`);
    if (s.modes.collision && t.ttc != null) parts.push(`TTC ${t.ttc.toFixed(1)}s`);
    const txt = parts.join("  ");
    const tw = ctx.measureText(txt).width + 12 * u, th = 20 * u;
    const ly = b.y1 - th - 3 * u < 0 ? b.y2 + 3 * u : b.y1 - th - 3 * u;
    ctx.fillStyle = "rgba(6,16,28,0.82)"; ctx.fillRect(b.x1, ly, tw, th);
    ctx.fillStyle = col; ctx.fillRect(b.x1, ly, 3 * u, th);
    ctx.fillStyle = "#e6f1fb"; ctx.fillText(txt, b.x1 + 8 * u, ly + 14.5 * u);
    ctx.globalAlpha = 1;
  }
}
