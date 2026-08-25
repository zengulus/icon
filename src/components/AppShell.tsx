import { NavLink, Outlet } from 'react-router-dom';
import { PHASE_THREE_COVERAGE_READY } from '../rules/index.js';
import { useCharacters } from '../context/CharacterContext.js';

const links = [
  ['/', 'Roster', '◈'],
  ['/compendium', 'Rules', '⌁'],
  ['/lab', 'Lab', '⌬'],
  ['/vtt', 'VTT', '▦'],
  ['/campaigns', 'Campaigns', '◉'],
] as const;

export function AppShell() {
  const { user, cloudEnabled } = useCharacters();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">I</span>
          <div><strong>ICON</strong><small>Field Guide // 1.5</small></div>
        </div>
        <nav>
          {links.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => isActive ? 'active' : ''}>
              <span>{icon}</span>{label}
              {(to === '/campaigns' || to === '/vtt') && !PHASE_THREE_COVERAGE_READY && <i title="Rules gate active">GATED</i>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className={`status-dot ${user ? 'online' : ''}`} />
          <div>
            <strong>{user?.email ?? 'Local archive'}</strong>
            <small>{user ? 'Synced with Supabase' : cloudEnabled ? 'Sign in to sync' : 'Browser storage'}</small>
          </div>
        </div>
      </aside>
      <main className="main-panel"><Outlet /></main>
    </div>
  );
}
