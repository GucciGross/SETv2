import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Plus, FolderPlus } from 'lucide-react';

export default function NotebookList() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const [notebooks, setNotebooks] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState('');

  const load = async () => {
    if (!spaceId) return;
    setNotebooks((await api.get(`/spaces/${spaceId}/notebooks`)).notebooks);
    setSubjects((await api.get(`/spaces/${spaceId}/subjects`)).subjects);
  };
  useEffect(() => {
    load();
  }, [spaceId]);

  const newSubject = async () => {
    const t = window.prompt('Subject name (e.g. BIO 201, Thesis, Spanish)');
    if (!t?.trim() || !spaceId) return;
    await api.post(`/spaces/${spaceId}/subjects`, { title: t.trim() });
    load();
  };

  const bySubject = (sid: string) => notebooks.filter((n) => n.subject_id === sid);
  const unfiled = notebooks.filter((n) => !n.subject_id || !subjects.some((s) => s.id === n.subject_id));

  const card = (n: any) => (
    <div
      key={n.id}
      role="button"
      tabIndex={0}
      className="set-card p-4 text-left hover:border-set-accent/40 transition-colors cursor-pointer"
      onClick={() => navigate(`/app/space/${spaceId}/notebook/${n.id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/app/space/${spaceId}/notebook/${n.id}`); }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-white truncate">{n.title}</span>
        <span className="text-xs text-set-dim shrink-0">{n.source_count} sources · {n.chunk_count} chunks</span>
      </div>
      {n.description && <p className="text-sm text-set-dim mt-1">{n.description}</p>}
      {subjects.length > 0 && (
        <select
          className="set-input text-xs mt-2 w-40"
          value={n.subject_id ?? ''}
          onClick={(e) => e.stopPropagation()}
          onChange={async (e) => {
            e.stopPropagation();
            const sid = e.target.value || null;
            await api.patch(`/notebooks/${n.id}`, { subjectId: sid }).catch(() => {});
            load();
          }}
        >
          <option value="">No subject</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
      )}
    </div>
  );

  const subjectSection = (s: any) => {
    const list = bySubject(s.id);
    return (
      <div key={s.id} className="mb-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
          <h2 className="text-sm font-semibold text-white">{s.title}</h2>
          <span className="text-xs text-set-dim">{list.length}</span>
        </div>
        <div className="grid gap-3">{list.map(card)}</div>
      </div>
    );
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">Subjects & notebooks</h1>
      <p className="text-set-dim text-sm mb-5">
        A subject is a class or topic — its notebooks hold sources, transcripts and study material. Upload PDFs, Markdown, web pages or recordings, then chat with citations, generate flashcards and study.
      </p>
      <form
        className="flex flex-wrap gap-2 mb-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim() || !spaceId) return;
          const { notebook } = await api.post(`/spaces/${spaceId}/notebooks`, { title, subjectId: subjectId || undefined });
          setTitle('');
          navigate(`/app/space/${spaceId}/notebook/${notebook.id}`);
        }}
      >
        <input className="set-input flex-1 min-w-40" placeholder="New notebook title…" value={title} onChange={(e) => setTitle(e.target.value)} />
        {subjects.length > 0 && (
          <select className="set-input w-44" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">No subject</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        )}
        <button className="set-btn-primary flex items-center gap-1"><Plus size={14} /> Create</button>
        <button type="button" className="set-btn flex items-center gap-1" onClick={newSubject}>
          <FolderPlus size={14} /> New subject
        </button>
      </form>
      {subjects.map(subjectSection)}
      {(subjects.length > 0 && unfiled.length > 0) && (
        <div className="mb-5">
          <h2 className="text-xs set-mono text-set-dim/70 mb-2">UNFILED</h2>
          <div className="grid gap-3">{unfiled.map(card)}</div>
        </div>
      )}
      {subjects.length === 0 && <div className="grid gap-3">{unfiled.map(card)}</div>}
      {notebooks.length === 0 && <p className="text-set-dim text-sm">No notebooks yet — create your first one above, or hit Record in the sidebar.</p>}
    </div>
  );
}
