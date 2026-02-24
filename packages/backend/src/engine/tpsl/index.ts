/**
 * TP/SL Lifecycle Manager
 * Handles cancel+create pattern for updating TP/SL orders on Binance.
 */
import type { VirtualPosition, TpSlConfig, SetTpSlRequest } from '../../store/types.js';
import { getVP, updateVP, getAllVPs } from '../../store/state.js';
import type { BinanceRestClient } from '../../binance/rest.js';
import { broadcast } from '../../ws/gateway.js';

/**
 * Set or update TP/SL for a virtual position.
 * Uses cancel+create pattern: cancels existing TP/SL orders, then creates new ones.
 */
export async function setTpSl(
  vpId: string,
  req: SetTpSlRequest,
  rest: BinanceRestClient
): Promise<VirtualPosition> {
  const vp = getVP(vpId);
  if (!vp) throw new Error(`VirtualPosition ${vpId} not found`);
  if (parseFloat(vp.net_qty) === 0) throw new Error('Cannot set TP/SL on empty position');

  const netQty = parseFloat(vp.net_qty);
  const percentQty = req.percent !== undefined ? (netQty * req.percent) / 100 : null;
  const resolvedQty = req.qty !== undefined ? parseFloat(req.qty) : percentQty;
  const qty = resolvedQty === null || Number.isNaN(resolvedQty) ? netQty : resolvedQty;
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error('Invalid TP/SL qty: must be > 0');
  }
  if (qty > netQty) {
    throw new Error('Invalid TP/SL qty: exceeds virtual position size');
  }

  // Mark as SYNCING
  const syncing: TpSlConfig = {
    tp_price: req.tp_price ?? vp.tpsl?.tp_price ?? null,
    tp_trigger_type: req.tp_trigger_type ?? vp.tpsl?.tp_trigger_type ?? 'LAST_PRICE',
    tp_order_id: null,
    sl_price: req.sl_price ?? vp.tpsl?.sl_price ?? null,
    sl_trigger_type: req.sl_trigger_type ?? vp.tpsl?.sl_trigger_type ?? 'MARK_PRICE',
    sl_order_id: null,
    sync_status: 'SYNCING',
  };

  let updated = { ...vp, tpsl: syncing };
  updateVP(updated);
  broadcast({ type: 'TPSL_SYNC_STATUS', payload: { vp_id: vpId, status: 'SYNCING' }, ts: Date.now() });

  try {
    // Cancel existing TP/SL orders
    await cancelExistingTpSl(vp, rest);

    const closeSide = vp.positionSide === 'LONG' ? 'SELL' : 'BUY';
    let tpOrderId: string | null = null;
    let slOrderId: string | null = null;

    // Create TP order
    if (syncing.tp_price) {
      const tpRes = await rest.placeOrder({
        symbol: vp.symbol,
        side: closeSide,
        positionSide: vp.positionSide,
        type: 'TAKE_PROFIT_MARKET',
        stopPrice: syncing.tp_price,
        quantity: qty.toFixed(8),
        reduceOnly: true,
        workingType: syncing.tp_trigger_type === 'LAST_PRICE' ? 'CONTRACT_PRICE' : 'MARK_PRICE',
        timeInForce: 'GTE_GTC',
      });
      tpOrderId = String(tpRes.orderId);
    }

    // Create SL order
    if (syncing.sl_price) {
      const slRes = await rest.placeOrder({
        symbol: vp.symbol,
        side: closeSide,
        positionSide: vp.positionSide,
        type: 'STOP_MARKET',
        stopPrice: syncing.sl_price,
        quantity: qty.toFixed(8),
        reduceOnly: true,
        workingType: syncing.sl_trigger_type === 'LAST_PRICE' ? 'CONTRACT_PRICE' : 'MARK_PRICE',
        timeInForce: 'GTE_GTC',
      });
      slOrderId = String(slRes.orderId);
    }

    const finalTpSl: TpSlConfig = {
      ...syncing,
      tp_order_id: tpOrderId,
      sl_order_id: slOrderId,
      sync_status: 'OK',
    };

    updated = { ...updated, tpsl: finalTpSl };
    updateVP(updated);
    broadcast({
      type: 'TPSL_SYNC_STATUS',
      payload: { vp_id: vpId, status: 'OK', tp_order_id: tpOrderId, sl_order_id: slOrderId },
      ts: Date.now(),
    });

    return updated;
  } catch (err) {
    const errorTpSl: TpSlConfig = { ...syncing, sync_status: 'ERROR' };
    updated = { ...updated, tpsl: errorTpSl };
    updateVP(updated);
    broadcast({ type: 'TPSL_SYNC_STATUS', payload: { vp_id: vpId, status: 'ERROR' }, ts: Date.now() });
    throw err;
  }
}

async function cancelExistingTpSl(vp: VirtualPosition, rest: BinanceRestClient): Promise<void> {
  const tpsl = vp.tpsl;
  if (!tpsl) return;
  const cancels: Promise<unknown>[] = [];
  if (tpsl.tp_order_id) {
    cancels.push(
      rest.cancelOrder(vp.symbol, tpsl.tp_order_id).catch(() => {/* already filled/canceled */})
    );
  }
  if (tpsl.sl_order_id) {
    cancels.push(
      rest.cancelOrder(vp.symbol, tpsl.sl_order_id).catch(() => {/* already filled/canceled */})
    );
  }
  await Promise.all(cancels);
}

/**
 * Remove TP/SL from a VP (cancel orders on Binance).
 */
export async function clearTpSl(vpId: string, rest: BinanceRestClient): Promise<VirtualPosition> {
  const vp = getVP(vpId);
  if (!vp) throw new Error(`VirtualPosition ${vpId} not found`);
  await cancelExistingTpSl(vp, rest);
  const updated = { ...vp, tpsl: null };
  updateVP(updated);
  return updated;
}

/**
 * When a TP/SL order is filled (triggered), clear it from the VP's tpsl config.
 */
export function handleTpSlFilled(orderId: string): void {
  for (const vp of getAllVPs()) {
    if (!vp.tpsl) continue;
    const matched =
      vp.tpsl.tp_order_id === orderId || vp.tpsl.sl_order_id === orderId;
    if (matched) {
      const newTpSl: TpSlConfig = {
        ...vp.tpsl,
        tp_order_id: vp.tpsl.tp_order_id === orderId ? null : vp.tpsl.tp_order_id,
        sl_order_id: vp.tpsl.sl_order_id === orderId ? null : vp.tpsl.sl_order_id,
        sync_status: 'OK',
      };
      // Clear entirely if both are gone
      const cleared = !newTpSl.tp_order_id && !newTpSl.sl_order_id;
      const updated = { ...vp, tpsl: cleared ? null : newTpSl };
      updateVP(updated);
      broadcast({ type: 'VIRTUAL_POSITION_UPDATE', payload: updated, ts: Date.now() });
      break;
    }
  }
}
