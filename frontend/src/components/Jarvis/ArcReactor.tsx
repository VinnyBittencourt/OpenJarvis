import { useEffect, useRef } from 'react';
import { useHudMode, useHudStore, type HudMode } from '../../lib/hud';
import { useLifeStore, type Mood } from '../../lib/life';

// The Jarvis core, drawn on one canvas with a hand-rolled perspective projection (no 3D
// library). Technology and sorcery share the object: a particle sphere with an engraved
// spiral and a wireframe heart, gyroscope rings, a sigil disc of procedural glyphs lying
// around the equator, ribbons of light that orbit like brush strokes and motes rising
// through it. Speed, color and turbulence follow the mode and the live microphone level,
// and the whole object leans toward the pointer.
type RGB = [number, number, number];
const MODE: Record<HudMode, { rgb: RGB; spin: number; energy: number; label: string }> = {
  off: { rgb: [64, 140, 165], spin: 0.22, energy: 0.03, label: 'Escuta desligada' },
  standby: { rgb: [95, 230, 255], spin: 0.45, energy: 0.07, label: 'Em espera' },
  listening: { rgb: [140, 240, 255], spin: 0.85, energy: 0.18, label: 'Ouvindo' },
  capturing: { rgb: [128, 236, 255], spin: 1.15, energy: 0.28, label: 'Recebendo' },
  thinking: { rgb: [255, 179, 71], spin: 2.6, energy: 0.26, label: 'Processando' },
  speaking: { rgb: [150, 238, 255], spin: 1.05, energy: 0.38, label: 'Falando' },
};
const GOLD: RGB = [255, 214, 140];
// Moods tint and pace the core while it is idle; an active mode (thinking, speaking) wins.
const MOOD: Partial<Record<Mood, { rgb: RGB; spin: number; label: string }>> = {
  worried: { rgb: [255, 128, 96], spin: 1.35, label: 'Sistema sob carga' },
  focused: { rgb: [120, 160, 255], spin: 0.6, label: 'Modo foco' },
  night: { rgb: [72, 150, 196], spin: 0.7, label: 'Vigília noturna' },
  gaming: { rgb: [72, 150, 196], spin: 0.55, label: 'Discreto, em jogo' },
};

const POINTS = 820;
const RING_SEG = 132;
const CAM = 4.4;
const GLYPHS = 32;
const MOTES = 80;

interface P { x: number; y: number; z: number; sx: number; sy: number; sz: number; ph: number; delay: number }

function buildPoints(): P[] {
  const pts: P[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < POINTS; i++) {
    const y = 1 - (i / (POINTS - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i;
    pts.push({
      x: Math.cos(a) * r, y, z: Math.sin(a) * r,
      sx: (Math.random() - 0.5) * 9, sy: (Math.random() - 0.5) * 9, sz: (Math.random() - 0.5) * 9,
      ph: Math.random() * Math.PI * 2, delay: Math.random() * 0.45,
    });
  }
  return pts;
}

function buildSolid() {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const n = Math.hypot(1, t);
  const v = raw.map(([x, y, z]) => [x / n, y / n, z / n]);
  const edges: [number, number][] = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) {
    const d = Math.hypot(v[i][0] - v[j][0], v[i][1] - v[j][1], v[i][2] - v[j][2]);
    if (d < 1.1) edges.push([i, j]);
  }
  return { v, edges };
}

// Invented glyphs: each one is a few strokes between nodes of a 3x3 grid. A fixed seed keeps
// the inscription identical on every load.
function buildGlyphs() {
  let seed = 20261112;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  return Array.from({ length: GLYPHS }, () => {
    const strokes: [number, number, number, number][] = [];
    let cx = (rnd() * 3) | 0, cy = (rnd() * 3) | 0;
    const n = 2 + ((rnd() * 3) | 0);
    for (let s = 0; s < n; s++) {
      const nx = (rnd() * 3) | 0, ny = (rnd() * 3) | 0;
      if (nx === cx && ny === cy) continue;
      strokes.push([cx, cy, nx, ny]);
      cx = nx; cy = ny;
    }
    return strokes;
  });
}

const RINGS = [
  { r: 1.3, tx: 1.25, tz: 0.2, speed: 0.9, dash: 22, on: 15 },
  { r: 1.47, tx: 0.5, tz: 1.0, speed: -0.6, dash: 33, on: 27 },
  { r: 1.62, tx: -0.9, tz: -0.5, speed: 0.4, dash: 12, on: 7 },
];
const RIBBONS = [
  { r: 1.86, n: 2, amp: 0.5, tx: 0.3, tz: 0.5, speed: 0.55, ph: 0 },
  { r: 2.0, n: 3, amp: 0.34, tx: -0.5, tz: -0.2, speed: -0.42, ph: 2.1 },
  { r: 1.74, n: 2, amp: 0.62, tx: 1.1, tz: 0.9, speed: 0.36, ph: 4.0 },
  { r: 2.1, n: 4, amp: 0.2, tx: -1.2, tz: 0.4, speed: -0.3, ph: 1.2 },
];

const ease = (k: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, k)), 3);

