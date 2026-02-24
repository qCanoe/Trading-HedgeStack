import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from '../config/env.js';
import type {
  VirtualPosition,
  OrderRecord,
  FillRecord,
  ClientOrderMapping,
} from './types.js';

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

function hasColumn(dbConn: Database.Database, table: string, column: string): boolean {
  const rows = dbConn.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function ensureAccountColumn(dbConn: Database.Database, table: string): void {
  if (!hasColumn(dbConn, table, 'account_id')) {
    dbConn.exec(`ALTER TABLE ${table} ADD COLUMN account_id TEXT NOT NULL DEFAULT 'main';`);
  }
  dbConn.exec(`UPDATE ${table} SET account_id='main' WHERE account_id IS NULL OR account_id='';`);
}

function initSchema(dbConn: Database.Database): void {
  dbConn.exec(`
    CREATE TABLE IF NOT EXISTS virtual_positions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL DEFAULT 'main',
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
      account_id TEXT NOT NULL DEFAULT 'main',
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

    CREATE TABLE IF NOT EXISTS fills (
      trade_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      client_order_id TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT 'main',
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

    CREATE TABLE IF NOT EXISTS client_order_map (
      client_order_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL DEFAULT 'main',
      virtual_position_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  ensureAccountColumn(dbConn, 'virtual_positions');
  ensureAccountColumn(dbConn, 'orders');
  ensureAccountColumn(dbConn, 'fills');
  ensureAccountColumn(dbConn, 'client_order_map');

  dbConn.exec(`
    CREATE INDEX IF NOT EXISTS idx_vp_account_symbol_side ON virtual_positions(account_id, symbol, position_side);
    CREATE INDEX IF NOT EXISTS idx_orders_vp ON orders(virtual_position_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_account_status ON orders(account_id, status);
    CREATE INDEX IF NOT EXISTS idx_fills_vp ON fills(virtual_position_id);
    CREATE INDEX IF NOT EXISTS idx_fills_symbol ON fills(symbol);
    CREATE INDEX IF NOT EXISTS idx_fills_account_symbol ON fills(account_id, symbol);
    CREATE INDEX IF NOT EXISTS idx_client_order_map_account ON client_order_map(account_id);
  `);

  try {
    dbConn.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_vp_account_symbol_side_name
      ON virtual_positions(account_id, symbol, position_side, name);
    `);
  } catch {
    dbConn.exec(`
      CREATE INDEX IF NOT EXISTS idx_vp_account_symbol_side_name
      ON virtual_positions(account_id, symbol, position_side, name);
    `);
  }
}

// ─── Virtual Position CRUD ────────────────────────────────────────────────

export function dbInsertVP(vp: VirtualPosition): void {
  const dbConn = getDb();
  dbConn.prepare(`
    INSERT INTO virtual_positions (id, account_id, name, symbol, position_side, net_qty, avg_entry, realized_pnl, tpsl, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    vp.id,
    vp.account_id,
    vp.name,
    vp.symbol,
    vp.positionSide,
    vp.net_qty,
    vp.avg_entry,
    vp.realized_pnl,
    vp.tpsl ? JSON.stringify(vp.tpsl) : null,
    vp.created_at
  );
}

export function dbUpdateVP(vp: VirtualPosition): void {
  const dbConn = getDb();
  dbConn.prepare(`
    UPDATE virtual_positions
    SET account_id=?, name=?, net_qty=?, avg_entry=?, realized_pnl=?, tpsl=?
    WHERE id=?
  `).run(
    vp.account_id,
    vp.name,
    vp.net_qty,
    vp.avg_entry,
    vp.realized_pnl,
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

function rowToVP(row: any): VirtualPosition {
  return {
    id: row.id,
    account_id: row.account_id ?? 'main',
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
  const dbConn = getDb();
  dbConn.prepare(`
    INSERT INTO orders (order_id, client_order_id, account_id, virtual_position_id, symbol, side, position_side, type, qty, price, stop_price, status, reduce_only, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(order_id) DO UPDATE SET
      account_id=excluded.account_id,
      virtual_position_id=excluded.virtual_position_id,
      status=excluded.status,
      updated_at=excluded.updated_at
  `).run(
    o.orderId,
    o.clientOrderId,
    o.account_id,
    o.virtual_position_id,
    o.symbol,
    o.side,
    o.positionSide,
    o.type,
    o.qty,
    o.price,
    o.stopPrice,
    o.status,
    o.reduceOnly ? 1 : 0,
    o.created_at,
    o.updated_at
  );
}

export function dbGetOpenOrders(): OrderRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM orders WHERE status NOT IN ('CANCELED','FILLED','EXPIRED','REJECTED') ORDER BY created_at DESC")
    .all() as any[];
  return rows.map(rowToOrder);
}

function rowToOrder(row: any): OrderRecord {
  return {
    orderId: row.order_id,
    clientOrderId: row.client_order_id,
    account_id: row.account_id ?? 'main',
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
  const dbConn = getDb();
  dbConn.prepare(`
    INSERT OR IGNORE INTO fills (trade_id, order_id, client_order_id, account_id, virtual_position_id, symbol, side, position_side, qty, price, commission, commission_asset, realized_pnl, ts)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    f.tradeId,
    f.orderId,
    f.clientOrderId,
    f.account_id,
    f.virtual_position_id,
    f.symbol,
    f.side,
    f.positionSide,
    f.qty,
    f.price,
    f.commission,
    f.commissionAsset,
    f.realizedPnl,
    f.ts
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
    account_id: row.account_id ?? 'main',
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

export function dbSaveClientOrderMap(clientOrderId: string, mapping: ClientOrderMapping): void {
  getDb()
    .prepare(
      'INSERT OR REPLACE INTO client_order_map (client_order_id, account_id, virtual_position_id, created_at) VALUES (?,?,?,?)'
    )
    .run(clientOrderId, mapping.account_id, mapping.virtual_position_id, Date.now());
}

export function dbGetOrderMappingByClientOrderId(clientOrderId: string): ClientOrderMapping | null {
  const row = getDb()
    .prepare('SELECT account_id, virtual_position_id FROM client_order_map WHERE client_order_id=?')
    .get(clientOrderId) as any;
  if (!row) return null;
  return {
    account_id: row.account_id ?? 'main',
    virtual_position_id: row.virtual_position_id,
  };
}

