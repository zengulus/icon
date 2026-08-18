import { lazy, Suspense } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { CharacterProvider } from './context/CharacterContext.js';
import { AppShell } from './components/AppShell.js';
import { Dashboard } from './pages/Dashboard.js';
import { CharacterEditor } from './pages/CharacterEditor.js';

const Compendium = lazy(() => import('./pages/Compendium.js').then((module) => ({ default: module.Compendium })));
const Sandbox = lazy(() => import('./pages/Sandbox.js').then((module) => ({ default: module.Sandbox })));
const Campaigns = lazy(() => import('./pages/Campaigns.js').then((module) => ({ default: module.Campaigns })));

const loading = <div className="page"><div className="empty-state">Opening module…</div></div>;

export function App() {
  return (
    <CharacterProvider>
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="characters/:id" element={<CharacterEditor />} />
            <Route path="compendium" element={<Suspense fallback={loading}><Compendium /></Suspense>} />
            <Route path="sandbox" element={<Suspense fallback={loading}><Sandbox /></Suspense>} />
            <Route path="campaigns" element={<Suspense fallback={loading}><Campaigns /></Suspense>} />
          </Route>
        </Routes>
      </HashRouter>
    </CharacterProvider>
  );
}
