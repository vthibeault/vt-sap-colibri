import { useMemo, useState } from 'react';
import { WaterfallChart } from 'nova-charts';
import type { BudgetDocument, WbsElement } from '@/sap/types';
import { useSapData } from '@/hooks/useSapData';
import { useSap } from '@/state/SapContext';
import { useAuth } from '@/state/AuthContext';
import { fmtDate, fmtMoney, fmtMoneyFull } from '@/lib/format';
import { exportCsv } from '@/lib/csv';
import { toast } from '@/lib/toast';
import { NovaChart } from '@/charts/NovaChart';
import { ChartCard, KpiTile, Skeleton } from '@/components/ui';
import { IconLock } from '@/components/icons';

const DOC_LABEL: Record<BudgetDocument['type'], string> = {
  ORIG: 'Original',
  SUPL: 'Supplement',
  RETN: 'Return',
};

export function BudgetPanel({ projectId }: { projectId: string }) {
  const { client } = useSap();
  const { can } = useAuth();
  const wbs = useSapData((c) => c.getWbsElements(projectId), [projectId]);
  const docs = useSapData((c) => c.getBudgetDocuments(projectId), [projectId]);
  const [adjusting, setAdjusting] = useState<WbsElement | null>(null);

  const phases = useMemo(() => (wbs.data ?? []).filter((w) => w.parentWbsId), [wbs.data]);
  const posted = useMemo(() => (docs.data ?? []).filter((d) => d.type !== 'ORIG'), [docs.data]);
  const canChange = can('K_BUDG', '02');

  const totals = useMemo(() => {
    const orig = (docs.data ?? []).filter((d) => d.type === 'ORIG').reduce((s, d) => s + d.amount, 0);
    const supl = posted.filter((d) => d.amount > 0).reduce((s, d) => s + d.amount, 0);
    const retn = posted.filter((d) => d.amount < 0).reduce((s, d) => s + d.amount, 0);
    return { orig, supl, retn, current: orig + supl + retn };
  }, [docs.data, posted]);

  const waterfall = useMemo(() => {
    const labels = ['Original', ...posted.map((d) => `${DOC_LABEL[d.type]} · ${d.wbsId.split('.').pop()}`)];
    const values = [totals.orig, ...posted.map((d) => d.amount)];
    return { labels, values };
  }, [posted, totals.orig]);

  const reloadAll = () => {
    wbs.reload();
    docs.reload();
  };

  if (wbs.loading || docs.loading || !wbs.data || !docs.data) {
    return (
      <div className="grid">
        <Skeleton height={100} />
        <Skeleton height={300} />
      </div>
    );
  }

  return (
    <div className="grid">
      <div className="kpi-row">
        <KpiTile index={0} label="Current budget" value={totals.current} format={fmtMoney} />
        <KpiTile index={1} label="Original budget" value={totals.orig} format={fmtMoney} />
        <KpiTile
          index={2}
          label="Supplements"
          value={totals.supl}
          format={fmtMoney}
          delta={posted.length ? { direction: 'up', text: `${posted.filter((d) => d.amount > 0).length} docs` } : undefined}
        />
        <KpiTile
          index={3}
          label="Returns"
          value={Math.abs(totals.retn)}
          format={fmtMoney}
          delta={totals.retn < 0 ? { direction: 'down', text: `${posted.filter((d) => d.amount < 0).length} docs` } : undefined}
        />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
        <ChartCard title="Budget evolution" sub="original → every posted change → current (morphs as you post)">
          <NovaChart
            height={300}
            create={(el) =>
              new WaterfallChart(el, {
                data: { labels: waterfall.labels, series: [{ id: 'budget', data: waterfall.values }] },
                total: 'Current',
                axes: { y: { format: (v) => fmtMoney(Number(v)) } },
              })
            }
            update={(chart) =>
              chart.setData({ labels: waterfall.labels, series: [{ id: 'budget', data: waterfall.values }] })
            }
            updateDeps={[waterfall]}
          />
        </ChartCard>

        <ChartCard
          title="Phase budgets"
          sub={canChange ? 'adjust posts a supplement / return document' : 'authorization K_BUDG/02 required to change'}
          actions={
            !canChange ? (
              <span className="conn-badge">
                <IconLock style={{ width: 12, height: 12 }} /> display only
              </span>
            ) : undefined
          }
        >
          <table className="data">
            <thead>
              <tr>
                <th>Phase</th>
                <th className="num">Budget</th>
                <th className="num">Actual</th>
                <th className="num">Available</th>
                {canChange && <th />}
              </tr>
            </thead>
            <tbody>
              {phases.map((w) => {
                const available = w.budget - w.actualCost - w.commitment;
                return (
                  <tr key={w.wbsId} style={{ cursor: 'default' }}>
                    <td>
                      <b>{w.description}</b>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{w.wbsId}</div>
                    </td>
                    <td className="num">{fmtMoney(w.budget)}</td>
                    <td className="num">{fmtMoney(w.actualCost)}</td>
                    <td className="num" style={{ color: available < 0 ? 'var(--status-critical-ink)' : undefined }}>
                      {fmtMoney(available)}
                    </td>
                    {canChange && (
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn sm" onClick={() => setAdjusting(w)}>
                          Adjust
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ChartCard>
      </div>

      <ChartCard
        title="Budget documents"
        sub="every budgeting transaction, SAP-style"
        actions={
          <button
            className="btn sm ghost"
            onClick={() =>
              exportCsv(
                `${projectId}-budget-documents.csv`,
                ['Document', 'Date', 'WBS', 'Type', 'Amount (EUR)', 'Reason', 'User'],
                (docs.data ?? []).map((d) => [d.id, d.date, d.wbsId, DOC_LABEL[d.type], d.amount, d.reason, d.user]),
              )
            }
          >
            Export CSV
          </button>
        }
      >
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th>WBS</th>
              <th>Type</th>
              <th className="num">Amount</th>
              <th>Reason</th>
              <th>User</th>
            </tr>
          </thead>
          <tbody>
            {[...docs.data].reverse().map((d) => (
              <tr key={d.id} style={{ cursor: 'default' }}>
                <td>{fmtDate(d.date)}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{d.wbsId}</td>
                <td>
                  <span className={`status-chip ${d.type === 'SUPL' ? 'health-good' : d.type === 'RETN' ? 'health-warn' : 'CRTD'}`}>
                    <span className="dot" />
                    {DOC_LABEL[d.type]}
                  </span>
                </td>
                <td className="num" style={{ color: d.amount < 0 ? 'var(--status-critical-ink)' : undefined }}>
                  {fmtMoneyFull(d.amount)}
                </td>
                <td>{d.reason}</td>
                <td style={{ color: 'var(--text-3)' }}>{d.user}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartCard>

      {adjusting && (
        <AdjustBudgetModal
          wbs={adjusting}
          onClose={() => setAdjusting(null)}
          onPost={async (newBudget, reason) => {
            try {
              await client.updateBudget(projectId, adjusting.wbsId, newBudget, reason);
              toast(
                `Budget ${newBudget >= adjusting.budget ? 'supplement' : 'return'} posted for ${adjusting.wbsId}`,
                'success',
              );
              setAdjusting(null);
              reloadAll();
            } catch (err) {
              toast(err instanceof Error ? err.message : 'Posting failed', 'error');
            }
          }}
        />
      )}
    </div>
  );
}

function AdjustBudgetModal({
  wbs,
  onClose,
  onPost,
}: {
  wbs: WbsElement;
  onClose: () => void;
  onPost: (newBudget: number, reason: string) => Promise<void>;
}) {
  const [value, setValue] = useState(wbs.budget);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const delta = value - wbs.budget;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(440px, 100%)' }} role="dialog" aria-label="Adjust budget">
        <div className="modal-head">
          <h2>Adjust budget · {wbs.description}</h2>
        </div>
        <div className="modal-body grid" style={{ gap: 14 }}>
          <div className="field">
            <label>New budget (EUR) — currently {fmtMoneyFull(wbs.budget)}</label>
            <input
              className="input"
              type="number"
              step={10_000}
              min={0}
              autoFocus
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label>Reason</label>
            <input
              className="input"
              placeholder="e.g. Scope extension wave 2 approved by steering board"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {delta !== 0 && (
            <p style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
              Posts a <b>{delta > 0 ? 'supplement' : 'return'}</b> of{' '}
              <b style={{ color: delta > 0 ? 'var(--status-good-ink)' : 'var(--status-critical-ink)' }}>
                {fmtMoneyFull(Math.abs(delta))}
              </b>{' '}
              against {wbs.wbsId}.
            </p>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <span style={{ flex: 1 }} />
          <button
            className="btn primary"
            disabled={busy || delta === 0 || reason.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              await onPost(value, reason);
              setBusy(false);
            }}
          >
            {busy ? 'Posting…' : 'Post document'}
          </button>
        </div>
      </div>
    </div>
  );
}
