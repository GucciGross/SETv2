import { Plug } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../stores/app';
import { COPILOT_TOGGLE_SELECTOR, isSetCopilotOpen } from '../../lib/copilotLauncher';

/** One route from the workspace, chat header and voice error surface. */
export default function AIConnectionButton({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const spaceId = useApp(s => s.currentSpaceId);
  return <button type="button" className="set-btn-ghost inline-flex items-center justify-center gap-1.5 min-h-11 min-w-11 shrink-0 text-xs"
    aria-label="AI connection settings" title="Connect Codex or an LLM; check voice setup" disabled={!spaceId}
    onClick={() => {
      window.dispatchEvent(new Event('set:copilot-reset-input'));
      const toggle = document.querySelector<HTMLButtonElement>(COPILOT_TOGGLE_SELECTOR);
      if (toggle && isSetCopilotOpen(toggle)) toggle.click();
      navigate(`/app/space/${spaceId}/settings?tab=providers`);
    }}>
    <Plug size={16} aria-hidden />{!compact && <span>AI setup</span>}
  </button>;
}
