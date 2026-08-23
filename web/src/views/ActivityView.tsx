import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import {
  Activity as ActivityIcon, FileText, MessageSquare, Users, BookOpen, Boxes, GraduationCap, UserPlus,
} from 'lucide-react';

const ICONS: Record<string, any> = {
  page_created: FileText,
  page_updated: FileText,
  comment: MessageSquare,
  mention: MessageSquare,
  assigned: GraduationCap,
  source_added: BookOpen,
  member_joined: UserPlus,
  model_added: Boxes,
};

function describe(a: any): string {
  const p = a.payload ?? {};
  switch (a.type) {
    case 'page_created': return `created the page "${p.title}"`;
    case 'page_updated': return `updated "${p.title}"`;
    case 'comment': return `commented on "${p.pageTitle}"`;
    case 'assigned': return `assigned ${p.assignees} member(s) to "${p.title}"${p.dueDate ? ` (due ${String(p.dueDate).slice(0, 10)})` : ''}`;
    case 'source_added': return `added ${p.count} source(s) to a notebook${p.names?.length ? `: ${p.names.join(', ')}` : ''}`;
    case 'member_joined': return `invited ${p.email} as ${p.role}`;
    case 'model_added': return `added a 3D model "${p.name}"`;
    default: return a.type;
  }
}

/** Per-space activity feed: who did what, when. */
export default function ActivityView() {
  const { spaceId } = useParams();
  const [items, setItems] = useState<any[] | null>(null);

  useEffect(() => {
    if (!spaceId) return;
    api.get(`/spaces/${spaceId}/activity?limit=100`).then((r) => setItems(r.activities)).catch(() => setItems([]));
  }, [spaceId]);

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1 flex items-center gap-2"><ActivityIcon size={22} /> Activity</h1>
      <p className="text-set-dim text-sm mb-6">Everything that happened in this space.</p>
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
