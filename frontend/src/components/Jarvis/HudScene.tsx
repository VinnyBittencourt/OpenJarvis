import { useEffect, useState } from 'react';
import { fetchGuardian, type GuardianState } from '../../lib/jarvis';
import { useHudMode, useHudStore } from '../../lib/hud';
import { useAppStore } from '../../lib/store';
import { startLife, useLifeStore } from '../../lib/life';

// Cockpit frame of the chat: two glass panes floating in perspective at the sides (live
// telemetry on the left, voice link on the right) and a clock rail on top. Decorative only,
// it never captures clicks.
const MODE_PT: Record<string, string> = {
  off: 'Desligada', standby: 'Em espera', listening: 'Ouvindo', capturing: 'Recebendo',
  thinking: 'Processando', speaking: 'Falando',
};

function Gauge({ label, value }: { label: string; value?: number | null }) {
  const ok = typeof value === 'number';
  const pct = ok ? Math.max(0, Math.min(100, value as number)) : 0;
  return (
    <div className="pane-gauge" data-hot={pct > 85 ? '1' : undefined}>
      <span>{label}</span>
      <div className="pane-meter"><i style={{ width: `${pct}%` }} /></div>
      <b>{ok ? Math.round(value as number) : '··'}</b>
    </div>
  );
}

export function HudScene() {
  const mode = useHudMode();
  const heard = useHudStore((s) => s.heard);
  const level = useHudStore((s) => s.level);
  const talk = useAppStore((s) => s.messages.length > 0);
  const [now, setNow] = useState(new Date());
  const [g, setG] = useState<GuardianState | null>(null);
  const life = useLifeStore((st) => st.status);
  useEffect(() => startLife(), []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const load = () => fetchGuardian().then(setG).catch(() => setG(null));
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const m = g?.metrics ?? {};
  const date = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className={`hud-scene ${talk ? 'talk' : ''}`} aria-hidden="true">
      <div className="hud-rail">
        <span>{date}</span>
        <time>{now.toLocaleTimeString('pt-BR', { hour12: false })}</time>
        <span>Processamento local</span>
      </div>
      <section className="holo-pane left">
        <h4>Sistema</h4>
        <Gauge label="CPU" value={m.cpu} />
        <Gauge label="RAM" value={m.ram} />
        <Gauge label="GPU" value={m.gpu} />
        <Gauge label="VRAM" value={m.vram_total_pct as number | undefined} />
        <p>Guardião: <em>{g ? g.mode : 'sem resposta'}</em></p>
      </section>
      <section className="holo-pane right">
        <h4>Voz</h4>
        <p>Escuta: <em>{MODE_PT[mode] ?? mode}</em></p>
        <div className="pane-level"><i style={{ transform: `scaleX(${Math.min(1, level * 4)})` }} /></div>
        <p>Último pedido</p>
        <blockquote>{heard || 'Nenhum ainda'}</blockquote>
        {life && (
          <>
            <h4 className="pane-sub">Parceria</h4>
            <p>Dia <em>{life.days_together}</em>, sequência de <em>{life.streak}</em></p>
            <p>Nível: <em>{life.tier_name}</em></p>
            <p>Estado: <em>{life.mood_label}</em></p>
          </>
        )}
      </section>
    </div>
  );
}
