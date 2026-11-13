import { useEffect, useState } from 'react';

// Start-up moment shown once per browser session: the emblem draws itself, the subsystems
// report in, then the overlay dissolves into the interface. Click or any key skips it.
const LINES_PT = ['Núcleo local', 'Voz e escuta', 'Guardião do sistema', 'Sexta-feira, Ryan e Ember'];
const LINES_EN = ['Local core', 'Voice and hearing', 'System guardian', 'Friday, Ryan and Ember'];
function english(): boolean {
  try { return localStorage.getItem('jarvis-lang') === 'en'; } catch { return false; }
}
const TOTAL_MS = 3100;

export function BootSequence() {
  const [show, setShow] = useState(() => {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
      return sessionStorage.getItem('jarvis-boot') !== '1';
    } catch { return false; }
  });
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!show) return;
    try { sessionStorage.setItem('jarvis-boot', '1'); } catch { /* private mode */ }
    const out = setTimeout(() => setLeaving(true), TOTAL_MS - 600);
    const end = setTimeout(() => setShow(false), TOTAL_MS);
    const skip = () => { setLeaving(true); setTimeout(() => setShow(false), 450); };
    window.addEventListener('keydown', skip, { once: true });
    return () => { clearTimeout(out); clearTimeout(end); window.removeEventListener('keydown', skip); };
  }, [show]);

  if (!show) return null;
  return (
    <div className={`boot ${leaving ? 'leaving' : ''}`} onClick={() => setShow(false)} role="presentation">
      <svg className="boot-emblem" viewBox="0 0 200 200" aria-hidden="true">
        <circle className="b1" cx="100" cy="100" r="92" />
        <circle className="b2" cx="100" cy="100" r="74" />
        <circle className="b3" cx="100" cy="100" r="52" />
        <circle className="b4" cx="100" cy="100" r="9" />
      </svg>
      <h1 className="boot-title">J.A.R.V.I.S.</h1>
      <ul className="boot-lines">
        {(english() ? LINES_EN : LINES_PT).map((l, i) => (
          <li key={l} style={{ animationDelay: `${0.7 + i * 0.32}s` }}><span>{l}</span><b>{english() ? 'ready' : 'pronto'}</b></li>
        ))}
      </ul>
      <div className="boot-progress"><i /></div>
    </div>
  );
}
