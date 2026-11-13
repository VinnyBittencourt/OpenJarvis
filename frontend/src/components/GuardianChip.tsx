import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { fetchGuardian, type GuardianState } from '../lib/jarvis';

const MODES: Record<string, { label: string; color: string }> = {
  normal: { label: 'Normal', color: 'var(--color-success)' },
  game: { label: 'Modo jogo', color: 'var(--color-accent)' },
  stress: { label: 'Sob carga', color: 'var(--color-warning)' },
  off: { label: 'Guardião off', color: 'var(--color-text-tertiary)' },
};

export function GuardianChip() {
  const navigate = useNavigate();
  const [state, setState] = useState<GuardianState | null>(null);

  useEffect(() => {
    const load = () => fetchGuardian().then(setState).catch(() => setState(null));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  if (!state) return null; // API without the Jarvis panels (plain OpenJarvis)
  const mode = MODES[state.mode] ?? MODES.off;
  const detail =
    state.mode === 'game' && state.game
      ? `Jogo: ${state.game.name}`
      : state.mode === 'stress' && state.stress_reasons?.length
        ? state.stress_reasons.join(', ')
        : state.mode === 'off'
          ? 'O guardião não está rodando'
          : 'Sem jogo e sem carga alta';

  return (
    <button
      onClick={() => navigate('/system')}
      title={detail}
      className="fixed top-2 right-14 z-40 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium cursor-pointer"
      style={{
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-secondary)',
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: mode.color }} />
      {mode.label}
    </button>
  );
}
