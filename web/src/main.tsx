import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import './index.css';
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
import Reset from './views/Reset';
import ActivityView from './views/ActivityView';
import MyTasksView from './views/MyTasksView';

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/docs', element: <DocsView standalone /> },
  { path: '/reset', element: <Reset /> },
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
        children: [
          { index: true, element: <Home /> },
          { path: 'space/:spaceId', element: <Home /> },
          { path: 'space/:spaceId/page/:pageId', element: <PageView /> },
          { path: 'space/:spaceId/graph', element: <GraphView /> },
          { path: 'space/:spaceId/db/:dbId', element: <DatabaseView /> },
          { path: 'space/:spaceId/notebooks', element: <NotebookList /> },
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
          { path: 'space/:spaceId/canvas', element: <CanvasView /> },
          { path: 'space/:spaceId/settings', element: <SettingsView /> },
        ],
      },
    ],
  },
]);

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
