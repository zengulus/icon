import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { CharacterProvider } from './context/CharacterContext.js';
import { AppShell } from './components/AppShell.js';
import { Dashboard } from './pages/Dashboard.js';
import { CharacterEditor } from './pages/CharacterEditor.js';

const Compendium = lazy(() => import('./pages/Compendium.js').then((module) => ({ default: module.Compendium })));
const Sandbox = lazy(() => import('./pages/Sandbox.js').then((module) => ({ default: module.Sandbox })));
const Campaigns = lazy(() => import('./pages/Campaigns.js').then((module) => ({ default: module.Campaigns })));
const EncounterRoom = lazy(() => import('./pages/EncounterRoom.js').then((module) => ({ default: module.EncounterRoom })));
const BrowserVtt = lazy(() => import('./pages/BrowserVtt.js').then((module) => ({ default: module.BrowserVtt })));

const loading = <div className="page"><div className="empty-state">Opening module…</div></div>;

export function App() {
  return (
    <HashRouter>
      <Routes>
        {/* The browser-only VTT route (serverless test) is intentionally OUTSIDE
            the CharacterProvider so mounting it never queries Supabase or the
            Render server: it boots a local authoritative room from the pure
            room reducer and renders through the shared TacticalViewport. */}
        <Route path="vtt" element={<Suspense fallback={loading}><BrowserVtt /></Suspense>} />
        <Route element={<CharacterProvider><AppShell /></CharacterProvider>}>
          <Route index element={<Dashboard />} />
          <Route path="characters/:id" element={<CharacterEditor />} />
          <Route path="compendium" element={<Suspense fallback={loading}><Compendium /></Suspense>} />
          <Route path="lab" element={<Suspense fallback={loading}><Sandbox labMode /></Suspense>} />
          <Route path="sandbox" element={<Navigate to="/lab" replace />} />
          <Route path="campaigns" element={<Suspense fallback={loading}><Campaigns /></Suspense>} />
          <Route path="encounters/:encounterId" element={<Suspense fallback={loading}><EncounterRoom /></Suspense>} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
