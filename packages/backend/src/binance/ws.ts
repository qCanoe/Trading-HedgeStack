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
import type { ExternalPosition, MarketTick, OrderRecord } from '../store/types.js';
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
}

function wsBase(testnet: boolean): string {
  return testnet ? WS_BASE_TESTNET : WS_BASE_LIVE;
}

const userStreams = new Map<string, UserStreamContext>();
const userStreamStatus = new Map<string, WsStatus>();

function setStatus(accountId: string, status: WsStatus): void {
  userStreamStatus.set(accountId, status);
}

export function getUserDataStreamStatus(accountId: string): WsStatus {
  return userStreamStatus.get(accountId) ?? 'UNKNOWN';
}

// ─── User Data Stream ──────────────────────────────────────────────────────

export async function startUserDataStream(
  accountId: string,
  rest: BinanceRestClient,
  testnet = config.binance.testnet
): Promise<void> {
  if (userStreams.has(accountId)) return;

  const listenKey = await rest.createListenKey();
  const context: UserStreamContext = {
    accountId,
    testnet,
    rest,
    listenKey,
    userDataWs: null,
    listenKeyInterval: null,
    reconnectTimer: null,
  };

  userStreams.set(accountId, context);
  setStatus(accountId, 'DISCONNECTED');
  connectUserDataWs(context);

  context.listenKeyInterval = setInterval(async () => {
    try {
      await rest.keepAliveListenKey(context.listenKey);
    } catch {
      try {
        context.listenKey = await rest.createListenKey();
      } catch {}
    }
  }, 30 * 60 * 1000);
}

function connectUserDataWs(ctx: UserStreamContext): void {
  const url = `${wsBase(ctx.testnet)}/ws/${ctx.listenKey}`;
  ctx.userDataWs = new WebSocket(url);

  ctx.userDataWs.on('open', () => {
    setStatus(ctx.accountId, 'CONNECTED');
    console.log(`[Binance WS] User data connected (${ctx.accountId})`);
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
    setStatus(ctx.accountId, 'DISCONNECTED');
    console.warn(`[Binance WS] User data closed (${ctx.accountId}) — reconnecting in 3s`);
    broadcast({
      type: 'WS_RECONNECT',
      payload: { reason: 'user_data_closed', account_id: ctx.accountId },
      ts: Date.now(),
    });
    ctx.reconnectTimer = setTimeout(() => connectUserDataWs(ctx), 3000);
  });

  ctx.userDataWs.on('error', (err) => {
    setStatus(ctx.accountId, 'DISCONNECTED');
    console.error(`[Binance WS] User data error (${ctx.accountId})`, err);
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
let marketTestnet = config.binance.testnet;

export function startMarketStream(testnet = config.binance.testnet): void {
  marketTestnet = testnet;
  const symbols = config.symbols.map((s) => `${s.toLowerCase()}@markPrice`);
  const combined = symbols.join('/');
  const url = `${wsBase(marketTestnet)}/stream?streams=${combined}`;
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
    console.warn('[Binance WS] Market stream closed — reconnecting in 3s');
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
    setStatus(accountId, 'DISCONNECTED');
  }
  userStreams.clear();

  if (marketReconnectTimer) clearTimeout(marketReconnectTimer);
  marketWs?.close();
}

