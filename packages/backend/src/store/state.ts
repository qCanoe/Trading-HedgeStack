/**
 * In-memory state store — single source of truth for runtime state.
 * Persistence is handled by db.ts; this layer is for fast in-memory access.
 */
import type {
  VirtualPosition,
  OrderRecord,
  FillRecord,
  ExternalPosition,
  MarketTick,
  ConsistencyStatus,
  ClientOrderMapping,
} from './types.js';
import type { Symbol, PositionSide } from '../config/env.js';
import {
  dbGetAllVPs,
  dbGetOpenOrders,
  dbGetRecentFills,
  dbInsertVP,
  dbUpdateVP,
  dbDeleteVP,
  dbUpsertOrder,
  dbInsertFill,
  dbSaveClientOrderMap,
  dbGetOrderMappingByClientOrderId,
  getDb,
} from './db.js';

interface StateFilter {
  account_id?: string;
  symbol?: Symbol;
}

export function positionKey(accountId: string, symbol: Symbol, side: PositionSide): string {
  return JSON.stringify([accountId, symbol, side]);
}

export function decodePositionKey(key: string): [string, Symbol, PositionSide] {
  const parsed = JSON.parse(key) as [string, Symbol, PositionSide];
  if (!Array.isArray(parsed) || parsed.length !== 3) {
    throw new Error(`Invalid position key: ${key}`);
  }
  return parsed;
}

function matchFilter(
  item: { account_id: string; symbol?: Symbol },
  filter?: StateFilter
): boolean {
  if (!filter) return true;
  if (filter.account_id && item.account_id !== filter.account_id) return false;
  if (filter.symbol && item.symbol !== filter.symbol) return false;
  return true;
}

// ─── In-memory maps ────────────────────────────────────────────────────────

const virtualPositions = new Map<string, VirtualPosition>();
const openOrders = new Map<string, OrderRecord>();
const externalPositions = new Map<string, ExternalPosition>(); // key = `${accountId}_${symbol}_${positionSide}`
const marketTicks = new Map<string, MarketTick>(); // key = symbol
const consistencyStatus = new Map<string, ConsistencyStatus>(); // key = `${accountId}_${symbol}_${positionSide}`

// ─── Initialise from DB ───────────────────────────────────────────────────

export function initState(): void {
  for (const vp of dbGetAllVPs()) virtualPositions.set(vp.id, vp);
  for (const order of dbGetOpenOrders()) openOrders.set(order.orderId, order);
}

// ─── Virtual Positions ────────────────────────────────────────────────────

export function getAllVPs(filter?: StateFilter): VirtualPosition[] {
  return Array.from(virtualPositions.values()).filter((vp) => matchFilter(vp, filter));
}

export function getVP(id: string): VirtualPosition | undefined {
  return virtualPositions.get(id);
}

export function createVP(vp: VirtualPosition): void {
  virtualPositions.set(vp.id, vp);
  dbInsertVP(vp);
}

export function updateVP(vp: VirtualPosition): void {
  virtualPositions.set(vp.id, vp);
  dbUpdateVP(vp);
}

export function deleteVP(id: string): void {
  virtualPositions.delete(id);
  dbDeleteVP(id);
}

// ─── Orders ───────────────────────────────────────────────────────────────

export function getOpenOrders(filter?: StateFilter): OrderRecord[] {
  return Array.from(openOrders.values()).filter((order) => matchFilter(order, filter));
}

export function getOrder(orderId: string): OrderRecord | undefined {
  return openOrders.get(orderId);
}

export function upsertOrder(order: OrderRecord): void {
  const terminal = ['CANCELED', 'FILLED', 'EXPIRED', 'REJECTED'];
  if (terminal.includes(order.status)) {
    openOrders.delete(order.orderId);
  } else {
    openOrders.set(order.orderId, order);
  }
  dbUpsertOrder(order);
}

// ─── Fills ────────────────────────────────────────────────────────────────

const recentFills: FillRecord[] = [];
const MAX_RECENT_FILLS = 100;

export function addFill(fill: FillRecord): void {
  recentFills.unshift(fill);
  if (recentFills.length > MAX_RECENT_FILLS) recentFills.pop();
  dbInsertFill(fill);
}

export function getRecentFills(filter?: StateFilter): FillRecord[] {
  return recentFills.filter((fill) => matchFilter(fill, filter));
}

export function initFills(): void {
  const dbFills = dbGetRecentFills(MAX_RECENT_FILLS);
  recentFills.push(...dbFills);
}

// ─── External Positions ───────────────────────────────────────────────────

export function setExternalPosition(pos: ExternalPosition): void {
  externalPositions.set(positionKey(pos.account_id, pos.symbol, pos.positionSide), pos);
}

export function getExternalPositions(filter?: StateFilter): ExternalPosition[] {
  return Array.from(externalPositions.values()).filter((pos) => matchFilter(pos, filter));
}

export function getExternalPosition(
  accountId: string,
  symbol: Symbol,
  side: PositionSide
): ExternalPosition | undefined {
  return externalPositions.get(positionKey(accountId, symbol, side));
}

// ─── Market Ticks ─────────────────────────────────────────────────────────

export function setMarketTick(tick: MarketTick): void {
  marketTicks.set(tick.symbol, tick);
}

export function getMarketTick(symbol: Symbol): MarketTick | undefined {
  return marketTicks.get(symbol);
}

export function getAllMarketTicks(): Record<string, MarketTick> {
  return Object.fromEntries(marketTicks.entries());
}

// ─── Consistency Status ───────────────────────────────────────────────────

export function setConsistencyStatus(s: ConsistencyStatus): void {
  consistencyStatus.set(positionKey(s.account_id, s.symbol, s.positionSide), s);
}

export function getConsistencyStatuses(filter?: StateFilter): ConsistencyStatus[] {
  return Array.from(consistencyStatus.values()).filter((item) => matchFilter(item, filter));
}

// ─── clientOrderId map ─────────────────────────────────────────────────────

const clientOrderMap = new Map<string, ClientOrderMapping>();

export function saveClientOrderMap(clientOrderId: string, mapping: ClientOrderMapping): void {
  clientOrderMap.set(clientOrderId, mapping);
  dbSaveClientOrderMap(clientOrderId, mapping);
}

export function getOrderMappingByClientOrderId(clientOrderId: string): ClientOrderMapping | null {
  return clientOrderMap.get(clientOrderId) ?? dbGetOrderMappingByClientOrderId(clientOrderId);
}

export function __dangerousResetStateForTests(): void {
  virtualPositions.clear();
  openOrders.clear();
  externalPositions.clear();
  marketTicks.clear();
  consistencyStatus.clear();
  recentFills.length = 0;
  clientOrderMap.clear();

  const db = getDb();
  db.exec(`
    DELETE FROM fills;
    DELETE FROM orders;
    DELETE FROM virtual_positions;
    DELETE FROM client_order_map;
  `);
}
