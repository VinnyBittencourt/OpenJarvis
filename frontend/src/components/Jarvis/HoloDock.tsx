import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Activity, BarChart3, Bot, Database, History, MessageSquare, Plus, ScrollText, Settings } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { useHudStore } from '../../lib/hud';
import { tr, useLang } from '../../lib/life';

// Navigation for the holographic theme: a floating rail of diamond keys on the left edge.
// The original sidebar (history, model picker) becomes a drawer opened from the first key.
const ITEMS = [
  { path: '/', icon: MessageSquare, label: 'Jarvis', en: 'Jarvis' },
  { path: '/agents', icon: Bot, label: 'Agentes', en: 'Agents' },
  { path: '/system', icon: Activity, label: 'Sistema', en: 'System' },
  { path: '/dashboard', icon: BarChart3, label: 'Painel', en: 'Dashboard' },
  { path: '/data-sources', icon: Database, label: 'Fontes de dados', en: 'Data sources' },
  { path: '/logs', icon: ScrollText, label: 'Registros', en: 'Logs' },
  { path: '/settings', icon: Settings, label: 'Ajustes', en: 'Settings' },
];

export function HoloDock() {
  const lang = useLang();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const createConversation = useAppStore((s) => s.createConversation);

  // The drawer starts closed and closes again on every navigation.
  useEffect(() => {
    if (document.documentElement.classList.contains('jarvis-hud')) setSidebarOpen(false);
  }, [pathname, setSidebarOpen]);

  const newChat = () => {
    const s = useAppStore.getState();
    if (s.messages.length > 0) createConversation(s.selectedModel);
    useHudStore.getState().bumpGreet();
    navigate('/');
  };

  return (
    <nav className="holo-dock" aria-label="Navegação">
      <button className={sidebarOpen ? 'on' : ''} onClick={() => setSidebarOpen(!sidebarOpen)} aria-label={tr(lang, 'Histórico e modelo', 'History and model')}>
        <i><History size={16} /></i><span>{tr(lang, 'Histórico e modelo', 'History and model')}</span>
      </button>
      <button onClick={newChat} aria-label={tr(lang, 'Nova conversa', 'New chat')}>
        <i><Plus size={16} /></i><span>{tr(lang, 'Nova conversa', 'New chat')}</span>
      </button>
      <hr />
      {ITEMS.map((it) => (
        <button key={it.path} className={pathname === it.path ? 'on' : ''} onClick={() => navigate(it.path)} aria-label={tr(lang, it.label, it.en)}>
          <i><it.icon size={16} /></i><span>{tr(lang, it.label, it.en)}</span>
        </button>
      ))}
    </nav>
  );
}
