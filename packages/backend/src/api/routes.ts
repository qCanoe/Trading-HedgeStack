/**
 * REST API routes — /v1/...
 */
import { nanoid } from 'nanoid';
import type { FastifyInstance } from 'fastify';
import { getAllUserDataStreamInfos, getUserDataStreamInfo } from '../binance/ws.js';
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
import {
  getOpsMetricsSnapshot,
  recordCancel,
  recordConditionalOrderSubmit,
  recordErrorCode,
  recordOrderAmend,
  recordOrderSubmit,
} from '../ops/metrics.js';
import { getStartupHealthReport } from '../ops/health.js';
import type {
  VirtualPosition,
  CreateVirtualPositionRequest,
  PlaceOrderRequest,
  ClosePositionRequest,
  SetTpSlRequest,
  ReconcileRequest,
  AmendOrderRequest,
  AmendOrderResponse,
} from '../store/types.js';
import type { Symbol, PositionSide } from '../config/env.js';

type PlacementType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_MARKET';

function normalizeAccountId(accountId?: string): string {
  return accountId?.trim().toLowerCase() || 'main';
}

function accountScopeMismatch(message: string) {
  return { error: 'ACCOUNT_SCOPE_MISMATCH', message };
}

function sendTrackedError(
  reply: any,
  statusCode: number,
  error: string,
  message: string,
  accountId?: string,
  route?: string
) {
  recordErrorCode(accountId, error, route);
  return reply.status(statusCode).send({ error, message });
}

function resolveWorkingType(triggerPriceType?: 'LAST_PRICE' | 'MARK_PRICE'): 'CONTRACT_PRICE' | 'MARK_PRICE' {
  return triggerPriceType === 'MARK_PRICE' ? 'MARK_PRICE' : 'CONTRACT_PRICE';
}

function isConditionalOrderType(type: string): boolean {
  return type === 'STOP' || type === 'STOP_MARKET';
}

function validateOrderRequestBody(
  body: {
    type: string;
    qty: string;
    price?: string;
    stopPrice?: string;
  },
): string | null {
  const allowedTypes: PlacementType[] = ['MARKET', 'LIMIT', 'STOP', 'STOP_MARKET'];
  const normalizedType = body.type as PlacementType;
  if (!allowedTypes.includes(normalizedType)) {
    return `Unsupported order type: ${body.type}`;
  }

  const qty = parseFloat(body.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    return 'qty must be a positive number';
  }

  if (normalizedType === 'LIMIT') {
    const price = parseFloat(body.price ?? '');
    if (!Number.isFinite(price) || price <= 0) return 'price is required for LIMIT order';
  }

  if (normalizedType === 'STOP') {
    const price = parseFloat(body.price ?? '');
    const stopPrice = parseFloat(body.stopPrice ?? '');
    if (!Number.isFinite(price) || price <= 0) return 'price is required for STOP order';
    if (!Number.isFinite(stopPrice) || stopPrice <= 0) return 'stopPrice is required for STOP order';
  }

  if (normalizedType === 'STOP_MARKET') {
    const stopPrice = parseFloat(body.stopPrice ?? '');
    if (!Number.isFinite(stopPrice) || stopPrice <= 0) return 'stopPrice is required for STOP_MARKET order';
  }

  return null;
}

