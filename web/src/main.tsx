import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Navigate, useRouteError } from 'react-router-dom';
import './index.css';
// CopilotKit v2 styles are Tailwind v4 output; a virtual module (see
// vite.config.ts) hands them over as a string, bypassing our Tailwind v3
// PostCSS pipeline — injected as a <style> tag here.
// @ts-expect-error virtual module provided by copilotkitRawStyles() plugin
import cpkStyles from 'virtual:copilotkit-v2-styles';

// iPhones in Safari's "Request Desktop Website" mode render at ~980px layout
// width — fixed overlays anchored right (copilot launcher + popup) end up
// off-screen and the page pans sideways. Force the mobile overlay layout in
// that case. Standalone PWA launches get the real viewport and are unaffected.
function syncForceMobile() {
  const iOS = /iPhone|iPod|iPad/.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  document.documentElement.classList.toggle('set-force-mobile', iOS && !standalone && window.innerWidth >= 768);
}
syncForceMobile();
window.addEventListener('resize', syncForceMobile);

const cpkStyleEl = document.createElement('style');
cpkStyleEl.dataset.copilotkit = 'v2-styles';
cpkStyleEl.textContent = cpkStyles;
document.head.appendChild(cpkStyleEl);
import App from './App';
import Login from './views/Login';
import AppShell from './components/AppShell';
import PageView from './views/PageView';
import GraphView from './views/GraphView';
import DatabaseView from './views/DatabaseView';
import NotebookList from './views/NotebookList';
import NotebookView from './views/NotebookView';
import ModelsView from './views/ModelsView';
import ModelView from './views/ModelView';
import PathsView from './views/PathsView';
import SettingsView from './views/SettingsView';
import StudyView from './views/StudyView';
import CanvasView from './views/CanvasView';
import LibraryView from './views/LibraryView';
import CodingView from './views/CodingView';
import TerminalView from './views/TerminalView';
import DocsView from './views/DocsView';
import Landing from './views/Landing';
import Consent from './views/Consent';
import AgentsLanding from './views/AgentsLanding';
import DashboardView from './views/DashboardView';
import Reset from './views/Reset';
import Join from './views/Join';
import ActivityView from './views/ActivityView';
import CapturesView from './views/CapturesView';
import MyTasksView from './views/MyTasksView';
import { PagesList, DatabasesList } from './views/ListsView';
import { ResearchList, ResearchRun } from './views/ResearchView';
import PaperView from './views/PaperView';
import { Compass, RefreshCw } from 'lucide-react';

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/docs', element: <DocsView standalone /> },
  { path: '/reset', element: <Reset /> },
  { path: '/join', element: <Join /> },
  { path: '/oauth/consent', element: <Consent /> },
  { path: '/agents', element: <AgentsLanding /> },
  { path: '/', element: <Landing /> },
  {
    path: '/',
    element: <App />,
    children: [
      {
        path: '/app',
        element: <AppShell />,
        errorElement: <RouteError />,
        children: [
          { index: true, element: <Home /> },
          { path: 'space/:spaceId', element: <DashboardView /> },
          { path: 'space/:spaceId/pages', element: <PagesList /> },
          { path: 'space/:spaceId/databases', element: <DatabasesList /> },
          { path: 'space/:spaceId/page/:pageId', element: <PageView /> },
          { path: 'space/:spaceId/graph', element: <GraphView /> },
          { path: 'space/:spaceId/db/:dbId', element: <DatabaseView /> },
          { path: 'space/:spaceId/notebooks', element: <NotebookList /> },
          { path: 'space/:spaceId/research', element: <ResearchList /> },
          { path: 'space/:spaceId/research/:runId', element: <ResearchRun /> },
          { path: 'space/:spaceId/research/:runId/paper', element: <PaperView /> },
          { path: 'space/:spaceId/notebook/:nbId', element: <NotebookView /> },
          { path: 'space/:spaceId/notebook/:nbId/deck/:deckId', element: <StudyView /> },
          { path: 'space/:spaceId/models', element: <ModelsView /> },
          { path: 'space/:spaceId/model/:modelId', element: <ModelView /> },
          { path: 'space/:spaceId/paths', element: <PathsView /> },
          { path: 'space/:spaceId/library', element: <LibraryView /> },
          { path: 'space/:spaceId/coding', element: <CodingView /> },
          { path: 'space/:spaceId/terminal', element: <TerminalView /> },
          { path: 'space/:spaceId/docs', element: <DocsView /> },
          { path: 'space/:spaceId/tasks', element: <MyTasksView /> },
          { path: 'space/:spaceId/activity', element: <ActivityView /> },
          { path: 'space/:spaceId/captures', element: <CapturesView /> },
          { path: 'space/:spaceId/canvas', element: <CanvasView /> },
          { path: 'space/:spaceId/settings', element: <SettingsView /> },
        ],
      },
      // catch-all: unmatched URLs (including agent-driven navigations) render
      // this instead of the router's raw "Unexpected Application Error! 404"
      { path: '*', element: <NotFound /> },
    ],
  },
]);

function NotFound() {
  return (
    <div className="h-screen flex flex-col items-center justify-center gap-3 text-center p-6">
      <Compass size={40} className="text-set-accent" strokeWidth={1.5} />
      <h1 className="text-lg font-bold text-white">That page doesn't exist</h1>
      <p className="text-sm text-set-dim max-w-xs">
        The link or navigation went somewhere unknown. Nothing is broken — head back and keep going.
      </p>
      <a href="/app" className="set-btn-primary text-sm mt-1">Back to workspace</a>
    </div>
  );
}

/** Route-level crash page: a render error in any view degrades to this
 *  instead of React Router's raw error dump. The rest of the app stays
 *  reachable; reload usually clears transient bad state. */
function RouteError() {
  const err = useRouteError() as any;
  return (
    <div className="h-screen flex flex-col items-center justify-center gap-3 text-center p-6">
      <RefreshCw size={36} className="text-amber-300" strokeWidth={1.5} />
      <h1 className="text-lg font-bold text-white">This page hit a bug</h1>
      <p className="text-sm text-set-dim max-w-sm">
        Something failed while rendering this view. Your workspace and data are fine —
        reload the page, or head back and retry.
      </p>
      {typeof err?.message === 'string' && (
        <code className="text-[11px] text-red-300/80 bg-set-panel2 border border-set-border rounded px-2 py-1 max-w-full truncate">
          {err.message}
        </code>
      )}
      <div className="flex gap-2 mt-1">
        <button className="set-btn text-sm" onClick={() => window.location.reload()}>Reload</button>
        <a href="/app" className="set-btn-primary text-sm">Back to workspace</a>
      </div>
    </div>
  );
}

function Home() {
  return (
    <div className="p-10 max-w-2xl mx-auto text-set-dim">
      <h1 className="text-2xl font-bold text-white mb-3">SET — Strategic Enablement Toolkit</h1>
      <p className="mb-4">
        Your knowledge + learning operating system. Pick a page from the sidebar, or explore:
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>Pages — block editor with wiki links, tables, images and backlinks</li>
        <li>Graph — your knowledge graph</li>
        <li>Databases — table / board / calendar / gallery</li>
        <li>Notebooks — grounded research chat with citations</li>
        <li>Copilot — AI agent with tools and generative UI (right panel)</li>
        <li>Optional work surfaces: Coding, Terminal, 3D &amp; CAD, Library, Learning Paths, Canvas — toggle them in Settings</li>
      </ul>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
