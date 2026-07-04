import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/state/AuthContext';
import { useBrand } from '@/state/BrandContext';
import { useSap } from '@/state/SapContext';
import { IconDashboard, IconLogout, IconMoon, IconPlug, IconProjects, IconStudio, IconSun } from './icons';
import { Toasts } from './ui';

const TITLES: [RegExp, string][] = [
  [/^\/projects\/.+/, 'Project workspace'],
  [/^\/projects/, 'Projects'],
  [/^\/studio/, 'Brand studio'],
  [/^\/integration/, 'SAP integration'],
  [/^\/$/, 'Portfolio overview'],
];

export function AppShell() {
  const { user, logout, can } = useAuth();
  const { brand, mode, setBrand } = useBrand();
  const { client } = useSap();
  const location = useLocation();

  const title = TITLES.find(([re]) => re.test(location.pathname))?.[1] ?? brand.name;
  const persona = user?.fullName ?? '';

  const toggleMode = () =>
    setBrand({ ...brand, mode: mode === 'dark' ? 'light' : 'dark' });

  return (
    <div className="app">
      <aside className="sidebar">
        <NavLink to="/" className="sidebar-logo">
          <span className="logo-mark">{brand.monogram}</span>
          <span>
            <span className="logo-name">{brand.name}</span>
            <div className="logo-tagline">{brand.tagline}</div>
          </span>
        </NavLink>

        <div className="nav-section">Project System</div>
        <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <IconDashboard /> <span className="nav-label">Overview</span>
        </NavLink>
        <NavLink to="/projects" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <IconProjects /> <span className="nav-label">Projects</span>
        </NavLink>

        <div className="nav-section">Platform</div>
        {can('Z_COLIBRI_BRAND', '02') && (
          <NavLink to="/studio" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <IconStudio /> <span className="nav-label">Brand studio</span>
          </NavLink>
        )}
        <NavLink to="/integration" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <IconPlug /> <span className="nav-label">Integration</span>
        </NavLink>

        <div className="sidebar-user">
          <span className="avatar">{persona ? persona[0] : '·'}</span>
          <span className="who">
            <b>{persona}</b>
            <span>{user?.jobTitle}</span>
          </span>
          <button className="btn ghost icon" onClick={logout} title="Sign out" aria-label="Sign out">
            <IconLogout />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{title}</h1>
          <span className="spacer" />
          <span className={`conn-badge ${client.mode}`} title="Data source">
            <span className="dot" />
            {client.mode === 'mock' ? 'Mock SAP' : 'Live SAP'}
          </span>
          <button className="btn ghost icon" onClick={toggleMode} title="Toggle color mode" aria-label="Toggle color mode">
            {mode === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
        </header>
        {/* keying on pathname re-runs the entrance choreography per page */}
        <main className="content" key={location.pathname}>
          <div className="page">
            <Outlet />
          </div>
        </main>
      </div>
      <Toasts />
    </div>
  );
}
