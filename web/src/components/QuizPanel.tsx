import { useCallback, useEffect, useRef, useState } from 'react';
import { confirmDialog } from './Confirm';
import { ClipboardCheck, GraduationCap, Hourglass, ListChecks, Settings2, Timer } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../stores/app';
import { InlineQuiz } from './A2UI';

/**
 * Assessed quizzes: attempts are server-side (answers never reach the browser
 * mid-attempt), support time limits, attempt caps, bank draws and open-answer
 * questions that a teacher grades manually. Editors configure the deck and
 * grade from here; everyone keeps the old instant-feedback practice mode.
 */

type Phase = 'lobby' | 'running' | 'review';

export default function QuizPanel({ deckId }: { deckId: string }) {
  const { spaces, currentSpaceId } = useApp();
  const role = spaces.find((s) => s.id === currentSpaceId)?.role ?? 'viewer';
  const isEditor = role === 'editor' || role === 'owner';

  const [data, setData] = useState<{ deck: any; attempts: any[] } | null>(null);
  const [phase, setPhase] = useState<Phase>('lobby');
  const [attempt, setAttempt] = useState<any>(null); // { id, deadline, items }
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [result, setResult] = useState<any>(null); // submit response { attempt, items, answers }
  const [practice, setPractice] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get(`/decks/${deckId}`).then((r) => setData({ deck: r.deck, attempts: r.attempts })).catch(() => {});
  }, [deckId]);
  useEffect(() => {
    load();
  }, [load]);

  // abandon any in-flight attempt state when switching decks
  useEffect(() => {
    setPhase('lobby');
    setAttempt(null);
    setResult(null);
    setPractice(false);
  }, [deckId]);

  const settings = data?.deck?.settings ?? {};
  const bank = data?.deck?.items?.items ?? [];
  const assessed =
    settings.shuffle || settings.shuffleOptions || settings.timeLimitSec || settings.attemptLimit || settings.drawCount;
  const finished = (data?.attempts ?? []).filter((a) => a.status !== 'in_progress');
  const attemptsUsed = finished.length;
  const attemptsLeft = settings.attemptLimit ? Math.max(0, settings.attemptLimit - attemptsUsed) : null;

  // ---- runner ----

  const submit = useCallback(
    async (finalAnswers: Record<string, any>, auto = false) => {
      if (!attempt) return;
      try {
        const r = await api.post(`/attempts/${attempt.id}/submit`, { answers: finalAnswers });
        setResult(r);
        setPhase('review');
        load();
      } catch (e: any) {
        // 409 = already submitted/closed: fall back to reading the attempt
        if (e.status === 409) {
          const r = await api.get(`/attempts/${attempt.id}`);
          setResult({ attempt: r.attempt, items: r.attempt.items, answers: r.attempt.answers });
          setPhase('review');
          load();
        } else if (!auto) {
          setError(e.message);
        }
      }
    },
    [attempt, load]
  );

  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (phase !== 'running' || !attempt?.deadline) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [phase, attempt?.deadline]);
  const leftMs = attempt?.deadline ? new Date(attempt.deadline).getTime() - Date.now() : null;
  const expired = phase === 'running' && leftMs !== null && leftMs <= 0;
  const autoSubmitted = useRef(false);
  useEffect(() => {
    if (expired && !autoSubmitted.current) {
      autoSubmitted.current = true;
      submit(answers, true);
    }
  }, [expired, answers, submit]);

  // debounced autosave of answers
  const saveTimer = useRef<any>(null);
  useEffect(() => {
    if (phase !== 'running' || !attempt) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.patch(`/attempts/${attempt.id}`, { answers }).catch(() => {});
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [answers, phase, attempt]);

  const start = async () => {
    setError('');
    try {
      const r = await api.post(`/decks/${deckId}/attempts`);
      autoSubmitted.current = false;
      setAttempt(r.attempt);
      setAnswers({});
      setPhase('running');
    } catch (e: any) {
      setError(e.message);
      load();
    }
  };

  // ---- render ----

  if (!data) return <div className="text-set-dim text-sm p-4">Loading quiz…</div>;

  const fmtClock = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return (h ? `${h}:` : '') + `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  return (
    <div className="space-y-4">
      {error && <div className="set-card p-3 text-sm text-red-300 border-red-500/40">{error}</div>}

      {phase === 'lobby' && !practice && (
        <div className="set-card p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-white flex items-center gap-1.5">
              <ClipboardCheck size={15} /> {assessed ? 'Assessed quiz' : 'Quiz'}
            </h3>
            {assessed && attemptsLeft !== null && (
              <span className="text-xs text-set-dim">{attemptsLeft} of {settings.attemptLimit} attempts left</span>
            )}
          </div>
          {assessed ? (
            <div className="text-sm text-set-dim space-y-1 mb-3">
              <div className="flex items-center gap-3 flex-wrap text-xs">
                {settings.drawCount && bank.length ? <span>{Math.min(settings.drawCount, bank.length)} of {bank.length} questions served</span> : <span>{bank.length} questions</span>}
                {settings.timeLimitSec ? <span className="flex items-center gap-1"><Timer size={12} /> {Math.round(settings.timeLimitSec / 60)} min limit</span> : null}
                {settings.shuffle ? <span>question order shuffled</span> : null}
                {settings.shuffleOptions ? <span>options shuffled</span> : null}
                {settings.attemptLimit ? <span>{settings.attemptLimit} attempts</span> : null}
              </div>
              <p className="text-xs">Answers are checked server-side and graded instantly for multiple choice; open answers go to your teacher for grading.</p>
            </div>
          ) : (
            <p className="text-sm text-set-dim mb-3">
              This deck is set up for practice — instant feedback, unlimited tries, nothing recorded.
              {isEditor && ' Turn on integrity settings below to run it as an assessed quiz.'}
            </p>
          )}
          <div className="flex gap-2 flex-wrap">
            <button
              className="set-btn-primary text-sm"
              onClick={start}
              disabled={attemptsLeft === 0}
            >
              {attemptsLeft === 0 ? 'Attempt limit reached' : assessed ? 'Start attempt' : 'Practice — start'}
            </button>
            <button className="set-btn text-sm" onClick={() => setPractice(true)}>Instant-feedback practice</button>
          </div>
          {(data.attempts ?? []).length > 0 && (
            <div className="mt-4">
              <div className="text-[11px] uppercase text-set-dim font-semibold mb-1.5">My attempts</div>
              {data.attempts.map((a: any) => (
                <div key={a.id} className="flex items-center gap-2 text-sm py-1">
                  <span className="flex-1">{new Date(a.started_at).toLocaleString()}</span>
                  {a.status === 'in_progress' ? (
                    <span className="text-xs text-amber-300">in progress</span>
                  ) : (
                    <>
                      <span className={`font-medium ${Number(a.final_score) / Math.max(1, Number(a.total_points)) >= 0.6 ? 'text-green-300' : 'text-red-300'}`}>
                        {a.final_score == null ? `${a.auto_score}/${a.total_points} — awaiting grading` : `${a.final_score}/${a.total_points}`}
                      </span>
                      {a.late && <span className="text-xs text-red-400">late</span>}
                    </>
                  )}
                  <button
                    className="text-xs text-set-dim hover:text-set-text"
                    onClick={async () => {
                      const r = await api.get(`/attempts/${a.id}`);
                      setResult({ attempt: r.attempt, items: r.attempt.items, answers: r.attempt.answers });
                      setPhase('review');
                    }}
                  >
                    review
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {phase === 'lobby' && practice && (
        <div>
          <button className="text-xs text-set-dim hover:text-set-text mb-2" onClick={() => setPractice(false)}>← back</button>
          <InlineQuiz props={{ title: `${data.deck.title} (practice)`, items: bank }} />
        </div>
      )}

      {phase === 'running' && attempt && (
        <div className="set-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white text-sm">{data.deck.title}</h3>
            {leftMs !== null && (
              <span className={`font-mono text-sm flex items-center gap-1 ${leftMs < 60_000 ? 'text-red-400' : 'text-set-dim'}`}>
                <Hourglass size={13} /> {fmtClock(leftMs)} <span className="hidden sm:inline">left</span>
              </span>
            )}
          </div>
          <div className="space-y-4">
            {attempt.items.map((it: any, i: number) => (
              <div key={i}>
                <div className="text-sm mb-1.5">{i + 1}. {it.question} <span className="text-[10px] text-set-dim">({it.points} pt)</span></div>
                {it.type === 'open' ? (
                  <textarea
                    className="set-input text-sm"
                    rows={3}
                    placeholder="Your answer…"
                    value={answers[String(i)] ?? ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [String(i)]: e.target.value }))}
                  />
                ) : (
                  <div className="grid gap-1">
                    {(it.options ?? []).map((opt: string, j: number) => (
                      <button
                        key={j}
                        className={`text-left text-sm px-2.5 py-1.5 rounded-lg border transition-colors ${
                          answers[String(i)] === j
                            ? 'border-set-accent bg-set-accent/15 text-white'
                            : 'border-set-border hover:border-set-accent/50 hover:bg-set-panel2'
                        }`}
                        onClick={() => setAnswers((a) => ({ ...a, [String(i)]: j }))}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="set-btn-primary text-sm" onClick={async () => { if (await confirmDialog({ title: 'Submit your answers?', confirmLabel: 'Submit' })) submit(answers); }}>
              Submit
            </button>
          </div>
        </div>
      )}

      {phase === 'review' && result && (
        <div className="set-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white text-sm flex items-center gap-1.5"><ListChecks size={15} /> Results</h3>
            <button
              className="set-btn text-xs"
              onClick={() => {
                setPhase('lobby');
                setResult(null);
                load();
              }}
            >
              back to quiz
            </button>
          </div>
          <div className="text-sm mb-3">
            {result.attempt.final_score != null ? (
              <span className="text-lg font-bold text-white">
                {result.attempt.final_score}/{result.attempt.total_points}{' '}
                <span className="text-sm font-normal text-set-dim">
                  ({Math.round((Number(result.attempt.final_score) / Math.max(1, Number(result.attempt.total_points))) * 100)}%)
                </span>
              </span>
            ) : (
              <span className="text-lg font-bold text-white">
                {result.attempt.auto_score}/{result.attempt.total_points}{' '}
                <span className="text-sm font-normal text-amber-300">auto-scored — open answers awaiting grading</span>
              </span>
            )}
            {result.attempt.late && <span className="ml-2 text-xs text-red-400">submitted late</span>}
          </div>
          <div className="space-y-3">
            {(result.items ?? []).map((it: any, i: number) => {
              const ans = result.answers?.[String(i)];
              const correct = it.type !== 'open' && Number(ans) === it.answerIndex;
              return (
                <div key={i} className="border border-set-border rounded-lg p-2.5">
                  <div className="text-sm mb-1">
                    {i + 1}. {it.question}
                    {it.type === 'open' ? (
                      <span className="ml-1.5 text-[10px] uppercase text-amber-300">open — {result.attempt.final_score != null ? 'graded' : 'awaiting grading'}</span>
                    ) : (
                      <span className={`ml-1.5 text-[10px] uppercase ${correct ? 'text-green-400' : 'text-red-400'}`}>{correct ? 'correct' : 'incorrect'}</span>
                    )}
                  </div>
                  <div className="text-xs text-set-dim space-y-0.5">
                    {it.type === 'open' ? (
                      <>
                        <div><span className="text-set-text">Your answer:</span> {String(ans ?? '(blank)')}</div>
                        {it.answerReference && <div><span className="text-set-text">Expected:</span> {it.answerReference}</div>}
                      </>
                    ) : (
                      <>
                        <div><span className="text-set-text">Your answer:</span> {typeof ans === 'number' ? it.options?.[ans] : '(blank)'}</div>
                        <div><span className="text-green-400">Correct:</span> {it.options?.[it.answerIndex]}</div>
                        {it.explanation && <div>{it.explanation}</div>}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isEditor && phase === 'lobby' && !practice && (
        <>
          <QuizSettings deckId={deckId} settings={settings} onChanged={load} />
          <GradingPanel deckId={deckId} />
        </>
      )}
    </div>
  );
}

function QuizSettings({ deckId, settings, onChanged }: { deckId: string; settings: any; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    shuffle: !!settings.shuffle,
    shuffleOptions: !!settings.shuffleOptions,
    minutes: settings.timeLimitSec ? String(Math.round(settings.timeLimitSec / 60)) : '',
    attemptLimit: settings.attemptLimit ? String(settings.attemptLimit) : '',
    drawCount: settings.drawCount ? String(settings.drawCount) : '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      shuffle: !!settings.shuffle,
      shuffleOptions: !!settings.shuffleOptions,
      minutes: settings.timeLimitSec ? String(Math.round(settings.timeLimitSec / 60)) : '',
      attemptLimit: settings.attemptLimit ? String(settings.attemptLimit) : '',
      drawCount: settings.drawCount ? String(settings.drawCount) : '',
    });
  }, [settings]);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/decks/${deckId}/settings`, {
        shuffle: form.shuffle,
        shuffleOptions: form.shuffleOptions,
        timeLimitSec: form.minutes ? Math.max(1, Math.round(Number(form.minutes) * 60)) : null,
        attemptLimit: form.attemptLimit ? Math.max(1, Number(form.attemptLimit)) : null,
        drawCount: form.drawCount ? Math.max(1, Number(form.drawCount)) : null,
      });
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="set-card p-4">
      <button className="flex items-center gap-1.5 text-sm font-semibold text-white" onClick={() => setOpen((o) => !o)}>
        <Settings2 size={14} /> Quiz settings {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="mt-3 space-y-2.5 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.shuffle} onChange={(e) => setForm((f) => ({ ...f, shuffle: e.target.checked }))} />
            Shuffle question order
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.shuffleOptions} onChange={(e) => setForm((f) => ({ ...f, shuffleOptions: e.target.checked }))} />
            Shuffle answer options
          </label>
          <div className="flex gap-2 flex-wrap">
            <label className="flex items-center gap-2">
              Time limit (min)
              <input className="set-input w-20" type="number" min={1} value={form.minutes} onChange={(e) => setForm((f) => ({ ...f, minutes: e.target.value }))} placeholder="none" />
            </label>
            <label className="flex items-center gap-2">
              Attempt limit
              <input className="set-input w-20" type="number" min={1} value={form.attemptLimit} onChange={(e) => setForm((f) => ({ ...f, attemptLimit: e.target.value }))} placeholder="∞" />
            </label>
            <label className="flex items-center gap-2">
              Serve N questions
              <input className="set-input w-20" type="number" min={1} value={form.drawCount} onChange={(e) => setForm((f) => ({ ...f, drawCount: e.target.value }))} placeholder="all" />
            </label>
          </div>
          <p className="text-xs text-set-dim">Serving fewer questions than the deck holds turns it into a question bank — each student draws a random subset.</p>
          <button className="set-btn-primary text-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
        </div>
      )}
    </div>
  );
}

