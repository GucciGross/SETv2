import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { marked } from 'marked';
import { api } from '../lib/api';

/** A2UI-style declarative generative UI — agents emit component descriptors, this registry renders them. */

export interface A2UIComponent {
  type: 'card' | 'kv' | 'table' | 'quiz' | 'flashcards' | 'viewer3d' | 'form' | 'list' | 'image';
  props: Record<string, any>;
}

const md = (s: string) => ({ __html: marked.parse(s ?? '', { async: false }) as string });

export function A2UIRenderer({ component, onFormSubmit }: { component: A2UIComponent; onFormSubmit?: (values: Record<string, any>) => void }) {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const p = component.props ?? {};

  switch (component.type) {
    case 'card':
      return (
        <div className="set-card p-4 fadein">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xl">{p.icon ?? ''}</span>
            <h4 className="font-semibold text-white">{p.title}</h4>
          </div>
          {p.body && <div className="prose-set text-sm max-w-none" dangerouslySetInnerHTML={md(p.body)} />}
          {p.pageId && (
            <button className="set-btn mt-2 text-xs" onClick={() => navigate(`/app/space/${spaceId}/page/${p.pageId}`)}>
              Open page 
            </button>
          )}
          {p.kind === 'audio' && p.deckId && (
            <AudioPlayer segments={parseAudioSegments(p.body)} />
          )}
        </div>
      );
    case 'kv':
      return (
        <div className="set-card p-3 fadein text-sm">
          {p.title && <h4 className="font-semibold text-white mb-2">{p.title}</h4>}
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {Object.entries(p.entries ?? {}).map(([k, v]) => (
              <React.Fragment key={k}>
                <span className="text-set-dim">{k}</span>
                <span>{String(v)}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      );
    case 'table':
      return (
        <div className="set-card p-3 fadein overflow-x-auto">
          {p.title && <h4 className="font-semibold text-white mb-2 text-sm">{p.title}</h4>}
          <table className="w-full text-xs">
            <thead>
              <tr>{(p.columns ?? []).map((c: string) => <th key={c} className="text-left border-b border-set-border py-1 pr-3 text-set-dim">{c}</th>)}</tr>
            </thead>
            <tbody>
              {(p.rows ?? []).map((row: any[], i: number) => (
                <tr key={i}>{row.map((cell, j) => <td key={j} className="border-b border-set-border/40 py-1 pr-3">{String(cell ?? '')}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'list':
      return (
        <div className="set-card p-3 fadein">
          {p.title && <h4 className="font-semibold text-white mb-2 text-sm">{p.title}</h4>}
          <div className="space-y-1">
            {(p.items ?? []).map((item: any, i: number) => (
              <button key={i}
                className="flex w-full items-center gap-2 px-2 py-1.5 rounded-md hover:bg-set-panel2 text-sm text-left"
                onClick={() => {
                  if (item.kind === 'page') navigate(`/app/space/${spaceId}/page/${item.id}`);
                  else if (item.kind === 'model') navigate(`/app/space/${spaceId}/model/${item.id}`);
                }}>
                <span>{item.icon}</span> <span className="flex-1 truncate">{item.title}</span>
                <span className="text-set-dim text-xs">{item.kind}</span>
              </button>
            ))}
          </div>
        </div>
      );
    case 'image':
      return (
        <figure className="set-card p-3 fadein">
          {p.title && <h4 className="font-semibold text-white text-sm mb-2">{p.title}</h4>}
          <img src={p.src} alt={p.alt ?? 'capture'} className="rounded-lg border border-set-border max-h-96 w-auto" />
          {p.caption && <figcaption className="text-xs text-set-dim mt-1.5">{p.caption}</figcaption>}
        </figure>
      );
    case 'form':
      return <A2Form props={p} onSubmit={onFormSubmit} />;
    case 'quiz':
      return <InlineQuiz props={p} />;
    case 'flashcards':
      return <InlineFlashcards props={p} />;
    case 'viewer3d':
      return (
        <div className="set-card p-4 fadein flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl"></span>
            <div>
              <div className="font-semibold text-white text-sm">{p.name ?? '3D Model'}</div>
              <div className="text-xs text-set-dim">Interactive 3D scene</div>
            </div>
          </div>
          <button className="set-btn text-xs" onClick={() => navigate(`/app/space/${spaceId}/model/${p.modelId}`)}>
            Open 3D viewer 
          </button>
        </div>
      );
    default:
      return <div className="text-xs text-set-dim set-card p-2">Unknown component: {component.type}</div>;
  }
}

import React from 'react';

function A2Form({ props, onSubmit }: { props: any; onSubmit?: (v: Record<string, any>) => void }) {
  const [values, setValues] = useState<Record<string, any>>({});
  return (
    <div className="set-card p-4 fadein space-y-2">
      <h4 className="font-semibold text-white text-sm">{props.title ?? 'Form'}</h4>
      {(props.fields ?? []).map((f: any) => (
        <label key={f.name} className="block text-sm">
          <span className="text-set-dim text-xs">{f.label}</span>
          {f.type === 'select' ? (
            <select className="set-input mt-0.5" value={values[f.name] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}>
              <option value="">—</option>
              {(f.options ?? []).map((o: string) => <option key={o}>{o}</option>)}
            </select>
          ) : (
            <input
              className="set-input mt-0.5"
              type={f.type === 'number' ? 'number' : 'text'}
              value={values[f.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            />
          )}
        </label>
      ))}
      <button className="set-btn-primary" onClick={() => onSubmit?.(values)}>{props.submitLabel ?? 'Submit'}</button>
    </div>
  );
}

export function InlineQuiz({ props }: { props: any }) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const items: any[] = props.items ?? [];
  const score = items.reduce((s, it, i) => s + (answers[i] === it.answerIndex ? 1 : 0), 0);
  const answered = Object.keys(answers).length;
  return (
    <div className="set-card p-4 fadein space-y-3">
      <h4 className="font-semibold text-white text-sm"> {props.title ?? 'Quiz'} {answered > 0 && <span className="text-set-dim font-normal">— {score}/{items.length}</span>}</h4>
      {items.map((it, i) => (
        <div key={i}>
          <div className="text-sm mb-1">{i + 1}. {it.question}</div>
          <div className="grid gap-1">
            {it.options.map((opt: string, j: number) => {
              const chosen = answers[i] === j;
              const correct = j === it.answerIndex;
              const revealed = answers[i] !== undefined;
              return (
                <button
                  key={j}
                  disabled={revealed}
                  className={`text-left text-sm px-2.5 py-1.5 rounded-lg border transition-colors ${
                    revealed && correct ? 'border-green-500/60 bg-green-500/10 text-green-300'
                    : revealed && chosen ? 'border-red-500/60 bg-red-500/10 text-red-300'
                    : 'border-set-border hover:border-set-accent/50 hover:bg-set-panel2'
                  }`}
                  onClick={() => setAnswers((a) => ({ ...a, [i]: j }))}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          {answers[i] !== undefined && it.explanation && (
            <div className="text-xs text-set-dim mt-1"> {it.explanation}</div>
          )}
        </div>
      ))}
    </div>
  );
}

export function InlineFlashcards({ props }: { props: any }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const cards: any[] = props.cards ?? [];
  if (!cards.length) return null;
  const card = cards[idx];
  const grade = async (g: number) => {
    if (props.deckId) await api.post(`/decks/${props.deckId}/review`, { itemIndex: idx, grade: g }).catch(() => {});
    setFlipped(false);
    setIdx((i) => (i + 1) % cards.length);
  };
  return (
    <div className="set-card p-4 fadein">
      <h4 className="font-semibold text-white text-sm mb-2"> {props.title ?? 'Flashcards'} <span className="text-set-dim font-normal">{idx + 1}/{cards.length}</span></h4>
      <button
        className="w-full min-h-24 p-4 rounded-xl bg-set-panel2 border border-set-border text-left hover:border-set-accent/40 transition-colors"
        onClick={() => setFlipped((f) => !f)}
      >
        <div className="text-[10px] uppercase tracking-wider text-set-dim mb-1">{flipped ? 'Answer' : 'Question'}</div>
        <div className="text-sm">{flipped ? card.back : card.front}</div>
      </button>
      {flipped ? (
        <div className="grid grid-cols-4 gap-1.5 mt-2">
          <button className="set-btn text-xs text-red-300" onClick={() => grade(0)}>Again</button>
          <button className="set-btn text-xs" onClick={() => grade(1)}>Hard</button>
          <button className="set-btn text-xs" onClick={() => grade(2)}>Good</button>
          <button className="set-btn text-xs text-green-300" onClick={() => grade(3)}>Easy</button>
        </div>
      ) : (
        <div className="text-center text-xs text-set-dim mt-2">Click card to flip</div>
      )}
    </div>
  );
}

function parseAudioSegments(body: string | undefined): { speaker: string; text: string }[] {
  if (!body) return [];
  return body.split('\n').filter((l) => l.includes(':')).map((l) => {
    const [speaker, ...rest] = l.replace(/^\*?\*?/, '').split(':');
    return { speaker: speaker.replace(/[^A-Za-z ]/g, '').trim(), text: rest.join(':').trim() };
  }).filter((s) => s.text);
}

function AudioPlayer({ segments }: { segments: { speaker: string; text: string }[] }) {
  const [playing, setPlaying] = useState(false);
  const play = () => {
    setPlaying(true);
    let i = 0;
    const speakNext = () => {
      if (i >= segments.length) return setPlaying(false);
      const seg = segments[i++];
      const u = new SpeechSynthesisUtterance(seg.text);
      u.pitch = seg.speaker === 'Expert' ? 0.9 : 1.1;
      u.rate = 1.02;
      u.onend = speakNext;
      speechSynthesis.speak(u);
    };
    speechSynthesis.cancel();
    speakNext();
  };
  return (
    <div className="mt-2 flex items-center gap-2">
      <button className="set-btn text-xs" onClick={playing ? () => { speechSynthesis.cancel(); setPlaying(false); } : play} disabled={!segments.length}>
        {playing ? ' Stop' : ' Play audio overview'}
      </button>
      <span className="text-xs text-set-dim">{segments.length} segments · browser speech</span>
    </div>
  );
}
