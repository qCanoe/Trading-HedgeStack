/**
 * Backend WebSocket client.
 * Connects to ws://backend/ws and dispatches events to the Zustand store.
 */
import type { WsEvent, StateSnapshot, VirtualPosition, OrderRecord, FillRecord, ExternalPosition, MarketTick, ConsistencyStatus } from '../types/index.js';
import { useStore } from '../store/index.js';

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;

export function connectWs(): void {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('[WS] Connected');
    reconnectDelay = 1000;
    useStore.getState().setWsConnected(true);
  };

  ws.onclose = () => {
    console.warn(`[WS] Disconnected — reconnecting in ${reconnectDelay}ms`);
    useStore.getState().setWsConnected(false);
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      connectWs();
    }, reconnectDelay);
  };

  ws.onerror = (err) => {
    console.error('[WS] Error', err);
  };

  ws.onmessage = (event) => {
    try {
      const msg: WsEvent = JSON.parse(event.data as string);
      handleEvent(msg);
    } catch {}
  };
}

function handleEvent(event: WsEvent): void {
  const store = useStore.getState();

  switch (event.type) {
    case 'STATE_SNAPSHOT': {
      const snap = event.payload as StateSnapshot;
      store.setVirtualPositions(snap.virtual_positions);
      store.setOpenOrders(snap.open_orders);
      store.setRecentFills(snap.recent_fills);
      store.setExternalPositions(snap.external_positions);
      store.setMarketTicks(snap.market);
      store.setConsistencyStatuses(snap.consistency ?? []);
      break;
    }
    case 'VIRTUAL_POSITION_UPDATE':
      store.upsertVirtualPosition(event.payload as VirtualPosition);
      break;
    case 'ORDER_UPSERT':
      store.upsertOrder(event.payload as OrderRecord);
      break;
    case 'FILL':
      store.addFill(event.payload as FillRecord);
      break;
    case 'EXTERNAL_POSITION_UPDATE':
      store.upsertExternalPosition(event.payload as ExternalPosition);
      break;
    case 'MARKET_TICK':
      store.updateMarketTick(event.payload as MarketTick);
      break;
    case 'CONSISTENCY_STATUS':
      store.updateConsistencyStatus(event.payload as ConsistencyStatus);
      break;
    case 'WS_RECONNECT':
      console.log('[WS] Binance reconnect:', (event.payload as any).reason);
      break;
    case 'TPSL_SYNC_STATUS': {
      const { vp_id, status, tp_order_id, sl_order_id } = event.payload as any;
      store.updateTpSlSyncStatus(vp_id, status, tp_order_id, sl_order_id);
      break;
    }
  }
}

export function disconnectWs(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws?.close();
  ws = null;
}
