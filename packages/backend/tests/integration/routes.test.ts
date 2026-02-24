import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { registerRoutes } from '../../src/api/routes.js';
import {
  __dangerousResetOpsMetricsForTests,
  setOpsAlertLogger,
} from '../../src/ops/metrics.js';
import { __dangerousSetStartupHealthForTests } from '../../src/ops/health.js';
import { processBinanceFillEvent } from '../../src/engine/attribution/index.js';
import {
  __dangerousResetStateForTests,
  addFill,
  createVP,
  getOrder,
  setExternalPosition,
  upsertOrder,
} from '../../src/store/state.js';
import type { BinanceClientPool } from '../../src/binance/pool.js';

interface MockCall {
  account_id: string;
  params: Record<string, unknown>;
}

interface MockPoolBundle {
  pool: BinanceClientPool;
  placeCalls: MockCall[];
  cancelCalls: MockCall[];
}

function createMockPool(): MockPoolBundle {
  const placeCalls: MockCall[] = [];
  const cancelCalls: MockCall[] = [];
  let orderSeq = 1000;

  const pool = {
    hasAccount: (id: string) => ['main', 'sub_a', 'sub_b'].includes(id),
    isEnabled: (id: string) => ['main', 'sub_a'].includes(id),
    getAllAccounts: () => [
      { id: 'main', name: 'Main', type: 'MAIN', testnet: true, enabled: true, apiKey: '', apiSecret: '' },
      { id: 'sub_a', name: 'Sub A', type: 'SUB', testnet: true, enabled: true, apiKey: '', apiSecret: '' },
      { id: 'sub_b', name: 'Sub B', type: 'SUB', testnet: true, enabled: false, apiKey: '', apiSecret: '' },
    ],
    getClient: (accountId: string) => ({
      cancelOrder: async (symbol: string, orderId: string) => {
        cancelCalls.push({ account_id: accountId, params: { symbol, orderId } });
        return { orderId: Number(orderId), status: 'CANCELED' };
      },
      placeOrder: async (params: Record<string, unknown>) => {
        placeCalls.push({ account_id: accountId, params });
        orderSeq += 1;
        return {
          orderId: orderSeq,
          clientOrderId: (params.newClientOrderId as string | undefined) ?? `mock_${orderSeq}`,
          status: 'NEW',
        };
      },
    }),
  } as unknown as BinanceClientPool;

  return { pool, placeCalls, cancelCalls };
}

