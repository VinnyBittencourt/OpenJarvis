// Meeting mode: while a meeting is being recorded Jarvis is completely silent and takes no voice
// commands. Only the button in the interface stops the recording (rule from Vinicius, 14/11).
// Kept in its own tiny store so the voice (tts.ts) and the microphone (useWakeWord) can both read
// it without importing each other.
import { create } from 'zustand';

interface MeetingModeState {
  recording: boolean;
  setRecording: (on: boolean) => void;
}

export const useMeetingMode = create<MeetingModeState>((set) => ({
  recording: false,
  setRecording: (recording) => set({ recording }),
}));

export function meetingRecording(): boolean {
  return useMeetingMode.getState().recording;
}
