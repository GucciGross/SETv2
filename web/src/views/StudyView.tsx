import { useApp } from '../stores/app';
import { studioPath } from '../components/h5p/api';
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { marked } from 'marked';
import { api } from '../lib/api';
import { InlineFlashcards } from '../components/A2UI';
import QuizPanel from '../components/QuizPanel';
import { Package } from 'lucide-react';

const md = (s: string) => ({ __html: marked.parse(s ?? '', { async: false }) as string });

export default function StudyView() {
  const { deckId, spaceId } = useParams();
  const navigate = useNavigate();
  const role = useApp((state) => state.spaces.find((space) => space.id === spaceId)?.role);
  const canEdit = role === 'owner' || role === 'editor';
  const [h5pError, setH5pError] = useState('');
  const [converting, setConverting] = useState(false);
  const [deck, setDeck] = useState<any>(null);

  useEffect(() => {
    if (!deckId) return;
    api.get(`/decks/${deckId}`).then((r) => setDeck(r.deck)).catch(() => {});
  }, [deckId]);

  if (!deck) return <div className="p-8 text-set-dim">Loading deck…</div>;
  const items = deck.items ?? {};

  const exportH5P = async () => {
    const res = await fetch(`/api/decks/${deckId}/h5p`, { headers: { authorization: `Bearer ${localStorage.getItem('set_token')}` } });
    if (!res.ok) {
      setH5pError((await res.json()).error ?? 'H5P export failed.');
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(deck.title || 'deck').replace(/[^\w.-]+/g, '_').slice(0, 60)}.h5p`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h1 className="text-lg font-bold text-white flex-1 truncate">{deck.title}</h1>
        {canEdit && <><button className="set-btn-primary text-xs" disabled={converting} onClick={async () => {
          setConverting(true); setH5pError('');
          try { const result = await api.post(`/decks/${deckId}/h5p/activity`); navigate(studioPath(spaceId!, result.activity.id)); }
          catch (error: any) { setH5pError(error.message); } finally { setConverting(false); }
        }}>{converting ? 'Creating practice copy…' : 'Open copy in H5P Studio'}</button>
        <button className="set-btn text-xs flex items-center gap-1.5" onClick={() => void exportH5P().catch((error) => setH5pError(error.message))}>
          <Package size={12} /> Export H5P
        </button></>}
      </div>
      {h5pError && <p role="alert" className="text-sm text-red-400 mb-3">{h5pError}</p>}
      {deck.kind === 'flashcards' && <InlineFlashcards props={{ deckId: deck.id, title: deck.title, cards: items.cards }} />}
      {deck.kind === 'quiz' && <QuizPanel deckId={deck.id} />}
      {deck.kind === 'studyguide' && (
        <div className="set-card p-6">
          <h1 className="text-xl font-bold text-white mb-3"> {deck.title}</h1>
          <div className="prose-set max-w-none" dangerouslySetInnerHTML={md(items.markdown ?? '')} />
        </div>
      )}
      {deck.kind === 'audio' && (
        <div className="space-y-2">
          <h1 className="text-xl font-bold text-white mb-3"> {deck.title}</h1>
          {(items.segments ?? []).map((seg: any, i: number) => (
            <div key={i} className={`set-card p-3 text-sm ${seg.speaker === 'Host' ? 'border-blue-500/30' : 'border-violet-500/30'}`}>
              <span className={`text-xs font-semibold ${seg.speaker === 'Host' ? 'text-blue-300' : 'text-violet-300'}`}>{seg.speaker}</span>
              <p className="mt-0.5">{seg.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
