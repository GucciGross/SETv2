import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { marked } from 'marked';
import { api } from '../lib/api';
import { InlineQuiz, InlineFlashcards } from '../components/A2UI';

const md = (s: string) => ({ __html: marked.parse(s ?? '', { async: false }) as string });

export default function StudyView() {
  const { deckId } = useParams();
  const [deck, setDeck] = useState<any>(null);

  useEffect(() => {
    if (!deckId) return;
    api.get(`/decks/${deckId}`).then((r) => setDeck(r.deck)).catch(() => {});
  }, [deckId]);

  if (!deck) return <div className="p-8 text-set-dim">Loading deck…</div>;
  const items = deck.items ?? {};

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {deck.kind === 'flashcards' && <InlineFlashcards props={{ deckId: deck.id, title: deck.title, cards: items.cards }} />}
      {deck.kind === 'quiz' && <InlineQuiz props={{ deckId: deck.id, title: deck.title, items: items.items }} />}
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
