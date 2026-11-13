import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import {
  fetchGuardian, fetchPrompts, fetchClaudeUsage, fetchNotices, fetchSecretary, saveCity,
  type GuardianState, type SavedPrompt, type ClaudeUsage, type Notice, type SecretaryPanel,
} from '../lib/jarvis';

type Tab = 'guardian' | 'secretary' | 'usage' | 'prompts' | 'notices';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'guardian', label: 'Guardião' },
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
  if (failed) return <p className="text-sm" style={muted}>Não consegui falar com a API do Jarvis. Inicie pelo INICIAR-GUI.bat.</p>;
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

export function SystemPage() {
  const [tab, setTab] = useState<Tab>('guardian');
  return (
    <div className="flex-1 overflow-y-auto px-6 py-10">
      <div className="max-w-3xl mx-auto w-full">
        <h1 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Sistema</h1>
        <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
          Guardião, uso do Claude, prompts do Ryan e da Ember, e avisos. Tudo vem de arquivos locais.
        </p>
        <div className="flex gap-2 mb-5">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
              style={{ ...card, color: tab === t.id ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}>
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'guardian' && <GuardianTab />}
        {tab === 'secretary' && <SecretaryTab />}
        {tab === 'usage' && <UsageTab />}
        {tab === 'prompts' && <PromptsTab />}
        {tab === 'notices' && <NoticesTab />}
      </div>
    </div>
  );
}
