import { useState } from 'react';
import {
  clearSapConfigOverride,
  resolveSapConfig,
  saveSapConfigOverride,
} from '@/sap/client';
import type { ConnectionInfo } from '@/sap/types';
import { MockSapClient } from '@/sap/mock/mockClient';
import { useSap } from '@/state/SapContext';
import { ChartCard } from '@/components/ui';
import { toast } from '@/lib/toast';
import { IconCheck, IconWarn } from '@/components/icons';

interface Endpoint {
  service: string;
  entity: string;
  purpose: string;
  status: 'mocked' | 'ready' | 'todo';
}

const ENDPOINTS: Endpoint[] = [
  { service: 'API_ENTERPRISE_PROJECT_SRV_0002', entity: 'A_EnterpriseProject', purpose: 'Project definitions', status: 'ready' },
  { service: 'API_ENTERPRISE_PROJECT_SRV_0002', entity: 'A_EnterpriseProjectElement', purpose: 'WBS hierarchy', status: 'ready' },
  { service: 'API_ENTERPRISE_PROJECT_SRV_0002', entity: 'ReleaseProject / CompleteProject', purpose: 'Status changes', status: 'todo' },
  { service: 'custom CDS (ZC_ProjectActivity)', entity: 'network activities', purpose: 'Schedule read/write', status: 'todo' },
  { service: 'custom CDS / C_ProjectActualCostsQry', entity: 'ACDOCA line items', purpose: 'Plan, actual & commitment costs', status: 'todo' },
  { service: 'project milestone view', entity: 'milestones', purpose: 'Milestone tracking', status: 'todo' },
];

export function Integration() {
  const { client, reconnect } = useSap();
  const [config, setConfig] = useState(() => resolveSapConfig());
  const [result, setResult] = useState<ConnectionInfo | null>(null);
  const [testing, setTesting] = useState(false);

  const apply = async () => {
    saveSapConfigOverride({ mode: config.mode, baseUrl: config.baseUrl, sapClient: config.sapClient });
    await reconnect();
    setResult(null);
    toast(config.mode === 'live' ? 'Switched to live SAP gateway' : 'Switched to mock SAP', 'success');
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await client.testConnection());
    } finally {
      setTesting(false);
    }
  };

  const resetDemo = async () => {
    MockSapClient.resetDemoData();
    clearSapConfigOverride();
    setConfig(resolveSapConfig());
    await reconnect();
    toast('Demo data & connection overrides reset', 'success');
  };

  return (
    <div className="grid" style={{ maxWidth: 900 }}>
      <ChartCard title="Data source" sub="Colibri talks to SAP through one swappable client — flip it here when you get system access">
        <div className="grid" style={{ gap: 16 }}>
          <div className="field">
            <label>Mode</label>
            <div className="segmented">
              {(['mock', 'live'] as const).map((m) => (
                <button key={m} className={config.mode === m ? 'on' : ''} onClick={() => setConfig({ ...config, mode: m })}>
                  {m === 'mock' ? 'Mock (in-browser)' : 'Live (OData)'}
                </button>
              ))}
            </div>
          </div>

          {config.mode === 'live' && (
            <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <div className="field">
                <label>Gateway base URL</label>
                <input
                  className="input"
                  placeholder="https://myNNNNNN.s4hana.ondemand.com"
                  value={config.baseUrl}
                  onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                />
              </div>
              <div className="field">
                <label>SAP client (optional)</label>
                <input
                  className="input"
                  placeholder="100"
                  value={config.sapClient ?? ''}
                  onChange={(e) => setConfig({ ...config, sapClient: e.target.value || undefined })}
                />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={() => void apply()}>Apply</button>
            <button className="btn" onClick={() => void test()} disabled={testing}>
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            <span style={{ flex: 1 }} />
            <button className="btn ghost" onClick={() => void resetDemo()}>Reset demo data</button>
          </div>

          {result && (
            <div className={`conn-result ${result.ok ? 'ok' : 'fail'}`}>
              {result.ok ? (
                <IconCheck style={{ width: 20, height: 20, color: 'var(--status-good-ink)' }} />
              ) : (
                <IconWarn style={{ width: 20, height: 20, color: 'var(--status-critical-ink)' }} />
              )}
              <div>
                <b>{result.system}</b>
                <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                  {result.message} · {result.latencyMs} ms
                </div>
              </div>
            </div>
          )}

          <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
            Credentials are never stored in the browser: set <code>VITE_SAP_USER</code> /{' '}
            <code>VITE_SAP_PASSWORD</code> in <code>.env</code> (communication arrangement
            SAP_COM_0308), or rely on SSO cookies. In dev, export <code>SAP_GATEWAY_URL</code> so
            Vite proxies <code>/sap/opu/odata</code> past CORS.
          </p>
        </div>
      </ChartCard>

      <ChartCard title="API surface" sub="what goes live automatically vs. what needs mapping in src/sap/odata.ts">
        <table className="data">
          <thead>
            <tr>
              <th>Service</th>
              <th>Entity / operation</th>
              <th>Purpose</th>
              <th>Live status</th>
            </tr>
          </thead>
          <tbody>
            {ENDPOINTS.map((e) => (
              <tr key={e.service + e.entity} style={{ cursor: 'default' }}>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{e.service}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{e.entity}</td>
                <td>{e.purpose}</td>
                <td>
                  <span className={`endpoint-status ${e.status}`}>
                    {e.status === 'ready' ? 'mapped · ready to test' : e.status === 'todo' ? 'needs mapping' : 'mocked'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 12, lineHeight: 1.6 }}>
          Everything is fully mocked today. “Mapped” rows will work against a real gateway as soon
          as credentials exist; “needs mapping” rows have a documented TODO in{' '}
          <code>src/sap/odata.ts</code> with the recommended SAP service to expose.
        </p>
      </ChartCard>
    </div>
  );
}
