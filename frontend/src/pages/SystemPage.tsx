import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import {
  fetchGuardian, fetchPrompts, fetchClaudeUsage, fetchNotices, fetchSecretary, saveCity,
  fetchMemory, addMemory, deleteMemory, fetchVoiceMetrics, fetchVoiceEngine, setVoiceEngine,
  type GuardianState, type SavedPrompt, type ClaudeUsage, type Notice, type SecretaryPanel,
  type MemoryFact, type VoiceMetrics, type VoiceEngine,
} from '../lib/jarvis';
import { useLifeStore, startLife } from '../lib/life';
import { soundsEnabled, setSoundsEnabled, playSound } from '../lib/sounds';

type Tab = 'guardian' | 'life' | 'memory' | 'speed' | 'secretary' | 'usage' | 'prompts' | 'notices';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'guardian', label: 'Guardião' },
  { id: 'life', label: 'Parceria' },
  { id: 'memory', label: 'Memória' },
  { id: 'speed', label: 'Voz e desempenho' },
  { id: 'secretary', label: 'Sexta-feira' },
  { id: 'usage', label: 'Uso do Claude' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'notices', label: 'Avisos' },
];

const card = { background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' } as const;
const muted = { color: 'var(--color-text-tertiary)' } as const;

function usePoll<T>(load: () => Promise<T>, ms: number): { data: T | null; failed: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const run = () =>
      load()
        .then((d) => alive && (setData(d), setFailed(false)))
        .catch(() => alive && setFailed(true));
    run();
    const t = setInterval(run, ms);
    return () => { alive = false; clearInterval(t); };
  }, [load, ms]);
  return { data, failed };
}

