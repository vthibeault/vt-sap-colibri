const EUR = new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

/** Compact money for tiles and chart labels: €1.2M, €840K. */
export function fmtMoney(value: number, currency = 'EUR'): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const sym = currency === 'EUR' ? '€' : `${currency} `;
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}${sym}${Math.round(abs / 1_000)}K`;
  return `${sign}${sym}${Math.round(abs)}`;
}

export function fmtMoneyFull(value: number): string {
  return EUR.format(value);
}

export function fmtPct(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function fmtDate(isoDate: string | Date): string {
  const d = typeof isoDate === 'string' ? new Date(isoDate) : isoDate;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "2026-03" → "Mar 26". */
export function fmtPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'short' })} ${String(y).slice(2)}`;
}
