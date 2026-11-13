import { ChatArea } from '../components/Chat/ChatArea';
import { SystemPanel } from '../components/Chat/SystemPanel';
import { useAppStore } from '../lib/store';
import { HudScene } from '../components/Jarvis/HudScene';

export function ChatPage() {
  const systemPanelOpen = useAppStore((s) => s.systemPanelOpen);

  return (
    <div className="flex h-full overflow-hidden relative">
      <HudScene />
      <div className="flex-1 min-w-0 relative z-[1]">
        <ChatArea />
      </div>
      {systemPanelOpen && <SystemPanel />}
    </div>
  );
}
