/**
 * Binance WebSocket manager.
 * Manages two streams:
 *   1. User Data Stream (order updates, fills, position updates)
 *   2. Market streams (markPrice for each symbol)
 */
import WebSocket from 'ws';
import { config } from '../config/env.js';
import type { BinanceRestClient } from './rest.js';
import { processBinanceFillEvent } from '../engine/attribution/index.js';
import type { BinanceFillEvent } from '../engine/attribution/index.js';
import {
  upsertOrder,
  setExternalPosition,
  setMarketTick,
} from '../store/state.js';
import { broadcast } from '../ws/gateway.js';
import { checkConsistency } from '../engine/reconcile/index.js';
import type { ExternalPosition, MarketTick, OrderRecord } from '../store/types.js';
import type { Symbol, PositionSide } from '../config/env.js';

const WS_BASE_LIVE = 'wss://fstream.binance.com';
const WS_BASE_TESTNET = 'wss://stream.binancefuture.com';

function wsBase(): string {
  return config.binance.testnet ? WS_BASE_TESTNET : WS_BASE_LIVE;
}

// ─── User Data Stream ──────────────────────────────────────────────────────

let listenKey: string | null = null;
let userDataWs: WebSocket | null = null;
let listenKeyInterval: ReturnType<typeof setInterval> | null = null;
let userDataReconnectTimer: ReturnType<typeof setTimeout> | null = null;

export async function startUserDataStream(rest: BinanceRestClient): Promise<void> {
  listenKey = await rest.createListenKey();
  connectUserDataWs(rest);

  // Keep-alive every 30 minutes
  listenKeyInterval = setInterval(async () => {
    try {
      if (listenKey) await rest.keepAliveListenKey(listenKey);
    } catch {
      // Renew on failure
      try { listenKey = await rest.createListenKey(); } catch {}
    }
  }, 30 * 60 * 1000);
}

function connectUserDataWs(rest: BinanceRestClient): void {
  if (!listenKey) return;
  const url = `${wsBase()}/ws/${listenKey}`;
  userDataWs = new WebSocket(url);

  userDataWs.on('open', () => {
    console.log('[Binance WS] User data stream connected');
    broadcast({ type: 'WS_RECONNECT', payload: { reason: 'user_data_connected' }, ts: Date.now() });
  });

  userDataWs.on('message', (data: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(data.toString());
      handleUserDataEvent(msg, rest);
    } catch (err) {
      console.error('[Binance WS] Parse error', err);
    }
  });

  userDataWs.on('close', () => {
    console.warn('[Binance WS] User data stream closed — reconnecting in 3s');
    broadcast({ type: 'WS_RECONNECT', payload: { reason: 'user_data_closed' }, ts: Date.now() });
    userDataReconnectTimer = setTimeout(() => connectUserDataWs(rest), 3000);
  });

  userDataWs.on('error', (err) => {
    console.error('[Binance WS] User data error', err);
  });
}

function handleUserDataEvent(msg: any, rest: BinanceRestClient): void {
  switch (msg.e) {
    case 'ORDER_TRADE_UPDATE': {
      const o = msg.o;
      const now = Date.now();

      // Update order record
      const order: OrderRecord = {
        orderId: String(o.i),
        clientOrderId: o.c,
        virtual_position_id: '', // will be filled by attribution
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

      // Process fill
      const { fill, updatedVP } = processBinanceFillEvent(msg as BinanceFillEvent);
      if (fill) {
        broadcast({ type: 'FILL', payload: fill, ts: now });
      }
      if (updatedVP) {
        broadcast({ type: 'VIRTUAL_POSITION_UPDATE', payload: updatedVP, ts: now });
      }
      break;
    }

    case 'ACCOUNT_UPDATE': {
      // Position and balance updates
      const positions = msg.a?.P ?? [];
      for (const p of positions) {
        const extPos: ExternalPosition = {
          symbol: p.s,
          positionSide: p.ps,
          qty: Math.abs(parseFloat(p.pa)).toString(),
          avgEntryPrice: p.ep,
          unrealizedPnl: p.up ?? '0',
          markPrice: '0', // will be updated from market stream
        };
        setExternalPosition(extPos);
        broadcast({ type: 'EXTERNAL_POSITION_UPDATE', payload: extPos, ts: Date.now() });
      }
      // Trigger consistency check
      setTimeout(() => checkConsistency(), 500);
      break;
    }

    default:
      break;
  }
}

// ─── Market Stream ────────────────────────────────────────────────────────

let marketWs: WebSocket | null = null;
let marketReconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function startMarketStream(): void {
  const symbols = config.symbols.map((s) => `${s.toLowerCase()}@markPrice`);
  const combined = symbols.join('/');
  const url = `${wsBase()}/stream?streams=${combined}`;
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
  if (listenKeyInterval) clearInterval(listenKeyInterval);
  if (userDataReconnectTimer) clearTimeout(userDataReconnectTimer);
  if (marketReconnectTimer) clearTimeout(marketReconnectTimer);
  userDataWs?.close();
  marketWs?.close();
}
