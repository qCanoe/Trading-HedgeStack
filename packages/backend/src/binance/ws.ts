/**
 * Binance WebSocket manager.
 * - User Data Stream per account
 * - Shared market stream
 */
import WebSocket from 'ws';
import { config } from '../config/env.js';
import type { BinanceRestClient } from './rest.js';
import {
  processBinanceFillEvent,
  extractAccountIdFromClientOrderId,
  type BinanceFillEvent,
} from '../engine/attribution/index.js';
import { handleTpSlFilled } from '../engine/tpsl/index.js';
import { checkConsistency } from '../engine/reconcile/index.js';
import {
  upsertOrder,
  setExternalPosition,
  setMarketTick,
  getOrderMappingByClientOrderId,
  getOrder,
} from '../store/state.js';
import { broadcast } from '../ws/gateway.js';
import { recordWsReconnect } from '../ops/metrics.js';
import type { AccountStreamStatus, ExternalPosition, MarketTick, OrderRecord } from '../store/types.js';
import type { Symbol } from '../config/env.js';

const WS_BASE_LIVE = 'wss://fstream.binance.com';
const WS_BASE_TESTNET = 'wss://stream.binancefuture.com';

type WsStatus = 'CONNECTED' | 'DISCONNECTED' | 'UNKNOWN';

interface UserStreamContext {
  accountId: string;
  testnet: boolean;
  rest: BinanceRestClient;
  listenKey: string;
  userDataWs: WebSocket | null;
  listenKeyInterval: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempts: number;
}

function wsBase(testnet: boolean): string {
  return testnet ? WS_BASE_TESTNET : WS_BASE_LIVE;
}

const userStreams = new Map<string, UserStreamContext>();
const streamStatusByAccount = new Map<string, AccountStreamStatus>();

function getOrCreateStatus(accountId: string): AccountStreamStatus {
  const existing = streamStatusByAccount.get(accountId);
  if (existing) return existing;
  const initial: AccountStreamStatus = {
    account_id: accountId,
    ws_status: 'UNKNOWN',
    reason: null,
    last_error: null,
    last_connected_at: null,
    updated_at: Date.now(),
  };
  streamStatusByAccount.set(accountId, initial);
  return initial;
}

function updateStatus(
  accountId: string,
  ws_status: WsStatus,
  reason: string | null,
  err?: unknown
): AccountStreamStatus {
  const prev = getOrCreateStatus(accountId);
  const next: AccountStreamStatus = {
    ...prev,
    ws_status,
    reason,
    updated_at: Date.now(),
  };

  if (ws_status === 'CONNECTED') {
    next.last_connected_at = Date.now();
    next.last_error = null;
  } else if (err) {
    const msg = err instanceof Error ? err.message : String(err);
    next.last_error = msg;
  }

  streamStatusByAccount.set(accountId, next);
  broadcast({ type: 'ACCOUNT_STREAM_STATUS', payload: next, ts: Date.now() });
  return next;
}

function scheduleReconnect(ctx: UserStreamContext, reason: string): void {
  if (ctx.reconnectTimer) return;
  ctx.reconnectAttempts += 1;

  const base = Math.min(1000 * Math.pow(2, ctx.reconnectAttempts - 1), 30_000);
  const jitter = Math.floor(Math.random() * Math.min(1000, Math.floor(base * 0.3)));
  const delay = base + jitter;

  updateStatus(ctx.accountId, 'DISCONNECTED', `${reason}: reconnect_in_${delay}ms`);
  recordWsReconnect(ctx.accountId);
  ctx.reconnectTimer = setTimeout(() => {
    ctx.reconnectTimer = null;
    connectUserDataWs(ctx);
  }, delay);
}

export function getUserDataStreamStatus(accountId: string): WsStatus {
  return getOrCreateStatus(accountId).ws_status;
}

export function getUserDataStreamInfo(accountId: string): AccountStreamStatus {
  return getOrCreateStatus(accountId);
}

export function getAllUserDataStreamInfos(): AccountStreamStatus[] {
  return Array.from(streamStatusByAccount.values());
}

// ─── User Data Stream ──────────────────────────────────────────────────────

export async function startUserDataStream(
  accountId: string,
  rest: BinanceRestClient,
  testnet = config.binance.testnet
): Promise<void> {
  if (userStreams.has(accountId)) return;

  try {
    const listenKey = await rest.createListenKey();
    const context: UserStreamContext = {
      accountId,
      testnet,
      rest,
      listenKey,
      userDataWs: null,
      listenKeyInterval: null,
      reconnectTimer: null,
      reconnectAttempts: 0,
    };

    userStreams.set(accountId, context);
    updateStatus(accountId, 'DISCONNECTED', 'stream_initializing');
    connectUserDataWs(context);

    context.listenKeyInterval = setInterval(async () => {
      try {
        await rest.keepAliveListenKey(context.listenKey);
      } catch {
        try {
          context.listenKey = await rest.createListenKey();
          updateStatus(accountId, 'DISCONNECTED', 'listen_key_renewed');
        } catch (renewErr) {
          updateStatus(accountId, 'DISCONNECTED', 'listen_key_renew_failed', renewErr);
        }
      }
    }, 30 * 60 * 1000);
  } catch (err) {
    updateStatus(accountId, 'DISCONNECTED', 'listen_key_create_failed', err);
    throw err;
  }
}

