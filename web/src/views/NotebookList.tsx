import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Plus } from 'lucide-react';

export default function NotebookList() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const [notebooks, setNotebooks] = useState<any[]>([]);
  const [title, setTitle] = useState('');

  const load = async () => {
    if (!spaceId) return;
    setNotebooks((await api.get(`/spaces/${spaceId}/notebooks`)).notebooks);
  };
  useEffect(() => {
    load();
  }, [spaceId]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1"> Research Notebooks</h1>
      <p className="text-set-dim text-sm mb-5">Source-grounded AI research — upload PDFs, Markdown, web pages or transcripts, then chat with citations, generate study material and browse knowledge views.</p>
      <form
        className="flex gap-2 mb-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim() || !spaceId) return;
          const { notebook } = await api.post(`/spaces/${spaceId}/notebooks`, { title });
          setTitle('');
          navigate(`/app/space/${spaceId}/notebook/${notebook.id}`);
        }}
      >
        <input className="set-input" placeholder="New notebook title…" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="set-btn-primary flex items-center gap-1"><Plus size={14} /> Create</button>
      </form>
      <div className="grid gap-3">
        {notebooks.map((n) => (
          <button
            key={n.id}
            className="set-card p-4 text-left hover:border-set-accent/40 transition-colors"
            onClick={() => navigate(`/app/space/${spaceId}/notebook/${n.id}`)}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white">{n.title}</span>
              <span className="text-xs text-set-dim">{n.source_count} sources · {n.chunk_count} chunks</span>
            </div>
            {n.description && <p className="text-sm text-set-dim mt-1">{n.description}</p>}
          </button>
        ))}
        {notebooks.length === 0 && <p className="text-set-dim text-sm">No notebooks yet — create your first one above.</p>}
      </div>
    </div>
  );
}