function Meter({ label, value, extra }: { label: string; value: number | null | undefined; extra?: string }) {
  const pct = typeof value === 'number' ? Math.max(0, Math.min(100, value)) : null;
  const color = pct === null ? 'var(--color-text-tertiary)' : pct >= 90 ? 'var(--color-error)' : pct >= 70 ? 'var(--color-warning)' : 'var(--color-accent)';
  return (
    <div className="rounded-xl p-3" style={card}>
      <div className="flex justify-between text-xs mb-2" style={{ color: 'var(--color-text-secondary)' }}>
        <span>{label}</span>
        <span>{pct === null ? 'sem dado' : `${Math.round(pct)}%`}</span>
      </div>
      <div className="h-1.5 rounded-full" style={{ background: 'var(--color-border)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct ?? 0}%`, background: color }} />
      </div>
      {extra && <div className="text-[11px] mt-2" style={muted}>{extra}</div>}
    </div>
  );
}

function GuardianTab() {
  const { data: g, failed } = usePoll<GuardianState>(fetchGuardian, 3000);
  if (failed) return <p className="text-sm" style={muted}>Não consegui falar com a API do Jarvis. Inicie pelo JARVIS.bat.</p>;
  if (!g) return <p className="text-sm" style={muted}>Carregando...</p>;
  const m = g.metrics || {};
  const mb = (v?: number | null) => (typeof v === 'number' ? `${(v / 1024).toFixed(1)} GB` : '');
  return (
    <div className="space-y-4">
      <div className="rounded-xl p-4 text-sm" style={card}>
        <div style={{ color: 'var(--color-text)' }}>
          Estado: <b>{g.mode}</b>{g.running ? '' : ' (guardião parado)'}
          {g.voice_muted ? ' · voz silenciada' : ''}
        </div>
        {g.game && <div className="mt-1" style={muted}>Jogo: {g.game.name} desde {g.game.since}</div>}
        {!!g.stress_reasons?.length && <div className="mt-1" style={muted}>Motivo: {g.stress_reasons.join(', ')}</div>}
        {g.updated && <div className="mt-1 text-xs" style={muted}>Atualizado {g.updated}</div>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Meter label="CPU" value={m.cpu} />
        <Meter label="RAM" value={m.ram} />
        <Meter label="GPU" value={m.gpu} />
        <Meter label="VRAM fora do Ollama" value={m.vram} extra={`Total ${mb(m.vram_used_mb)} de ${mb(m.vram_total_mb)}; Ollama ${mb(m.vram_ollama_mb)}`} />
      </div>
      <div>
        <h3 className="text-xs font-medium mb-2" style={muted}>Eventos recentes</h3>
        {g.events.length === 0 ? <p className="text-sm" style={muted}>Nenhum evento.</p> : (
          <ul className="space-y-1 text-xs font-mono" style={{ color: 'var(--color-text-secondary)' }}>
            {g.events.map((e, i) => <li key={i}>{String(e.ts ?? '')} {String(e.type ?? '')}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

function SecretaryTab() {
  const { data, failed } = usePoll<SecretaryPanel>(fetchSecretary, 60000);
  const [panel, setPanel] = useState<SecretaryPanel | null>(null);
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);
  const shown = panel ?? data;
  useEffect(() => { if (data && !city) setCity(data.city); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (failed && !shown) return <p className="text-sm" style={muted}>Sem dados.</p>;
  if (!shown) return <p className="text-sm" style={muted}>Carregando...</p>;
  const block = (title: string, text: string) => (
    <div className="rounded-xl p-4" style={card}>
      <h3 className="text-xs font-medium mb-1" style={muted}>{title}</h3>
      <p className="text-sm" style={{ color: 'var(--color-text)' }}>{text}</p>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Cidade, por exemplo Volta Redonda"
          className="flex-1 px-3 py-1.5 rounded-lg text-sm" style={{ ...card, color: 'var(--color-text)' }} />
        <button disabled={saving} className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
          style={{ ...card, color: 'var(--color-accent)' }}
          onClick={() => { setSaving(true); saveCity(city).then(setPanel).catch(() => {}).finally(() => setSaving(false)); }}>
          Salvar cidade
        </button>
      </div>
      {block('Clima', shown.weather)}
      {block('Manchetes', shown.news)}
      {block('Reuniões nos avisos (últimas 24 horas)', shown.agenda)}
      <p className="text-xs" style={muted}>Atualizado às {shown.updated}. Dados lidos pelo PC, nada passa pelo Claude.</p>
    </div>
  );
}

function UsageTab() {
  const { data: u, failed } = usePoll<ClaudeUsage>(fetchClaudeUsage, 10000);
  if (failed) return <p className="text-sm" style={muted}>Sem dados.</p>;
  if (!u) return <p className="text-sm" style={muted}>Carregando...</p>;
  const stat = (label: string, v: { calls: number; cost_usd: number }) => (
    <div className="rounded-xl p-4" style={card}>
      <div className="text-xs" style={muted}>{label}</div>
      <div className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>{v.calls} chamadas</div>
      <div className="text-xs" style={muted}>≈ US$ {v.cost_usd.toFixed(2)} a preço de tabela</div>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">{stat('Hoje', u.today)}{stat('Este mês', u.month)}</div>
      <div className="rounded-xl p-4 text-sm" style={card}>
        {Object.keys(u.by_agent).length === 0 ? <span style={muted}>Nenhuma chamada ainda.</span> :
          Object.entries(u.by_agent).map(([a, v]) => (
            <div key={a} className="flex justify-between py-0.5" style={{ color: 'var(--color-text-secondary)' }}>
              <span>{a}</span><span>{v.calls} chamadas</span>
            </div>
          ))}
      </div>
      <p className="text-xs" style={muted}>{u.note} Sem cobrança extra enquanto o uso extra estiver desligado no claude.ai.</p>
    </div>
  );
}

function PromptsTab() {
  const { data, failed } = usePoll<SavedPrompt[]>(fetchPrompts, 10000);
  const [copied, setCopied] = useState<number | null>(null);
  if (failed) return <p className="text-sm" style={muted}>Sem dados.</p>;
  if (!data) return <p className="text-sm" style={muted}>Carregando...</p>;
  if (data.length === 0) return <p className="text-sm" style={muted}>Nenhum prompt salvo ainda. Peça ao Ryan ou à Ember.</p>;
  return (
    <div className="space-y-3">
      {data.map((p) => (
        <div key={p.id} className="rounded-xl p-4" style={card}>
          <div className="flex items-center justify-between text-xs mb-2" style={muted}>
            <span>#{p.id} · {p.agent}{p.project ? ` · ${p.project}` : ''} · {p.ts}</span>
            <button
              className="flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
              onClick={() => navigator.clipboard.writeText(p.text).then(() => { setCopied(p.id); setTimeout(() => setCopied(null), 1500); })}
            >
              <Copy size={11} /> {copied === p.id ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <pre className="text-xs whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{p.text}</pre>
        </div>
      ))}
    </div>
  );
}

function NoticesTab() {
  const { data, failed } = usePoll<Notice[]>(fetchNotices, 8000);
  const [app, setApp] = useState('all');
  if (failed) return <p className="text-sm" style={muted}>Sem dados.</p>;
  if (!data) return <p className="text-sm" style={muted}>Carregando...</p>;
  const apps = ['all', ...Array.from(new Set(data.map((n) => n.app)))];
  const rows = data.filter((n) => app === 'all' || n.app === app);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {apps.map((a) => (
          <button key={a} onClick={() => setApp(a)} className="px-2.5 py-1 rounded-full text-xs cursor-pointer"
            style={{ ...card, color: a === app ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}>
            {a === 'all' ? 'Todos' : a}
          </button>
        ))}
      </div>
      {rows.length === 0 ? <p className="text-sm" style={muted}>Nenhum aviso.</p> : rows.map((n, i) => (
        <div key={i} className="rounded-xl p-3 text-sm" style={card}>
          <div className="text-xs" style={muted}>{n.app} · {n.kind === 'call' ? 'ligação' : 'mensagem'} · {n.seen_at}</div>
          <div style={{ color: 'var(--color-text)' }}>{n.from}</div>
          {n.text && <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{n.text}</div>}
        </div>
      ))}
    </div>
  );
}

function LifeTab() {
  const life = useLifeStore((st) => st.status);
  useEffect(() => startLife(), []);
  if (!life) return <p className="text-sm" style={muted}>Sem resposta do servidor do Jarvis.</p>;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ['Dias de parceria', String(life.days_together)],
          ['Dias seguidos', String(life.streak)],
          ['Conversas', String(life.turns)],
          ['Nível', life.tier_name],
        ].map(([k, v]) => (
          <div key={k} className="px-3 py-2 rounded-lg" style={card}>
            <p className="text-xs" style={muted}>{k}</p>
            <p className="text-lg" style={{ color: 'var(--color-text)' }}>{v}</p>
          </div>
        ))}
      </div>
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {life.to_next_tier > 0
          ? `Faltam ${life.to_next_tier} marcos para o próximo nível. Cada nível acrescenta uma camada ao núcleo.`
          : 'Nível máximo alcançado. O núcleo está completo.'}
      </p>
      <div>
        <h3 className="text-xs font-medium mb-2" style={muted}>Marcos alcançados</h3>
        {life.achieved.length === 0 && <p className="text-sm" style={muted}>Nenhum ainda. O primeiro vem na próxima conversa.</p>}
        <div className="space-y-2">
          {life.achieved.map((m) => (
            <div key={m.id} className="flex justify-between px-3 py-2 rounded-lg text-sm" style={{ ...card, color: 'var(--color-text)' }}>
              <span>{m.title}</span><span style={muted}>{m.date.split('-').reverse().join('/')}</span>
            </div>
          ))}
        </div>
      </div>
      {life.next.length > 0 && (
        <div>
          <h3 className="text-xs font-medium mb-2" style={muted}>Próximos</h3>
          <div className="space-y-2">
            {life.next.map((m) => (
              <div key={m.id} className="px-3 py-2 rounded-lg text-sm" style={{ ...card, color: 'var(--color-text-secondary)' }}>
                <div className="flex justify-between"><span>{m.title}</span><span>{m.progress} de {m.goal}</span></div>
                <div className="h-1 mt-2 rounded" style={{ background: 'var(--color-border)' }}>
                  <div className="h-1 rounded" style={{ width: `${Math.round((m.progress / m.goal) * 100)}%`, background: 'var(--color-accent)' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MemoryTab() {
  const [facts, setFacts] = useState<MemoryFact[] | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const reload = () => fetchMemory().then(setFacts).catch(() => setError('Não consegui ler a memória. O servidor do Jarvis está ligado?'));
  useEffect(() => { void reload(); }, []);
  const save = () => {
    if (!note.trim()) return;
    addMemory(note).then(() => { setNote(''); setError(''); return reload(); }).catch(() => setError('Não consegui guardar a anotação.'));
  };
  const remove = (id: number) => deleteMemory(id).then(reload).catch(() => setError('Não consegui apagar a anotação.'));
  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        O que o Jarvis guarda sobre o senhor. Por voz: &quot;lembre que...&quot;, &quot;o que você sabe sobre...&quot; e &quot;esqueça...&quot;.
      </p>
      <div className="flex gap-2">
        <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="Nova anotação" aria-label="Nova anotação"
          className="flex-1 px-3 py-2 rounded-lg text-sm" style={{ ...card, color: 'var(--color-text)' }} />
        <button onClick={save} className="px-3 py-2 rounded-lg text-xs font-medium cursor-pointer" style={{ ...card, color: 'var(--color-accent)' }}>Guardar</button>
      </div>
      {error && <p className="text-xs" style={{ color: 'var(--color-error, #f87171)' }}>{error}</p>}
      {facts && facts.length === 0 && <p className="text-sm" style={muted}>Nada guardado ainda.</p>}
      {facts && [...facts].reverse().map((f) => (
        <div key={f.id} className="flex items-start gap-3 px-3 py-2 rounded-lg" style={card}>
          <div className="flex-1">
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>{f.text}</p>
            <p className="text-xs mt-0.5" style={muted}>{f.created}, {f.source === 'auto' ? 'guardado sozinho' : f.source === 'tela' ? 'escrito aqui' : 'a seu pedido'}</p>
          </div>
          <button onClick={() => void remove(f.id)} className="text-xs cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>Apagar</button>
        </div>
      ))}
    </div>
  );
}

const seconds = (ms: number | null | undefined) => (ms == null ? 'sem dados' : `${(ms / 1000).toFixed(1)} s`);

function SpeedTab() {
  const { data: metrics } = usePoll<VoiceMetrics>(fetchVoiceMetrics, 5000);
  const [voice, setVoice] = useState<VoiceEngine | null>(null);
  const [sounds, setSounds] = useState(soundsEnabled());
  useEffect(() => { fetchVoiceEngine().then(setVoice).catch(() => setVoice(null)); }, []);
  const choose = (engine: 'piper' | 'kokoro') => setVoiceEngine(engine).then(setVoice).catch(() => {});
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xs font-medium mb-2" style={muted}>Tempo de resposta por voz (média das últimas {metrics?.turns ?? 0} falas)</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="px-3 py-2 rounded-lg" style={card}>
            <p className="text-xs" style={muted}>Entender a fala</p>
            <p className="text-lg" style={{ color: 'var(--color-text)' }}>{seconds(metrics?.stt_ms)}</p>
          </div>
          <div className="px-3 py-2 rounded-lg" style={card}>
            <p className="text-xs" style={muted}>Do fim da fala até a voz do Jarvis</p>
            <p className="text-lg" style={{ color: 'var(--color-text)' }}>{seconds(metrics?.first_audio_ms)}</p>
          </div>
        </div>
        <p className="text-xs mt-2" style={muted}>Conta desde que o servidor foi ligado. A frase &quot;Um momento, senhor&quot; também vale como primeira voz.</p>
      </div>
      <div>
        <h3 className="text-xs font-medium mb-2" style={muted}>Voz do Jarvis</h3>
        {voice ? (
          <div className="flex gap-2 items-center flex-wrap">
            {(['piper', 'kokoro'] as const).map((e) => (
              <button key={e} onClick={() => void choose(e)} disabled={e === 'piper' && !voice.piper_available}
                className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer disabled:opacity-40"
                style={{ ...card, color: voice.engine === e ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}>
                {e === 'piper' ? `Faber${voice.piper_voice ? '' : ' (sem arquivo de voz)'}` : 'Kokoro (pm_alex)'}
              </button>
            ))}
            {voice.error && <p className="text-xs w-full" style={muted}>A voz Faber falhou e o Jarvis voltou ao Kokoro: {voice.error}</p>}
          </div>
        ) : <p className="text-sm" style={muted}>Sem resposta do servidor.</p>}
        <p className="text-xs mt-2" style={muted}>A troca vale a partir da próxima frase.</p>
      </div>
      <div>
        <h3 className="text-xs font-medium mb-2" style={muted}>Sons da interface</h3>
        <button onClick={() => { setSoundsEnabled(!sounds); setSounds(!sounds); if (!sounds) playSound('wake'); }}
          className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer" style={{ ...card, color: sounds ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}>
          {sounds ? 'Ligados' : 'Desligados'}
        </button>
      </div>
    </div>
  );
}

export function SystemPage() {
  const [tab, setTab] = useState<Tab>('guardian');
  return (
    <div className="flex-1 overflow-y-auto px-6 py-10">
      <div className="max-w-3xl mx-auto w-full">
        <h1 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Sistema</h1>
        <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
          Guardião, uso do Claude, prompts do Ryan e da Ember, e avisos. Tudo vem de arquivos locais.
        </p>
        <div className="flex flex-wrap gap-2 mb-5">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
              style={{ ...card, color: tab === t.id ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}>
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'guardian' && <GuardianTab />}
        {tab === 'life' && <LifeTab />}
        {tab === 'memory' && <MemoryTab />}
        {tab === 'speed' && <SpeedTab />}
        {tab === 'secretary' && <SecretaryTab />}
        {tab === 'usage' && <UsageTab />}
        {tab === 'prompts' && <PromptsTab />}
        {tab === 'notices' && <NoticesTab />}
      </div>
    </div>
  );
}
