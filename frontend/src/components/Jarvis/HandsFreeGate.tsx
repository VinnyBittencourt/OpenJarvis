import { useEffect } from 'react';
import { useAppStore } from '../../lib/store';
import { useHudStore } from '../../lib/hud';
import { useTtsStore } from '../../lib/tts';
import { prefetchFillers } from '../../lib/fillers';
import { isAppMode } from '../../lib/appmode';
import { useSpokenAlerts } from '../../hooks/useSpokenAlerts';
import { tr, useLang } from '../../lib/life';

// One click per page load turns hands-free mode on: browsers only allow the microphone and
// audio playback after a user gesture. After that, saying "Jarvis" is enough.
export function HandsFreeGate() {
  const active = useHudStore((s) => s.active);
  const lang = useLang();
  const error = useHudStore((s) => s.error);
  const wake = useHudStore((s) => s.wake);
  const updateSettings = useAppStore((s) => s.updateSettings);
  useSpokenAlerts();

  const activate = () => {
    updateSettings({ voiceOutputEnabled: true, voiceAutoplay: true });
    void useTtsStore.getState().ensureHealth().then(() => {
      if (useTtsStore.getState().available === true) prefetchFillers();
    });
    useHudStore.getState().setError(null);
    useHudStore.getState().setActive(true);
  };
  const deactivate = () => useHudStore.getState().setActive(false);

  // Desktop app window: audio and microphone are allowed without a click, so hands-free
  // mode starts by itself when the app opens.
  useEffect(() => {
    if (isAppMode()) activate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `active` can be restored from a previous visit; wake stays 'off' until the click.
  const running = active && wake !== 'off';
  return (
    <div className="hud-gate">
      {running ? (
        <button className="hud-gate-btn off" onClick={deactivate}>{tr(lang, 'DESATIVAR ESCUTA', 'STOP LISTENING')}</button>
      ) : (
        <button className="hud-gate-btn" onClick={activate}>{tr(lang, 'ATIVAR JARVIS', 'ACTIVATE JARVIS')}</button>
      )}
      {!running && !error && !isAppMode() && <p>{tr(lang, 'Um clique por sessão. Depois é só dizer "Jarvis".', 'One click per session. Then just say "Jarvis".')}</p>}
      {error && <p className="err">{error}</p>}
    </div>
  );
}