describe('routes integration', () => {
  beforeEach(() => {
    __dangerousResetStateForTests();
    __dangerousResetOpsMetricsForTests();
    setOpsAlertLogger(() => {});
    __dangerousSetStartupHealthForTests([
      { name: 'accounts_config_readable', status: 'PASS', message: 'ok' },
      { name: 'accounts_unique_id', status: 'PASS', message: 'ok' },
      { name: 'enabled_account_exists', status: 'PASS', message: 'ok' },
      { name: 'enabled_account_credentials', status: 'PASS', message: 'ok' },
      { name: 'symbols_config_valid', status: 'PASS', message: 'ok' },
      { name: 'db_path_writable', status: 'PASS', message: 'ok' },
    ]);
  });

  it('returns ACCOUNT_ID_REQUIRED_FOR_CANCEL when mapping is missing', async () => {
    const mock = createMockPool();
    const app = Fastify();
    registerRoutes(app, mock.pool);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/orders/123/cancel',
      payload: { symbol: 'BTCUSDT' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('ACCOUNT_ID_REQUIRED_FOR_CANCEL');
    await app.close();
  });

  it('filters state by account_id', async () => {
    createVP({
      id: 'vp_main',
      account_id: 'main',
      name: 'm',
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      net_qty: '1',
      avg_entry: '90000',
      realized_pnl: '0',
      tpsl: null,
      created_at: Date.now(),
    });
    createVP({
      id: 'vp_sub_a',
      account_id: 'sub_a',
      name: 's',
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      net_qty: '2',
      avg_entry: '91000',
      realized_pnl: '0',
      tpsl: null,
      created_at: Date.now() + 1,
    });
    upsertOrder({
      orderId: '1',
      clientOrderId: 'coid-1',
      account_id: 'main',
      virtual_position_id: 'vp_main',
      symbol: 'BTCUSDT',
      side: 'BUY',
      positionSide: 'LONG',
      type: 'LIMIT',
      qty: '1',
      price: '90000',
      stopPrice: null,
      status: 'NEW',
      reduceOnly: false,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    upsertOrder({
      orderId: '2',
      clientOrderId: 'coid-2',
      account_id: 'sub_a',
      virtual_position_id: 'vp_sub_a',
      symbol: 'BTCUSDT',
      side: 'BUY',
      positionSide: 'LONG',
      type: 'LIMIT',
      qty: '1',
      price: '91000',
      stopPrice: null,
      status: 'NEW',
      reduceOnly: false,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    addFill({
      tradeId: 'f1',
      orderId: '1',
      clientOrderId: 'coid-1',
      account_id: 'main',
      virtual_position_id: 'vp_main',
      symbol: 'BTCUSDT',
      side: 'BUY',
      positionSide: 'LONG',
      qty: '1',
      price: '90000',
      commission: '0.1',
      commissionAsset: 'USDT',
      realizedPnl: '0',
      ts: Date.now(),
    });
    addFill({
      tradeId: 'f2',
      orderId: '2',
      clientOrderId: 'coid-2',
      account_id: 'sub_a',
      virtual_position_id: 'vp_sub_a',
      symbol: 'BTCUSDT',
      side: 'BUY',
      positionSide: 'LONG',
      qty: '1',
      price: '91000',
      commission: '0.1',
      commissionAsset: 'USDT',
      realizedPnl: '0',
      ts: Date.now(),
    });
    setExternalPosition({
      account_id: 'main',
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      qty: '1',
      avgEntryPrice: '90000',
      unrealizedPnl: '0',
      markPrice: '91000',
    });
    setExternalPosition({
      account_id: 'sub_a',
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      qty: '2',
      avgEntryPrice: '91000',
      unrealizedPnl: '0',
      markPrice: '92000',
    });

    const mock = createMockPool();
    const app = Fastify();
    registerRoutes(app, mock.pool);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/state?account_id=sub_a',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.virtual_positions.every((v: any) => v.account_id === 'sub_a')).toBe(true);
    expect(body.open_orders.every((o: any) => o.account_id === 'sub_a')).toBe(true);
    expect(body.recent_fills.every((f: any) => f.account_id === 'sub_a')).toBe(true);
    expect(body.external_positions.every((p: any) => p.account_id === 'sub_a')).toBe(true);
    await app.close();
  });

  it('returns ACCOUNT_SCOPE_MISMATCH for reconcile cross-account assignment', async () => {
    createVP({
      id: 'vp_sub_a',
      account_id: 'sub_a',
      name: 'sub-a-vp',
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      net_qty: '1',
      avg_entry: '90000',
      realized_pnl: '0',
      tpsl: null,
      created_at: Date.now(),
    });
    setExternalPosition({
      account_id: 'main',
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      qty: '1',
      avgEntryPrice: '90000',
      unrealizedPnl: '0',
      markPrice: '90500',
    });

    const mock = createMockPool();
    const app = Fastify();
    registerRoutes(app, mock.pool);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/reconcile',
      payload: {
        account_id: 'main',
        symbol: 'BTCUSDT',
        positionSide: 'LONG',
        assignments: [{ virtual_position_id: 'vp_sub_a', qty: '1' }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('ACCOUNT_SCOPE_MISMATCH');
    await app.close();
  });

  it('validates conditional order required fields', async () => {
    createVP({
      id: 'vp_main',
      account_id: 'main',
      name: 'main-vp',
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      net_qty: '0',
      avg_entry: '0',
      realized_pnl: '0',
      tpsl: null,
      created_at: Date.now(),
    });

    const mock = createMockPool();
    const app = Fastify();
    registerRoutes(app, mock.pool);

    const limitMissingPrice = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        virtual_position_id: 'vp_main',
        symbol: 'BTCUSDT',
        positionSide: 'LONG',
        side: 'BUY',
        type: 'LIMIT',
        qty: '0.1',
      },
    });
    expect(limitMissingPrice.statusCode).toBe(400);
    expect(limitMissingPrice.json().error).toBe('INVALID_REQUEST');

    const stopMissingStopPrice = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        virtual_position_id: 'vp_main',
        symbol: 'BTCUSDT',
        positionSide: 'LONG',
        side: 'BUY',
        type: 'STOP',
        qty: '0.1',
        price: '90000',
      },
    });
    expect(stopMissingStopPrice.statusCode).toBe(400);
    expect(stopMissingStopPrice.json().error).toBe('INVALID_REQUEST');

    const stopMarketMissingStopPrice = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        virtual_position_id: 'vp_main',
        symbol: 'BTCUSDT',
        positionSide: 'LONG',
        side: 'BUY',
        type: 'STOP_MARKET',
        qty: '0.1',
      },
    });
    expect(stopMarketMissingStopPrice.statusCode).toBe(400);
    expect(stopMarketMissingStopPrice.json().error).toBe('INVALID_REQUEST');

    await app.close();
  });

  it('amends order via cancel+new and keeps attribution mapping', async () => {
    createVP({
      id: 'vp_main',
      account_id: 'main',
      name: 'main-vp',
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      net_qty: '0',
      avg_entry: '0',
      realized_pnl: '0',
      tpsl: null,
      created_at: Date.now(),
    });

    upsertOrder({
      orderId: '777',
      clientOrderId: 'old-cid',
      account_id: 'main',
      virtual_position_id: 'vp_main',
      symbol: 'BTCUSDT',
      side: 'BUY',
      positionSide: 'LONG',
      type: 'LIMIT',
      qty: '0.1',
      price: '90000',
      stopPrice: null,
      status: 'NEW',
      reduceOnly: false,
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const mock = createMockPool();
    const app = Fastify();
    registerRoutes(app, mock.pool);

    const amendRes = await app.inject({
      method: 'POST',
      url: '/v1/orders/777/amend',
      payload: {
        symbol: 'BTCUSDT',
        type: 'STOP_MARKET',
        qty: '0.2',
        stopPrice: '85000',
      },
    });

    expect(amendRes.statusCode).toBe(200);
    const amendBody = amendRes.json();
    expect(amendBody.old_order_id).toBe('777');
    expect(amendBody.new_order_id).not.toBe('777');

    expect(mock.cancelCalls).toHaveLength(1);
    expect(mock.cancelCalls[0].params.orderId).toBe('777');
    expect(mock.placeCalls).toHaveLength(1);
    expect(mock.placeCalls[0].params.type).toBe('STOP_MARKET');
    expect(mock.placeCalls[0].params.stopPrice).toBe('85000');

    expect(getOrder('777')).toBeUndefined();
    const newOrder = getOrder(amendBody.new_order_id);
    expect(newOrder?.virtual_position_id).toBe('vp_main');
    expect(newOrder?.type).toBe('STOP_MARKET');

    const fillResult = processBinanceFillEvent({
      e: 'ORDER_TRADE_UPDATE',
      E: Date.now(),
      o: {
        s: 'BTCUSDT',
        c: amendBody.clientOrderId,
        i: Number(amendBody.new_order_id),
        S: 'BUY',
        ps: 'LONG',
        l: '0.2',
        L: '85000',
        T: Date.now(),
        t: 42,
        n: '0.01',
        N: 'USDT',
        rp: '0',
        X: 'FILLED',
        q: '0.2',
        p: '85000',
        R: false,
        ot: 'STOP_MARKET',
        tf: 'GTC',
      },
    });

    expect(fillResult.fill?.virtual_position_id).toBe('vp_main');
    expect(fillResult.updatedVP?.id).toBe('vp_main');

    await app.close();
  });

  it('returns ACCOUNT_SCOPE_MISMATCH for amend cross-account request', async () => {
    createVP({
      id: 'vp_main',
      account_id: 'main',
      name: 'main-vp',
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      net_qty: '0',
      avg_entry: '0',
      realized_pnl: '0',
      tpsl: null,
      created_at: Date.now(),
    });
    upsertOrder({
      orderId: '778',
      clientOrderId: 'cid-778',
      account_id: 'main',
      virtual_position_id: 'vp_main',
      symbol: 'BTCUSDT',
      side: 'BUY',
      positionSide: 'LONG',
      type: 'LIMIT',
      qty: '0.1',
      price: '90000',
      stopPrice: null,
      status: 'NEW',
      reduceOnly: false,
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const mock = createMockPool();
    const app = Fastify();
    registerRoutes(app, mock.pool);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/orders/778/amend',
      payload: {
        account_id: 'sub_a',
        symbol: 'BTCUSDT',
        type: 'LIMIT',
        qty: '0.2',
        price: '91000',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('ACCOUNT_SCOPE_MISMATCH');
    await app.close();
  });

  it('returns INVALID_ACCOUNT for disabled sub account operations', async () => {
    createVP({
      id: 'vp_sub_b',
      account_id: 'sub_b',
      name: 'sub-b-vp',
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      net_qty: '1',
      avg_entry: '90000',
      realized_pnl: '0',
      tpsl: null,
      created_at: Date.now(),
    });
    upsertOrder({
      orderId: '777',
      clientOrderId: 'coid-777',
      account_id: 'sub_b',
      virtual_position_id: 'vp_sub_b',
      symbol: 'BTCUSDT',
      side: 'BUY',
      positionSide: 'LONG',
      type: 'LIMIT',
      qty: '1',
      price: '90000',
      stopPrice: null,
      status: 'NEW',
      reduceOnly: false,
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const mock = createMockPool();
    const app = Fastify();
    registerRoutes(app, mock.pool);

    const orderRes = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        virtual_position_id: 'vp_sub_b',
        symbol: 'BTCUSDT',
        positionSide: 'LONG',
        side: 'BUY',
        type: 'LIMIT',
        qty: '0.001',
        price: '90000',
      },
    });
    expect(orderRes.statusCode).toBe(400);
    expect(orderRes.json().error).toBe('INVALID_ACCOUNT');

    const cancelRes = await app.inject({
      method: 'POST',
      url: '/v1/orders/777/cancel',
      payload: { symbol: 'BTCUSDT', account_id: 'sub_b' },
    });
    expect(cancelRes.statusCode).toBe(400);
    expect(cancelRes.json().error).toBe('INVALID_ACCOUNT');

    const amendRes = await app.inject({
      method: 'POST',
      url: '/v1/orders/777/amend',
      payload: {
        account_id: 'sub_b',
        symbol: 'BTCUSDT',
        type: 'LIMIT',
        qty: '0.001',
        price: '90000',
      },
    });
    expect(amendRes.statusCode).toBe(400);
    expect(amendRes.json().error).toBe('INVALID_ACCOUNT');

    const closeRes = await app.inject({
      method: 'POST',
      url: '/v1/virtual-positions/vp_sub_b/close',
      payload: { type: 'MARKET' },
    });
    expect(closeRes.statusCode).toBe(400);
    expect(closeRes.json().error).toBe('INVALID_ACCOUNT');

    const tpslRes = await app.inject({
      method: 'POST',
      url: '/v1/virtual-positions/vp_sub_b/tpsl',
      payload: { tp_price: '91000' },
    });
    expect(tpslRes.statusCode).toBe(400);
    expect(tpslRes.json().error).toBe('INVALID_ACCOUNT');

    const reconcileRes = await app.inject({
      method: 'POST',
      url: '/v1/reconcile',
      payload: {
        account_id: 'sub_b',
        symbol: 'BTCUSDT',
        positionSide: 'LONG',
        assignments: [{ virtual_position_id: 'vp_sub_b', qty: '1' }],
      },
    });
    expect(reconcileRes.statusCode).toBe(400);
    expect(reconcileRes.json().error).toBe('INVALID_ACCOUNT');

    await app.close();
  });

  it('tracks amend and conditional metrics and exposes warning alerts', async () => {
    createVP({
      id: 'vp_main',
      account_id: 'main',
      name: 'main-vp',
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      net_qty: '0',
      avg_entry: '0',
      realized_pnl: '0',
      tpsl: null,
      created_at: Date.now(),
    });
    upsertOrder({
      orderId: '900',
      clientOrderId: 'cid-900',
      account_id: 'main',
      virtual_position_id: 'vp_main',
      symbol: 'BTCUSDT',
      side: 'BUY',
      positionSide: 'LONG',
      type: 'LIMIT',
      qty: '0.1',
      price: '90000',
      stopPrice: null,
      status: 'NEW',
      reduceOnly: false,
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const mock = createMockPool();
    const app = Fastify();
    registerRoutes(app, mock.pool);

    await app.inject({
      method: 'POST',
      url: '/v1/orders/900/amend',
      payload: {
        symbol: 'BTCUSDT',
        type: 'STOP_MARKET',
        qty: '0.1',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/ops/metrics?account_id=main&window_sec=900',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.by_account.main.order_amend_total).toBe(1);
    expect(body.by_account.main.order_amend_fail).toBe(1);
    expect(body.by_account.main.conditional_order_submit_fail).toBe(1);
    expect(body.alerts.some((alert: any) => alert.code === 'AMEND_ERROR_RATE_HIGH')).toBe(true);

    await app.close();
  });

  it('exposes ops metrics snapshot and alerts', async () => {
    createVP({
      id: 'vp_sub_b',
      account_id: 'sub_b',
      name: 'sub-b-vp',
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      net_qty: '1',
      avg_entry: '90000',
      realized_pnl: '0',
      tpsl: null,
      created_at: Date.now(),
    });

    const mock = createMockPool();
    const app = Fastify();
    registerRoutes(app, mock.pool);

    await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        virtual_position_id: 'vp_sub_b',
        symbol: 'BTCUSDT',
        positionSide: 'LONG',
        side: 'BUY',
        type: 'LIMIT',
        qty: '0.001',
        price: '90000',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/ops/metrics?account_id=sub_b&window_sec=900',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.by_account.sub_b.order_submit_total).toBe(1);
    expect(body.by_account.sub_b.order_submit_fail).toBe(1);
    expect(body.by_account.sub_b.error_counts.INVALID_ACCOUNT).toBe(1);
    expect(body.alerts.some((alert: any) => alert.code === 'INVALID_ACCOUNT_HIGH')).toBe(true);

    await app.close();
  });

  it('returns 503 on failed startup health report', async () => {
    __dangerousSetStartupHealthForTests(
      [{ name: 'db_path_writable', status: 'FAIL', message: 'permission denied' }],
      Date.now() - 5_000,
    );

    const mock = createMockPool();
    const app = Fastify();
    registerRoutes(app, mock.pool);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/ops/health',
    });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe('FAIL');
    expect(body.checks[0].name).toBe('db_path_writable');
    expect(body.uptime_sec).toBeGreaterThanOrEqual(5);
    await app.close();
  });
});
