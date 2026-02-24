import type { PositionSide, Symbol, OrderSide, OrderType, TimeInForce } from '../config/env.js';

export type AccountType = 'MAIN' | 'SUB';

export interface AccountInfo {
  id: string;
  name: string;
  type: AccountType;
  testnet: boolean;
  enabled: boolean;
  ws_status: 'CONNECTED' | 'DISCONNECTED' | 'UNKNOWN';
}

// ─── Virtual Position ──────────────────────────────────────────────────────

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

// ─── Order Record ─────────────────────────────────────────────────────────

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

// ─── Fill Record ──────────────────────────────────────────────────────────

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

// ─── External Position ────────────────────────────────────────────────────

export interface ExternalPosition {
  account_id: string;
  symbol: Symbol;
  positionSide: PositionSide;
  qty: string;
  avgEntryPrice: string;
  unrealizedPnl: string;
  markPrice: string;
}

// ─── Market Data ─────────────────────────────────────────────────────────

export interface MarketTick {
  symbol: Symbol;
  lastPrice: string;
  markPrice: string;
  indexPrice: string;
}

// ─── WS Event Types ────────────────────────────────────────────────────────

export type EventType =
  | 'ORDER_UPSERT'
  | 'FILL'
  | 'VIRTUAL_POSITION_UPDATE'
  | 'EXTERNAL_POSITION_UPDATE'
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

export interface ConsistencyStatus {
  account_id: string;
  symbol: Symbol;
  positionSide: PositionSide;
  status: 'OK' | 'MISMATCH';
  external_qty: string;
  virtual_qty: string;
}

// ─── API Request Types ────────────────────────────────────────────────────

export interface CreateVirtualPositionRequest {
  name: string;
  symbol: Symbol;
  positionSide: PositionSide;
  account_id?: string;
}

export interface PlaceOrderRequest {
  virtual_position_id: string;
  account_id?: string;
  symbol: Symbol;
  positionSide: PositionSide;
  side: OrderSide;
  type: OrderType;
  qty: string;
  price?: string;
  stopPrice?: string;
  reduceOnly?: boolean;
  timeInForce?: TimeInForce;
}

export interface ClosePositionRequest {
  type: 'MARKET' | 'LIMIT';
  account_id?: string;
  qty?: string;
  percent?: number;
  price?: string;
}

export interface SetTpSlRequest {
  account_id?: string;
  tp_price?: string | null;
  tp_trigger_type?: 'LAST_PRICE' | 'MARK_PRICE';
  sl_price?: string | null;
  sl_trigger_type?: 'LAST_PRICE' | 'MARK_PRICE';
  qty?: string;
}

export interface ReconcileAssignment {
  virtual_position_id: string;
  qty: string;
}

export interface ClientOrderMapping {
  account_id: string;
  virtual_position_id: string;
}

export interface ReconcileRequest {
  account_id?: string;
  symbol: Symbol;
  positionSide: PositionSide;
  assignments: ReconcileAssignment[];
}

// ─── State Snapshot ───────────────────────────────────────────────────────

export interface StateSnapshot {
  external_positions: ExternalPosition[];
  virtual_positions: VirtualPosition[];
  open_orders: OrderRecord[];
  recent_fills: FillRecord[];
  market: Record<string, MarketTick>;
  consistency: ConsistencyStatus[];
  reconcile: Record<string, Record<string, 'OK' | 'MISMATCH'>>;
}
