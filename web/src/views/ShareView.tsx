import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { marked } from 'marked';
import { Compass } from 'lucide-react';
import { api } from '../lib/api';

/**
 * Public read-only page for a share link — no account required.
 * Renders exactly the title + markdown the server returns for the token.
 */

const md = (s: string) => ({ __html: marked.parse(s ?? '', { async: false }) as string });

export default function ShareView() {
  const { token } = useParams();
  const [page, setPage] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    api.get(`/share/${token}`)
      .then((r) => setPage(r.page))
      .catch((e) => setError(e.message));
  }, [token]);

  if (error) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3 text-center p-6">
        <Compass size={40} className="text-set-accent" strokeWidth={1.5} />
        <h1 className="text-lg font-bold text-white">This link isn't available</h1>
        <p className="text-sm text-set-dim max-w-xs">{error}</p>
      </div>
    );
  }
  if (!page) return <div className="h-screen flex items-center justify-center text-set-dim">Loading…</div>;

  return (
    <div className="min-h-screen bg-set-bg">
      <div className="max-w-3xl mx-auto px-4 sm:px-8 py-10">
        <div className="flex items-start gap-3 mb-6">
          <span className="text-4xl">{page.icon ?? ''}</span>
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-white">{page.title}</h1>
            <div className="text-xs text-set-dim mt-1">
              shared read-only · updated {new Date(page.updated_at).toLocaleDateString()}
            </div>
          </div>
        </div>
        <div className="set-card p-6">
          <div className="prose-set max-w-none" dangerouslySetInnerHTML={md(page.markdown)} />
        </div>
        <div className="text-center mt-8 text-xs text-set-dim">
          Published with <Link to="/" className="text-set-accent hover:underline">SET</Link> — the Knowledge + Learning OS
        </div>
      </div>
    </div>
  );
}