export function ArcReactor({ size = 340 }: { size?: number }) {
  const mode = useHudMode();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const big = size > 300;

  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const pts = buildPoints();
    const solid = buildSolid();
    const glyphs = buildGlyphs();
    const motes = Array.from({ length: MOTES }, () => ({
      a: Math.random() * Math.PI * 2, r: 0.25 + Math.random() * 2, y: Math.random() * 4.6 - 2.2,
      v: 0.12 + Math.random() * 0.32, w: (Math.random() - 0.5) * 0.9,
    }));
    const c = size / 2;
    const S = size * 0.168;
    let raf = 0, last = 0, born = -1, angle = 0, energy = 0;
    let tiltX = 0.3, tiltY = 0, wantX = 0.3, wantY = 0;
    const col: RGB = [...MODE[modeRef.current].rgb];

    const onMove = (e: PointerEvent) => {
      wantY = (e.clientX / window.innerWidth - 0.5) * 0.9;
      wantX = 0.3 + (e.clientY / window.innerHeight - 0.5) * 0.5;
    };
    window.addEventListener('pointermove', onMove);

    // Rotate around Y by `a`, then around X by `b`, then project.
    let sa = 0, ca = 1, sb = 0, cb = 1;
    const rot = (a: number, b: number) => { sa = Math.sin(a); ca = Math.cos(a); sb = Math.sin(b); cb = Math.cos(b); };
    const out = { x: 0, y: 0, z: 0, k: 1 };
    const proj = (x: number, y: number, z: number) => {
      const x1 = x * ca + z * sa;
      const z1 = -x * sa + z * ca;
      const y2 = y * cb - z1 * sb;
      const z2 = y * sb + z1 * cb;
      const k = CAM / (CAM - z2);
      out.x = c + x1 * S * k; out.y = c + y2 * S * k; out.z = z2; out.k = k;
      return out;
    };
    const depthOf = (z: number, span: number) => Math.max(0, Math.min(1, (z + span) / (span * 2)));
    const seg = (x0: number, y0: number, x1: number, y1: number) => { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };

    const draw = (ms: number) => {
      const t = ms / 1000;
      if (born < 0) born = t;
      const dt = Math.min(0.05, last ? t - last : 0.016);
      last = t;
      const m = modeRef.current;
      const cfg = MODE[m];
      const mic = useHudStore.getState().level;

      const life = useLifeStore.getState();
      const celebrating = life.mood === 'celebrating' || life.celebrateUntil > Date.now();
      const idle = m === 'standby' || m === 'off' || m === 'listening';
      const moodCfg = idle ? MOOD[life.mood] : undefined;
      const wantRgb: RGB = celebrating ? GOLD : moodCfg ? moodCfg.rgb : cfg.rgb;
      const spin = celebrating ? Math.max(cfg.spin, 2.2) : cfg.spin * (moodCfg ? moodCfg.spin : 1);

      let target = cfg.energy;
      if (m === 'standby') target += 0.035 * Math.sin(t * 0.9); // slow breathing: the core is alive at rest
      if (idle && life.mood === 'worried') target += 0.07 * Math.abs(Math.sin(t * 11));
      if (celebrating) target += 0.3;
      if (m === 'listening' || m === 'capturing') target += mic * 0.9;
      if (m === 'speaking') target = 0.3 + 0.22 * Math.abs(Math.sin(t * 7.3)) + 0.18 * Math.abs(Math.sin(t * 17.1));
      if (m === 'thinking') target = 0.24 + 0.08 * Math.sin(t * 5);
      energy += (target - energy) * 0.16;
      for (let i = 0; i < 3; i++) col[i] += (wantRgb[i] - col[i]) * 0.07;
      const rgb = `${col[0] | 0},${col[1] | 0},${col[2] | 0}`;
      const gold = `${(col[0] * 0.35 + GOLD[0] * 0.65) | 0},${(col[1] * 0.35 + GOLD[1] * 0.65) | 0},${(col[2] * 0.35 + GOLD[2] * 0.65) | 0}`;
      angle += dt * spin * 0.55;
      tiltX += (wantX - tiltX) * 0.06;
      tiltY += (wantY - tiltY) * 0.06;
      const boot = reduced ? 9 : t - born;
      const ringIn = ease((boot - 0.5) / 1.3);
      const sigilIn = ease((boot - 1.0) / 1.6);

      g.clearRect(0, 0, size, size);
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round';

      // ----- Sigil disc around the equator (drawn first so the sphere glows over it)
      rot(tiltY * 0.6, 1.16 + (tiltX - 0.3) * 0.8);
      const sigA = t * 0.07 * (0.6 + cfg.spin * 0.5);
      const flat = (a: number, r: number) => proj(Math.cos(a) * r, 0, Math.sin(a) * r);
      const circle = (r: number, alpha: number, width: number, dashOn = 0, dashLen = 0, turn = 0) => {
        let px = 0, py = 0;
        const n = 150;
        for (let i = 0; i <= n; i++) {
          const q = flat((i / n) * Math.PI * 2 + turn, r);
          if (i > 0 && (!dashLen || i % dashLen < dashOn)) {
            g.strokeStyle = `rgba(${gold},${alpha * (0.25 + 0.75 * depthOf(q.z, 2.2)) * sigilIn})`;
            g.lineWidth = width * q.k;
            seg(px, py, q.x, q.y);
          }
          px = q.x; py = q.y;
        }
      };
      const rOut = 2.34 * (1.25 - 0.25 * sigilIn), rIn = 2.06 * (1.25 - 0.25 * sigilIn);
      circle(rOut, 0.75, 1.1);
      circle(rIn, 0.6, 0.8);
      circle(rIn - 0.1, 0.5, 0.8, 3, 9, -sigA * 3);
      circle(rOut + 0.12, 0.35, 0.7, 1, 5, sigA * 2);
      // glyph band
      const cellA = (Math.PI * 2) / GLYPHS * 0.56, cellR = (rOut - rIn) * 0.56;
      for (let gi = 0; gi < GLYPHS; gi++) {
        const a0 = (gi / GLYPHS) * Math.PI * 2 + sigA;
        const lit = 0.5 + 0.5 * Math.sin(t * 1.3 - gi * 0.55);
        for (const [x0, y0, x1, y1] of glyphs[gi]) {
          const p0 = flat(a0 + (x0 / 2 - 0.5) * cellA, (rIn + rOut) / 2 + (y0 / 2 - 0.5) * cellR);
          const ax = p0.x, ay = p0.y;
          const p1 = flat(a0 + (x1 / 2 - 0.5) * cellA, (rIn + rOut) / 2 + (y1 / 2 - 0.5) * cellR);
          g.strokeStyle = `rgba(${gold},${(0.3 + 0.65 * lit) * (0.3 + 0.7 * depthOf(p1.z, 2.4)) * sigilIn})`;
          g.lineWidth = 1.15 * p1.k;
          seg(ax, ay, p1.x, p1.y);
        }
      }
      // seven-pointed star inscribed in the disc, turning the other way
      g.lineWidth = 0.8;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 - sigA * 1.6;
        const b = ((i + 3) / 7) * Math.PI * 2 - sigA * 1.6;
        const p0 = flat(a, rIn - 0.1); const ax = p0.x, ay = p0.y, az = p0.z;
        const p1 = flat(b, rIn - 0.1);
        g.strokeStyle = `rgba(${gold},${0.2 * (0.3 + 0.7 * depthOf((az + p1.z) / 2, 2.2)) * sigilIn})`;
        seg(ax, ay, p1.x, p1.y);
        const node = flat(a, rIn - 0.1);
        g.fillStyle = `rgba(${gold},${0.8 * sigilIn})`;
        g.beginPath(); g.arc(node.x, node.y, 1.8 * node.k, 0, Math.PI * 2); g.fill();
      }
      // motes rising through the disc
      for (const o of motes) {
        o.y += o.v * dt * (0.6 + cfg.spin * 0.5 + energy * 2);
        o.a += o.w * dt;
        if (o.y > 2.4) { o.y = -2.2; o.r = 0.25 + Math.random() * 2; }
        const q = proj(Math.cos(o.a) * o.r, -o.y, Math.sin(o.a) * o.r);
        const fade = Math.max(0, 1 - Math.abs(o.y) / 2.4);
        const s = (big ? 1.7 : 1) * q.k;
        g.fillStyle = `rgba(${gold},${0.75 * fade * sigilIn})`;
        g.fillRect(q.x - s / 2, q.y - s / 2, s, s);
      }

      // ----- Core light
      // Kept dim on purpose: with additive drawing a strong center washes the sphere out to white.
      const glowR = S * (0.9 + energy * 0.35);
      const glow = g.createRadialGradient(c, c, 0, c, c, glowR);
      glow.addColorStop(0, `rgba(255,255,255,${0.16 + energy * 0.1})`);
      glow.addColorStop(0.2, `rgba(${rgb},${0.24 + energy * 0.14})`);
      glow.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = glow;
      g.fillRect(c - glowR, c - glowR, glowR * 2, glowR * 2);

      // ----- Wireframe heart, counter-rotating
      rot(-angle * 1.7 + tiltY, tiltX + t * 0.2);
      const sScale = (0.44 + energy * 0.22) * ease(boot / 1.4);
      const sv = solid.v.map(([x, y, z]) => { const p = proj(x * sScale, y * sScale, z * sScale); return [p.x, p.y, p.z]; });
      g.lineWidth = 1;
      for (const [i, j] of solid.edges) {
        g.strokeStyle = `rgba(${rgb},${0.28 + 0.4 * depthOf((sv[i][2] + sv[j][2]) / 2, sScale || 1)})`;
        seg(sv[i][0], sv[i][1], sv[j][0], sv[j][1]);
      }

      // ----- Particle sphere
      rot(angle + tiltY, tiltX);
      for (let i = 0; i < POINTS; i++) {
        const p = pts[i];
        let r = 1 + energy * 0.2 * Math.sin(p.ph + t * 3.1 + p.y * 4);
        if (m === 'speaking') r += energy * 0.14 * Math.sin(t * 9 - Math.acos(p.y) * 6);
        if (m === 'thinking') r += 0.05 * Math.sin(t * 6 + p.ph * 3);
        const k = ease((boot - p.delay) / 1.7);
        const q = proj(p.sx + (p.x * r - p.sx) * k, p.sy + (p.y * r - p.sy) * k, p.sz + (p.z * r - p.sz) * k);
        const depth = depthOf(q.z, 1.2);
        const s = (0.8 + 1.7 * depth) * (big ? 1 : 0.6);
        g.fillStyle = `rgba(${rgb},${(0.14 + 0.62 * depth) * (0.35 + 0.65 * k)})`;
        g.fillRect(q.x - s / 2, q.y - s / 2, s, s);
      }
      // engraved double spiral running pole to pole on the sphere
      for (let sp = 0; sp < 2; sp++) {
        let px = 0, py = 0;
        for (let i = 0; i <= 110; i++) {
          const u = i / 110;
          const lat = (u - 0.5) * Math.PI * 0.94;
          const lon = u * Math.PI * 5 + sp * Math.PI;
          const rr = 1.08 + energy * 0.08;
          const q = proj(Math.cos(lat) * Math.cos(lon) * rr, Math.sin(lat) * rr, Math.cos(lat) * Math.sin(lon) * rr);
          if (i > 0) {
            g.strokeStyle = `rgba(${gold},${(0.08 + 0.6 * depthOf(q.z, 1.2)) * Math.sin(u * Math.PI) * ringIn})`;
            g.lineWidth = 1.1;
            seg(px, py, q.x, q.y);
          }
          px = q.x; py = q.y;
        }
      }

      // ----- Gyroscope rings
      for (let ri = 0; ri < RINGS.length; ri++) {
        const R = RINGS[ri];
        const cx = Math.cos(R.tx), sx = Math.sin(R.tx), cz = Math.cos(R.tz), sz = Math.sin(R.tz);
        const spin = t * R.speed * (0.5 + cfg.spin * 0.6);
        const radius = R.r * (1.5 - 0.5 * ringIn) * (1 + energy * 0.05);
        const at = (a: number) => {
          const x0 = Math.cos(a) * radius, z0 = Math.sin(a) * radius;
          const y1 = -z0 * sx, z1 = z0 * cx;
          return proj(x0 * cz - y1 * sz, x0 * sz + y1 * cz, z1);
        };
        let px = 0, py = 0;
        for (let i = 0; i <= RING_SEG; i++) {
          const q = at((i / RING_SEG) * Math.PI * 2 + spin);
          if (i > 0 && i % R.dash < R.on) {
            const depth = depthOf(q.z, 1.7);
            g.strokeStyle = `rgba(${rgb},${(0.12 + 0.8 * depth) * ringIn})`;
            g.lineWidth = (ri === 1 ? 1.8 : 1.1) * (0.6 + depth);
            seg(px, py, q.x, q.y);
          }
          px = q.x; py = q.y;
        }
        const q = at(spin * -2.3 + ri * 2);
        g.fillStyle = `rgba(255,255,255,${0.9 * ringIn})`;
        g.beginPath(); g.arc(q.x, q.y, (big ? 3.4 : 2) * q.k * ringIn, 0, Math.PI * 2); g.fill();
      }

      // ----- Ribbons of light: wavy orbits drawn as tapering brush strokes
      rot(tiltY, tiltX);
      for (const R of RIBBONS) {
        const cx = Math.cos(R.tx), sx = Math.sin(R.tx), cz = Math.cos(R.tz), sz = Math.sin(R.tz);
        const head = t * R.speed * (0.7 + cfg.spin * 0.7) + R.ph;
        const N = 150;
        let px = 0, py = 0;
        for (let i = 0; i <= N; i++) {
          const u = (i / N) * Math.PI * 2;
          const rr = R.r * (1 + energy * 0.1) * (1.4 - 0.4 * sigilIn);
          const x0 = Math.cos(u) * rr, z0 = Math.sin(u) * rr;
          const y0 = Math.sin(R.n * u + R.ph + t * 0.35) * R.amp * (1 + energy * 1.4);
          const y1 = y0 * cx - z0 * sx, z1 = y0 * sx + z0 * cx;
          const q = proj(x0 * cz - y1 * sz, x0 * sz + y1 * cz, z1);
          if (i > 0) {
            // two comet heads per ribbon; brightness and width fall off behind each
            const d1 = Math.pow(Math.max(0, Math.cos((u - head) / 2)), 10);
            const d2 = Math.pow(Math.max(0, Math.cos((u - head - Math.PI) / 2)), 10);
            const w = Math.max(d1, d2);
            if (w > 0.01) {
              g.strokeStyle = `rgba(${w > 0.82 ? '255,255,255' : rgb},${w * (0.3 + 0.7 * depthOf(q.z, 2.2)) * sigilIn})`;
              g.lineWidth = (0.5 + 2.6 * w) * q.k * (big ? 1 : 0.6);
              seg(px, py, q.x, q.y);
            }
          }
          px = q.x; py = q.y;
        }
      }

      // ----- Flat instrument dial facing the viewer
      const dialR = size * 0.488;
      const ticks = 120;
      const turn = t * 0.06 * (m === 'thinking' ? 6 : 1);
      g.lineWidth = 1;
      for (let i = 0; i < ticks; i++) {
        const a = (i / ticks) * Math.PI * 2 + turn;
        const wave = 0.5 + 0.5 * Math.sin(t * 3 + i * 0.55) * Math.cos(t * 1.7 + i * 0.21);
        const len = (i % 10 === 0 ? 10 : 4) + energy * size * 0.035 * wave;
        g.strokeStyle = `rgba(${rgb},${(i % 10 === 0 ? 0.7 : 0.26) * ringIn})`;
        seg(c + Math.cos(a) * dialR, c + Math.sin(a) * dialR, c + Math.cos(a) * (dialR - len), c + Math.sin(a) * (dialR - len));
      }
      // ----- Layers earned with the partnership (tier 2 and up), drawn flat around the core
      const tau = Math.PI * 2;
      if (life.tier >= 2) {
        g.setLineDash([2, 9]);
        g.lineDashOffset = -t * 14;
        g.lineWidth = 1;
        g.strokeStyle = `rgba(${gold},0.34)`;
        g.beginPath();
        g.arc(c, c, S * 2.62, 0, tau);
        g.stroke();
        g.setLineDash([]);
      }
      if (life.tier >= 3) {
        g.fillStyle = `rgba(${gold},0.8)`;
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * tau + t * 0.12;
          const x = c + Math.cos(a) * S * 2.62, y = c + Math.sin(a) * S * 2.62;
          g.beginPath();
          g.moveTo(x, y - 4); g.lineTo(x + 3, y); g.lineTo(x, y + 4); g.lineTo(x - 3, y);
          g.closePath();
          g.fill();
        }
      }
      if (life.tier >= 4) {
        g.lineWidth = 1.5;
        for (let i = 0; i < 2; i++) {
          const a = (i ? -1 : 1) * t * 0.3 + i * Math.PI;
          g.strokeStyle = `rgba(${gold},0.5)`;
          g.beginPath();
          g.arc(c, c, S * 2.78, a, a + 1.3);
          g.stroke();
        }
      }

      // ----- Celebration: shockwaves and sparks leaving the core
      if (celebrating && !reduced) {
        for (let i = 0; i < 3; i++) {
          const k = (t * 0.45 + i / 3) % 1;
          g.lineWidth = 1.5;
          g.strokeStyle = `rgba(${gold},${(1 - k) * 0.55})`;
          g.beginPath();
          g.arc(c, c, S * (1 + k * 1.8), 0, tau);
          g.stroke();
        }
        for (let i = 0; i < 54; i++) {
          const k = (t * 0.6 + (i * 0.618034) % 1) % 1;
          const a = i * 2.399963 + t * 0.2;
          const r = S * (1.1 + k * 1.75);
          const s2 = 1 + (1 - k) * 2.2;
          g.fillStyle = `rgba(${i % 3 ? gold : '255,255,255'},${(1 - k) * 0.9})`;
          g.fillRect(c + Math.cos(a) * r - s2 / 2, c + Math.sin(a) * r - s2 / 2, s2, s2);
        }
      }

      g.globalCompositeOperation = 'source-over';
      if (!reduced || boot < 0.1) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', onMove); };
  }, [size, big]);

  const mood = useLifeStore((st) => st.mood);
  const celebrating = useLifeStore((st) => st.celebrateUntil) > Date.now() || mood === 'celebrating';
  const idleNow = mode === 'standby' || mode === 'off';
  const label = celebrating ? 'Marco alcançado' : idleNow && mode === 'standby' && MOOD[mood] ? MOOD[mood]!.label : MODE[mode].label;
  const rgb = (celebrating ? GOLD : idleNow && MOOD[mood] ? MOOD[mood]!.rgb : MODE[mode].rgb).join(',');
  return (
    <div className={`holo-core ${big ? 'big' : 'small'}`} data-mode={mode} data-mood={celebrating ? 'celebrating' : mood} style={{ ['--core' as string]: rgb, width: size, height: size }}>
      <canvas ref={canvasRef} style={{ width: size, height: size }} />
      <div className="holo-state" role="status">{label}</div>
    </div>
  );
}
