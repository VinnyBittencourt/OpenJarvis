import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Activity, BarChart3, Bot, Database, History, MessageSquare, Plus, ScrollText, Settings } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { useHudStore } from '../../lib/hud';

// Navigation for the holographic theme: a floating rail of diamond keys on the left edge.
// The original sidebar (history, model picker) becomes a drawer opened from the first key.
const ITEMS = [
  { path: '/', icon: MessageSquare, label: 'Jarvis' },
  { path: '/agents', icon: Bot, label: 'Agentes' },
  { path: '/system', icon: Activity, label: 'Sistema' },
  { path: '/dashboard', icon: BarChart3, label: 'Painel' },
  { path: '/data-sources', icon: Database, label: 'Fontes de dados' },
  { path: '/logs', icon: ScrollText, label: 'Registros' },
  { path: '/settings', icon: Settings, label: 'Ajustes' },
];

export function HoloDock() {
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
      <button className={sidebarOpen ? 'on' : ''} onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Histórico e modelo">
        <i><History size={16} /></i><span>Histórico e modelo</span>
      </button>
      <button onClick={newChat} aria-label="Nova conversa">
        <i><Plus size={16} /></i><span>Nova conversa</span>
      </button>
      <hr />
      {ITEMS.map((it) => (
        <button key={it.path} className={pathname === it.path ? 'on' : ''} onClick={() => navigate(it.path)} aria-label={it.label}>
          <i><it.icon size={16} /></i><span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
