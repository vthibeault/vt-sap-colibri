import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NewProjectInput, ProjectPriority } from '@/sap/types';
import { useSap } from '@/state/SapContext';
import { fmtMoney, fmtDate } from '@/lib/format';
import { toast } from '@/lib/toast';

interface PhaseTemplate {
  id: string;
  name: string;
  blurb: string;
  phases: { name: string; share: number }[];
}

const TEMPLATES: PhaseTemplate[] = [
  {
    id: 'capex',
    name: 'Capital investment',
    blurb: 'Engineer → build → commission',
    phases: [
      { name: 'Engineering', share: 0.2 },
      { name: 'Procurement & Construction', share: 0.55 },
      { name: 'Commissioning', share: 0.25 },
    ],
  },
  {
    id: 'it',
    name: 'IT implementation',
    blurb: 'Design → build → test → deploy',
    phases: [
      { name: 'Discover & Design', share: 0.25 },
      { name: 'Build & Integrate', share: 0.4 },
      { name: 'Test & Validate', share: 0.2 },
      { name: 'Deploy & Hypercare', share: 0.15 },
    ],
  },
  {
    id: 'rollout',
    name: 'Rollout program',
    blurb: 'Template → waves → stabilise',
    phases: [
      { name: 'Template design', share: 0.25 },
      { name: 'Site rollouts', share: 0.5 },
      { name: 'Stabilisation', share: 0.25 },
    ],
  },
];

const PRIORITIES: ProjectPriority[] = ['strategic', 'high', 'medium', 'low'];

