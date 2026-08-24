import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Bell, Users, CalendarClock, MessageSquare, CheckCheck } from 'lucide-react';
import { api } from '../lib/api';

interface Notif {
  id: string;
  type: string;
  payload: any;
  spaceName: string;
  read: boolean;
  createdAt: string;
  synthesized: boolean;
}

const ICONS: Record<string, any> = {
  assigned: Users,
  due_soon: CalendarClock,
  comment: MessageSquare,
};

export default function Notifications() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const load = () =>
      api.get('/notifications').then((r) => {
        setItems(r.notifications ?? []);
        setUnread(r.unread ?? 0);
      }).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const markAll = async () => {
    await api.post('/notifications/read').catch(() => {});
    setUnread(0);
    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
  };

  const openTarget = (n: Notif) => {
    if (!spaceId) return;
    if (n.type === 'assigned' || n.type === 'due_soon') navigate(`/app/space/${spaceId}/paths`);
    else if (n.type === 'comment' && n.payload?.pageId) navigate(`/app/space/${spaceId}/page/${n.payload.pageId}`);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        className="set-btn-ghost p-1.5 relative"
        title="Notifications"
        aria-label="Notifications"
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-0.5">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="set-card p-2 max-h-96 overflow-auto fadein shadow-2xl max-md:fixed max-md:left-3 max-md:right-3 max-md:top-14 max-md:z-[70] md:absolute md:right-0 md:top-9 md:z-[70] md:w-80">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs font-semibold uppercase text-set-dim">Notifications</span>
            {unread > 0 && (
              <button className="set-btn-ghost text-[10px] flex items-center gap-1" onClick={markAll}>
                <CheckCheck size={11} /> mark read
              </button>
            )}
          </div>
          {items.length === 0 && <div className="text-xs text-set-dim p-3">Nothing yet — assignments and activity show up here.</div>}
          {items.map((n) => {
            const Icon = ICONS[n.type] ?? Bell;
            const label =
              n.type === 'assigned'
                ? `${n.payload?.fromName ?? 'Someone'} assigned you "${n.payload?.title}"`
                : n.type === 'due_soon'
                  ? `Due soon: "${n.payload?.title}" (${n.payload?.done ?? 0}/${n.payload?.total ?? '?'} done)`
                  : `${n.payload?.fromName ?? 'Someone'} commented on "${n.payload?.pageTitle ?? 'a page'}"`;
            const sub =
              n.type === 'due_soon'
                ? `due ${n.payload?.dueDate ? new Date(n.payload.dueDate).toLocaleDateString() : ''}`
                : n.payload?.dueDate && n.type === 'assigned'
                  ? `due ${new Date(n.payload.dueDate).toLocaleDateString()}`
                  : n.spaceName;
            return (
              <button
                key={n.id}
                className={`w-full flex items-start gap-2 px-2 py-2 rounded-md text-left hover:bg-set-panel2 ${!n.read ? 'bg-set-accent/10' : ''}`}
                onClick={() => openTarget(n)}
              >
                <Icon size={14} className="mt-0.5 shrink-0 text-set-dim" />
                <span className="flex-1 min-w-0">
                  <span className="block text-xs text-set-text leading-snug">{label}</span>
                  <span className="block text-[10px] text-set-dim">{sub}</span>
                </span>
                {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-set-accent mt-1 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
