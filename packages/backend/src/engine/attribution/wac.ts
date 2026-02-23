/**
 * WAC (Weighted Average Cost) calculation engine.
 * Handles VP book updates when fills arrive.
 */
import type { VirtualPosition, FillRecord } from '../../store/types.js';

/**
 * Apply a fill to a virtual position and return the updated VP.
 * - Open (add): updates avg_entry via WAC formula
 * - Close (reduce): updates realized_pnl, avg_entry stays unchanged
 */
export function applyFillToVP(vp: VirtualPosition, fill: FillRecord): VirtualPosition {
  const fillQty = parseFloat(fill.qty);
  const fillPrice = parseFloat(fill.price);
  const netQty = parseFloat(vp.net_qty);
  const avgEntry = parseFloat(vp.avg_entry);
  const realizedPnl = parseFloat(vp.realized_pnl);
  const directionSign = vp.positionSide === 'LONG' ? 1 : -1;

  // Determine if this fill is opening or closing
  const isOpening =
    (vp.positionSide === 'LONG' && fill.side === 'BUY') ||
    (vp.positionSide === 'SHORT' && fill.side === 'SELL');

  let newNetQty: number;
  let newAvgEntry: number;
  let newRealizedPnl: number;

  if (isOpening) {
    // Opening / adding to position → WAC update
    if (netQty === 0) {
      newAvgEntry = fillPrice;
    } else {
      newAvgEntry = (netQty * avgEntry + fillQty * fillPrice) / (netQty + fillQty);
    }
    newNetQty = netQty + fillQty;
    newRealizedPnl = realizedPnl;
  } else {
    // Closing / reducing position → realized PnL update
    const closeQty = Math.min(fillQty, netQty);
    newRealizedPnl = realizedPnl + closeQty * (fillPrice - avgEntry) * directionSign;
    newNetQty = Math.max(0, netQty - closeQty);
    newAvgEntry = newNetQty === 0 ? 0 : avgEntry; // avg stays same when reducing
  }

  return {
    ...vp,
    net_qty: toFixed8(newNetQty),
    avg_entry: toFixed8(newAvgEntry),
    realized_pnl: toFixed8(newRealizedPnl),
  };
}

/**
 * Calculate unrealized PnL for a VP given current mark price.
 */
export function calcUnrealizedPnl(vp: VirtualPosition, markPrice: number): number {
  const qty = parseFloat(vp.net_qty);
  const avgEntry = parseFloat(vp.avg_entry);
  const dirSign = vp.positionSide === 'LONG' ? 1 : -1;
  return qty * (markPrice - avgEntry) * dirSign;
}

function toFixed8(n: number): string {
  return n.toFixed(8).replace(/\.?0+$/, '') || '0';
}
