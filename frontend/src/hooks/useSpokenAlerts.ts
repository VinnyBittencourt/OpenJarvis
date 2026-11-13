import { useEffect } from 'react';
import { useHudStore } from '../lib/hud';
import { useTtsStore } from '../lib/tts';

// Things Jarvis says on his own (alerts, reminders, small talk) arrive through
// /v1/jarvis/say. While hands-free mode is on, the interface speaks them itself, so the
// microphone knows it is Jarvis talking. When it is off, nothing is polled and the server
// plays them instead.
export function useSpokenAlerts() {
  const listening = useHudStore((s) => s.active && s.wake !== 'off');
  useEffect(() => {
    if (!listening) return;
    let cursor = -1;
    let stopped = false;
    const tick = async () => {
      // never talk over a reply: wait for the next round (the first round only reads the cursor)
      if (cursor >= 0 && useTtsStore.getState().state !== 'idle') return;
      try {
        const res = await fetch(`/v1/jarvis/say?after=${cursor}`);
        if (!res.ok || stopped) return;
        const data = (await res.json()) as { cursor: number; say: Array<{ id: number; text: string }> };
        cursor = data.cursor;
        const tts = useTtsStore.getState();
        for (const item of data.say) {
          if (item.text && tts.available === true) await tts.speak(`say-${item.id}`, item.text);
        }
      } catch {
        /* server restarting: try again on the next round */
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 2500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [listening]);
}
