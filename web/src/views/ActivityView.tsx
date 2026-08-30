import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import {
  Activity as ActivityIcon, FileText, MessageSquare, Users, BookOpen, Boxes, GraduationCap, UserPlus,
  Share2, Ban, Scissors, Download, ClipboardList, RotateCcw, Shield, Copy,
} from 'lucide-react';

const ICONS: Record<string, any> = {
  page_created: FileText,
  page_updated: FileText,
  page_restored: RotateCcw,
  comment: MessageSquare,
  mention: MessageSquare,
  assigned: GraduationCap,
  source_added: BookOpen,
  member_joined: UserPlus,
  member_role_changed: Shield,
  model_added: Boxes,
  share_created: Share2,
  share_revoked: Ban,
  web_clipped: Scissors,
  gradebook_exported: ClipboardList,
  path_cloned: Copy,
  roster_imported: UserPlus,
};

const FILTERS: [string, string][] = [
  ['' , 'All events'],
  ['page_created', 'Pages created'],
  ['page_restored', 'Restores'],
  ['comment', 'Comments'],
  ['assigned', 'Assignments'],
  ['source_added', 'Sources'],
  ['web_clipped', 'Web clips'],
  ['member_joined', 'Members invited'],
  ['member_role_changed', 'Role changes'],
  ['share_created', 'Links published'],
  ['share_revoked', 'Links revoked'],
  ['gradebook_exported', 'Gradebook exports'],
];

function describe(a: any): string {
  const p = a.payload ?? {};
  switch (a.type) {
    case 'page_created': return `created the page "${p.title}"`;
    case 'page_updated': return `updated "${p.title}"`;
    case 'page_restored': return `restored an older version of "${p.title ?? 'a page'}"`;
    case 'comment': return `commented on "${p.pageTitle}"`;
    case 'assigned': return `assigned ${p.assignees} member(s) to "${p.title}"${p.dueDate ? ` (due ${String(p.dueDate).slice(0, 10)})` : ''}`;
    case 'source_added': return `added ${p.count} source(s) to a notebook${p.names?.length ? `: ${p.names.join(', ')}` : ''}`;
    case 'member_joined': return `invited ${p.email} as ${p.role}`;
    case 'member_role_changed': return `changed ${p.email}'s role to ${p.role}`;
    case 'model_added': return `added a 3D model "${p.name}"`;
    case 'share_created': return `published "${p.title}" to a public link`;
    case 'share_revoked': return `revoked the public link for "${p.title}"`;
    case 'web_clipped': return `clipped "${p.title}" from the web`;
    case 'gradebook_exported': return `exported the gradebook (${p.members} members, ${p.decks} quizzes, ${p.paths} paths)`;
    case 'path_cloned': return `cloned the learning path "${p.title}"`;
    case 'roster_imported': return `imported a roster (${p.added} added, ${p.invited} invited, ${p.already ?? 0} already members)`;
    default: return a.type;
  }
}

/** Per-space activity feed + audit trail: who did what, when — filterable, exportable. */
export default function ActivityView() {
  const { spaceId } = useParams();
  const [items, setItems] = useState<any[] | null>(null);
  const [type, setType] = useState('');

  useEffect(() => {
    if (!spaceId) return;
    setItems(null);
    api.get(`/spaces/${spaceId}/activity?limit=100${type ? `&type=${type}` : ''}`)
      .then((r) => setItems(r.activities))
      .catch(() => setItems([]));
  }, [spaceId, type]);

  const exportCsv = async () => {
    if (!spaceId) return;
    const res = await api.raw(`/spaces/${spaceId}/activity.csv`);
    if (!res.ok) return alert('Export failed');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'activity.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1 flex items-center gap-2"><ActivityIcon size={22} /> Activity</h1>
      <p className="text-set-dim text-sm mb-4">Everything that happened in this space — the audit trail.</p>
      <div className="flex items-center gap-2 mb-6">
        <select className="set-input text-sm flex-1" value={type} onChange={(e) => setType(e.target.value)}>
          {FILTERS.map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <button className="set-btn text-sm flex items-center gap-1.5" onClick={exportCsv}>
          <Download size={13} /> CSV
        </button>
      </div>
      {!items && <p className="text-set-dim text-sm">Loading…</p>}
      {items?.length === 0 && <p className="text-set-dim text-sm set-card p-4">No activity yet — start writing, commenting or assigning.</p>}
      <div className="space-y-2">
        {items?.map((a) => {
          const Icon = ICONS[a.type] ?? ActivityIcon;
          return (
            <div key={a.id} className="set-card p-3 flex items-start gap-3">
              <span className="w-7 h-7 rounded-full bg-set-panel2 border border-set-border flex items-center justify-center text-set-dim shrink-0">
                <Icon size={13} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm">
                  <span className="text-white font-medium">{a.actor_name}</span> <span className="text-set-dim">{describe(a)}</span>
                </div>
                <div className="text-[11px] text-set-dim mt-0.5">{new Date(a.created_at).toLocaleString()}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
