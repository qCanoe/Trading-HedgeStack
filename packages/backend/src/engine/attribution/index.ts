/**
 * Fill Attribution Engine
 * Parses clientOrderId to identify account + VirtualPosition mapping,
 * then applies the fill to the VP's book via WAC.
 */
import {
  getVP,
  updateVP,
  saveClientOrderMap,
  getOrderMappingByClientOrderId,
  addFill,
} from '../../store/state.js';
import { applyFillToVP } from './wac.js';
import type { FillRecord, VirtualPosition } from '../../store/types.js';
import type { Symbol, PositionSide, OrderSide } from '../../config/env.js';

function normalizeAccountId(accountId: string): string {
  return accountId.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'main';
}

// ─── clientOrderId encoding ───────────────────────────────────────────────

/**
 * Encode: ACC-{accountId}-VP-{vpShortId}-{ts}-{nonce}
 * Example: ACC-main-VP-abc123-1708700123456-001
 */
export function encodeClientOrderId(vpId: string, accountId = 'main'): string {
  const shortId = vpId.slice(0, 6);
  const ts = Date.now();
  const nonce = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
  return `ACC-${normalizeAccountId(accountId)}-VP-${shortId}-${ts}-${nonce}`;
}

/**
 * Decode vp short id from current and legacy formats.
 */
export function decodeClientOrderId(clientOrderId: string): string | null {
  if (clientOrderId.startsWith('ACC-')) {
    const parts = clientOrderId.split('-');
    const vpIndex = parts.indexOf('VP');
    if (vpIndex === -1 || parts.length < vpIndex + 2) return null;
    return parts[vpIndex + 1] ?? null;
  }

  if (clientOrderId.startsWith('VP-')) {
    const parts = clientOrderId.split('-');
    return parts.length >= 4 ? parts[1] : null;
  }

  return null;
}

/**
 * Decode account id from current and legacy formats.
 */
export function extractAccountIdFromClientOrderId(clientOrderId: string): string | null {
  if (clientOrderId.startsWith('ACC-')) {
    const parts = clientOrderId.split('-');
    return parts.length >= 2 ? normalizeAccountId(parts[1]) : null;
  }
  if (clientOrderId.startsWith('VP-')) {
    return 'main';
  }
  return null;
}

/**
 * Register a clientOrderId mapping before placing an order.
 */
export function registerOrderMapping(clientOrderId: string, accountId: string, vpId: string): void {
  saveClientOrderMap(clientOrderId, {
    account_id: normalizeAccountId(accountId),
    virtual_position_id: vpId,
  });
}

// ─── Binance WS Fill event shape ──────────────────────────────────────────

export interface BinanceFillEvent {
  e: string;
  E: number;
  o: {
    s: string;
    c: string;
    i: number;
    S: string;
    ps: string;
    l: string;
    L: string;
    T: number;
    t: number;
    n: string;
    N: string;
    rp: string;
    X: string;
    q: string;
    p: string;
    sp?: string;
    R: boolean;
    ot: string;
    tf: string;
  };
}

/**
 * Process ORDER_TRADE_UPDATE and update fill + VP book.
 */
export function processBinanceFillEvent(
  event: BinanceFillEvent,
  streamAccountId = 'main'
): {
  fill: FillRecord | null;
  updatedVP: VirtualPosition | null;
  orderId: string;
  status: string;
} {
  const o = event.o;
  const orderId = String(o.i);
  const status = o.X;

  if (!['PARTIALLY_FILLED', 'FILLED'].includes(status)) {
    return { fill: null, updatedVP: null, orderId, status };
  }

  const fillQty = parseFloat(o.l);
  if (fillQty <= 0) {
    return { fill: null, updatedVP: null, orderId, status };
  }

  const mapping = getOrderMappingByClientOrderId(o.c);
  const accountId = mapping?.account_id
    ?? extractAccountIdFromClientOrderId(o.c)
    ?? normalizeAccountId(streamAccountId);
  const vpId = mapping?.virtual_position_id ?? null;

  const fill: FillRecord = {
    tradeId: String(o.t),
    orderId,
    clientOrderId: o.c,
    account_id: accountId,
    virtual_position_id: vpId,
    symbol: o.s as Symbol,
    side: o.S as OrderSide,
    positionSide: o.ps as PositionSide,
    qty: o.l,
    price: o.L,
    commission: o.n,
    commissionAsset: o.N,
    realizedPnl: o.rp,
    ts: o.T,
  };

  addFill(fill);

  let updatedVP: VirtualPosition | null = null;
  if (vpId) {
    const vp = getVP(vpId);
    if (vp && vp.account_id === accountId) {
      updatedVP = applyFillToVP(vp, fill);
      updateVP(updatedVP);
    }
  }

  return { fill, updatedVP, orderId, status };
}

