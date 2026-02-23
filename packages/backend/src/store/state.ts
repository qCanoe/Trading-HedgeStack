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
  dbGetVpIdByClientOrderId,
} from './db.js';

// ─── In-memory maps ────────────────────────────────────────────────────────

const virtualPositions = new Map<string, VirtualPosition>();
const openOrders = new Map<string, OrderRecord>();
const externalPositions = new Map<string, ExternalPosition>(); // key = `${symbol}_${positionSide}`
const marketTicks = new Map<string, MarketTick>(); // key = symbol
const consistencyStatus = new Map<string, ConsistencyStatus>(); // key = `${symbol}_${positionSide}`

// ─── Initialise from DB ───────────────────────────────────────────────────

export function initState(): void {
  for (const vp of dbGetAllVPs()) virtualPositions.set(vp.id, vp);
  for (const order of dbGetOpenOrders()) openOrders.set(order.orderId, order);
}

// ─── Virtual Positions ────────────────────────────────────────────────────

export function getAllVPs(): VirtualPosition[] {
  return Array.from(virtualPositions.values());
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

export function getOpenOrders(): OrderRecord[] {
  return Array.from(openOrders.values());
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

export function getRecentFills(): FillRecord[] {
  return recentFills.slice();
}

export function initFills(): void {
  const dbFills = dbGetRecentFills(MAX_RECENT_FILLS);
  recentFills.push(...dbFills);
}

// ─── External Positions ───────────────────────────────────────────────────

export function setExternalPosition(pos: ExternalPosition): void {
  const key = `${pos.symbol}_${pos.positionSide}`;
  externalPositions.set(key, pos);
}

export function getExternalPositions(): ExternalPosition[] {
  return Array.from(externalPositions.values());
}

export function getExternalPosition(symbol: Symbol, side: PositionSide): ExternalPosition | undefined {
  return externalPositions.get(`${symbol}_${side}`);
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
  consistencyStatus.set(`${s.symbol}_${s.positionSide}`, s);
}

export function getConsistencyStatuses(): ConsistencyStatus[] {
  return Array.from(consistencyStatus.values());
}

// ─── clientOrderId map ─────────────────────────────────────────────────────

const clientOrderMap = new Map<string, string>(); // clientOrderId → vpId

export function saveClientOrderMap(clientOrderId: string, vpId: string): void {
  clientOrderMap.set(clientOrderId, vpId);
  dbSaveClientOrderMap(clientOrderId, vpId);
}

export function getVpIdByClientOrderId(clientOrderId: string): string | null {
  return clientOrderMap.get(clientOrderId) ?? dbGetVpIdByClientOrderId(clientOrderId);
}
