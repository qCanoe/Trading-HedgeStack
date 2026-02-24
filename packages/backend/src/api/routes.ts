/**
 * REST API routes — /v1/...
 */
import { nanoid } from 'nanoid';
import type { FastifyInstance } from 'fastify';
import { getUserDataStreamStatus } from '../binance/ws.js';
import { BinanceClientPool } from '../binance/pool.js';
import {
  getAllVPs,
  getVP,
  createVP,
  deleteVP,
  getOpenOrders,
  getRecentFills,
  getExternalPositions,
  getAllMarketTicks,
  getConsistencyStatuses,
  upsertOrder,
  getOrder,
} from '../store/state.js';
import { encodeClientOrderId, registerOrderMapping } from '../engine/attribution/index.js';
import { setTpSl, clearTpSl } from '../engine/tpsl/index.js';
import { applyReconcile } from '../engine/reconcile/index.js';
import { broadcast } from '../ws/gateway.js';
import type {
  VirtualPosition,
  CreateVirtualPositionRequest,
  PlaceOrderRequest,
  ClosePositionRequest,
  SetTpSlRequest,
  ReconcileRequest,
} from '../store/types.js';
import type { Symbol, PositionSide } from '../config/env.js';

function normalizeAccountId(accountId?: string): string {
  return accountId?.trim().toLowerCase() || 'main';
}

