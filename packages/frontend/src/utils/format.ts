/**
 * Formatting utilities.
 */

export function fmtPrice(price: string | number | null | undefined, decimals = 2): string {
  if (price == null || price === '' || price === '0') return '—';
  const n = parseFloat(String(price));
  if (isNaN(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtQty(qty: string | number | null | undefined, decimals = 3): string {
  if (qty == null || qty === '') return '0';
  const n = parseFloat(String(qty));
  if (isNaN(n)) return '0';
  return n.toFixed(decimals);
}

export function fmtPnl(pnl: string | number | null | undefined): string {
  if (pnl == null) return '0.00';
  const n = parseFloat(String(pnl));
  if (isNaN(n)) return '0.00';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}`;
}

export function pnlColor(pnl: string | number | null | undefined): string {
  const n = parseFloat(String(pnl ?? 0));
  if (n > 0) return '#0ecb81';
  if (n < 0) return '#f6465d';
  return '#848e9c';
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function calcUPnl(
  qty: string,
  avgEntry: string,
  markPrice: string,
  positionSide: 'LONG' | 'SHORT'
): number {
  const q = parseFloat(qty);
  const avg = parseFloat(avgEntry);
  const mark = parseFloat(markPrice);
  if (!q || !avg || !mark) return 0;
  const sign = positionSide === 'LONG' ? 1 : -1;
  return q * (mark - avg) * sign;
}
