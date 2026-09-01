import { useEffect, useState } from 'react';
import { confirmDialog } from './Confirm';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Sparkles, Plus, Trash2, Power, FileText } from 'lucide-react';

/** Settings → Skills: manage copilot capability documents (SKILL.md-style). */
export default function SkillsSettings() {
  const { spaceId } = useParams();
  const [skills, setSkills] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', content: '' });

  const load = async () => {
    if (!spaceId) return;
    const r = await api.get(`/spaces/${spaceId}/skills`).catch(() => ({ skills: [] }));
    setSkills(r.skills ?? []);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [spaceId]);

  const save = async () => {
    if (!form.name.trim() || !form.content.trim()) return;
    if (editing) {
      await api.patch(`/skills/${editing.id}`, form);
    } else {
      await api.post(`/spaces/${spaceId}/skills`, form);
    }
    setCreating(false); setEditing(null); setForm({ name: '', description: '', content: '' });
    load();
  };

  const toggle = async (s: any) => {
    await api.patch(`/skills/${s.id}`, { active: !s.active });
    load();
  };

  return (
    <div>
      <p className="text-sm text-set-dim mb-4">
        Skills are SKILL.md-style documents that extend your copilot with specialized behavior.
        Active skills are injected into the agent's instructions on every run.
        <span className="block mt-1 text-xs">Format: a name (kebab-case), a short description, and instructions the agent follows when relevant.</span>
      </p>
      <button className="set-btn mb-4 flex items-center gap-1.5 text-xs" onClick={() => { setCreating(true); setEditing(null); setForm({ name: '', description: '', content: '# My Skill\n\n## When to use\n...\n\n## Instructions\n- ...' }); }}>
        <Plus size={13} /> New skill
      </button>

      {(creating || editing) && (
        <div className="set-card p-4 mb-4 space-y-3">
          <input className="set-input font-mono text-sm" placeholder="skill-name (kebab-case)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={!!editing?.built_in} maxLength={60} />
          <input className="set-input text-sm" placeholder="Short description shown in the list" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={200} />
          <textarea className="set-input h-56 font-mono text-xs resize-y" placeholder="# Skill instructions..." value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
          <div className="flex gap-2">
            <button className="set-btn-primary text-xs" onClick={save} disabled={!form.name.trim() || !form.content.trim()}>Save skill</button>
            <button className="set-btn text-xs" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {skills.map((s) => (
          <div key={s.id} className={`set-card p-3 flex items-start gap-3 ${!s.active ? 'opacity-50' : ''}`}>
            <span className={`w-2 h-2 rounded-full mt-2 shrink-0 ${s.active ? 'bg-green-400' : 'bg-set-dim'}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-white">{s.name}</span>
                {s.built_in && <span className="text-[9px] uppercase text-blue-300 border border-set-accent/40 rounded-full px-1.5 py-0.5">built-in</span>}
              </div>
              <div className="text-xs text-set-dim mt-0.5">{s.description}</div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button className="set-btn-ghost p-1.5" title={s.active ? 'Deactivate' : 'Activate'} onClick={() => toggle(s)}>
                <Power size={13} className={s.active ? 'text-green-400' : 'text-set-dim'} />
              </button>
              <button className="set-btn-ghost p-1.5" title="Edit" onClick={() => {
                setEditing(s); setCreating(false);
                api.get(`/skills/${s.id}`).then((r) => setForm({ name: r.skill.name, description: r.skill.description, content: r.skill.content }));
              }}>
                <FileText size={13} />
              </button>
              {!s.built_in && (
                <button className="set-btn-ghost p-1.5 hover:text-red-400" title="Delete" onClick={async () => {
                  if (!(await confirmDialog({ title: `Delete skill "${s.name}"?`, danger: true, confirmLabel: 'Delete' }))) return;
                  await api.del(`/skills/${s.id}`);
                  load();
                }}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
        ))}
        {skills.length === 0 && !creating && (
          <p className="text-sm text-set-dim set-card p-4">No skills yet — create one to give your copilot specialized behavior.</p>
        )}
      </div>
    </div>
  );
}
