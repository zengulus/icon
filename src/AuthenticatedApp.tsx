import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { CharacterProvider } from './context/CharacterContext.js';
import { AppShell } from './components/AppShell.js';
import { Dashboard } from './pages/Dashboard.js';
import { CharacterEditor } from './pages/CharacterEditor.js';
import { NewCharacter } from './pages/NewCharacter.js';

const Compendium = lazy(() => import('./pages/Compendium.js').then((module) => ({ default: module.Compendium })));
const Campaigns = lazy(() => import('./pages/Campaigns.js').then((module) => ({ default: module.Campaigns })));
const EncounterRoom = lazy(() => import('./pages/EncounterRoom.js').then((module) => ({ default: module.EncounterRoom })));

const loading = <div className="page"><div className="empty-state">Opening module…</div></div>;

function LegacyEncounterRedirect() {
  const { encounterId } = useParams();
  return <Navigate to={encounterId ? `/vtt/${encodeURIComponent(encounterId)}` : '/vtt'} replace />;
}

/**
 * The authenticated companion application. It is loaded only for routes
 * other than `#/lab`, keeping the public browser-local Lab independent from
 * Supabase and the Render-backed room client.
 */
export function AuthenticatedApp() {
  return (
    <CharacterProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="characters/new" element={<NewCharacter />} />
          <Route path="characters/:id" element={<CharacterEditor />} />
          <Route path="compendium" element={<Suspense fallback={loading}><Compendium /></Suspense>} />
          <Route path="sandbox" element={<Navigate to="/lab" replace />} />
          <Route path="campaigns" element={<Suspense fallback={loading}><Campaigns /></Suspense>} />
          <Route path="vtt" element={<Navigate to="/campaigns" replace />} />
          <Route path="vtt/:encounterId" element={<Suspense fallback={loading}><EncounterRoom /></Suspense>} />
          <Route path="encounters/:encounterId" element={<LegacyEncounterRedirect />} />
        </Route>
      </Routes>
    </CharacterProvider>
  );
}
