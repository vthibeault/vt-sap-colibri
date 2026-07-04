import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/state/AuthContext';
import { useBrand } from '@/state/BrandContext';
import { useSap } from '@/state/SapContext';
import type { ProjectDefinition } from '@/sap/types';
import { IconDashboard, IconMoon, IconPlug, IconProjects, IconStudio, IconSun } from './icons';

interface Command {
  id: string;
  section: 'Navigate' | 'Projects' | 'Actions';
  label: string;
  keywords?: string;
  icon?: React.ReactNode;
  hint?: string;
  run: () => void;
}

/** ⌘K / Ctrl+K launcher: navigation, projects, and actions from anywhere. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [projects, setProjects] = useState<ProjectDefinition[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { can } = useAuth();
  const { brand, mode, setBrand } = useBrand();
  const { client } = useSap();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setSel(0);
      return;
    }
    void client.listProjects().then(setProjects);
  }, [open, client]);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => {
      setOpen(false);
      navigate(to);
    };
    const cmds: Command[] = [
      { id: 'nav-overview', section: 'Navigate', label: 'Portfolio overview', icon: <IconDashboard />, run: go('/') },
      { id: 'nav-projects', section: 'Navigate', label: 'Projects', icon: <IconProjects />, run: go('/projects') },
      { id: 'nav-resources', section: 'Navigate', label: 'Resources', keywords: 'capacity work center load', icon: <IconProjects />, run: go('/resources') },
      { id: 'nav-integration', section: 'Navigate', label: 'SAP integration', keywords: 'odata gateway connect', icon: <IconPlug />, run: go('/integration') },
      {
        id: 'act-mode',
        section: 'Actions',
        label: mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
        keywords: 'theme dark light color',
        icon: mode === 'dark' ? <IconSun /> : <IconMoon />,
        run: () => {
          setBrand({ ...brand, mode: mode === 'dark' ? 'light' : 'dark' });
          setOpen(false);
        },
      },
    ];
    if (can('Z_COLIBRI_BRAND', '02')) {
      cmds.splice(3, 0, { id: 'nav-studio', section: 'Navigate', label: 'Brand studio', keywords: 'theme white label', icon: <IconStudio />, run: go('/studio') });
    }
    if (can('C_PROJ', '01')) {
      cmds.push({
        id: 'act-new-project',
        section: 'Actions',
        label: 'New project…',
        keywords: 'create add',
        icon: <IconProjects />,
        run: go('/projects?new=1'),
      });
    }
    for (const p of projects) {
      cmds.push({
        id: `proj-${p.projectId}`,
        section: 'Projects',
        label: p.description,
        keywords: p.projectId + ' ' + p.responsible,
        hint: p.projectId,
        run: go(`/projects/${p.projectId}`),
      });
    }
    return cmds;
  }, [projects, navigate, can, brand, mode, setBrand]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => (c.label + ' ' + (c.keywords ?? '')).toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => setSel(0), [filtered.length, query]);

  useEffect(() => {
    listRef.current?.querySelector('.cmdk-item.sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;

  const sections: Command['section'][] = ['Navigate', 'Projects', 'Actions'];

  return (
    <div className="cmdk-overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="cmdk" role="dialog" aria-label="Command palette">
        <input
          autoFocus
          placeholder="Jump to a project, page or action…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter') {
              filtered[sel]?.run();
            }
          }}
        />
        <div className="cmdk-list" ref={listRef}>
          {filtered.length === 0 && <div className="cmdk-empty">Nothing matches “{query}”</div>}
          {sections.map((section) => {
            const items = filtered.filter((c) => c.section === section);
            if (items.length === 0) return null;
            return (
              <div key={section}>
                <div className="cmdk-section">{section}</div>
                {items.map((c) => {
                  const index = filtered.indexOf(c);
                  return (
                    <button
                      key={c.id}
                      className={`cmdk-item ${index === sel ? 'sel' : ''}`}
                      onMouseEnter={() => setSel(index)}
                      onClick={() => c.run()}
                    >
                      {c.icon}
                      {c.label}
                      {c.hint && <span className="hint">{c.hint}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
