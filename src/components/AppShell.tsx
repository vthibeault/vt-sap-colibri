import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/state/AuthContext';
import { useBrand } from '@/state/BrandContext';
import { useSap } from '@/state/SapContext';
import { useI18n, LOCALE_META, type Locale, type MessageKey } from '@/i18n';
import { useAlerts } from '@/hooks/useAlerts';
import type { AlertSeverity } from '@/lib/alerts';
import { IconBell, IconDashboard, IconLogout, IconMoon, IconPlug, IconProjects, IconStudio, IconSun, IconUsers } from './icons';
import { CommandPalette } from './CommandPalette';
import { Toasts } from './ui';

const TITLES: [RegExp, MessageKey][] = [
  [/^\/projects\/.+/, 'title.workspace'],
  [/^\/projects/, 'title.projects'],
  [/^\/resources/, 'title.resources'],
  [/^\/studio/, 'title.studio'],
  [/^\/integration/, 'title.integration'],
  [/^\/$/, 'title.overview'],
];

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  critical: 'var(--status-critical)',
  warning: 'var(--status-warn)',
  info: 'var(--accent)',
};

function AlertsBell() {
  const { t } = useI18n();
  const { alerts, loading } = useAlerts();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const critical = alerts.filter((a) => a.severity === 'critical').length;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        className="btn ghost icon"
        onClick={() => setOpen((o) => !o)}
        title={t('shell.alerts')}
        aria-label={t('shell.alerts')}
        style={{ position: 'relative' }}
      >
        <IconBell />
        {!loading && alerts.length > 0 && (
          <span className={`bell-badge ${critical ? 'critical' : ''}`}>{alerts.length}</span>
        )}
      </button>
      {open && (
        <div className="alert-panel">
          <div className="alert-panel-head">{t('alerts.title')}</div>
          {alerts.length === 0 ? (
            <div className="alert-empty">{t('alerts.empty')}</div>
          ) : (
            alerts.map((a, i) => (
              <button
                key={a.id}
                className="alert-row"
                style={{ '--i': i } as CSSProperties}
                onClick={() => {
                  setOpen(false);
                  navigate(`/projects/${a.projectId}`);
                }}
              >
                <span className="a-dot" style={{ background: SEVERITY_COLOR[a.severity] }} />
                <span style={{ minWidth: 0 }}>
                  <b>{a.projectName}</b>
                  <span className="a-msg">{t(a.messageKey as MessageKey, a.params)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const { user, logout, can } = useAuth();
  const { brand, mode, setBrand } = useBrand();
  const { client } = useSap();
  const { t, locale, setLocale } = useI18n();
  const location = useLocation();

  const titleKey = TITLES.find(([re]) => re.test(location.pathname))?.[1];
  const persona = user?.fullName ?? '';

  const toggleMode = () => setBrand({ ...brand, mode: mode === 'dark' ? 'light' : 'dark' });

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

        <div className="nav-section">{t('nav.section.ps')}</div>
        <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <IconDashboard /> <span className="nav-label">{t('nav.overview')}</span>
        </NavLink>
        <NavLink to="/projects" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <IconProjects /> <span className="nav-label">{t('nav.projects')}</span>
        </NavLink>
        <NavLink to="/resources" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <IconUsers /> <span className="nav-label">{t('nav.resources')}</span>
        </NavLink>

        <div className="nav-section">{t('nav.section.platform')}</div>
        {can('Z_COLIBRI_BRAND', '02') && (
          <NavLink to="/studio" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <IconStudio /> <span className="nav-label">{t('nav.studio')}</span>
          </NavLink>
        )}
        <NavLink to="/integration" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <IconPlug /> <span className="nav-label">{t('nav.integration')}</span>
        </NavLink>

        <div className="sidebar-user">
          <span className="avatar">{persona ? persona[0] : '·'}</span>
          <span className="who">
            <b>{persona}</b>
            <span>{user?.jobTitle}</span>
          </span>
          <button className="btn ghost icon" onClick={logout} title={t('shell.signOut')} aria-label={t('shell.signOut')}>
            <IconLogout />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{titleKey ? t(titleKey) : brand.name}</h1>
          <span className="spacer" />
          <span className="kbd" title="Command palette">⌘K</span>
          <div className="segmented" role="group" aria-label="Language">
            {(Object.keys(LOCALE_META) as Locale[]).map((l) => (
              <button key={l} className={locale === l ? 'on' : ''} onClick={() => setLocale(l)}>
                {LOCALE_META[l].label}
              </button>
            ))}
          </div>
          <span className={`conn-badge ${client.mode}`} title="Data source">
            <span className="dot" />
            {client.mode === 'mock' ? t('shell.mockSap') : t('shell.liveSap')}
          </span>
          <AlertsBell />
          <button className="btn ghost icon" onClick={toggleMode} title={t('shell.toggleMode')} aria-label={t('shell.toggleMode')}>
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
      <CommandPalette />
      <Toasts />
    </div>
  );
}
