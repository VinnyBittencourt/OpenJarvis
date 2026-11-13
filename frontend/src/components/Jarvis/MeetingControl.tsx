import { useEffect, useState } from 'react';
import { tr, useLang } from '../../lib/life';
import { playSound } from '../../lib/sounds';

// Meeting notes: one button to start and stop recording the meeting audio (Teams through the
// PC sound plus the microphone), a timer while it records, and the result when it is ready:
// a lean summary and Vinny's to-do list. The same recorder answers to voice and to schedules.
interface Task { task: string; due: string }
interface Last { title?: string; finished?: string; summary?: string[]; my_tasks?: Task[]; decisions?: string[]; empty?: boolean }
interface Status { state: 'idle' | 'recording' | 'processing'; elapsed?: number; title?: string; last?: Last }

const SEEN_KEY = 'jarvis-meeting-seen';

function clock(s = 0): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function MeetingControl() {
  const lang = useLang();
  const [st, setSt] = useState<Status | null>(null);
  const [seen, setSeen] = useState(() => {
    try { return localStorage.getItem(SEEN_KEY) || ''; } catch { return ''; }
  });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let timer = 0;
    let prev: Status['state'] | null = null;
    const load = async () => {
      try {
        const res = await fetch('/v1/jarvis/meeting');
        if (res.ok) {
          const data = (await res.json()) as Status;
          if (prev === 'processing' && data.state === 'idle') { playSound('notice'); setOpen(true); }
          prev = data.state;
          setSt(data);
        }
      } catch {
        /* server restarting */
      }
      timer = window.setTimeout(load, prev && prev !== 'idle' ? 2000 : 10000);
    };
    void load();
    return () => window.clearTimeout(timer);
  }, []);

  if (!st) return null;
  const post = async (path: string) => {
    try {
      const res = await fetch(`/v1/jarvis/meeting/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      if (res.ok) setSt((await res.json()) as Status);
      playSound(path === 'start' ? 'wake' : 'off');
    } catch {
      /* server offline */
    }
  };
  const last = st.last;
  const fresh = !!last?.finished && last.finished !== seen && st.state === 'idle';
  const dismiss = () => {
    const key = last?.finished || '';
    try { localStorage.setItem(SEEN_KEY, key); } catch { /* storage blocked */ }
    setSeen(key);
    setOpen(false);
  };

  return (
    <>
      {st.state === 'recording' ? (
        <button className="meeting-btn rec" onClick={() => void post('stop')}>
          <span className="rec-dot" aria-hidden="true" />
          {tr(lang, 'Parar gravação', 'Stop recording')} · {clock(st.elapsed)}
        </button>
      ) : st.state === 'processing' ? (
        <span className="meeting-btn busy">{tr(lang, 'Resumindo a reunião…', 'Summarising the meeting…')}</span>
      ) : (
        <button className="meeting-btn" onClick={() => void post('start')}>
          <span className="rec-dot idle" aria-hidden="true" />
          {tr(lang, 'Gravar reunião', 'Record meeting')}
        </button>
      )}
      {fresh && !open && (
        <button className="meeting-btn result" onClick={() => setOpen(true)}>
          {tr(lang, 'Reunião resumida', 'Meeting summary')}: {last?.my_tasks?.length ?? 0} {tr(lang, 'tarefa(s) para o senhor', 'task(s) for you')}
        </button>
      )}
      {open && last && (
        <section className="meeting-card" aria-label={tr(lang, 'Resumo da reunião', 'Meeting summary')}>
          <header>
            <h4>{last.title}</h4>
            <button className="x" onClick={dismiss} aria-label={tr(lang, 'Fechar', 'Close')}>×</button>
          </header>
          {last.empty ? (
            <p>{tr(lang, 'Nenhuma fala foi captada nesta gravação.', 'No speech was captured in this recording.')}</p>
          ) : (
            <>
              <h5>{tr(lang, 'Para o senhor fazer', 'Your to-do')}</h5>
              {last.my_tasks && last.my_tasks.length > 0 ? (
                <ul className="todo">
                  {last.my_tasks.map((t) => (
                    <li key={t.task}>
                      <span aria-hidden="true">☐</span> {t.task}
                      {t.due ? <em> · {t.due}</em> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{tr(lang, 'Nada ficou com o senhor.', 'Nothing was assigned to you.')}</p>
              )}
              <h5>{tr(lang, 'Resumo', 'Summary')}</h5>
              <ul>{(last.summary ?? []).map((s) => <li key={s}>{s}</li>)}</ul>
              <p className="where">{tr(lang, 'Nota completa, com a transcrição, no cofre: Reuniões.', 'Full note with transcript in the vault: Reuniões.')}</p>
            </>
          )}
        </section>
      )}
    </>
  );
}
