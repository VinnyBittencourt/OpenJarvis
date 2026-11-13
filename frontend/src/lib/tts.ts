import { create } from 'zustand';
import { synthesizeSpeech, fetchTtsHealth } from './api';
import { toSpeakableText } from './message-text';

export type TtsState = 'idle' | 'loading' | 'speaking';

/**
 * Voice output is a single shared resource: one utterance at a time, for the
 * whole app. The state lives in one store rather than per component, because a
 * per-component hook would give every message its own audio element -- two
 * replies would then talk over each other, and autoplay would make that the
 * normal case rather than the exception.
 */
interface TtsStore {
  state: TtsState;
  /** id of the message currently loading or speaking, if any. */
  speakingId: string | null;
  error: string | null;
  /** Message whose read-aloud attempt failed, if any. */
  errorId: string | null;
  /** null until the health probe has answered. */
  available: boolean | null;
  /** Last message spoken by autoplay, so a re-render never repeats it. */
  autoSpokenId: string | null;
  speak: (id: string, text: string) => Promise<void>;
  /** Add more text to the utterance of `id` (starts one if needed). Used to speak a reply while it is still being written. */
  enqueue: (id: string, text: string) => void;
  /** Play already synthesized audio as part of the utterance of `id` (cached acknowledgements). */
  enqueueBlob: (id: string, audio: Blob) => void;
  stop: () => void;
  ensureHealth: () => Promise<void>;
  markAutoSpoken: (id: string) => void;
}

// Playback handles are not render state -- keeping them out of the store avoids
// re-rendering every subscriber when an audio element is swapped.
let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let controller: AbortController | null = null;
let token = 0;
let healthProbe: Promise<void> | null = null;
// Sentence queue: a reply is synthesized and played one sentence at a time, so the voice
// starts after the first sentence is ready instead of after the whole reply.
interface Chunk { blob: Promise<Blob> }
let queue: Chunk[] = [];
let synthChain: Promise<unknown> = Promise.resolve();
let running = false;

/** Split text into sentence-sized pieces; very short pieces ride along with the next one. */
export function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?…:])\s+|\n+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let carry = '';
  for (const p of parts) {
    carry = carry ? `${carry} ${p}` : p;
    if (carry.length >= 28) { out.push(carry); carry = ''; }
  }
  if (carry) out.push(carry);
  return out;
}

/** Only a stream ending in the active conversation may trigger autoplay. */
export function shouldAutoplayFinishedReply(
  previousStreamingConversationId: string | null,
  activeId: string | null,
  streamIsActive: boolean,
  lastMessage: { id: string; role: string } | undefined,
  autoSpokenId: string | null,
): boolean {
  return previousStreamingConversationId !== null
    && previousStreamingConversationId === activeId
    && !streamIsActive
    && lastMessage !== undefined
    && lastMessage.role === 'assistant'
    && lastMessage.id !== autoSpokenId;
}

function teardown(): void {
  if (audio) {
    // Detach first: clearing src re-runs the media load algorithm, which fails
    // on an empty source and dispatches an `error` event. With the handler
    // still attached that surfaces as a bogus "Playback failed" after every
    // successful utterance.
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.src = '';
    audio = null;
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  if (controller) {
    controller.abort();
    controller = null;
  }
  queue = [];
  running = false;
  synthChain = Promise.resolve();
}

export const useTtsStore = create<TtsStore>((set, get) => ({
  state: 'idle',
  speakingId: null,
  error: null,
  errorId: null,
  available: null,
  autoSpokenId: null,

  ensureHealth: () => {
    if (healthProbe) return healthProbe;
    healthProbe = fetchTtsHealth()
      .then((health) => {
        set({ available: health.available });
        if (!health.available) healthProbe = null;
      })
      .catch(() => {
        set({ available: false });
        healthProbe = null;
      });
    return healthProbe;
  },

  markAutoSpoken: (id: string) => set({ autoSpokenId: id }),

  speak: async (id: string, text: string) => {
    if (!toSpeakableText(text)) return;
    // Bump before teardown so a synthesis still in flight is both aborted and
    // fenced off by the token, even if the abort loses the race.
    token += 1;
    teardown();
    controller = new AbortController();
    set({ state: 'loading', speakingId: id, error: null, errorId: null });
    get().enqueue(id, text);
  },

  enqueueBlob: (id: string, audio: Blob) => {
    if (get().speakingId !== id || !controller) {
      token += 1;
      teardown();
      controller = new AbortController();
      set({ state: 'loading', speakingId: id, error: null, errorId: null });
    }
    queue.push({ blob: Promise.resolve(audio) });
    get().enqueue(id, '');
  },

  enqueue: (id: string, text: string) => {
    if (get().speakingId !== id || !controller) {
      token += 1;
      teardown();
      controller = new AbortController();
      set({ state: 'loading', speakingId: id, error: null, errorId: null });
    }
    const mine = token;
    const signal = controller!.signal;
    for (const sentence of splitSentences(text)) {
      const speakable = toSpeakableText(sentence);
      if (!speakable) continue;
      // Synthesize one sentence at a time, in order, ahead of playback.
      const blob = synthChain.then(() => synthesizeSpeech(speakable, { signal }));
      synthChain = blob.catch(() => undefined);
      queue.push({ blob });
    }
    if (running) return;
    if (queue.length === 0) {
      set({ state: 'idle', speakingId: null });
      return;
    }
    running = true;

    const fail = (err: unknown) => {
      if (mine !== token) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      teardown();
      set({
        state: 'idle',
        speakingId: null,
        error: err instanceof Error ? err.message : 'Speech synthesis failed',
        errorId: id,
      });
    };
    const next = async (): Promise<void> => {
      if (mine !== token) return;
      const chunk = queue.shift();
      if (!chunk) {
        running = false;
        set({ state: 'idle', speakingId: null });
        return;
      }
      try {
        const data = await chunk.blob;
        if (mine !== token) return;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        const url = URL.createObjectURL(data);
        objectUrl = url;
        const el = new Audio(url);
        audio = el;
        el.onended = () => { void next(); };
        el.onerror = () => fail(new Error('Playback failed'));
        await el.play();
        if (mine === token) set({ state: 'speaking', speakingId: id });
      } catch (err) {
        fail(err);
      }
    };
    void next();
  },

  stop: () => {
    token += 1;
    teardown();
    set({ state: 'idle', speakingId: null, error: null, errorId: null });
  },
}));

/** Test seam: reset module-level playback handles between cases. */
export function __resetTtsForTests(): void {
  teardown();
  token = 0;
  healthProbe = null;
  useTtsStore.setState({
    state: 'idle',
    speakingId: null,
    error: null,
    errorId: null,
    available: null,
    autoSpokenId: null,
  });
}
