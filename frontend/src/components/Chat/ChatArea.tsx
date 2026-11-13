import { useRef, useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { MessageBubble } from './MessageBubble';
import { InputArea } from './InputArea';
import { StreamingDots } from './StreamingDots';
import { useAppStore } from '../../lib/store';
import { shouldAutoplayFinishedReply, useTtsStore } from '../../lib/tts';
import { stripThinkTags } from '../../lib/message-text';
import { PanelRightOpen, PanelRightClose, Database, X } from 'lucide-react';
import { listConnectors } from '../../lib/connectors-api';
import { ArcReactor } from '../Jarvis/ArcReactor';
import { HandsFreeGate } from '../Jarvis/HandsFreeGate';
import { useHudStore } from '../../lib/hud';
import { fetchBriefing, type Briefing } from '../../lib/jarvis';
import { pickFiller } from '../../lib/fillers';

// The core owns the stage: as large as the viewport allows, and still large beside the
// transcript once a conversation starts (it only shrinks on narrow windows).
function useCoreSize(isEmpty: boolean): number {
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const stageW = vp.w - 90;
  if (isEmpty) return Math.round(Math.max(280, Math.min(900, vp.h * 0.8, stageW * 0.72)));
  if (vp.w < 1100) return 190;
  return Math.round(Math.max(300, Math.min(780, vp.h * 0.74, stageW * 0.54)));
}

function getGreetingPt(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function ChatArea() {
  const activeId = useAppStore((s) => s.activeId);
  const messages = useAppStore((s) => s.messages);
  const streamState = useAppStore((s) => s.streamState);
  const systemPanelOpen = useAppStore((s) => s.systemPanelOpen);
  const toggleSystemPanel = useAppStore((s) => s.toggleSystemPanel);
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const wasStreaming = useRef(false);
  const lastScrollTop = useRef(0);
  const isCurrentChatStreaming = streamState.isStreaming && streamState.conversationId === activeId;

  // Autoplay: speak a reply once it is finished, never while it streams -- a
  // partial sentence would be synthesized and then cut off by the next chunk.
  // autoSpokenId fences the message so re-renders cannot repeat it.
  const voiceOutputEnabled = useAppStore((s) => s.settings.voiceOutputEnabled);
  const voiceAutoplay = useAppStore((s) => s.settings.voiceAutoplay);
  // Probe the backend as soon as voice output is switched on. Without this the
  // first reply could never autoplay: `available` is only set by ensureHealth,
  // which until now ran solely from the per-message read-aloud button -- and
  // that button does not exist until a reply is already on screen.
  useEffect(() => {
    if (!voiceOutputEnabled) return;
    useTtsStore.getState().ensureHealth();
  }, [voiceOutputEnabled]);

  // Speak on the falling edge of a stream -- the moment a reply finishes -- and
  // never merely because a finished reply happens to be on screen. Opening the
  // app or switching conversations would otherwise read stale history aloud,
  // and browsers block that anyway: playback with no preceding user gesture is
  // rejected outright, so the failure would be silent in both senses.
  const streamingConversationRef = useRef<string | null>(null);
  const spokenRef = useRef<{ id: string; n: number }>({ id: '', n: 0 });
  useEffect(() => {
    const last = messages[messages.length - 1];
    const tts = useTtsStore.getState();
    const justFinished = shouldAutoplayFinishedReply(
      streamingConversationRef.current,
      activeId,
      streamState.isStreaming,
      last,
      tts.autoSpokenId,
    );
    streamingConversationRef.current = isCurrentChatStreaming ? activeId : null;

    if (!justFinished) return;
    if (!voiceOutputEnabled || !voiceAutoplay) return;

    if (!last || last.role !== 'assistant' || activeId === null) return;

    // Model loading may still be in flight when a fast reply completes. Wait
    // for the probe, then confirm that this is still the active finished reply.
    const completedConversationId = activeId;
    const completedMessageId = last.id;
    void tts.ensureHealth().then(() => {
      const app = useAppStore.getState();
      const currentTts = useTtsStore.getState();
      const currentLast = app.messages[app.messages.length - 1];
      if (app.activeId !== completedConversationId || app.streamState.isStreaming) return;
      if (!app.settings.voiceOutputEnabled || !app.settings.voiceAutoplay) return;
      if (currentLast?.id !== completedMessageId || currentTts.available !== true) return;
      if (currentTts.autoSpokenId === completedMessageId) return;

      const text = stripThinkTags(currentLast.content);
      if (!text) return;
      currentTts.markAutoSpoken(completedMessageId);
      // Sentences already spoken while the reply was streaming are not repeated.
      const already = spokenRef.current.id === completedMessageId ? spokenRef.current.n : 0;
      const rest = text.slice(already);
      if (already === 0) void currentTts.speak(completedMessageId, text);
      else if (rest.trim()) currentTts.enqueue(completedMessageId, rest);
    });
  }, [activeId, messages, streamState.isStreaming, isCurrentChatStreaming, voiceOutputEnabled, voiceAutoplay]);
  const currentStreamContent = isCurrentChatStreaming ? streamState.content : '';

  // If nothing has arrived a moment after the request went out, say a short cached
  // acknowledgement so the wait does not feel like a hang. Only in hands-free mode.
  const handsFreeOn = useHudStore((s) => s.active && s.wake !== 'off');
  useEffect(() => {
    if (!isCurrentChatStreaming || !handsFreeOn || !voiceOutputEnabled || !voiceAutoplay) return;
    const timer = setTimeout(() => {
      const app = useAppStore.getState();
      const last = app.messages[app.messages.length - 1];
      if (!app.streamState.isStreaming || !last || last.role !== 'assistant') return;
      if (stripThinkTags(app.streamState.content).trim()) return;
      if (useTtsStore.getState().state !== 'idle') return;
      const filler = pickFiller();
      if (filler) useTtsStore.getState().enqueueBlob(last.id, filler);
    }, 1200);
    return () => clearTimeout(timer);
  }, [isCurrentChatStreaming, handsFreeOn, voiceOutputEnabled, voiceAutoplay]);

  // Start talking before the reply is finished: every complete sentence that arrives in the
  // stream goes to the voice queue right away.
  useEffect(() => {
    if (!isCurrentChatStreaming || !voiceOutputEnabled || !voiceAutoplay) return;
    const tts = useTtsStore.getState();
    if (tts.available !== true) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (spokenRef.current.id !== last.id) spokenRef.current = { id: last.id, n: 0 };
    const text = stripThinkTags(streamState.content);
    const ready = text.slice(spokenRef.current.n).match(/^[\s\S]*[.!?…:](?=\s)/);
    if (!ready || ready[0].trim().length < 12) return;
    spokenRef.current.n += ready[0].length;
    tts.enqueue(last.id, ready[0]);
  }, [isCurrentChatStreaming, streamState.content, messages, voiceOutputEnabled, voiceAutoplay]);

  // Check if any data sources are connected
  const [hasConnectedSources, setHasConnectedSources] = useState<boolean | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    listConnectors()
      .then((list) => setHasConnectedSources(list.some((c) => c.connected)))
      .catch(() => setHasConnectedSources(null));
  }, []);

  useEffect(() => {
    // Sending a message always pins the view to the bottom, even if the
    // user had scrolled up to read earlier messages.
    if (isCurrentChatStreaming && !wasStreaming.current) {
      shouldAutoScroll.current = true;
    }
    wasStreaming.current = isCurrentChatStreaming;
    if (shouldAutoScroll.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, currentStreamContent, isCurrentChatStreaming]);

  const handleScroll = () => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    const distance = scrollHeight - scrollTop - clientHeight;
    const scrolledUp = scrollTop < lastScrollTop.current;
    lastScrollTop.current = scrollTop;
    if (scrolledUp && distance >= 1) {
      // Any upward scroll away from the bottom stops autoscroll immediately,
      // so streaming content never fights the user (no jitter). Sub-1px
      // upward movement (elastic bounce settling at the bottom) is ignored.
      shouldAutoScroll.current = false;
    } else if (!scrolledUp) {
      // Re-engage when scrolled back to the bottom. < 2 rather than < 1:
      // at fractional zoom levels the at-bottom residual can reach 1px,
      // which would otherwise leave autoscroll permanently disengaged.
      shouldAutoScroll.current = distance < 2;
    }
  };

  const isEmpty = messages.length === 0 && !isCurrentChatStreaming;
  const coreSize = useCoreSize(isEmpty);

  // Greeting of a new chat: time of day, new WhatsApp messages and emails, weather warning.
  // It is shown always and spoken once per new chat when hands-free mode is on (browsers
  // only allow audio after the click that turns it on).
  const handsFree = useHudStore((s) => s.active && s.wake !== 'off');
  const greetNonce = useHudStore((s) => s.greetNonce);
  const [brief, setBrief] = useState<Briefing | null>(null);
  const briefedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isEmpty) return;
    let cancelled = false;
    const key = `${activeId ?? 'new'}:${greetNonce}`;
    fetchBriefing()
      .then((b) => {
        if (cancelled) return;
        setBrief(b);
        if (!handsFree || briefedRef.current === key) return;
        briefedRef.current = key;
        void useTtsStore.getState().ensureHealth().then(() => {
          if (useTtsStore.getState().available === true) void useTtsStore.getState().speak(`briefing-${key}`, b.text);
        });
      })
      .catch(() => setBrief(null));
    return () => { cancelled = true; };
  }, [isEmpty, activeId, greetNonce, handsFree]);

  const PanelIcon = systemPanelOpen ? PanelRightClose : PanelRightOpen;

  return (
    <div className={`holo-stage flex flex-col h-full ${isEmpty ? 'empty' : 'talk'}`}>
      {/* Toggle bar */}
      <div className="holo-toggle flex items-center justify-end px-3 py-1.5 shrink-0">
        <button
          onClick={toggleSystemPanel}
          className="p-1.5 rounded-md transition-colors cursor-pointer"
          style={{ color: 'var(--color-text-tertiary)' }}
          title={`${systemPanelOpen ? 'Hide' : 'Show'} system panel (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+I)`}
        >
          <PanelIcon size={16} />
        </button>
      </div>

      {/* Data sources banner */}
      {hasConnectedSources === false && !bannerDismissed && (
        <div
          className="mx-4 mb-2 flex items-center gap-3 px-4 py-3 rounded-lg text-sm shrink-0"
          style={{
            background: 'var(--color-accent-subtle)',
            border: '1px solid var(--color-border)',
          }}
        >
          <Database size={16} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
          <span style={{ color: 'var(--color-text-secondary)', flex: 1 }}>
            Connect your data sources (Gmail, iMessage, Slack, etc.) to get personalized answers.
          </span>
          <button
            onClick={() => navigate('/data-sources')}
            className="px-3 py-1 rounded text-xs font-medium cursor-pointer"
            style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)', border: 'none' }}
          >
            Connect
          </button>
          <button
            onClick={() => setBannerDismissed(true)}
            className="p-1 rounded cursor-pointer"
            style={{ color: 'var(--color-text-tertiary)', background: 'transparent', border: 'none' }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className={`jarvis-hero ${isEmpty ? 'big' : 'small'}`}>
        <ArcReactor size={coreSize} />
        {isEmpty && (
          <div className="jarvis-greet">
            <h2>{brief?.greeting ?? `${getGreetingPt()}, senhor.`}</h2>
            <p>{brief ? `${brief.inbox}${brief.weather_alert ? ` ${brief.weather_alert}` : ''}` : 'Diga "Jarvis" e faça o pedido.'}</p>
          </div>
        )}
        <HandsFreeGate />
      </div>
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="holo-transcript flex-1 overflow-y-auto"
      >
        {isEmpty ? (
          <div className="h-full" />
        ) : (
          <div className="max-w-[var(--chat-max-width)] mx-auto px-4 py-6">
            {messages.map((msg, i) => {
              const isLastAssistant =
                i === messages.length - 1 && msg.role === 'assistant';
              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isLive={isLastAssistant && isCurrentChatStreaming}
                />
              );
            })}
            {(() => {
              if (!isCurrentChatStreaming || streamState.content !== '') return null;
              // For research messages the ResearchTimeline handles its own
              // pre-content loading state — suppress the generic dots.
              const last = messages[messages.length - 1];
              if (last?.role === 'assistant' && last.isResearch) return null;
              return (
                <div className="flex justify-start mb-4">
                  <StreamingDots phase={streamState.phase} />
                </div>
              );
            })()}
          </div>
        )}
      </div>
      <InputArea />
    </div>
  );
}
