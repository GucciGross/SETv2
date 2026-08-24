import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApp } from '../../stores/app';
import Mascot, { DEFAULT_MASCOT, type MascotConfig } from '../Mascot';
import { Brain, Users, GraduationCap, Wrench, ArrowRight } from 'lucide-react';

const PERSONAS = [
  {
    id: 'personal' as const,
    icon: <Brain size={20} />,
    title: 'Personal knowledge',
    blurb: 'Second brain: notes, reading, ideas, projects',
  },
  {
    id: 'team' as const,
    icon: <Users size={20} />,
    title: 'Team enablement',
    blurb: 'SOPs, onboarding paths, shared docs and tasks',
  },
  {
    id: 'study' as const,
    icon: <GraduationCap size={20} />,
    title: 'Study & research',
    blurb: 'Sources, citations, flashcards and quizzes',
  },
  {
    id: 'builder' as const,
    icon: <Wrench size={20} />,
    title: 'Engineering',
    blurb: 'Docs, runbooks, code surfaces, agents',
  },
];

/**
 * First-run persona picker: shapes starter content, and starts the
 * spotlight tour. Shown once (until the user picks or skips).
 */
export default function WelcomeModal({ onDone }: { onDone: (persona?: string) => void }) {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const { user } = useApp();
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mascot: MascotConfig = (user as any)?.mascot ?? DEFAULT_MASCOT;

  const finish = async (persona?: string) => {
    setBusy(true);
    try {
      await api.put('/users/onboarding', { welcomed: true, ...(persona ? { persona } : {}) });
      if (persona && spaceId) {
        await api.post(`/spaces/${spaceId}/onboarding/seed`, { persona }).catch(() => {});
      }
      useApp.setState({ user: { ...(user as any), onboarding: { ...(user as any)?.onboarding, welcomed: true, persona } } });
      onDone(persona);
      if (spaceId) navigate(`/app/space/${spaceId}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 safe-outer">
      <div className="set-card bg-set-panel w-full max-w-lg p-6 sm:p-8">
        <div className="flex items-start gap-4 mb-5">
          <Mascot config={mascot} mood="celebrating" size={64} />
          <div>
            <h2 className="text-xl font-bold text-white">
              Welcome to SET{(user as any)?.name ? `, ${(user as any).name.split(' ')[0]}` : ''}
            </h2>
            <p className="text-sm text-set-dim mt-1">
              What is this workspace for? We set up starter pages, a database and the right surfaces for it.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPicked(p.id)}
              className={`text-left p-3.5 rounded-xl border transition-colors ${
                picked === p.id
                  ? 'border-set-accent bg-set-accent/15'
                  : 'border-set-border bg-set-panel2/40 hover:border-set-accent/40'
              }`}
            >
              <div className="flex items-center gap-2 text-white text-sm font-medium mb-1">
                <span className={picked === p.id ? 'text-set-accent' : 'text-set-dim'}>{p.icon}</span>
                {p.title}
              </div>
              <div className="text-xs text-set-dim">{p.blurb}</div>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button className="set-btn-primary text-sm flex items-center gap-1.5" disabled={!picked || busy} onClick={() => picked && finish(picked)}>
            {busy ? 'Setting up…' : 'Set up my workspace'} {!busy && <ArrowRight size={14} />}
          </button>
          <button className="set-btn-ghost text-sm" disabled={busy} onClick={() => finish(undefined)}>
            Skip — I'll explore myself
          </button>
        </div>
        <p className="text-[11px] text-set-dim mt-3">You can redo this anytime from the dashboard checklist.</p>
      </div>
    </div>
  );
}
