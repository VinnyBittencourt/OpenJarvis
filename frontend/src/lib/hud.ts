// Jarvis HUD state: hands-free listening status shared by the orb, the scene and the mic hook.
import { create } from 'zustand';
import { useAppStore } from './store';
import { useTtsStore } from './tts';

export type WakeState = 'off' | 'standby' | 'awake' | 'capturing' | 'transcribing';
export type HudMode = 'off' | 'standby' | 'listening' | 'capturing' | 'thinking' | 'speaking';

interface HudState {
  active: boolean; // hands-free mode switched on by the user (needs one click per page load)
  wake: WakeState;
  level: number; // 0..1 live microphone level
  heard: string; // last accepted command
  error: string | null;
  setActive: (on: boolean) => void;
  setWake: (w: WakeState) => void;
  setLevel: (l: number) => void;
  setHeard: (t: string) => void;
  setError: (e: string | null) => void;
  greetNonce: number; // bumped when the user asks for a new chat, so the greeting is spoken again
  bumpGreet: () => void;
  unclearUntil: number; // the last utterance was not understood: the core turns red until then
  flagUnclear: (ms?: number) => void;
}

export const useHudStore = create<HudState>((set) => ({
  active: false, // browsers need a click each page load before the mic and audio may start
  wake: 'off',
  level: 0,
  heard: '',
  error: null,
  setActive: (on) => set({ active: on, wake: on ? 'standby' : 'off' }),
  setWake: (wake) => set({ wake }),
  setLevel: (level) => set({ level }),
  setHeard: (heard) => set({ heard }),
  setError: (error) => set({ error }),
  greetNonce: 0,
  bumpGreet: () => set((s) => ({ greetNonce: s.greetNonce + 1 })),
  unclearUntil: 0,
  flagUnclear: (ms = 1600) => set({ unclearUntil: Date.now() + ms }),
}));

/** What the orb should show right now. */
export function useHudMode(): HudMode {
  const ttsState = useTtsStore((s) => s.state);
  const streaming = useAppStore((s) => s.streamState.isStreaming);
  const wake = useHudStore((s) => s.wake);
  if (ttsState === 'speaking' || ttsState === 'loading') return 'speaking';
  if (streaming || wake === 'transcribing') return 'thinking';
  if (wake === 'capturing') return 'capturing';
  if (wake === 'awake') return 'listening';
  if (wake === 'standby') return 'standby';
  return 'off';
}
