import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Plus, Trash2 } from 'lucide-react';

/** Databases: table / kanban / calendar / gallery views. */

const OPTION_COLORS: Record<string, string> = {
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  blue: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  green: 'bg-green-500/15 text-green-300 border-green-500/30',
  red: 'bg-red-500/15 text-red-300 border-red-500/30',
  violet: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  grey: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
};
const colorFor = (c?: string) => OPTION_COLORS[c ?? 'grey'] ?? OPTION_COLORS.grey;

interface Column { id: string; name: string; type: string; config?: { options?: { value: string; color?: string }[] } }

export default function DatabaseView() {
  const { spaceId, dbId } = useParams();
  const navigate = useNavigate();
  const [db, setDb] = useState<any>(null);
  const [views, setViews] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [viewId, setViewId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!dbId) return;
    const r = await api.get(`/databases/${dbId}`);
    setDb(r.database);
    setViews(r.views);
    setRows(r.rows);
    setViewId((v) => v ?? r.views[0]?.id ?? null);
  }, [dbId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(load, 4000); // light live-sync until ws db events land in UI store
    return () => clearInterval(t);
  }, [load]);

  if (!db) return <div className="p-8 text-set-dim">Loading database…</div>;

  const columns: Column[] = db.schema ?? [];
  const view = views.find((v) => v.id === viewId) ?? views[0];
  const viewConfig = view?.config ?? {};

  const setCell = async (rowId: string, colId: string, value: any) => {
    setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: value } } : r)));
    await api.patch(`/rows/${rowId}`, { cells: { [colId]: value } });
  };

  const addRow = async () => {
    await api.post(`/databases/${db.id}/rows`, { title: 'New item' });
    load();
  };

  const removeRow = async (rowId: string) => {
    if (!confirm('Delete this row (and its page)?')) return;
    await api.del(`/rows/${rowId}`);
    load();
  };

  const CellEditor = ({ row, col }: { row: any; col: Column }) => {
    const value = row.cells?.[col.id];
    switch (col.type) {
      case 'checkbox':
        return (
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => setCell(row.id, col.id, e.target.checked)}
            className="accent-set-accent"
          />
        );
      case 'select':
        return (
          <select
            className="bg-transparent text-xs outline-none cursor-pointer"
            value={value ?? ''}
            onChange={(e) => setCell(row.id, col.id, e.target.value)}
          >
            <option value="">—</option>
            {(col.config?.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>{o.value}</option>
            ))}
          </select>
        );
      case 'date':
        return (
          <input
            type="date"
            className="bg-transparent text-xs outline-none"
            value={value ?? ''}
            onChange={(e) => setCell(row.id, col.id, e.target.value)}
          />
        );
      case 'number':
        return (
          <input
            type="number"
            className="bg-transparent text-xs outline-none w-20"
            value={value ?? ''}
            onChange={(e) => setCell(row.id, col.id, e.target.value === '' ? null : Number(e.target.value))}
          />
        );
      default:
        return (
          <input
            className="bg-transparent text-sm outline-none w-full focus:bg-set-panel2 rounded px-1"
            value={value ?? ''}
            placeholder="Empty"
            onChange={(e) => setCell(row.id, col.id, e.target.value)}
          />
        );
    }
  };

  const SelectChip = ({ value, col }: { value: any; col: Column }) => {
    const opt = (col.config?.options ?? []).find((o) => o.value === value);
    return <span className={`set-chip ${colorFor(opt?.color)}`}>{value ?? '—'}</span>;
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 sm:p-4 border-b border-set-border flex flex-wrap items-center gap-2 sm:gap-3">
        <span className="text-2xl">{db.icon}</span>
        <input
          className="text-xl font-semibold bg-transparent outline-none text-white"
          value={db.name}
          onChange={(e) => setDb({ ...db, name: e.target.value })}
          onBlur={async () => {
            await api.patch(`/databases/${db.id}`, { name: db.name });
          }}
        />
        <div className="ml-4 flex gap-1">
          {views.map((v) => (
            <button
              key={v.id}
              className={`px-2.5 py-1 rounded-md text-sm ${viewId === v.id ? 'bg-set-accent/20 text-blue-200' : 'text-set-dim hover:text-set-text'}`}
              onClick={() => setViewId(v.id)}
            >
              {v.type === 'table' ? '' : v.type === 'kanban' ? '' : v.type === 'calendar' ? '' : ''} {v.name}
            </button>
          ))}
          {(['kanban', 'calendar', 'gallery', 'table'] as const)
            .filter((t) => !views.some((v) => v.type === t))
            .map((t) => (
              <button
                key={t}
                className="px-2 py-1 rounded-md text-xs text-set-dim hover:text-set-text border border-dashed border-set-border"
                onClick={async () => {
                  const { view } = await api.post(`/databases/${db.id}/views`, {
                    name: t[0].toUpperCase() + t.slice(1),
                    type: t,
                    config: t === 'kanban' ? { groupBy: columns.find((c) => c.type === 'select')?.id } : t === 'calendar' ? { dateColumn: columns.find((c) => c.type === 'date')?.id } : {},
                  });
                  load();
                  setViewId(view.id);
                }}
              >
                + {t}
              </button>
            ))}
        </div>
        <button className="set-btn ml-auto flex items-center gap-1" onClick={addRow}><Plus size={14} /> New</button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {view?.type === 'kanban' && <KanbanView {...{ columns, rows, viewConfig, setCell, addRow, removeRow, spaceId, dbId: db.id }} />}
        {view?.type === 'calendar' && <CalendarView {...{ columns, rows, viewConfig, setCell, addRow, spaceId, dbId: db.id }} />}
        {view?.type === 'gallery' && <GalleryView {...{ columns, rows, spaceId, dbId: db.id, removeRow }} />}
        {(!view || view.type === 'table') && (
          <div className="set-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-set-panel2 text-left">
                  {columns.map((c) => (
                    <th key={c.id} className="px-3 py-2 font-medium text-set-dim border-b border-set-border">{c.name}</th>
                  ))}
                  <th className="w-8 border-b border-set-border" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-set-panel2/50 group border-b border-set-border/40">
                    {columns.map((c) => (
                      <td key={c.id} className="px-3 py-1.5">
                        {c.id === columns[0]?.id && row.page_id ? (
                          <button className="hover:text-set-accent text-left w-full" onClick={() => navigate(`/app/space/${spaceId}/page/${row.page_id}`)}>
                            <CellEditor row={row} col={c} />
                          </button>
                        ) : (
                          <CellEditor row={row} col={c} />
                        )}
                      </td>
                    ))}
                    <td>
                      <button className="opacity-0 group-hover:opacity-100 text-set-dim hover:text-red-400 p-1" onClick={() => removeRow(row.id)}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <div className="p-6 text-center text-set-dim text-sm">No rows yet.</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function KanbanView({ columns, rows, viewConfig, setCell, addRow, spaceId, dbId }: any) {
  const groupCol: Column | undefined = columns.find((c: Column) => c.id === viewConfig.groupBy) ?? columns.find((c: Column) => c.type === 'select');
  const groups = groupCol?.config?.options ?? [];
  const [dragId, setDragId] = useState<string | null>(null);

  return (
    <div className="flex gap-3 overflow-x-auto h-full items-start pb-4">
      {groups.map((g: any) => {
        const groupRows = rows.filter((r: any) => (r.cells?.[groupCol!.id] ?? '') === g.value);
        return (
          <div
            key={g.value}
            className="w-64 shrink-0 set-card p-2 min-h-40"
            onDragOver={(e) => e.preventDefault()}
            onDrop={async () => {
              if (dragId) {
                setDragId(null);
                setCell(dragId, groupCol!.id, g.value);
              }
            }}
          >
            <div className="flex items-center justify-between px-1 pb-2">
              <span className={`set-chip ${colorFor(g.color)}`}>{g.value}</span>
              <span className="text-xs text-set-dim">{groupRows.length}</span>
            </div>
            <div className="space-y-1.5">
              {groupRows.map((r: any) => (
                <div
                  key={r.id}
                  draggable
                  onDragStart={() => setDragId(r.id)}
                  className="bg-set-panel2 border border-set-border rounded-lg p-2.5 cursor-grab hover:border-set-accent/40"
                >
                  <div className="text-sm text-white truncate">{r.page_title ?? r.cells?.title ?? 'Untitled'}</div>
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    {columns.filter((c: Column) => ['select', 'date'].includes(c.type) && c.id !== groupCol?.id).map((c: Column) =>
                      r.cells?.[c.id] ? (
                        <span key={c.id} className="text-[10px] text-set-dim bg-set-panel rounded px-1.5 py-0.5">
                          {r.cells[c.id]}
                        </span>
                      ) : null
                    )}
                  </div>
                </div>
              ))}
              <button className="w-full text-xs text-set-dim hover:text-set-text p-1 rounded border border-dashed border-set-border" onClick={async () => {
                await api.post(`/databases/${dbId}/rows`, { cells: { [groupCol!.id]: g.value } });
                window.location.reload();
              }}>+ New</button>
            </div>
          </div>
        );
      })}
      {groups.length === 0 && (
        <div className="text-sm text-set-dim p-4">Add a <b>select</b> column with options to use the board view.</div>
      )}
    </div>
  );
}

function CalendarView({ columns, rows, viewConfig, setCell, dbId }: any) {
  const dateCol = columns.find((c: Column) => c.id === viewConfig.dateColumn) ?? columns.find((c: Column) => c.type === 'date');
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const startPad = (first.getDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(startPad).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const rowsForDay = (day: number) =>
    rows.filter((r: any) => {
      const v = dateCol ? r.cells?.[dateCol.id] : null;
      return v && new Date(v).toDateString() === new Date(year, month, day).toDateString();
    });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button className="set-btn-ghost" onClick={() => setCursor(new Date(year, month - 1, 1))}></button>
        <div className="font-semibold text-white">{cursor.toLocaleString('en', { month: 'long', year: 'numeric' })}</div>
        <button className="set-btn-ghost" onClick={() => setCursor(new Date(year, month + 1, 1))}></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs text-set-dim mb-1">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => (
          <div key={i} className="min-h-24 set-card p-1.5 border-set-border/60">
            {day && (
              <>
                <div className={`text-xs mb-1 ${new Date().toDateString() === new Date(year, month, day).toDateString() ? 'text-set-accent font-bold' : 'text-set-dim'}`}>{day}</div>
                <div className="space-y-1">
                  {rowsForDay(day).map((r: any) => (
                    <div key={r.id} className="bg-set-accent/15 text-blue-200 text-[11px] rounded px-1.5 py-0.5 truncate" title={r.page_title ?? ''}>
                      {r.page_title ?? r.cells?.title ?? 'Untitled'}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function GalleryView({ rows, spaceId, removeRow }: any) {
  const navigate = useNavigate();
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
      {rows.map((r: any) => (
        <div key={r.id} className="set-card overflow-hidden group hover:border-set-accent/40 transition-colors">
          <div className="h-24 bg-gradient-to-br from-set-panel2 to-[#1c2130] flex items-center justify-center text-3xl cursor-pointer"
            onClick={() => r.page_id && navigate(`/app/space/${spaceId}/page/${r.page_id}`)}>
            {r.cells?.icon ?? ''}
          </div>
          <div className="p-2.5">
            <div className="text-sm text-white truncate">{r.page_title ?? r.cells?.title ?? 'Untitled'}</div>
            <div className="text-xs text-set-dim truncate mt-0.5">{Object.entries(r.cells ?? {}).filter(([k, v]) => k !== 'title' && v).slice(0, 2).map(([k, v]) => `${v}`).join(' · ')}</div>
            <button className="opacity-0 group-hover:opacity-100 text-set-dim hover:text-red-400 text-xs mt-1" onClick={() => removeRow(r.id)}>delete</button>
          </div>
        </div>
      ))}
      {rows.length === 0 && <div className="text-sm text-set-dim">No rows yet.</div>}
    </div>
  );
}
