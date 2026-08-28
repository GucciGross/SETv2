import { X, ArrowUpRight } from 'lucide-react';
import { motion, useDragControls } from 'motion/react';
import type { GraphNode } from '../../lib/graph/types';

interface NodeCardProps {
  node: GraphNode;
  neighbors: GraphNode[];
  onClose: () => void;
  onOpen: (id: string) => void;
  onSelect: (id: string) => void;
}

/**
 * Bottom sheet for a selected graph node: what it is (title, badges) and what
 * you can do (open it, jump to its linked pages). Slides up from the bottom;
 * swipe the grabber/header down to dismiss. Drag is bound to the header only
 * so the linked-pages list can still scroll.
 */
export default function NodeCard({ node, neighbors, onClose, onOpen, onSelect }: NodeCardProps) {
  const dragControls = useDragControls();

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center">
      <motion.div
        data-node-sheet
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 34, stiffness: 420 }}
        drag="y"
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 90 || info.velocity.y > 550) onClose();
        }}
        className="pointer-events-auto w-full overflow-hidden rounded-t-2xl border border-set-border border-b-0 bg-set-panel shadow-pop sm:mb-3 sm:w-[26rem] sm:rounded-2xl sm:border-b"
      >
        <div
          className="cursor-grab touch-none select-none pb-1 pt-2 active:cursor-grabbing"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <div className="mx-auto h-1 w-10 rounded-full bg-set-border" aria-hidden />
        </div>

        <div className="px-4" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <div className="flex items-start gap-2.5">
            <span className="text-xl leading-none">{node.icon || '📄'}</span>
            <div className="min-w-0 flex-1">
              <h3 className="break-words text-[15px] font-medium leading-snug text-set-text">{node.title}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="rounded-md border border-set-border bg-set-panel2 px-1.5 py-0.5 text-[10px] text-set-dim">
                  Page
                </span>
                <span className="rounded-md border border-set-border bg-set-panel2 px-1.5 py-0.5 text-[10px] text-set-dim">
                  {node.deg ?? 0} {node.deg === 1 ? 'link' : 'links'}
                </span>
                {node.is_daily && (
                  <span className="rounded-md border border-[rgba(251,191,36,0.35)] px-1.5 py-0.5 text-[10px] text-[#fbbf24]">
                    daily note
                  </span>
                )}
              </div>
            </div>
            <button
              className="-mt-1 -mr-1 rounded-lg p-1.5 text-set-dim hover:bg-set-panel2 hover:text-set-text"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          <button className="set-btn-primary mt-3 w-full" onClick={() => onOpen(node.id)}>
            <span className="inline-flex items-center gap-1.5">
              Open page <ArrowUpRight size={13} />
            </span>
          </button>

          {neighbors.length > 0 ? (
            <div className="mt-3">
              <div className="mb-1 text-[10px] tracking-[0.15em] text-set-dim uppercase">
                Linked pages · {neighbors.length}
              </div>
              <ul className="max-h-44 space-y-0.5 overflow-y-auto">
                {neighbors.map((n) => (
                  <li key={n.id}>
                    <button
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-set-dim hover:bg-set-panel2 hover:text-set-text"
                      onClick={() => onSelect(n.id)}
                      title={n.title}
                    >
                      <span>{n.icon || '📄'}</span>
                      <span className="truncate">{n.title}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-set-dim opacity-70">
                        {n.deg ?? 0} ↗
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 text-[11px] leading-relaxed text-set-dim">
              No links yet — mention this page with{' '}
              <code className="rounded bg-set-panel2 px-1 py-0.5">[[{node.title}]]</code> anywhere to connect it.
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
}
