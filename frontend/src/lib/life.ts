// Life of the partnership: mood of the core, tier, streak and milestones, served by
// /v1/jarvis/life. One poller for the whole app; the core reads it on every frame.
import { create } from 'zustand';

export type Mood = 'calm' | 'focused' | 'worried' | 'celebrating' | 'night' | 'gaming';

export interface LifeStatus {
  days_together: number;
  streak: number;
  turns: number;
  tier: number;
  tier_name: string;
  to_next_tier: number;
  achieved: Array<{ id: string; title: string; date: string }>;
  next: Array<{ id: string; title: string; progress: number; goal: number }>;
  mood: Mood;
  mood_label: string;
  language?: Lang;
}

export type Lang = 'pt' | 'en';

function savedLang(): Lang {
  try {
    return localStorage.getItem('jarvis-lang') === 'en' ? 'en' : 'pt';
  } catch {
    return 'pt';
  }
}

/** Language Jarvis is speaking now ("speak English" / "fale português"); the HUD follows it. */
export function useLang(): Lang {
  return useLifeStore((st) => st.status?.language ?? savedLang());
}

/** Pick the text of the active language. */
export function tr(lang: Lang, pt: string, en: string): string {
  return lang === 'en' ? en : pt;
}

interface LifeState {
  status: LifeStatus | null;
  mood: Mood;
  tier: number;
  celebrateUntil: number;
  celebrate: (ms?: number) => void;
  refresh: () => Promise<void>;
}

export const useLifeStore = create<LifeState>((set) => ({
  status: null,
  mood: 'calm',
  tier: 1,
  celebrateUntil: 0,
  celebrate: (ms = 9000) => set({ celebrateUntil: Date.now() + ms }),
  refresh: async () => {
    try {
      const res = await fetch('/v1/jarvis/life');
      if (!res.ok) return;
      const status = (await res.json()) as LifeStatus;
      set({ status, mood: status.mood, tier: status.tier });
      try {
        localStorage.setItem('jarvis-lang', status.language === 'en' ? 'en' : 'pt');
      } catch {
        /* storage blocked: the language still comes from the server */
      }
    } catch {
      /* server restarting: keep the last known state */
    }
  },
}));

let started = false;
export function startLife(): void {
  if (started) return;
  started = true;
  void useLifeStore.getState().refresh();
  window.setInterval(() => void useLifeStore.getState().refresh(), 5000);
}
