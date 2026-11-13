// Short acknowledgements spoken when a reply takes long, so silence never feels like a hang.
// They are synthesized once, when hands-free mode is switched on, and kept in memory.
import { synthesizeSpeech } from './api';

const LINES = ['Um momento, senhor.', 'Deixe-me ver, senhor.', 'Só um instante, senhor.', 'Já lhe respondo, senhor.'];
const cache: Blob[] = [];
let started = false;
let lastIndex = -1;

export function prefetchFillers(): void {
  if (started) return;
  started = true;
  void (async () => {
    for (const line of LINES) {
      try {
        cache.push(await synthesizeSpeech(line));
      } catch {
        started = cache.length > 0; // allow another attempt later if nothing was cached
        return;
      }
    }
  })();
}

/** A cached acknowledgement, never the same one twice in a row. Null until the cache is ready. */
export function pickFiller(): Blob | null {
  if (cache.length === 0) return null;
  let index = Math.floor(Math.random() * cache.length);
  if (cache.length > 1 && index === lastIndex) index = (index + 1) % cache.length;
  lastIndex = index;
  return cache[index];
}
