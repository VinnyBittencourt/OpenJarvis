import { useEffect, useRef } from 'react';

// Ambient scene behind every page: dust drifting toward the viewer in 3D, a perspective
// floor grid and a soft horizon. It also publishes the pointer position as CSS variables
// (--px, --py in -1..1) so panels can lean with the cursor. Never captures clicks.
const DUST = 150;

export function HoloBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, raf = 0, last = 0;
    let px = 0, py = 0, tx = 0, ty = 0;
    const resize = () => {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const dust = Array.from({ length: DUST }, () => ({
      x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: Math.random(), v: 0.02 + Math.random() * 0.05,
    }));
    const onMove = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth - 0.5) * 2;
      ty = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('resize', resize);

    const draw = (ms: number) => {
      const t = ms / 1000;
      const dt = Math.min(0.05, last ? t - last : 0.016);
      last = t;
      px += (tx - px) * 0.05; py += (ty - py) * 0.05;
      const root = document.documentElement.style;
      root.setProperty('--px', px.toFixed(3));
      root.setProperty('--py', py.toFixed(3));
      g.clearRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      const cx = w / 2 - px * 30, cy = h * 0.42 - py * 20;
      for (const d of dust) {
        d.z -= d.v * dt;
        if (d.z <= 0.02) { d.z = 1; d.x = (Math.random() - 0.5) * 2; d.y = (Math.random() - 0.5) * 2; }
        const k = 0.6 / d.z;
        const x = cx + d.x * w * 0.5 * k, y = cy + d.y * h * 0.5 * k;
        if (x < -20 || x > w + 20 || y < -20 || y > h + 20) { d.z = 0; continue; }
        const near = 1 - d.z;
        const s = 0.6 + near * 2.4;
        g.fillStyle = `rgba(120,225,255,${0.05 + near * 0.3})`;
        g.fillRect(x, y, s, s);
      }
      g.globalCompositeOperation = 'source-over';
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className="holo-backdrop" aria-hidden="true">
      <div className="holo-horizon" />
      <div className="holo-floor"><i /></div>
      <canvas ref={ref} />
      <div className="holo-vignette" />
    </div>
  );
}
