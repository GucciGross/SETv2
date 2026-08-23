import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Plus } from 'lucide-react';

export default function ModelsView() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const [models, setModels] = useState<any[]>([]);

  const load = async () => {
    if (!spaceId) return;
    setModels((await api.get(`/spaces/${spaceId}/models`)).models);
  };
  useEffect(() => {
    load();
  }, [spaceId]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1"> 3D Models</h1>
      <p className="text-set-dim text-sm mb-5">
        Interactive 3D learning environments — upload GLB/GLTF or URDF (robotics). Explode assemblies, click parts to see linked notes, animate joints, and ask the AI about any component.
      </p>
      <label className="set-btn cursor-pointer inline-flex items-center gap-1.5 mb-5">
        <Plus size={14} /> Upload model (.glb / .gltf / .urdf / .stl / .obj / .step)
        <input
          type="file"
          accept=".glb,.gltf,.urdf,.xml,.stl,.obj,.step,.stp"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f || !spaceId) return;
            await api.upload(`/spaces/${spaceId}/models`, [f]);
            load();
          }}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        {models.map((m) => (
          <button key={m.id} className="set-card p-4 text-left hover:border-set-accent/40" onClick={() => navigate(`/app/space/${spaceId}/model/${m.id}`)}>
            <div className="text-3xl mb-2">{m.kind === 'urdf' ? '' : ''}</div>
            <div className="font-semibold text-white">{m.name}</div>
            <div className="text-xs text-set-dim mt-0.5">
              {m.kind} · {(m.file_size / 1024).toFixed(0)} KB · {(m.parts?.links?.length ?? m.parts?.length ?? 0)} parts
            </div>
          </button>
        ))}
        {models.length === 0 && <p className="text-sm text-set-dim">No models yet. Try a URDF robot arm or any GLB from your library.</p>}
      </div>
    </div>
  );
}
