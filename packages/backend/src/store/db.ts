import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from '../config/env.js';
import type { VirtualPosition, OrderRecord, FillRecord } from './types.js';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    mkdirSync(dirname(config.dbPath), { recursive: true });
    db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS virtual_positions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      position_side TEXT NOT NULL,
      net_qty TEXT NOT NULL DEFAULT '0',
      avg_entry TEXT NOT NULL DEFAULT '0',
      realized_pnl TEXT NOT NULL DEFAULT '0',
      tpsl TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY,
      client_order_id TEXT NOT NULL UNIQUE,
      virtual_position_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      position_side TEXT NOT NULL,
      type TEXT NOT NULL,
      qty TEXT NOT NULL,
      price TEXT,
      stop_price TEXT,
      status TEXT NOT NULL,
      reduce_only INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_orders_vp ON orders(virtual_position_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

    CREATE TABLE IF NOT EXISTS fills (
      trade_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      client_order_id TEXT NOT NULL,
      virtual_position_id TEXT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      position_side TEXT NOT NULL,
      qty TEXT NOT NULL,
      price TEXT NOT NULL,
      commission TEXT NOT NULL,
      commission_asset TEXT NOT NULL,
      realized_pnl TEXT NOT NULL DEFAULT '0',
      ts INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_fills_vp ON fills(virtual_position_id);
    CREATE INDEX IF NOT EXISTS idx_fills_symbol ON fills(symbol);

    CREATE TABLE IF NOT EXISTS client_order_map (
      client_order_id TEXT PRIMARY KEY,
      virtual_position_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

// ─── Virtual Position CRUD ────────────────────────────────────────────────

export function dbInsertVP(vp: VirtualPosition): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO virtual_positions (id, name, symbol, position_side, net_qty, avg_entry, realized_pnl, tpsl, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    vp.id, vp.name, vp.symbol, vp.positionSide,
    vp.net_qty, vp.avg_entry, vp.realized_pnl,
    vp.tpsl ? JSON.stringify(vp.tpsl) : null,
    vp.created_at
  );
}

export function dbUpdateVP(vp: VirtualPosition): void {
  const db = getDb();
  db.prepare(`
    UPDATE virtual_positions SET name=?, net_qty=?, avg_entry=?, realized_pnl=?, tpsl=? WHERE id=?
  `).run(
    vp.name, vp.net_qty, vp.avg_entry, vp.realized_pnl,
    vp.tpsl ? JSON.stringify(vp.tpsl) : null,
    vp.id
  );
}

export function dbDeleteVP(id: string): void {
  getDb().prepare('DELETE FROM virtual_positions WHERE id=?').run(id);
}

export function dbGetAllVPs(): VirtualPosition[] {
  const rows = getDb().prepare('SELECT * FROM virtual_positions ORDER BY created_at ASC').all() as any[];
  return rows.map(rowToVP);
}

export function dbGetVP(id: string): VirtualPosition | null {
  const row = getDb().prepare('SELECT * FROM virtual_positions WHERE id=?').get(id) as any;
  return row ? rowToVP(row) : null;
}

function rowToVP(row: any): VirtualPosition {
  return {
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    positionSide: row.position_side,
    net_qty: row.net_qty,
    avg_entry: row.avg_entry,
    realized_pnl: row.realized_pnl,
    tpsl: row.tpsl ? JSON.parse(row.tpsl) : null,
    created_at: row.created_at,
  };
}

// ─── Order CRUD ───────────────────────────────────────────────────────────

export function dbUpsertOrder(o: OrderRecord): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO orders (order_id, client_order_id, virtual_position_id, symbol, side, position_side, type, qty, price, stop_price, status, reduce_only, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(order_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at
  `).run(
    o.orderId, o.clientOrderId, o.virtual_position_id, o.symbol,
    o.side, o.positionSide, o.type, o.qty, o.price, o.stopPrice,
    o.status, o.reduceOnly ? 1 : 0, o.created_at, o.updated_at
  );
}

export function dbGetOpenOrders(): OrderRecord[] {
  const rows = getDb().prepare(
    "SELECT * FROM orders WHERE status NOT IN ('CANCELED','FILLED','EXPIRED','REJECTED') ORDER BY created_at DESC"
  ).all() as any[];
  return rows.map(rowToOrder);
}

export function dbGetOrder(orderId: string): OrderRecord | null {
  const row = getDb().prepare('SELECT * FROM orders WHERE order_id=?').get(orderId) as any;
  return row ? rowToOrder(row) : null;
}

function rowToOrder(row: any): OrderRecord {
  return {
    orderId: row.order_id,
    clientOrderId: row.client_order_id,
    virtual_position_id: row.virtual_position_id,
    symbol: row.symbol,
    side: row.side,
    positionSide: row.position_side,
    type: row.type,
    qty: row.qty,
    price: row.price,
    stopPrice: row.stop_price,
    status: row.status,
    reduceOnly: row.reduce_only === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── Fill CRUD ────────────────────────────────────────────────────────────

export function dbInsertFill(f: FillRecord): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO fills (trade_id, order_id, client_order_id, virtual_position_id, symbol, side, position_side, qty, price, commission, commission_asset, realized_pnl, ts)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    f.tradeId, f.orderId, f.clientOrderId, f.virtual_position_id,
    f.symbol, f.side, f.positionSide, f.qty, f.price,
    f.commission, f.commissionAsset, f.realizedPnl, f.ts
  );
}

export function dbGetRecentFills(limit = 50): FillRecord[] {
  const rows = getDb().prepare('SELECT * FROM fills ORDER BY ts DESC LIMIT ?').all(limit) as any[];
  return rows.map(rowToFill);
}

function rowToFill(row: any): FillRecord {
  return {
    tradeId: row.trade_id,
    orderId: row.order_id,
    clientOrderId: row.client_order_id,
    virtual_position_id: row.virtual_position_id,
    symbol: row.symbol,
    side: row.side,
    positionSide: row.position_side,
    qty: row.qty,
    price: row.price,
    commission: row.commission,
    commissionAsset: row.commission_asset,
    realizedPnl: row.realized_pnl,
    ts: row.ts,
  };
}

// ─── ClientOrderId Map ────────────────────────────────────────────────────

export function dbSaveClientOrderMap(clientOrderId: string, vpId: string): void {
  getDb().prepare(
    'INSERT OR REPLACE INTO client_order_map (client_order_id, virtual_position_id, created_at) VALUES (?,?,?)'
  ).run(clientOrderId, vpId, Date.now());
}

export function dbGetVpIdByClientOrderId(clientOrderId: string): string | null {
  const row = getDb().prepare(
    'SELECT virtual_position_id FROM client_order_map WHERE client_order_id=?'
  ).get(clientOrderId) as any;
  return row?.virtual_position_id ?? null;
}
