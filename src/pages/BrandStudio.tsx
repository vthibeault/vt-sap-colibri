import { DonutChart, LineChart } from 'nova-charts';
import {
  BRAND_PRESETS,
  CHART_PALETTES,
  type BrandConfig,
  type FontStyle,
  type RadiusStyle,
} from '@/theme/branding';
import { useBrand } from '@/state/BrandContext';
import { useAuth } from '@/state/AuthContext';
import { NovaChart } from '@/charts/NovaChart';
import { ChartCard, HealthChip, KpiTile, StatusChip } from '@/components/ui';
import { toast } from '@/lib/toast';
import { fmtMoney } from '@/lib/format';

const ACCENTS = ['#0f766e', '#1d4ed8', '#b91c1c', '#6d28d9', '#0369a1', '#a16207', '#be185d', '#166534', '#0f172a'];

export function BrandStudio() {
  const { brand, setBrand, mode } = useBrand();
  const { can } = useAuth();

  const set = <K extends keyof BrandConfig>(key: K, value: BrandConfig[K]) =>
    setBrand({ ...brand, [key]: value });

  if (!can('Z_COLIBRI_BRAND', '02')) {
    return (
      <div className="empty rise">
        <span className="big">🔒</span>
        <b>Branding is locked for your roles</b>
        <span style={{ fontSize: 12.5 }}>
          Authorization object Z_COLIBRI_BRAND, activity 02 (change) is required — sign in as the
          Platform Administrator persona to try it.
        </span>
      </div>
    );
  }

  return (
    <div className="studio">
      {/* Controls */}
      <div className="grid" style={{ gap: 14 }}>
        <ChartCard title="Presets" sub="one-click corporate identities">
          <div className="preset-row">
            {BRAND_PRESETS.map((preset) => (
              <button
                key={preset.presetId}
                className="preset"
                onClick={() => {
                  const { presetId: _drop, ...config } = preset;
                  setBrand(config);
                  toast(`Brand switched to ${preset.name}`, 'success');
                }}
              >
                <span className="mark" style={{ background: preset.accent }}>
                  {preset.monogram}
                </span>
                <b>{preset.name}</b>
                <span>{preset.tagline}</span>
              </button>
            ))}
          </div>
        </ChartCard>

        <ChartCard title="Identity" sub="every change applies live, everywhere">
          <div className="grid" style={{ gap: 14 }}>
            <div className="grid" style={{ gridTemplateColumns: '1fr 90px', gap: 12 }}>
              <div className="field">
                <label>Product name</label>
                <input className="input" value={brand.name} onChange={(e) => set('name', e.target.value)} />
              </div>
              <div className="field">
                <label>Monogram</label>
                <input
                  className="input"
                  maxLength={2}
                  value={brand.monogram}
                  onChange={(e) => set('monogram', e.target.value.toUpperCase())}
                />
              </div>
            </div>
            <div className="field">
              <label>Tagline</label>
              <input className="input" value={brand.tagline} onChange={(e) => set('tagline', e.target.value)} />
            </div>
            <div className="field">
              <label>Accent color</label>
              <div className="swatches">
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    className={`swatch ${brand.accent === c ? 'on' : ''}`}
                    style={{ background: c }}
                    onClick={() => set('accent', c)}
                    aria-label={`Accent ${c}`}
                  />
                ))}
                <input
                  type="color"
                  value={brand.accent}
                  onChange={(e) => set('accent', e.target.value)}
                  style={{ width: 30, height: 30, border: 'none', background: 'none', cursor: 'pointer' }}
                  aria-label="Custom accent color"
                />
              </div>
            </div>
          </div>
        </ChartCard>

        <ChartCard title="Shape & type" sub="radius, typography, color mode">
          <div className="grid" style={{ gap: 14 }}>
            <div className="field">
              <label>Corner radius</label>
              <div className="segmented">
                {(['sharp', 'soft', 'round'] as RadiusStyle[]).map((r) => (
                  <button key={r} className={brand.radius === r ? 'on' : ''} onClick={() => set('radius', r)}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Typography</label>
              <div className="segmented">
                {(['modern', 'humanist', 'technical'] as FontStyle[]).map((f) => (
                  <button key={f} className={brand.font === f ? 'on' : ''} onClick={() => set('font', f)}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Color mode</label>
              <div className="segmented">
                {(['light', 'dark', 'system'] as const).map((m) => (
                  <button key={m} className={brand.mode === m ? 'on' : ''} onClick={() => set('mode', m)}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </ChartCard>

        <ChartCard title="Chart palette" sub="validated categorical sets (CVD-safe ordering)">
          <div className="grid" style={{ gap: 8 }}>
            {CHART_PALETTES.map((pal) => (
              <button
                key={pal.id}
                className={`palette-opt ${brand.paletteId === pal.id ? 'on' : ''}`}
                onClick={() => set('paletteId', pal.id)}
              >
                <b style={{ fontSize: 12.5, width: 60, textAlign: 'left' }}>{pal.name}</b>
                <span className="strip">
                  {(mode === 'dark' ? pal.dark : pal.light).map((c) => (
                    <i key={c} style={{ background: c }} />
                  ))}
                </span>
              </button>
            ))}
          </div>
        </ChartCard>
      </div>

      {/* Live preview */}
      <div className="grid studio-preview" style={{ gap: 14, position: 'sticky', top: 0 }}>
        <div className="kpi-row">
          <KpiTile index={0} label="Portfolio budget" value={32_450_000} format={fmtMoney} />
          <KpiTile index={1} label="CPI" value={0.97} format={(v) => v.toFixed(2)} delta={{ direction: 'flat', text: 'on plan' }} />
        </div>
        <ChartCard title="Preview · trend" sub="your palette on live charts">
          <NovaChart
            height={210}
            create={(el) =>
              new LineChart(el, {
                curve: 'catmull-rom',
                data: {
                  labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
                  series: [
                    { id: 'plan', name: 'Plan', data: [30, 44, 52, 65, 74, 88] },
                    { id: 'actual', name: 'Actual', data: [28, 47, 55, 61, 78, 84] },
                    { id: 'commit', name: 'Committed', data: [12, 18, 22, 30, 34, 41] },
                  ],
                },
              })
            }
          />
        </ChartCard>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <ChartCard title="Preview · mix" sub="donut">
            <NovaChart
              height={180}
              create={(el) =>
                new DonutChart(el, {
                  innerRadius: 0.66,
                  data: { labels: ['Labor', 'Material', 'Services', 'Travel'], series: [{ id: 'mix', data: [46, 24, 16, 9] }] },
                })
              }
            />
          </ChartCard>
          <ChartCard title="Preview · chrome" sub="chips & controls">
            <div className="grid" style={{ gap: 10 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <StatusChip status="REL" />
                <StatusChip status="TECO" />
                <HealthChip health="good" />
                <HealthChip health="bad" />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn primary sm">Primary</button>
                <button className="btn sm">Secondary</button>
                <button className="btn ghost sm">Ghost</button>
              </div>
              <input className="input" placeholder="Input field" />
            </div>
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
