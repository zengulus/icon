import { lazy, Suspense } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';

const Lab = lazy(() => import('./pages/BrowserVtt.js').then((module) => ({ default: module.Lab })));
const AuthenticatedApp = lazy(() => import('./AuthenticatedApp.js').then((module) => ({ default: module.AuthenticatedApp })));

const loading = <div className="page"><div className="empty-state">Opening module…</div></div>;

export function App() {
  return (
    <HashRouter>
      <Routes>
        {/* Lab is deliberately outside CharacterProvider: it is a public,
            browser-local human-testing service with no Supabase or Render
            dependency, at every release phase. */}
        <Route path="lab" element={<Suspense fallback={loading}><Lab /></Suspense>} />
        <Route path="*" element={<Suspense fallback={loading}><AuthenticatedApp /></Suspense>} />
      </Routes>
    </HashRouter>
  );
}