function connectUserDataWs(ctx: UserStreamContext): void {
  const url = `${wsBase(ctx.testnet)}/ws/${ctx.listenKey}`;
  ctx.userDataWs = new WebSocket(url);

  ctx.userDataWs.on('open', () => {
    ctx.reconnectAttempts = 0;
    updateStatus(ctx.accountId, 'CONNECTED', 'user_data_connected');
    broadcast({
      type: 'WS_RECONNECT',
      payload: { reason: 'user_data_connected', account_id: ctx.accountId },
      ts: Date.now(),
    });
  });

  ctx.userDataWs.on('message', (data: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(data.toString());
      handleUserDataEvent(ctx.accountId, msg);
    } catch (err) {
      console.error(`[Binance WS] Parse error (${ctx.accountId})`, err);
    }
  });

  ctx.userDataWs.on('close', () => {
    broadcast({
      type: 'WS_RECONNECT',
      payload: { reason: 'user_data_closed', account_id: ctx.accountId },
      ts: Date.now(),
    });
    scheduleReconnect(ctx, 'user_data_closed');
  });

  ctx.userDataWs.on('error', (err) => {
    console.error(`[Binance WS] User data error (${ctx.accountId})`, err);
    updateStatus(ctx.accountId, 'DISCONNECTED', 'user_data_error', err);
  });
}

function handleUserDataEvent(streamAccountId: string, msg: any): void {
  switch (msg.e) {
    case 'ORDER_TRADE_UPDATE': {
      const o = msg.o;
      const orderId = String(o.i);
      const now = Date.now();
      const mapping = getOrderMappingByClientOrderId(o.c);
      const existing = getOrder(orderId);
      const resolvedAccountId =
        mapping?.account_id
        ?? existing?.account_id
        ?? extractAccountIdFromClientOrderId(o.c)
        ?? streamAccountId;
      const resolvedVpId = mapping?.virtual_position_id ?? existing?.virtual_position_id ?? '';

      const order: OrderRecord = {
        orderId,
        clientOrderId: o.c,
        account_id: resolvedAccountId,
        virtual_position_id: resolvedVpId,
        symbol: o.s,
        side: o.S,
        positionSide: o.ps,
        type: o.ot,
        qty: o.q,
        price: o.p !== '0' ? o.p : null,
        stopPrice: o.sp && o.sp !== '0' ? o.sp : null,
        status: o.X,
        reduceOnly: o.R,
        created_at: o.T,
        updated_at: now,
      };
      upsertOrder(order);
      broadcast({ type: 'ORDER_UPSERT', payload: order, ts: now });

      const { fill, updatedVP, status } = processBinanceFillEvent(
        msg as BinanceFillEvent,
        resolvedAccountId
      );
      if (fill) {
        broadcast({ type: 'FILL', payload: fill, ts: now });
      }
      if (updatedVP) {
        broadcast({ type: 'VIRTUAL_POSITION_UPDATE', payload: updatedVP, ts: now });
      }

      if (status === 'FILLED') {
        handleTpSlFilled(orderId);
      }
      break;
    }

    case 'ACCOUNT_UPDATE': {
      const positions = msg.a?.P ?? [];
      for (const p of positions) {
        const extPos: ExternalPosition = {
          account_id: streamAccountId,
          symbol: p.s,
          positionSide: p.ps,
          qty: Math.abs(parseFloat(p.pa)).toString(),
          avgEntryPrice: p.ep,
          unrealizedPnl: p.up ?? '0',
          markPrice: '0',
        };
        setExternalPosition(extPos);
        broadcast({ type: 'EXTERNAL_POSITION_UPDATE', payload: extPos, ts: Date.now() });
      }
      setTimeout(() => checkConsistency(streamAccountId), 500);
      break;
    }

    default:
      break;
  }
}

// ─── Market Stream ────────────────────────────────────────────────────────

let marketWs: WebSocket | null = null;
let marketReconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function startMarketStream(testnet = config.binance.testnet): void {
  const symbols = config.symbols.map((s) => `${s.toLowerCase()}@markPrice`);
  const combined = symbols.join('/');
  const url = `${wsBase(testnet)}/stream?streams=${combined}`;
  connectMarketWs(url);
}

function connectMarketWs(url: string): void {
  marketWs = new WebSocket(url);

  marketWs.on('open', () => {
    console.log('[Binance WS] Market stream connected');
  });

  marketWs.on('message', (data: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(data.toString());
      const d = msg.data ?? msg;
      if (d.e === 'markPriceUpdate') {
        const tick: MarketTick = {
          symbol: d.s as Symbol,
          lastPrice: d.p,
          markPrice: d.p,
          indexPrice: d.i,
        };
        setMarketTick(tick);
        broadcast({ type: 'MARKET_TICK', payload: tick, ts: Date.now() });
      }
    } catch {}
  });

  marketWs.on('close', () => {
    marketReconnectTimer = setTimeout(() => connectMarketWs(url), 3000);
  });

  marketWs.on('error', (err) => {
    console.error('[Binance WS] Market stream error', err);
  });
}

export function stopAllStreams(): void {
  for (const [accountId, ctx] of userStreams.entries()) {
    if (ctx.listenKeyInterval) clearInterval(ctx.listenKeyInterval);
    if (ctx.reconnectTimer) clearTimeout(ctx.reconnectTimer);
    ctx.userDataWs?.close();
    updateStatus(accountId, 'DISCONNECTED', 'manual_stop');
  }
  userStreams.clear();

  if (marketReconnectTimer) clearTimeout(marketReconnectTimer);
  marketWs?.close();
}