export function registerRoutes(fastify: FastifyInstance, pool: BinanceClientPool): void {
  // ─── GET /v1/accounts ───────────────────────────────────────────────────
  fastify.get('/v1/accounts', async () => {
    return pool.getAllAccounts().map((acc) => {
      const stream = getUserDataStreamInfo(acc.id);
      return {
      id: acc.id,
      name: acc.name,
      type: acc.type,
      testnet: acc.testnet,
      enabled: acc.enabled,
      ws_status: stream.ws_status,
      last_error: stream.last_error,
      last_connected_at: stream.last_connected_at,
      };
    });
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
      accounts_status: getAllUserDataStreamInfos(),
      consistency: consistencyStatuses,
      reconcile,
    };
  });

  fastify.get<{ Querystring: { account_id?: string; window_sec?: string } }>(
    '/v1/ops/metrics',
    async (req) => {
      const accountId = req.query.account_id
        ? normalizeAccountId(req.query.account_id)
        : undefined;
      const windowSec = req.query.window_sec
        ? Number.parseInt(req.query.window_sec, 10)
        : undefined;
      return getOpsMetricsSnapshot(windowSec, accountId);
    }
  );

  fastify.get('/v1/ops/health', async (_req, reply) => {
    const report = getStartupHealthReport();
    if (report.status === 'FAIL') {
      return reply.status(503).send(report);
    }
    return reply.status(200).send(report);
  });

  // ─── POST /v1/virtual-positions ─────────────────────────────────────────
  fastify.post<{ Body: CreateVirtualPositionRequest }>('/v1/virtual-positions', async (req, reply) => {
    const { name, symbol, positionSide } = req.body;
    const accountId = normalizeAccountId(req.body.account_id);

    if (!name || !symbol || !positionSide) {
      return reply.status(400).send({ error: 'INVALID_REQUEST', message: 'name, symbol, positionSide required' });
    }
    if (!pool.hasAccount(accountId) || !pool.isEnabled(accountId)) {
      return sendTrackedError(
        reply,
        400,
        'INVALID_ACCOUNT',
        `Unavailable account_id: ${accountId}`,
        accountId,
        'POST /v1/virtual-positions'
      );
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
    const validationError = validateOrderRequestBody({
      type: body.type,
      qty: body.qty,
      price: body.price,
      stopPrice: body.stopPrice,
    });
    if (validationError) {
      recordOrderSubmit(undefined, false);
      if (isConditionalOrderType(body.type)) {
        recordConditionalOrderSubmit(undefined, false);
      }
      return reply.status(400).send({ error: 'INVALID_REQUEST', message: validationError });
    }
    const vp = getVP(body.virtual_position_id);
    if (!vp) {
      recordOrderSubmit(undefined, false);
      if (isConditionalOrderType(body.type)) {
        recordConditionalOrderSubmit(undefined, false);
      }
      return reply.status(400).send({ error: 'INVALID_VP', message: 'VirtualPosition not found' });
    }
    if (vp.symbol !== body.symbol || vp.positionSide !== body.positionSide) {
      recordOrderSubmit(vp.account_id, false);
      if (isConditionalOrderType(body.type)) {
        recordConditionalOrderSubmit(vp.account_id, false);
      }
      return reply.status(400).send({
        error: 'VP_DOMAIN_MISMATCH',
        message: `VP domain mismatch: VP=${vp.symbol}/${vp.positionSide}, req=${body.symbol}/${body.positionSide}`,
      });
    }

    const accountId = normalizeAccountId(body.account_id ?? vp.account_id);
    if (accountId !== vp.account_id) {
      recordOrderSubmit(accountId, false);
      if (isConditionalOrderType(body.type)) {
        recordConditionalOrderSubmit(accountId, false);
      }
      recordErrorCode(accountId, 'ACCOUNT_SCOPE_MISMATCH', 'POST /v1/orders');
      return reply.status(400).send(
        accountScopeMismatch(
          `VP belongs to ${vp.account_id}, but request account_id is ${accountId}`
        )
      );
    }
    if (!pool.hasAccount(accountId) || !pool.isEnabled(accountId)) {
      recordOrderSubmit(accountId, false);
      if (isConditionalOrderType(body.type)) {
        recordConditionalOrderSubmit(accountId, false);
      }
      return sendTrackedError(
        reply,
        400,
        'INVALID_ACCOUNT',
        `Unavailable account_id: ${accountId}`,
        accountId,
        'POST /v1/orders'
      );
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
        workingType: resolveWorkingType(body.triggerPriceType),
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
      recordOrderSubmit(accountId, true);
      if (isConditionalOrderType(body.type)) {
        recordConditionalOrderSubmit(accountId, true);
      }

      return { orderId: String(result.orderId), clientOrderId, status: result.status };
    } catch (err: any) {
      recordOrderSubmit(accountId, false);
      if (isConditionalOrderType(body.type)) {
        recordConditionalOrderSubmit(accountId, false);
      }
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
      if (!symbol) {
        recordCancel(undefined, false);
        return reply.status(400).send({ error: 'INVALID_REQUEST', message: 'symbol required' });
      }

      const existing = getOrder(orderId);
      const explicitAccountId = req.body.account_id ? normalizeAccountId(req.body.account_id) : undefined;
      if (!existing && !explicitAccountId) {
        recordCancel(undefined, false);
        return sendTrackedError(
          reply,
          400,
          'ACCOUNT_ID_REQUIRED_FOR_CANCEL',
          'account_id is required when order mapping is not found',
          undefined,
          'POST /v1/orders/:orderId/cancel'
        );
      }
      if (existing?.account_id && explicitAccountId && existing.account_id !== explicitAccountId) {
        recordCancel(explicitAccountId, false);
        recordErrorCode(
          explicitAccountId,
          'ACCOUNT_SCOPE_MISMATCH',
          'POST /v1/orders/:orderId/cancel'
        );
        return reply
          .status(400)
          .send(accountScopeMismatch(`Order belongs to ${existing.account_id}, but request account_id is ${explicitAccountId}`));
      }

      const accountId = normalizeAccountId(explicitAccountId ?? existing?.account_id);
      if (!pool.hasAccount(accountId) || !pool.isEnabled(accountId)) {
        recordCancel(accountId, false);
        return sendTrackedError(
          reply,
          400,
          'INVALID_ACCOUNT',
          `Unavailable account_id: ${accountId}`,
          accountId,
          'POST /v1/orders/:orderId/cancel'
        );
      }

      try {
        const result = await pool.getClient(accountId).cancelOrder(symbol, orderId);
        recordCancel(accountId, true);
        return { orderId: String(result.orderId), status: result.status };
      } catch (err: any) {
        recordCancel(accountId, false);
        const msg = err?.response?.data?.msg ?? err?.message ?? 'Unknown error';
        return reply.status(502).send({ error: 'BINANCE_ERROR', message: msg });
      }
    }
  );

  fastify.post<{ Params: { orderId: string }; Body: AmendOrderRequest }>(
    '/v1/orders/:orderId/amend',
    async (req, reply) => {
      const { orderId } = req.params;
      const oldOrder = getOrder(orderId);
      if (!oldOrder) {
        recordOrderAmend(undefined, false);
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Order not found' });
      }

      const body = req.body;
      if (!body?.symbol) {
        recordOrderAmend(oldOrder.account_id, false);
        return reply.status(400).send({ error: 'INVALID_REQUEST', message: 'symbol required' });
      }
      if (body.symbol !== oldOrder.symbol) {
        recordOrderAmend(oldOrder.account_id, false);
        return reply.status(400).send({
          error: 'INVALID_REQUEST',
          message: `symbol mismatch: order symbol is ${oldOrder.symbol}, request symbol is ${body.symbol}`,
        });
      }

      const validationError = validateOrderRequestBody({
        type: body.type,
        qty: body.qty,
        price: body.price,
        stopPrice: body.stopPrice,
      });
      if (validationError) {
        recordOrderAmend(oldOrder.account_id, false);
        if (isConditionalOrderType(body.type)) {
          recordConditionalOrderSubmit(oldOrder.account_id, false);
        }
        return reply.status(400).send({ error: 'INVALID_REQUEST', message: validationError });
      }

      const explicitAccountId = body.account_id ? normalizeAccountId(body.account_id) : undefined;
      if (explicitAccountId && explicitAccountId !== oldOrder.account_id) {
        recordOrderAmend(explicitAccountId, false);
        recordErrorCode(explicitAccountId, 'ACCOUNT_SCOPE_MISMATCH', 'POST /v1/orders/:orderId/amend');
        return reply.status(400).send(
          accountScopeMismatch(
            `Order belongs to ${oldOrder.account_id}, but request account_id is ${explicitAccountId}`
          ),
        );
      }

      const accountId = normalizeAccountId(explicitAccountId ?? oldOrder.account_id);
      if (!pool.hasAccount(accountId) || !pool.isEnabled(accountId)) {
        recordOrderAmend(accountId, false);
        if (isConditionalOrderType(body.type)) {
          recordConditionalOrderSubmit(accountId, false);
        }
        return sendTrackedError(
          reply,
          400,
          'INVALID_ACCOUNT',
          `Unavailable account_id: ${accountId}`,
          accountId,
          'POST /v1/orders/:orderId/amend',
        );
      }

      const vpId = body.virtual_position_id ?? oldOrder.virtual_position_id;
      const vp = getVP(vpId);
      if (!vp) {
        recordOrderAmend(accountId, false);
        return reply.status(400).send({ error: 'INVALID_VP', message: `VirtualPosition not found: ${vpId}` });
      }
      if (vp.account_id !== accountId) {
        recordOrderAmend(accountId, false);
        recordErrorCode(accountId, 'ACCOUNT_SCOPE_MISMATCH', 'POST /v1/orders/:orderId/amend');
        return reply.status(400).send(
          accountScopeMismatch(`VP belongs to ${vp.account_id}, but request account_id is ${accountId}`),
        );
      }
      if (vp.symbol !== oldOrder.symbol || vp.positionSide !== oldOrder.positionSide) {
        recordOrderAmend(accountId, false);
        return reply.status(400).send({
          error: 'VP_DOMAIN_MISMATCH',
          message: `VP domain mismatch: VP=${vp.symbol}/${vp.positionSide}, order=${oldOrder.symbol}/${oldOrder.positionSide}`,
        });
      }

      const client = pool.getClient(accountId);
      try {
        await client.cancelOrder(body.symbol, orderId);
        const canceled = {
          ...oldOrder,
          status: 'CANCELED',
          updated_at: Date.now(),
        };
        upsertOrder(canceled);
        broadcast({ type: 'ORDER_UPSERT', payload: canceled, ts: Date.now() });

        const newClientOrderId = encodeClientOrderId(vp.id, accountId);
        registerOrderMapping(newClientOrderId, accountId, vp.id);

        const result = await client.placeOrder({
          symbol: body.symbol,
          side: oldOrder.side,
          positionSide: oldOrder.positionSide,
          type: body.type,
          quantity: body.qty,
          price: body.price,
          stopPrice: body.stopPrice,
          timeInForce: body.timeInForce ?? 'GTC',
          workingType: resolveWorkingType(body.triggerPriceType),
          newClientOrderId: newClientOrderId,
        });

        const newOrder = {
          orderId: String(result.orderId),
          clientOrderId: newClientOrderId,
          account_id: accountId,
          virtual_position_id: vp.id,
          symbol: body.symbol,
          side: oldOrder.side,
          positionSide: oldOrder.positionSide,
          type: body.type,
          qty: body.qty,
          price: body.price ?? null,
          stopPrice: body.stopPrice ?? null,
          status: result.status,
          reduceOnly: oldOrder.reduceOnly,
          created_at: Date.now(),
          updated_at: Date.now(),
        };
        upsertOrder(newOrder);
        broadcast({ type: 'ORDER_UPSERT', payload: newOrder, ts: Date.now() });

        recordOrderAmend(accountId, true);
        if (isConditionalOrderType(body.type)) {
          recordConditionalOrderSubmit(accountId, true);
        }

        const response: AmendOrderResponse = {
          old_order_id: orderId,
          new_order_id: String(result.orderId),
          clientOrderId: newClientOrderId,
          status: result.status,
        };
        return response;
      } catch (err: any) {
        recordOrderAmend(accountId, false);
        if (isConditionalOrderType(body.type)) {
          recordConditionalOrderSubmit(accountId, false);
        }
        const msg = err?.response?.data?.msg ?? err?.message ?? 'Unknown error';
        return reply.status(502).send({ error: 'BINANCE_ERROR', message: msg });
      }
    },
  );

  // ─── POST /v1/virtual-positions/:id/close ───────────────────────────────
  fastify.post<{ Params: { id: string }; Body: ClosePositionRequest }>(
    '/v1/virtual-positions/:id/close',
    async (req, reply) => {
      const vp = getVP(req.params.id);
      if (!vp) return reply.status(404).send({ error: 'NOT_FOUND', message: 'VirtualPosition not found' });

      const accountId = normalizeAccountId(req.body.account_id ?? vp.account_id);
      if (accountId !== vp.account_id) {
        recordErrorCode(
          accountId,
          'ACCOUNT_SCOPE_MISMATCH',
          'POST /v1/virtual-positions/:id/close'
        );
        return reply
          .status(400)
          .send(accountScopeMismatch(`VP belongs to ${vp.account_id}, but request account_id is ${accountId}`));
      }
      if (!pool.hasAccount(accountId) || !pool.isEnabled(accountId)) {
        return sendTrackedError(
          reply,
          400,
          'INVALID_ACCOUNT',
          `Unavailable account_id: ${accountId}`,
          accountId,
          'POST /v1/virtual-positions/:id/close'
        );
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
          recordErrorCode(
            accountId,
            'ACCOUNT_SCOPE_MISMATCH',
            'POST /v1/virtual-positions/:id/tpsl'
          );
          return reply
            .status(400)
            .send(accountScopeMismatch(`VP belongs to ${vp.account_id}, but request account_id is ${accountId}`));
        }
        if (!pool.hasAccount(accountId) || !pool.isEnabled(accountId)) {
          return sendTrackedError(
            reply,
            400,
            'INVALID_ACCOUNT',
            `Unavailable account_id: ${accountId}`,
            accountId,
            'POST /v1/virtual-positions/:id/tpsl'
          );
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
        if (!pool.hasAccount(vp.account_id) || !pool.isEnabled(vp.account_id)) {
          return sendTrackedError(
            reply,
            400,
            'INVALID_ACCOUNT',
            `Unavailable account_id: ${vp.account_id}`,
            vp.account_id,
            'DELETE /v1/virtual-positions/:id/tpsl'
          );
        }
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
        return sendTrackedError(
          reply,
          400,
          'INVALID_ACCOUNT',
          `Unavailable account_id: ${accountId}`,
          accountId,
          'POST /v1/reconcile'
        );
      }

      const updated = applyReconcile({ ...req.body, account_id: accountId });
      return { updated };
    } catch (err: any) {
      if (String(err?.message ?? '').includes('does not belong to account')) {
        recordErrorCode(
          normalizeAccountId(req.body.account_id),
          'ACCOUNT_SCOPE_MISMATCH',
          'POST /v1/reconcile'
        );
        return reply.status(400).send(accountScopeMismatch(err.message));
      }
      if (String(err?.message ?? '').includes('symbol/side mismatch')) {
        recordErrorCode(
          normalizeAccountId(req.body.account_id),
          'ACCOUNT_SCOPE_MISMATCH',
          'POST /v1/reconcile'
        );
        return reply.status(400).send(accountScopeMismatch(err.message));
      }
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