function GradingPanel({ deckId }: { deckId: string }) {
  const [attempts, setAttempts] = useState<any[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [grades, setGrades] = useState<Record<number, { score: string; feedback: string }>>({});
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/decks/${deckId}/attempts`).then((r) => setAttempts(r.attempts)).catch(() => {});
  useEffect(() => {
    load();
  }, [deckId]);

  const open = async (a: any) => {
    if (openId === a.id) return setOpenId(null);
    setOpenId(a.id);
    setGrades({});
    const r = await api.get(`/attempts/${a.id}`);
    const g: Record<number, { score: string; feedback: string }> = {};
    (r.attempt.items ?? []).forEach((it: any, i: number) => {
      if (it.type === 'open') {
        const prev = (r.attempt.manual ?? []).find((m: any) => m.index === i);
        g[i] = { score: prev ? String(prev.score) : '', feedback: prev?.feedback ?? '' };
      }
    });
    setGrades(g);
  };

  const saveGrades = async (a: any) => {
    setBusy(true);
    try {
      await api.post(`/attempts/${a.id}/grade`, {
        grades: Object.entries(grades).map(([i, g]) => ({ index: Number(i), score: Number(g.score || 0), feedback: g.feedback || undefined })),
      });
      setOpenId(null);
      load();
    } finally {
      setBusy(false);
    }
  };

  const pending = attempts.filter((a) => a.status === 'submitted').length;

  return (
    <div className="set-card p-4">
      <h3 className="font-semibold text-white text-sm flex items-center gap-1.5 mb-2">
        <GraduationCap size={14} /> Grading {pending > 0 && <span className="text-xs text-amber-300">({pending} awaiting)</span>}
      </h3>
      {attempts.length === 0 && <p className="text-sm text-set-dim">No attempts yet.</p>}
      <div className="space-y-1">
        {attempts.map((a) => (
          <div key={a.id}>
            <button
              className="w-full flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-set-panel2 text-left"
              onClick={() => open(a)}
            >
              <span className="flex-1 truncate">{a.user_name}</span>
              <span className={`text-xs ${a.status === 'submitted' ? 'text-amber-300' : 'text-set-dim'}`}>
                {a.status === 'in_progress' ? 'in progress' : a.final_score == null ? `${a.auto_score}/${a.total_points} — open answers` : `${a.final_score}/${a.total_points}`}
              </span>
              {a.late && <span className="text-[10px] text-red-400">late</span>}
            </button>
            {openId === a.id && (
              <AttemptGrader attemptId={a.id} grades={grades} setGrades={setGrades} onSave={() => saveGrades(a)} busy={busy} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AttemptGrader({
  attemptId,
  grades,
  setGrades,
  onSave,
  busy,
}: {
  attemptId: string;
  grades: Record<number, { score: string; feedback: string }>;
  setGrades: (g: Record<number, { score: string; feedback: string }>) => void;
  onSave: () => void;
  busy: boolean;
}) {
  const [detail, setDetail] = useState<any>(null);
  useEffect(() => {
    api.get(`/attempts/${attemptId}`).then((r) => setDetail(r.attempt)).catch(() => {});
  }, [attemptId]);
  if (!detail) return <div className="text-xs text-set-dim px-2 py-1">loading…</div>;
  const items: any[] = detail.items ?? [];
  const answers: any = detail.answers ?? {};
  return (
    <div className="border border-set-border rounded-lg p-3 mb-2 space-y-3">
      {items.map((it, i) => (
        <div key={i} className="text-sm">
          <div className="mb-1">{i + 1}. {it.question} <span className="text-[10px] text-set-dim">({it.points} pt)</span></div>
          {it.type === 'open' ? (
            <div className="space-y-1.5">
              <div className="text-xs bg-set-panel2 rounded p-2 text-set-dim">{String(answers[String(i)] ?? '(blank)')}</div>
              {it.answerReference && <div className="text-xs text-set-dim">Expected: {it.answerReference}</div>}
              <div className="flex gap-2 items-center">
                <input
                  className="set-input w-20"
                  type="number"
                  min={0}
                  max={it.points}
                  step="0.5"
                  placeholder={`0–${it.points}`}
                  value={grades[i]?.score ?? ''}
                  onChange={(e) => setGrades({ ...grades, [i]: { score: e.target.value, feedback: grades[i]?.feedback ?? '' } })}
                />
                <input
                  className="set-input flex-1 text-xs"
                  placeholder="Feedback (optional)"
                  value={grades[i]?.feedback ?? ''}
                  onChange={(e) => setGrades({ ...grades, [i]: { score: grades[i]?.score ?? '', feedback: e.target.value } })}
                />
              </div>
            </div>
          ) : (
            <div className={`text-xs ${Number(answers[String(i)]) === it.answerIndex ? 'text-green-400' : 'text-red-400'}`}>
              {typeof answers[String(i)] === 'number' ? it.options?.[answers[String(i)]] : '(blank)'} → {it.options?.[it.answerIndex]}
            </div>
          )}
        </div>
      ))}
      <div className="flex justify-end">
        <button className="set-btn-primary text-xs" onClick={onSave} disabled={busy}>
          {busy ? 'Saving…' : 'Save grades'}
        </button>
      </div>
    </div>
  );
}
