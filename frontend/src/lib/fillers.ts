// Short acknowledgements spoken when a reply takes long, so silence never feels like a hang.
// They are synthesized once per language (the server speaks with the voice of the active
// language), when hands-free mode is switched on or the language changes, and kept in memory.
import { synthesizeSpeech } from './api';

type Lang = 'pt' | 'en';
const LINES: Record<Lang, string[]> = {
  pt: ['Um momento, senhor.', 'Deixe-me ver, senhor.', 'Só um instante, senhor.', 'Já lhe respondo, senhor.'],
  en: ['One moment, sir.', 'Let me see, sir.', 'Just a second, sir.', 'Right away, sir.'],
};
const cache: Record<Lang, Blob[]> = { pt: [], en: [] };
const started: Record<Lang, boolean> = { pt: false, en: false };
let lastIndex = -1;

function activeLang(): Lang {
  try {
    return localStorage.getItem('jarvis-lang') === 'en' ? 'en' : 'pt';
  } catch {
    return 'pt';
  }
}

export function prefetchFillers(): void {
  const lang = activeLang();
  if (started[lang]) return;
  started[lang] = true;
  void (async () => {
    for (const line of LINES[lang]) {
      try {
        if (activeLang() !== lang) break; // language changed midway: those clips would sound wrong
        cache[lang].push(await synthesizeSpeech(line));
      } catch {
        started[lang] = cache[lang].length > 0; // allow another attempt later if nothing was cached
        return;
      }
    }
  })();
}

/** A cached acknowledgement, never the same one twice in a row. Null until the cache is ready. */
export function pickFiller(): Blob | null {
  const clips = cache[activeLang()];
  if (clips.length === 0) {
    prefetchFillers(); // first long reply after a language switch: ready for the next one
    return null;
  }
  let index = Math.floor(Math.random() * clips.length);
  if (clips.length > 1 && index === lastIndex) index = (index + 1) % clips.length;
  lastIndex = index;
  return clips[index];
}
