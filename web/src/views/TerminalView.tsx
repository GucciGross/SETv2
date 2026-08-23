import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { SquareTerminal } from 'lucide-react';

/** Terminal surface: workspace console over pages, notebooks, surfaces and a JS sandbox. */
interface Line {
  text: string;
  kind: 'in' | 'out' | 'err';
}

export default function TerminalView() {
  const { spaceId } = useParams();
  const [lines, setLines] = useState<Line[]>([
    { text: 'SET workspace console — type "help" for commands', kind: 'out' },
  ]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIndex, setHistIndex] = useState(-1);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, [lines]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const exec = async () => {
    const command = input.trim();
    if (!command || !spaceId || busy) return;
    setInput('');
    setHistory((h) => [...h, command]);
    setHistIndex(-1);
    setLines((l) => [...l, { text: `set> ${command}`, kind: 'in' }]);
    if (command === 'clear' || command === 'cls') {
      setLines([]);
      return;
    }
    setBusy(true);
    try {
      const r = await api.post('/terminal/exec', { spaceId, command });
      setLines((l) => [...l, { text: r.output ?? '(no output)', kind: 'out' }]);
    } catch (e: any) {
      setLines((l) => [...l, { text: e.message, kind: 'err' }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0a0c10]" onClick={() => inputRef.current?.focus()}>
      <div className="h-11 border-b border-set-border flex items-center gap-2 px-4 shrink-0">
        <SquareTerminal size={15} className="text-green-400" />
        <span className="text-sm font-medium">Workspace console</span>
        <span className="text-[10px] text-set-dim ml-2">pages · notebooks · grounded search · surfaces · runjs</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 font-mono text-[13px] leading-relaxed">
        {lines.map((l, i) => (
          <pre
            key={i}
            className={`whitespace-pre-wrap break-words ${
              l.kind === 'in' ? 'text-blue-300' : l.kind === 'err' ? 'text-red-400' : 'text-set-text/90'
            }`}
          >
            {l.text}
          </pre>
        ))}
        {busy && <pre className="text-set-dim animate-pulse">…</pre>}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-set-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center gap-2 font-mono shrink-0">
        <span className="text-green-400 text-sm">set&gt;</span>
        <input
          ref={inputRef}
          className="flex-1 bg-transparent outline-none text-sm text-set-text font-mono"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') exec();
            else if (e.key === 'ArrowUp') {
              e.preventDefault();
              const idx = histIndex === -1 ? history.length - 1 : Math.max(0, histIndex - 1);
              if (history[idx] !== undefined) {
                setHistIndex(idx);
                setInput(history[idx]);
              }
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              if (histIndex === -1) return;
              const idx = histIndex + 1;
              if (idx >= history.length) {
                setHistIndex(-1);
                setInput('');
              } else {
                setHistIndex(idx);
                setInput(history[idx]);
              }
            }
          }}
          placeholder='help'
          disabled={busy}
        />
      </div>
    </div>
  );
}
