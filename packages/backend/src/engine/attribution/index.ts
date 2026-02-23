/**
 * Fill Attribution Engine
 * Parses clientOrderId to identify which VirtualPosition a fill belongs to,
 * then applies the fill to the VP's book via WAC.
 */
import { nanoid } from 'nanoid';
import {
  getVP,
  updateVP,
  saveClientOrderMap,
  getVpIdByClientOrderId,
  addFill,
} from '../../store/state.js';
import { applyFillToVP } from './wac.js';
import type { FillRecord, VirtualPosition } from '../../store/types.js';
import type { Symbol, PositionSide, OrderSide } from '../../config/env.js';

// ─── clientOrderId encoding ───────────────────────────────────────────────

/**
 * Encode: VP-{vpShortId}-{ts}-{nonce}
 * Example: VP-abc123-1708700123456-001
 */
export function encodeClientOrderId(vpId: string): string {
  const shortId = vpId.slice(0, 6);
  const ts = Date.now();
  const nonce = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
  return `VP-${shortId}-${ts}-${nonce}`;
}

/**
 * Decode: extract vpShortId from clientOrderId.
 * Returns null for external orders (not prefixed with VP-).
 */
export function decodeClientOrderId(clientOrderId: string): string | null {
  if (!clientOrderId.startsWith('VP-')) return null;
  const parts = clientOrderId.split('-');
  // VP-{shortId}-{ts}-{nonce}  → parts[1] = shortId
  return parts.length >= 4 ? parts[1] : null;
}

/**
 * Register a clientOrderId → vpId mapping before placing an order.
 */
export function registerOrderMapping(clientOrderId: string, vpId: string): void {
  saveClientOrderMap(clientOrderId, vpId);
}

// ─── Binance WS Fill event shape ──────────────────────────────────────────

export interface BinanceFillEvent {
  /** Event type = "ORDER_TRADE_UPDATE" */
  e: string;
  /** Event time */
  E: number;
  /** Order data */
  o: {
    s: string;   // symbol
    c: string;   // clientOrderId
    i: number;   // orderId
    S: string;   // side BUY/SELL
    ps: string;  // positionSide LONG/SHORT
    l: string;   // last filled qty
    L: string;   // last filled price
    T: number;   // trade time
    t: number;   // trade id
    n: string;   // commission
    N: string;   // commission asset
    rp: string;  // realized profit
    X: string;   // order status
    q: string;   // original qty
    p: string;   // price
    sp?: string; // stop price
    R: boolean;  // reduceOnly
    ot: string;  // order type
    tf: string;  // timeInForce
  };
}

/**
 * Process an ORDER_TRADE_UPDATE event from Binance WS.
 * Returns the updated VP if a fill was attributed, otherwise null.
 */
export function processBinanceFillEvent(event: BinanceFillEvent): {
  fill: FillRecord | null;
  updatedVP: VirtualPosition | null;
  orderId: string;
  status: string;
} {
  const o = event.o;
  const orderId = String(o.i);
  const status = o.X;

  // Only process fills (PARTIALLY_FILLED or FILLED)
  if (!['PARTIALLY_FILLED', 'FILLED'].includes(status)) {
    return { fill: null, updatedVP: null, orderId, status };
  }

  const fillQty = parseFloat(o.l);
  if (fillQty <= 0) {
    return { fill: null, updatedVP: null, orderId, status };
  }

  // Resolve virtual_position_id
  const vpId = getVpIdByClientOrderId(o.c);

  const fill: FillRecord = {
    tradeId: String(o.t),
    orderId,
    clientOrderId: o.c,
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
    if (vp) {
      updatedVP = applyFillToVP(vp, fill);
      updateVP(updatedVP);
    }
  }

  return { fill, updatedVP, orderId, status };
}
