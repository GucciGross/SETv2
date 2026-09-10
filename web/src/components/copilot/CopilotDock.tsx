import { useEffect } from 'react';
import { Keyboard, Mic } from 'lucide-react';
import { openSetCopilot, focusCopilotInput } from '../../lib/copilotLauncher';
import { useCopilotVoice } from './useCopilotVoice';
import { useAgent } from '@copilotkit/react-core/v2';
import { askAgent, GUIDE_AGENT } from '../../lib/copilot';
import './copilotDock.css';

/**
 * Primary Copilot launcher: a two-way rocker for voice or text. This takes
 * layout space above the mobile task bar instead of floating over it.
 */
export default function CopilotDock() {
  const { agent } = useAgent({ agentId: GUIDE_AGENT });
  const voice = useCopilotVoice((text) => {
    openSetCopilot();
    if (agent) void askAgent(agent, text);
  });

  useEffect(() => () => voice.cancel(), [voice.cancel]);

  const openText = () => {
    voice.cancel();
    if (openSetCopilot()) focusCopilotInput();
  };

  return (
    <div className="set-copilot-dock" aria-label="SET Copilot">
      <div className="set-copilot-rocker" role="group" aria-label="Choose voice or text Copilot">
        <button
          type="button"
          className="set-copilot-rocker-side set-copilot-rocker-voice"
          onClick={() => voice.state === 'listening' ? voice.stop() : void voice.start()}
          aria-pressed={voice.state === 'listening'}
          aria-label={voice.state === 'listening' ? 'Stop voice input and send' : 'Talk to SET Copilot'}
          title={voice.state === 'listening' ? 'Stop and send' : 'Voice Copilot'}
        >
          <Mic size={28} strokeWidth={1.65} />
        </button>
        <span className="set-copilot-rocker-divider" aria-hidden />
        <button
          type="button"
          className="set-copilot-rocker-side set-copilot-rocker-text"
          onClick={openText}
          aria-label="Type to SET Copilot"
          title="Text Copilot"
        >
          <Keyboard size={29} strokeWidth={1.65} />
        </button>
      </div>
      {(voice.state !== 'idle' || voice.error) && (
        <div className="set-copilot-dock-status" role={voice.error ? 'alert' : 'status'}>
          {voice.error || (voice.state === 'requesting' ? 'Microphone permission…' : voice.state === 'transcribing' ? 'Transcribing…' : 'Listening — tap mic to send')}
        </div>
      )}
    </div>
  );
}
