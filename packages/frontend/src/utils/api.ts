/**
 * API client utilities for the backend REST API.
 */
import type {
  VirtualPosition,
  OrderRecord,
  FillRecord,
  ExternalPosition,
  MarketTick,
} from '../types/index.js';

const BASE = '/v1';

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // State
  getState: () => request<{
    external_positions: ExternalPosition[];
    virtual_positions: VirtualPosition[];
    open_orders: OrderRecord[];
    recent_fills: FillRecord[];
    market: Record<string, MarketTick>;
    reconcile: Record<string, Record<string, string>>;
  }>('GET', '/state'),

  // Virtual Positions
  createVP: (body: { name: string; symbol: string; positionSide: string }) =>
    request<VirtualPosition>('POST', '/virtual-positions', body),
  deleteVP: (id: string) =>
    request<{ success: boolean }>('DELETE', `/virtual-positions/${id}`),

  // Orders
  placeOrder: (body: {
    virtual_position_id: string;
    symbol: string;
    positionSide: string;
    side: string;
    type: string;
    qty: string;
    price?: string;
    stopPrice?: string;
    reduceOnly?: boolean;
    timeInForce?: string;
  }) => request<{ orderId: string; clientOrderId: string; status: string }>('POST', '/orders', body),

  cancelOrder: (orderId: string, symbol: string) =>
    request<{ orderId: string; status: string }>('POST', `/orders/${orderId}/cancel`, { symbol }),

  // Close position
  closePosition: (
    vpId: string,
    body: { type: 'MARKET' | 'LIMIT'; qty?: string; percent?: number; price?: string }
  ) => request<{ orderId: string; clientOrderId: string; status: string }>('POST', `/virtual-positions/${vpId}/close`, body),

  // TPSL
  setTpSl: (
    vpId: string,
    body: {
      tp_price?: string | null;
      tp_trigger_type?: string;
      sl_price?: string | null;
      sl_trigger_type?: string;
      qty?: string;
    }
  ) => request<VirtualPosition>('POST', `/virtual-positions/${vpId}/tpsl`, body),
  clearTpSl: (vpId: string) =>
    request<VirtualPosition>('DELETE', `/virtual-positions/${vpId}/tpsl`),

  // Reconcile
  reconcile: (body: {
    symbol: string;
    positionSide: string;
    assignments: Array<{ virtual_position_id: string; qty: string }>;
  }) => request<{ updated: VirtualPosition[] }>('POST', '/reconcile', body),
};
