// Timing of a voice turn: end of speech -> text (transcription) -> first voice of the reply.
// Posted to /v1/jarvis/metrics and shown in System > Desempenho.
import { useTtsStore } from './tts';

let speechEndAt = 0;
let sttMs = -1;

export function markSpeechEnd(): void {
  speechEndAt = performance.now();
  sttMs = -1;
}

export function markTranscribed(): void {
  if (speechEndAt) sttMs = Math.round(performance.now() - speechEndAt);
}

export function cancelTurn(): void {
  speechEndAt = 0;
  sttMs = -1;
}

useTtsStore.subscribe((state, prev) => {
  if (!speechEndAt || sttMs < 0) return;
  if (state.state !== 'speaking' || prev.state === 'speaking') return;
  const total = Math.round(performance.now() - speechEndAt);
  const body = { stt_ms: sttMs, first_audio_ms: total, total_ms: total };
  cancelTurn();
  if (total > 60000) return; // not the reply of this turn
  void fetch('/v1/jarvis/metrics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
});
