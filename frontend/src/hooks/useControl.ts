import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useHudStore } from '../lib/hud';
import { meetingRecording } from '../lib/meetingMode';
import { useTtsStore } from '../lib/tts';

// Orders from outside the page: the tray menu and the global shortcut Ctrl+Alt+J (tools/tray.py)
// post them to /v1/jarvis/control and this hook carries them out.
//   listen: open the chat, switch hands-free on and listen right away, as if he said "Jarvis"
//   hush:   stop talking now
//   mute:   stop talking and switch the listening off
export function useControl(): void {
  const navigate = useNavigate();
  useEffect(() => {
    let cursor = -1;
    let timer = 0;
    const tick = async () => {
      try {
        const res = await fetch(`/v1/jarvis/control?after=${cursor}`);
        if (res.ok) {
          const data = (await res.json()) as { cursor: number; actions: string[] };
          cursor = data.cursor;
          for (const action of data.actions) {
            if (action === 'hush' || action === 'mute') useTtsStore.getState().stop();
            if (action === 'mute') useHudStore.getState().setActive(false);
            if (action === 'listen' && !meetingRecording()) {
              navigate('/');
              useHudStore.getState().setActive(true);
              // the microphone needs a moment to start when hands-free was off
              window.setTimeout(() => window.dispatchEvent(new Event('jarvis-wake')), 700);
            }
          }
        }
      } catch {
        /* server restarting */
      }
      timer = window.setTimeout(tick, 700);
    };
    void tick();
    return () => window.clearTimeout(timer);
  }, [navigate]);
}
