import { useEffect, useState } from 'react';
import { playSound } from '../../lib/sounds';
import { startLife, tr, useLang, useLifeStore, type Lang } from '../../lib/life';

// Friday's notice: new WhatsApp, Outlook or Teams notifications still in the Windows notification
// center show up as a small chip, with a light chime, instead of being spoken. "Ouvir" asks
// Friday to read them in the chat; the cross hides the chip until something newer arrives.
interface Inbox { total: number; latest_id: number; text: string }

const SEEN_KEY = 'jarvis-inbox-seen';

function seenId(): number {
  try { return Number(localStorage.getItem(SEEN_KEY) || 0); } catch { return 0; }
}

export function askJarvis(text: string): void {
  window.dispatchEvent(new CustomEvent('jarvis-ask', { detail: text }));
}

export function FridayNotice() {
  const lang = useLang();
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [seen, setSeen] = useState(seenId);

  useEffect(() => {
    let last: number | null = null; // null until the first answer: no chime for what was already there
    const load = async () => {
      try {
        const res = await fetch('/v1/jarvis/inbox');
        if (!res.ok) return;
        const data = (await res.json()) as Inbox;
        const latest = data.latest_id || 0;
        if (last !== null && latest > last && latest > seenId()) playSound('notice');
        last = Math.max(last ?? 0, latest);
        setInbox(data);
      } catch {
        /* server restarting */
      }
    };
    void load();
    const id = window.setInterval(load, 10000);
    return () => window.clearInterval(id);
  }, []);

  if (!inbox || inbox.total === 0 || inbox.latest_id <= seen) return null;
  const dismiss = () => {
    try { localStorage.setItem(SEEN_KEY, String(inbox.latest_id)); } catch { /* storage blocked */ }
    setSeen(inbox.latest_id);
  };
  return (
    <div className="friday-notice" role="status">
      <span className="friday-dot" aria-hidden="true" />
      <span className="friday-text">{inbox.text}</span>
      <button onClick={() => { askJarvis(lang === 'en' ? 'do I have new messages?' : 'tenho mensagem nova?'); dismiss(); }}>
        {tr(lang, 'Ouvir', 'Read')}
      </button>
      <button className="x" onClick={dismiss} aria-label={tr(lang, 'Dispensar', 'Dismiss')}>×</button>
    </div>
  );
}

// PT / EN switch. The choice goes to the server (language.txt), so it is kept for the next session.
export function LangToggle() {
  const lang = useLang();
  useEffect(() => startLife(), []);
  useEffect(() => {
    document.documentElement.dataset.lang = lang; // jarvis-hud.css tints the HUD mint in English
  }, [lang]);
  const pick = async (next: Lang) => {
    if (next === lang) return;
    try {
      await fetch('/v1/jarvis/language', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: next }),
      });
      try { localStorage.setItem('jarvis-lang', next); } catch { /* storage blocked */ }
      await useLifeStore.getState().refresh();
    } catch {
      /* server offline: nothing changes */
    }
  };
  return (
    <div className="lang-toggle" role="group" aria-label={tr(lang, 'Idioma do Jarvis', 'Jarvis language')}>
      <button className={lang === 'pt' ? 'on' : ''} onClick={() => void pick('pt')} aria-pressed={lang === 'pt'}>PT</button>
      <button className={lang === 'en' ? 'on' : ''} onClick={() => void pick('en')} aria-pressed={lang === 'en'}>EN</button>
    </div>
  );
}
