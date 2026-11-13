// Jarvis panels: read-only data served by jarvis_serve.py under /v1/jarvis (local files).
export interface GuardianState {
  running: boolean;
  mode: 'normal' | 'game' | 'stress' | 'off' | string;
  updated?: string;
  voice_muted?: boolean;
  game?: { name: string; since: string } | null;
  stress_reasons?: string[];
  metrics: Record<string, number | null>;
  services: Record<string, unknown> | unknown[];
  ollama_unloaded?: unknown;
  events: Array<Record<string, unknown>>;
}

export interface SavedPrompt {
  id: number;
  ts: string;
  agent: string;
  project: string;
  text: string;
}

export interface ClaudeUsage {
  today: { calls: number; cost_usd: number };
  month: { calls: number; cost_usd: number };
  by_agent: Record<string, { calls: number; cost_usd: number }>;
  recent: Array<Record<string, unknown>>;
  note: string;
}

export interface Notice {
  id?: number;
  app: string;
  kind: string;
  from: string;
  text: string;
  seen_at: string;
}

export interface SecretaryPanel {
  city: string;
  weather: string;
  news: string;
  agenda: string;
  updated: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} failed (${res.status})`);
  return res.json() as Promise<T>;
}

export const fetchGuardian = () => getJson<GuardianState>('/v1/jarvis/guardian');
export const fetchPrompts = () => getJson<{ prompts: SavedPrompt[] }>('/v1/jarvis/prompts').then((r) => r.prompts);
export const fetchClaudeUsage = () => getJson<ClaudeUsage>('/v1/jarvis/usage');
export interface Briefing { greeting: string; inbox: string; weather_alert: string; text: string; whatsapp: number; email: number; teams: number }
export const fetchBriefing = () => getJson<Briefing>('/v1/jarvis/briefing');
export const fetchSecretary = (refresh = false) =>
  getJson<SecretaryPanel>(`/v1/jarvis/secretary${refresh ? '?refresh=true' : ''}`);
export const saveCity = (city: string) =>
  fetch('/v1/jarvis/secretary/city', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ city }),
  }).then((r) => {
    if (!r.ok) throw new Error('Could not save the city');
    return r.json() as Promise<SecretaryPanel>;
  });
export const fetchNotices = () => getJson<{ notifications: Notice[] }>('/v1/jarvis/notifications').then((r) => r.notifications);

export interface MemoryFact { id: number; text: string; kind: string; source: string; created: string }
export const fetchMemory = () => getJson<{ facts: MemoryFact[] }>('/v1/jarvis/memory').then((r) => r.facts);
export const addMemory = (text: string) =>
  fetch('/v1/jarvis/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).then((r) => {
    if (!r.ok) throw new Error('Could not save the note');
  });
export const deleteMemory = (id: number) =>
  fetch(`/v1/jarvis/memory/${id}`, { method: 'DELETE' }).then((r) => {
    if (!r.ok) throw new Error('Could not delete the note');
  });

export interface VoiceMetrics {
  turns: number;
  stt_ms: number | null;
  first_audio_ms: number | null;
  total_ms: number | null;
}
export const fetchVoiceMetrics = () => getJson<VoiceMetrics>('/v1/jarvis/metrics');

export interface VoiceEngine { engine: 'piper' | 'kokoro'; piper_voice: string; piper_available: boolean; error: string }
export const fetchVoiceEngine = () => getJson<VoiceEngine>('/v1/jarvis/voice');
export const setVoiceEngine = (engine: 'piper' | 'kokoro') =>
  fetch('/v1/jarvis/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engine }),
  }).then((r) => r.json() as Promise<VoiceEngine>);
