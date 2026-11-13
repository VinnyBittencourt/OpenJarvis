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