export function registerRoutes(fastify: FastifyInstance, pool: BinanceClientPool): void {
  // ─── GET /v1/accounts ───────────────────────────────────────────────────
  fastify.get('/v1/accounts', async () => {
    return pool.getAllAccounts().map((acc) => ({
      id: acc.id,
      name: acc.name,
      type: acc.type,
      testnet: acc.testnet,
      enabled: acc.enabled,
      ws_status: getUserDataStreamStatus(acc.id),
    }));
  });

  // ─── GET /v1/state ──────────────────────────────────────────────────────
  fastify.get<{ Querystring: { account_id?: string; symbol?: string } }>('/v1/state', async (req) => {
    const accountId = req.query.account_id ? normalizeAccountId(req.query.account_id) : undefined;
    const symbol = req.query.symbol as Symbol | undefined;
    const filter = {
      ...(accountId ? { account_id: accountId } : {}),
      ...(symbol ? { symbol } : {}),
    };

    const vps = getAllVPs(filter);
    const externalPositions = getExternalPositions(filter);
    const market = getAllMarketTicks();
    const consistencyStatuses = getConsistencyStatuses(filter);
    const reconcile: Record<string, Record<string, string>> = {};
    for (const s of consistencyStatuses) {
      if (!reconcile[s.account_id]) reconcile[s.account_id] = {};
      reconcile[s.account_id][`${s.symbol}_${s.positionSide}`] = s.status;
    }

    return {
      external_positions: externalPositions,
      virtual_positions: vps,
      open_orders: getOpenOrders(filter),
      recent_fills: getRecentFills(filter),
      market,
      consistency: consistencyStatuses,
      reconcile,
    };
  });

  // ─── POST /v1/virtual-positions ─────────────────────────────────────────
  fastify.post<{ Body: CreateVirtualPositionRequest }>('/v1/virtual-positions', async (req, reply) => {
    const { name, symbol, positionSide } = req.body;
    const accountId = normalizeAccountId(req.body.account_id);

    if (!name || !symbol || !positionSide) {
      return reply.status(400).send({ error: 'INVALID_REQUEST', message: 'name, symbol, positionSide required' });
    }
    if (!pool.hasAccount(accountId) || !pool.isEnabled(accountId)) {
      return reply.status(400).send({ error: 'INVALID_ACCOUNT', message: `Unavailable account_id: ${accountId}` });
    }

    const vp: VirtualPosition = {
      id: `vp_${nanoid(8)}`,
      account_id: accountId,
      name,
      symbol: symbol as Symbol,
      positionSide: positionSide as PositionSide,
      net_qty: '0',
      avg_entry: '0',
      realized_pnl: '0',
      tpsl: null,
      created_at: Date.now(),
    };
    createVP(vp);
    broadcast({ type: 'VIRTUAL_POSITION_UPDATE', payload: vp, ts: Date.now() });
    return reply.status(201).send(vp);
  });

  // ─── DELETE /v1/virtual-positions/:id ───────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/v1/virtual-positions/:id', async (req, reply) => {
    const vp = getVP(req.params.id);
    if (!vp) return reply.status(404).send({ error: 'NOT_FOUND', message: 'VirtualPosition not found' });
    if (parseFloat(vp.net_qty) !== 0) {
      return reply.status(409).send({ error: 'NON_EMPTY', message: 'Cannot delete VP with open position' });
    }
    deleteVP(req.params.id);
    return { success: true };
  });

  // ─── POST /v1/orders ─────────────────────────────────────────────────────
  fastify.post<{ Body: PlaceOrderRequest }>('/v1/orders', async (req, reply) => {
    const body = req.body;
    const vp = getVP(body.virtual_position_id);
    if (!vp) {
      return reply.status(400).send({ error: 'INVALID_VP', message: 'VirtualPosition not found' });
    }
    if (vp.symbol !== body.symbol || vp.positionSide !== body.positionSide) {
      return reply.status(400).send({
        error: 'VP_DOMAIN_MISMATCH',
        message: `VP domain mismatch: VP=${vp.symbol}/${vp.positionSide}, req=${body.symbol}/${body.positionSide}`,
      });
    }

    const accountId = normalizeAccountId(body.account_id ?? vp.account_id);
    if (accountId !== vp.account_id) {
      return reply.status(400).send({
        error: 'VP_ACCOUNT_MISMATCH',
        message: `VP belongs to ${vp.account_id}, but request account_id is ${accountId}`,
      });
    }
    if (!pool.hasAccount(accountId) || !pool.isEnabled(accountId)) {
      return reply.status(400).send({ error: 'INVALID_ACCOUNT', message: `Unavailable account_id: ${accountId}` });
    }

    const clientOrderId = encodeClientOrderId(vp.id, accountId);
    registerOrderMapping(clientOrderId, accountId, vp.id);

    try {
      const result = await pool.getClient(accountId).placeOrder({
        symbol: body.symbol,
        side: body.side,
        positionSide: body.positionSide,
        type: body.type,
        quantity: body.qty,
        price: body.price,
        stopPrice: body.stopPrice,
        reduceOnly: body.reduceOnly,
        timeInForce: body.timeInForce,
        newClientOrderId: clientOrderId,
      });

      const order = {
        orderId: String(result.orderId),
        clientOrderId,
        account_id: accountId,
        virtual_position_id: vp.id,
        symbol: body.symbol,
        side: body.side,
        positionSide: body.positionSide,
        type: body.type,
        qty: body.qty,
        price: body.price ?? null,
        stopPrice: body.stopPrice ?? null,
        status: result.status,
        reduceOnly: body.reduceOnly ?? false,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      upsertOrder(order);
      broadcast({ type: 'ORDER_UPSERT', payload: order, ts: Date.now() });

      return { orderId: String(result.orderId), clientOrderId, status: result.status };
    } catch (err: any) {
      const msg = err?.response?.data?.msg ?? err?.message ?? 'Unknown error';
      return reply.status(502).send({ error: 'BINANCE_ERROR', message: msg });
    }
  });

  // ─── POST /v1/orders/:orderId/cancel ─────────────────────────────────────
  fastify.post<{ Params: { orderId: string }; Body: { symbol: string; account_id?: string } }>(
    '/v1/orders/:orderId/cancel',
    async (req, reply) => {
      const { orderId } = req.params;
      const { symbol } = req.body;
      if (!symbol) return reply.status(400).send({ error: 'INVALID_REQUEST', message: 'symbol required' });

      const existing = getOrder(orderId);
      const accountId = normalizeAccountId(req.body.account_id ?? existing?.account_id);
      if (!pool.hasAccount(accountId) || !pool.isEnabled(accountId)) {
        return reply.status(400).send({ error: 'INVALID_ACCOUNT', message: `Unavailable account_id: ${accountId}` });
      }

      try {
        const result = await pool.getClient(accountId).cancelOrder(symbol, orderId);
        return { orderId: String(result.orderId), status: result.status };
      } catch (err: any) {
        const msg = err?.response?.data?.msg ?? err?.message ?? 'Unknown error';
        return reply.status(502).send({ error: 'BINANCE_ERROR', message: msg });
      }
    }
  );

  // ─── POST /v1/virtual-positions/:id/close ───────────────────────────────
  fastify.post<{ Params: { id: string }; Body: ClosePositionRequest }>(
    '/v1/virtual-positions/:id/close',
    async (req, reply) => {
      const vp = getVP(req.params.id);
      if (!vp) return reply.status(404).send({ error: 'NOT_FOUND', message: 'VirtualPosition not found' });

      const accountId = normalizeAccountId(req.body.account_id ?? vp.account_id);
      if (accountId !== vp.account_id) {
        return reply.status(400).send({ error: 'VP_ACCOUNT_MISMATCH', message: 'account_id mismatch with VP' });
      }

      const netQty = parseFloat(vp.net_qty);
      if (netQty === 0) return reply.status(400).send({ error: 'EMPTY_POSITION', message: 'No open position' });

      const { type = 'MARKET', qty, percent, price } = req.body;
      let closeQty: number;
      if (qty) {
        closeQty = Math.min(parseFloat(qty), netQty);
      } else if (percent) {
        closeQty = netQty * (percent / 100);
      } else {
        closeQty = netQty;
      }

      const closeSide = vp.positionSide === 'LONG' ? 'SELL' : 'BUY';
      const clientOrderId = encodeClientOrderId(vp.id, accountId);
      registerOrderMapping(clientOrderId, accountId, vp.id);

      try {
        const result = await pool.getClient(accountId).placeOrder({
          symbol: vp.symbol,
          side: closeSide,
          positionSide: vp.positionSide,
          type: type === 'LIMIT' ? 'LIMIT' : 'MARKET',
          quantity: closeQty.toFixed(8),
          price: price,
          reduceOnly: true,
          timeInForce: type === 'LIMIT' ? 'GTC' : undefined,
          newClientOrderId: clientOrderId,
        });
        return { orderId: String(result.orderId), clientOrderId, status: result.status };
      } catch (err: any) {
        const msg = err?.response?.data?.msg ?? err?.message ?? 'Unknown error';
        return reply.status(502).send({ error: 'BINANCE_ERROR', message: msg });
      }
    }
  );

  // ─── POST /v1/virtual-positions/:id/tpsl ─────────────────────────────────
  fastify.post<{ Params: { id: string }; Body: SetTpSlRequest }>(
    '/v1/virtual-positions/:id/tpsl',
    async (req, reply) => {
      try {
        const vp = getVP(req.params.id);
        if (!vp) return reply.status(404).send({ error: 'NOT_FOUND', message: 'VirtualPosition not found' });

        const accountId = normalizeAccountId(req.body.account_id ?? vp.account_id);
        if (accountId !== vp.account_id) {
          return reply.status(400).send({ error: 'VP_ACCOUNT_MISMATCH', message: 'account_id mismatch with VP' });
        }

        const updated = await setTpSl(req.params.id, req.body, pool.getClient(accountId));
        return updated;
      } catch (err: any) {
        return reply.status(400).send({ error: 'TPSL_ERROR', message: err.message });
      }
    }
  );

  // ─── DELETE /v1/virtual-positions/:id/tpsl ───────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/v1/virtual-positions/:id/tpsl',
    async (req, reply) => {
      try {
        const vp = getVP(req.params.id);
        if (!vp) return reply.status(404).send({ error: 'NOT_FOUND', message: 'VirtualPosition not found' });
        const updated = await clearTpSl(req.params.id, pool.getClient(vp.account_id));
        return updated;
      } catch (err: any) {
        return reply.status(400).send({ error: 'TPSL_ERROR', message: err.message });
      }
    }
  );

  // ─── POST /v1/reconcile ───────────────────────────────────────────────────
  fastify.post<{ Body: ReconcileRequest }>('/v1/reconcile', async (req, reply) => {
    try {
      const accountId = normalizeAccountId(req.body.account_id);
      if (!pool.hasAccount(accountId) || !pool.isEnabled(accountId)) {
        return reply.status(400).send({ error: 'INVALID_ACCOUNT', message: `Unavailable account_id: ${accountId}` });
      }

      const updated = applyReconcile({ ...req.body, account_id: accountId });
      return { updated };
    } catch (err: any) {
      if (err?.message === 'RECONCILE_OVER_ASSIGNED') {
        return reply.status(400).send({
          error: 'RECONCILE_OVER_ASSIGNED',
          message: 'Assigned quantity exceeds external position quantity',
        });
      }
      return reply.status(400).send({ error: 'RECONCILE_ERROR', message: err.message });
    }
  });
}
