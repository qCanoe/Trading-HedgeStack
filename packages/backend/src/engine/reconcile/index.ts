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
  getExternalPositions,
  setConsistencyStatus,
} from '../../store/state.js';
import { broadcast } from '../../ws/gateway.js';
import type { VirtualPosition, ConsistencyStatus, ReconcileRequest } from '../../store/types.js';
import type { Symbol, PositionSide } from '../../config/env.js';

const UNASSIGNED_PREFIX = 'UNASSIGNED';
const EPSILON = 0.0001;

function consistencyKey(accountId: string, symbol: Symbol, positionSide: PositionSide): string {
  return `${accountId}_${symbol}_${positionSide}`;
}

function parseQty(raw: string, label: string): number {
  const val = parseFloat(raw);
  if (!Number.isFinite(val) || val < 0) {
    throw new Error(`Invalid ${label}: ${raw}`);
  }
  return val;
}

/**
 * Check consistency for symbol/positionSide pairs in a single account or all accounts.
 */
export function checkConsistency(accountId?: string): void {
  const vps = getAllVPs(accountId ? { account_id: accountId } : undefined);
  const external = getExternalPositions(accountId ? { account_id: accountId } : undefined);

  const vpTotals = new Map<string, number>();
  for (const vp of vps) {
    const key = consistencyKey(vp.account_id, vp.symbol, vp.positionSide);
    vpTotals.set(key, (vpTotals.get(key) ?? 0) + parseFloat(vp.net_qty));
  }

  const extTotals = new Map<string, number>();
  for (const ext of external) {
    const key = consistencyKey(ext.account_id, ext.symbol, ext.positionSide);
    extTotals.set(key, parseFloat(ext.qty));
  }

  const keys = new Set<string>([...vpTotals.keys(), ...extTotals.keys()]);

  for (const key of keys) {
    const [acc, symbol, positionSide] = key.split('_') as [string, Symbol, PositionSide];
    const vpQty = vpTotals.get(key) ?? 0;
    const extQty = extTotals.get(key) ?? 0;
    const diff = Math.abs(extQty - vpQty);

    const status: ConsistencyStatus = {
      account_id: acc,
      symbol,
      positionSide,
      status: diff < EPSILON ? 'OK' : 'MISMATCH',
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
  const accountId = req.account_id ?? 'main';
  const ext = getExternalPosition(accountId, req.symbol, req.positionSide);
  if (!ext) throw new Error(`No external position found for ${accountId}/${req.symbol} ${req.positionSide}`);

  const extQty = parseFloat(ext.qty);
  let assignedQty = 0;
  const updated: VirtualPosition[] = [];

  for (const assignment of req.assignments) {
    const vp = getVP(assignment.virtual_position_id);
    if (!vp) throw new Error(`VirtualPosition ${assignment.virtual_position_id} not found`);
    if (vp.account_id !== accountId) throw new Error(`VirtualPosition ${vp.id} does not belong to account ${accountId}`);
    if (vp.symbol !== req.symbol || vp.positionSide !== req.positionSide) {
      throw new Error(`VirtualPosition ${vp.id} symbol/side mismatch`);
    }

    const newQty = parseQty(assignment.qty, `assignment qty for ${vp.id}`);
    assignedQty += newQty;

    const updatedVP: VirtualPosition = {
      ...vp,
      net_qty: newQty.toFixed(8),
      avg_entry: ext.avgEntryPrice,
      realized_pnl: vp.realized_pnl,
    };
    updateVP(updatedVP);
    updated.push(updatedVP);
  }

  if (assignedQty > extQty + EPSILON) {
    throw new Error('RECONCILE_OVER_ASSIGNED');
  }

  const remainder = extQty - assignedQty;
  if (remainder > EPSILON) {
    const existing = getAllVPs({ account_id: accountId }).find(
      (v) =>
        v.symbol === req.symbol
        && v.positionSide === req.positionSide
        && v.name.startsWith(UNASSIGNED_PREFIX)
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
        account_id: accountId,
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

  const status: ConsistencyStatus = {
    account_id: accountId,
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

