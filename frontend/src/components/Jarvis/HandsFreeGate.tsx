import { useAppStore } from '../../lib/store';
import { useHudStore } from '../../lib/hud';
import { useTtsStore } from '../../lib/tts';
import { prefetchFillers } from '../../lib/fillers';

// One click per page load turns hands-free mode on: browsers only allow the microphone and
// audio playback after a user gesture. After that, saying "Jarvis" is enough.
export function HandsFreeGate() {
  const active = useHudStore((s) => s.active);
  const error = useHudStore((s) => s.error);
  const wake = useHudStore((s) => s.wake);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const activate = () => {
    updateSettings({ voiceOutputEnabled: true, voiceAutoplay: true });
    void useTtsStore.getState().ensureHealth().then(() => {
      if (useTtsStore.getState().available === true) prefetchFillers();
    });
    useHudStore.getState().setError(null);
    useHudStore.getState().setActive(true);
  };
  const deactivate = () => useHudStore.getState().setActive(false);

  // `active` can be restored from a previous visit; wake stays 'off' until the click.
  const running = active && wake !== 'off';
  return (
    <div className="hud-gate">
      {running ? (
        <button className="hud-gate-btn off" onClick={deactivate}>DESATIVAR ESCUTA</button>
      ) : (
        <button className="hud-gate-btn" onClick={activate}>ATIVAR JARVIS</button>
      )}
      {!running && !error && <p>Um clique por sessão. Depois é só dizer &quot;Jarvis&quot;.</p>}
      {error && <p className="err">{error}</p>}
    </div>
  );
}
