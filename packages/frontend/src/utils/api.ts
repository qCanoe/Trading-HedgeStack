/**
 * API client utilities for the backend REST API.
 */
import type {
  AccountInfo,
  AccountStreamStatus,
  PlaceOrderType,
  VirtualPosition,
  OrderRecord,
  FillRecord,
  ExternalPosition,
  MarketTick,
  ConsistencyStatus,
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
  // Accounts
  getAccounts: () => request<AccountInfo[]>('GET', '/accounts'),

  // State
  getState: (params?: { account_id?: string; symbol?: string }) => {
    const qs = new URLSearchParams();
    if (params?.account_id) qs.set('account_id', params.account_id);
    if (params?.symbol) qs.set('symbol', params.symbol);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{
    external_positions: ExternalPosition[];
    virtual_positions: VirtualPosition[];
    open_orders: OrderRecord[];
    recent_fills: FillRecord[];
    market: Record<string, MarketTick>;
    accounts_status: AccountStreamStatus[];
    consistency: ConsistencyStatus[];
    reconcile: Record<string, Record<string, string>>;
    }>('GET', `/state${suffix}`);
  },

  // Virtual Positions
  createVP: (body: { name: string; symbol: string; positionSide: string; account_id?: string }) =>
    request<VirtualPosition>('POST', '/virtual-positions', body),
  deleteVP: (id: string) =>
    request<{ success: boolean }>('DELETE', `/virtual-positions/${id}`),

  // Orders
  placeOrder: (body: {
    virtual_position_id: string;
    account_id?: string;
    symbol: string;
    positionSide: string;
    side: string;
    type: PlaceOrderType;
    qty: string;
    price?: string;
    stopPrice?: string;
    triggerPriceType?: 'LAST_PRICE' | 'MARK_PRICE';
    reduceOnly?: boolean;
    timeInForce?: string;
  }) => request<{ orderId: string; clientOrderId: string; status: string }>('POST', '/orders', body),

  cancelOrder: (orderId: string, symbol: string, account_id?: string) =>
    request<{ orderId: string; status: string }>('POST', `/orders/${orderId}/cancel`, { symbol, account_id }),

  amendOrder: (orderId: string, body: {
    account_id?: string;
    symbol: string;
    virtual_position_id?: string;
    type: Exclude<PlaceOrderType, 'MARKET'>;
    qty: string;
    price?: string;
    stopPrice?: string;
    triggerPriceType?: 'LAST_PRICE' | 'MARK_PRICE';
    timeInForce?: string;
  }) => request<{
    old_order_id: string;
    new_order_id: string;
    clientOrderId: string;
    status: string;
  }>('POST', `/orders/${orderId}/amend`, body),

  // Close position
  closePosition: (
    vpId: string,
    body: { type: 'MARKET' | 'LIMIT'; account_id?: string; qty?: string; percent?: number; price?: string }
  ) => request<{ orderId: string; clientOrderId: string; status: string }>('POST', `/virtual-positions/${vpId}/close`, body),

  // TPSL
  setTpSl: (
    vpId: string,
    body: {
      tp_price?: string | null;
      account_id?: string;
      tp_trigger_type?: string;
      sl_price?: string | null;
      sl_trigger_type?: string;
      qty?: string;
      percent?: number;
    }
  ) => request<VirtualPosition>('POST', `/virtual-positions/${vpId}/tpsl`, body),
  clearTpSl: (vpId: string) =>
    request<VirtualPosition>('DELETE', `/virtual-positions/${vpId}/tpsl`),

  // Reconcile
  reconcile: (body: {
    account_id?: string;
    symbol: string;
    positionSide: string;
    assignments: Array<{ virtual_position_id: string; qty: string }>;
  }) => request<{ updated: VirtualPosition[] }>('POST', '/reconcile', body),
};
