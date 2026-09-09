import { Link, useParams, useSearchParams } from 'react-router-dom';
import NotebookCollection from './NotebookCollection';
import SkillLabView from './SkillLabView';

export default function NotebookList() {
  const { spaceId } = useParams();
  const [search] = useSearchParams();
  if (search.get('teach') === '1') return <SkillLabView key={spaceId} />;
  return <>
    <div className="max-w-3xl mx-auto px-6 pt-6">
      <div className="set-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-semibold text-set-text">Teach your AI, too</h2>
          <p className="text-sm text-set-dim">Turn notebook evidence into reviewed skills for Codex and MCP workflows.</p></div>
        <Link className="set-btn-primary" to="?teach=1">Teach AI</Link>
      </div>
    </div>
    <NotebookCollection />
  </>;
}
