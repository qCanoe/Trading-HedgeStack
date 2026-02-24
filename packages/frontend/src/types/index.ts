// Shared types (mirrored from backend — keep in sync)

export type Symbol = 'BTCUSDT' | 'ETHUSDT' | string;
export type PositionSide = 'LONG' | 'SHORT';
export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'STOP' | 'TAKE_PROFIT_MARKET' | 'TAKE_PROFIT';
export type PlaceOrderType = 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'STOP';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK' | 'GTX';
export type AccountType = 'MAIN' | 'SUB';

export interface AccountInfo {
  id: string;
  name: string;
  type: AccountType;
  testnet: boolean;
  enabled: boolean;
  ws_status: 'CONNECTED' | 'DISCONNECTED' | 'UNKNOWN';
  last_error: string | null;
  last_connected_at: number | null;
}

export interface AccountStreamStatus {
  account_id: string;
  ws_status: 'CONNECTED' | 'DISCONNECTED' | 'UNKNOWN';
  reason: string | null;
  last_error: string | null;
  last_connected_at: number | null;
  updated_at: number;
}

export interface TpSlConfig {
  tp_price: string | null;
  tp_trigger_type: 'LAST_PRICE' | 'MARK_PRICE';
  tp_order_id: string | null;
  sl_price: string | null;
  sl_trigger_type: 'LAST_PRICE' | 'MARK_PRICE';
  sl_order_id: string | null;
  sync_status: 'OK' | 'SYNCING' | 'ERROR';
}

export interface VirtualPosition {
  id: string;
  account_id: string;
  name: string;
  symbol: Symbol;
  positionSide: PositionSide;
  net_qty: string;
  avg_entry: string;
  realized_pnl: string;
  tpsl: TpSlConfig | null;
  created_at: number;
}

export interface OrderRecord {
  orderId: string;
  clientOrderId: string;
  account_id: string;
  virtual_position_id: string;
  symbol: Symbol;
  side: OrderSide;
  positionSide: PositionSide;
  type: OrderType;
  qty: string;
  price: string | null;
  stopPrice: string | null;
  status: string;
  reduceOnly: boolean;
  created_at: number;
  updated_at: number;
}

export interface FillRecord {
  tradeId: string;
  orderId: string;
  clientOrderId: string;
  account_id: string;
  virtual_position_id: string | null;
  symbol: Symbol;
  side: OrderSide;
  positionSide: PositionSide;
  qty: string;
  price: string;
  commission: string;
  commissionAsset: string;
  realizedPnl: string;
  ts: number;
}

export interface ExternalPosition {
  account_id: string;
  symbol: Symbol;
  positionSide: PositionSide;
  qty: string;
  avgEntryPrice: string;
  unrealizedPnl: string;
  markPrice: string;
}

export interface MarketTick {
  symbol: Symbol;
  lastPrice: string;
  markPrice: string;
  indexPrice: string;
}

export interface ConsistencyStatus {
  account_id: string;
  symbol: Symbol;
  positionSide: PositionSide;
  status: 'OK' | 'MISMATCH';
  external_qty: string;
  virtual_qty: string;
}

export type EventType =
  | 'ORDER_UPSERT'
  | 'FILL'
  | 'VIRTUAL_POSITION_UPDATE'
  | 'EXTERNAL_POSITION_UPDATE'
  | 'ACCOUNT_STREAM_STATUS'
  | 'TPSL_SYNC_STATUS'
  | 'CONSISTENCY_STATUS'
  | 'MARKET_TICK'
  | 'WS_RECONNECT'
  | 'STATE_SNAPSHOT';

export interface WsEvent<T = unknown> {
  type: EventType;
  payload: T;
  ts: number;
}

export interface StateSnapshot {
  virtual_positions: VirtualPosition[];
  open_orders: OrderRecord[];
  recent_fills: FillRecord[];
  external_positions: ExternalPosition[];
  market: Record<string, MarketTick>;
  accounts_status: AccountStreamStatus[];
  consistency: ConsistencyStatus[];
  reconcile: Record<string, Record<string, string>>;
}
