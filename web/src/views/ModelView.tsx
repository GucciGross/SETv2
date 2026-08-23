import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../stores/app';
import Viewer3D from '../components/Viewer3D';
import { Wand2, Save } from 'lucide-react';

export default function ModelView() {
  const { spaceId, modelId } = useParams();
  const navigate = useNavigate();
  const { pages } = useApp();
  const [model, setModel] = useState<any>(null);
  const [editParts, setEditParts] = useState<any[] | null>(null);

  useEffect(() => {
    if (!modelId) return;
    api.get(`/models/${modelId}`).then((r) => setModel(r.model));
  }, [modelId]);

  if (!model) return <div className="p-8 text-set-dim">Loading 3D model…</div>;

  // URDF models keep {links, joints}; expose links as editable parts
  const editableParts: any[] =
    model.parts?.links
      ? model.parts.links.map((l: any) => ({ node: l.name, name: l.name, linkedPageId: (l as any).linkedPageId ?? null }))
      : (model.parts ?? []);

  const saveParts = async (parts: any[]) => {
    const full = model.parts?.links
      ? { ...model.parts, links: model.parts.links.map((l: any) => ({ ...l, linkedPageId: parts.find((p) => p.node === l.name)?.linkedPageId ?? null })) }
      : parts;
    await api.patch(`/models/${model.id}`, { parts: full });
    setModel({ ...model, parts: full });
    setEditParts(null);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-set-border flex items-center gap-3">
        <span className="text-xl">{model.kind === 'urdf' ? '' : ''}</span>
        <input
          className="text-lg font-semibold bg-transparent outline-none text-white"
          value={model.name}
          onChange={(e) => setModel({ ...model, name: e.target.value })}
          onBlur={() => api.patch(`/models/${model.id}`, { name: model.name })}
        />
        <button className="set-btn ml-auto flex items-center gap-1 text-xs" onClick={async () => {
          const r = await api.post(`/models/${model.id}/autolink`);
          setModel({ ...model, parts: r.parts });
        }}>
          <Wand2 size={13} /> Auto-link parts to pages
        </button>
        <button className="set-btn flex items-center gap-1 text-xs" onClick={() => setEditParts(editableParts)}>
          <Save size={13} /> Link parts manually
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <Viewer3D model={model} onPartLink={(pageId) => navigate(`/app/space/${spaceId}/page/${pageId}`)} />
      </div>

      {editParts && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setEditParts(null)}>
          <div className="set-card p-5 w-[440px] max-h-[70vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-white mb-3"> Link parts to workspace pages</h3>
            <div className="space-y-2">
              {editParts.map((p, i) => (
                <label key={p.node} className="flex items-center gap-2 text-sm">
                  <span className="w-36 truncate">{p.name ?? p.node}</span>
                  <select
                    className="set-input flex-1"
                    value={p.linkedPageId ?? ''}
                    onChange={(e) => setEditParts(editParts.map((x, j) => (j === i ? { ...x, linkedPageId: e.target.value || null } : x)))}
                  >
                    <option value="">— none —</option>
                    {pages.map((pg) => (
                      <option key={pg.id} value={pg.id}>{pg.title}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button className="set-btn-primary mt-4" onClick={() => saveParts(editParts)}>Save links</button>
          </div>
        </div>
      )}
    </div>
  );
}
