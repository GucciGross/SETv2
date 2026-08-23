import { useEffect } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useApp } from './stores/app';
import { api, getToken } from './lib/api';

export default function App() {
  const { user, loadSpaces, setCurrentSpace } = useApp();
  useEffect(() => {
    (async () => {
      try {
        const { user } = await api.get('/auth/me');
        useApp.setState({ user });
        await loadSpaces();
        const spaceId = useApp.getState().currentSpaceId ?? useApp.getState().spaces[0]?.id;
        if (spaceId) setCurrentSpace(spaceId);
      } catch {
        /* redirect handled in api */
      }
    })();
  }, [loadSpaces, setCurrentSpace]);

  if (!getToken()) return <Navigate to="/login" replace />;
  if (!user) return <div className="h-screen flex items-center justify-center text-set-dim">Loading SET…</div>;
  return <Outlet />;
}