export function NewProjectWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { client } = useSap();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState<NewProjectInput>({
    description: '',
    profile: 'ZPS_CAPEX',
    priority: 'medium',
    responsible: '',
    startDate: new Date().toISOString().slice(0, 10),
    months: 12,
    budget: 1_000_000,
    phases: TEMPLATES[0].phases.map((p) => ({ ...p })),
  });
  const [templateId, setTemplateId] = useState('capex');

  const set = <K extends keyof NewProjectInput>(key: K, value: NewProjectInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const shareSum = useMemo(() => form.phases.reduce((s, p) => s + p.share, 0), [form.phases]);
  const basicsValid = form.description.trim().length >= 3 && form.responsible.trim().length >= 2 && form.budget > 0;
  const phasesValid = form.phases.length >= 2 && form.phases.every((p) => p.name.trim().length >= 2);

  const create = async () => {
    setBusy(true);
    try {
      const project = await client.createProject(form);
      toast(`Project ${project.projectId} created in SAP (status CRTD)`, 'success');
      onCreated();
      onClose();
      navigate(`/projects/${project.projectId}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Create failed', 'error');
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Create project">
        <div className="modal-head">
          <h2>New project</h2>
          <button className="btn ghost sm" onClick={onClose}>Cancel</button>
        </div>
        <div className="modal-body grid" style={{ gap: 16 }}>
          <div className="wizard-steps" aria-hidden>
            {[0, 1, 2].map((i) => (
              <i key={i} className={i <= step ? 'done' : ''} />
            ))}
          </div>

          {step === 0 && (
            <div className="wizard-pane grid" style={{ gap: 14 }}>
              <div className="field">
                <label>Project name</label>
                <input
                  className="input"
                  autoFocus
                  placeholder="e.g. Aurora · Battery Plant Phase 2"
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              </div>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="field">
                  <label>Responsible</label>
                  <input className="input" placeholder="Project manager" value={form.responsible} onChange={(e) => set('responsible', e.target.value)} />
                </div>
                <div className="field">
                  <label>Project profile</label>
                  <select className="input" value={form.profile} onChange={(e) => set('profile', e.target.value)}>
                    <option value="ZPS_CAPEX">ZPS_CAPEX — capital investment</option>
                    <option value="ZPS_INVEST">ZPS_INVEST — internal investment</option>
                    <option value="ZPS_OPEX">ZPS_OPEX — operational</option>
                  </select>
                </div>
              </div>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="field">
                  <label>Start date</label>
                  <input className="input" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
                </div>
                <div className="field">
                  <label>Duration (months)</label>
                  <input className="input" type="number" min={1} max={60} value={form.months} onChange={(e) => set('months', Number(e.target.value))} />
                </div>
                <div className="field">
                  <label>Budget (EUR)</label>
                  <input className="input" type="number" min={0} step={50_000} value={form.budget} onChange={(e) => set('budget', Number(e.target.value))} />
                </div>
              </div>
              <div className="field">
                <label>Priority</label>
                <div className="segmented">
                  {PRIORITIES.map((p) => (
                    <button key={p} className={form.priority === p ? 'on' : ''} onClick={() => set('priority', p)}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="wizard-pane grid" style={{ gap: 14 }}>
              <div className="field">
                <label>Phase template</label>
                <div className="chip-row">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      className={`chip ${templateId === t.id ? 'on' : ''}`}
                      title={t.blurb}
                      onClick={() => {
                        setTemplateId(t.id);
                        set('phases', t.phases.map((p) => ({ ...p })));
                      }}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>WBS phases (budget share)</label>
                <div className="grid" style={{ gap: 8 }}>
                  {form.phases.map((phase, i) => (
                    <div className="phase-row" key={i} style={{ animationDelay: `${i * 40}ms` }}>
                      <input
                        className="input"
                        value={phase.name}
                        onChange={(e) =>
                          set('phases', form.phases.map((p, j) => (j === i ? { ...p, name: e.target.value } : p)))
                        }
                      />
                      <input
                        type="range"
                        min={5}
                        max={80}
                        value={Math.round((phase.share / shareSum) * 100)}
                        onChange={(e) =>
                          set('phases', form.phases.map((p, j) => (j === i ? { ...p, share: Number(e.target.value) / 100 } : p)))
                        }
                        aria-label={`${phase.name} budget share`}
                      />
                      <span className="share">{Math.round((phase.share / shareSum) * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn sm"
                  onClick={() => set('phases', [...form.phases, { name: `Phase ${form.phases.length + 1}`, share: 0.15 }])}
                >
                  + Add phase
                </button>
                {form.phases.length > 2 && (
                  <button className="btn sm ghost" onClick={() => set('phases', form.phases.slice(0, -1))}>
                    Remove last
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="wizard-pane grid" style={{ gap: 14 }}>
              <div className="review-box">
                <div className="row"><span>Project</span><b>{form.description}</b></div>
                <div className="row"><span>Profile / priority</span><b>{form.profile} · {form.priority}</b></div>
                <div className="row"><span>Responsible</span><b>{form.responsible}</b></div>
                <div className="row"><span>Timeline</span><b>{fmtDate(form.startDate)} · {form.months} months</b></div>
                <div className="row"><span>Budget</span><b>{fmtMoney(form.budget)}</b></div>
                <div className="row">
                  <span>WBS</span>
                  <b>{form.phases.map((p) => p.name).join(' → ')}</b>
                </div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
                Creates the project definition (status CRTD) with one WBS element per phase and a
                starter activity chain you can refine in the Gantt editor. In live mode this posts
                to <code>A_EnterpriseProject</code> / <code>A_EnterpriseProjectElement</code>.
              </p>
            </div>
          )}
        </div>
        <div className="modal-foot">
          {step > 0 && (
            <button className="btn" onClick={() => setStep(step - 1)} disabled={busy}>
              Back
            </button>
          )}
          <span style={{ flex: 1 }} />
          {step < 2 ? (
            <button
              className="btn primary"
              disabled={step === 0 ? !basicsValid : !phasesValid}
              onClick={() => setStep(step + 1)}
            >
              Continue
            </button>
          ) : (
            <button className="btn primary" disabled={busy} onClick={() => void create()}>
              {busy ? 'Creating in SAP…' : 'Create project'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
