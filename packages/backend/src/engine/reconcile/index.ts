/**
 * Reconcile Engine
 * Detects mismatches between Binance real positions and VP ledger totals,
 * and applies user-defined re-assignments.
 */
import { nanoid } from 'nanoid';
import {
  getAllVPs,
  getVP,
  updateVP,
  createVP,
  getExternalPosition,
  setConsistencyStatus,
} from '../../store/state.js';
import { broadcast } from '../../ws/gateway.js';
import type { VirtualPosition, ConsistencyStatus, ReconcileRequest } from '../../store/types.js';
import type { Symbol, PositionSide } from '../../config/env.js';

const UNASSIGNED_PREFIX = 'UNASSIGNED';

/**
 * Check consistency for all symbol/positionSide pairs.
 * Emits CONSISTENCY_STATUS events for any mismatches.
 */
export function checkConsistency(): void {
  const vps = getAllVPs();

  // Group VP totals by (symbol, positionSide)
  const vpTotals = new Map<string, number>();
  for (const vp of vps) {
    const key = `${vp.symbol}_${vp.positionSide}`;
    vpTotals.set(key, (vpTotals.get(key) ?? 0) + parseFloat(vp.net_qty));
  }

  // Compare with external positions
  for (const [key, vpQty] of vpTotals.entries()) {
    const [symbol, positionSide] = key.split('_') as [Symbol, PositionSide];
    const ext = getExternalPosition(symbol, positionSide);
    const extQty = ext ? parseFloat(ext.qty) : 0;

    const diff = Math.abs(extQty - vpQty);
    const status: ConsistencyStatus = {
      symbol,
      positionSide,
      status: diff < 0.0001 ? 'OK' : 'MISMATCH',
      external_qty: extQty.toString(),
      virtual_qty: vpQty.toFixed(8),
    };

    setConsistencyStatus(status);
    broadcast({ type: 'CONSISTENCY_STATUS', payload: status, ts: Date.now() });
  }
}

/**
 * Apply a reconcile request: re-distribute external qty among VPs.
 * Any difference is assigned to an UNASSIGNED VP.
 */
export function applyReconcile(req: ReconcileRequest): VirtualPosition[] {
  const ext = getExternalPosition(req.symbol, req.positionSide);
  if (!ext) throw new Error(`No external position found for ${req.symbol} ${req.positionSide}`);

  const extQty = parseFloat(ext.qty);
  let assignedQty = 0;

  const updated: VirtualPosition[] = [];

  for (const assignment of req.assignments) {
    const vp = getVP(assignment.virtual_position_id);
    if (!vp) throw new Error(`VirtualPosition ${assignment.virtual_position_id} not found`);

    const newQty = parseFloat(assignment.qty);
    assignedQty += newQty;

    const updatedVP: VirtualPosition = {
      ...vp,
      net_qty: newQty.toFixed(8),
      avg_entry: ext.avgEntryPrice, // Reset to current external entry
      realized_pnl: vp.realized_pnl, // Keep accumulated PnL
    };
    updateVP(updatedVP);
    updated.push(updatedVP);
  }

  // Handle remainder → UNASSIGNED VP
  const remainder = extQty - assignedQty;
  if (remainder > 0.0001) {
    // Find or create UNASSIGNED VP
    const existing = getAllVPs().find(
      (v) =>
        v.symbol === req.symbol &&
        v.positionSide === req.positionSide &&
        v.name.startsWith(UNASSIGNED_PREFIX)
    );

    if (existing) {
      const updatedUnassigned: VirtualPosition = {
        ...existing,
        net_qty: remainder.toFixed(8),
        avg_entry: ext.avgEntryPrice,
      };
      updateVP(updatedUnassigned);
      updated.push(updatedUnassigned);
    } else {
      const unassigned: VirtualPosition = {
        id: `vp_${nanoid(8)}`,
        name: `${UNASSIGNED_PREFIX}-${req.positionSide}`,
        symbol: req.symbol,
        positionSide: req.positionSide,
        net_qty: remainder.toFixed(8),
        avg_entry: ext.avgEntryPrice,
        realized_pnl: '0',
        tpsl: null,
        created_at: Date.now(),
      };
      createVP(unassigned);
      updated.push(unassigned);
    }
  }

  // Update consistency status
  const status: ConsistencyStatus = {
    symbol: req.symbol,
    positionSide: req.positionSide,
    status: 'OK',
    external_qty: extQty.toString(),
    virtual_qty: extQty.toFixed(8),
  };
  setConsistencyStatus(status);
  broadcast({ type: 'CONSISTENCY_STATUS', payload: status, ts: Date.now() });

  return updated;
}
