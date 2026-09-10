import WorkspaceSettings from './WorkspaceSettings';
import CodexSettings from '../components/copilot/CodexSettings';

/** Workspace options and personal credentials are intentionally separate. */
export default function SettingsView() {
  return <>
    <WorkspaceSettings />
    <div className="px-4 sm:px-6 pb-6 max-w-3xl mx-auto"><CodexSettings /></div>
  </>;
}
