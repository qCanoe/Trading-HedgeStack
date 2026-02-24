/**
 * WebSocket Gateway — broadcasts server events to all connected browser clients.
 */
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { WsEvent } from '../store/types.js';

const clients = new Set<WebSocket>();

export function registerWsGateway(fastify: FastifyInstance): void {
  fastify.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    console.log(`[WS] Client connected (total: ${clients.size})`);

    socket.on('close', () => {
      clients.delete(socket);
      console.log(`[WS] Client disconnected (total: ${clients.size})`);
    });

    socket.on('error', (err) => {
      console.error('[WS] Socket error', err);
      clients.delete(socket);
    });

    // Send initial state snapshot on connect
    sendStateSnapshot(socket);
  });
}

export function broadcast(event: WsEvent): void {
  const payload = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(payload, (err) => {
        if (err) clients.delete(client);
      });
    }
  }
}

function sendStateSnapshot(socket: WebSocket): void {
  // Lazy import to avoid circular dependencies at module load time
  import('../store/state.js').then(
    ({
      getAllVPs,
      getOpenOrders,
      getRecentFills,
      getExternalPositions,
      getAllMarketTicks,
      getConsistencyStatuses,
    }) => {
      const consistency = getConsistencyStatuses();
      const reconcile: Record<string, Record<string, string>> = {};
      for (const s of consistency) {
        if (!reconcile[s.account_id]) reconcile[s.account_id] = {};
        reconcile[s.account_id][`${s.symbol}_${s.positionSide}`] = s.status;
      }

      const snapshot = {
        virtual_positions: getAllVPs(),
        open_orders: getOpenOrders(),
        recent_fills: getRecentFills(),
        external_positions: getExternalPositions(),
        market: getAllMarketTicks(),
        consistency,
        reconcile,
      };
      const event: WsEvent = { type: 'STATE_SNAPSHOT', payload: snapshot, ts: Date.now() };
      if (socket.readyState === 1) socket.send(JSON.stringify(event));
    }
  );
}
