import { describe, it, expect } from 'vitest';
import { applyFillToVP, calcUnrealizedPnl } from '../../src/engine/attribution/wac.js';
import type { VirtualPosition, FillRecord } from '../../src/store/types.js';

function makeVP(overrides: Partial<VirtualPosition> = {}): VirtualPosition {
  return {
    id: 'vp_test01',
    account_id: 'main',
    name: 'Test',
    symbol: 'BTCUSDT',
    positionSide: 'LONG',
    net_qty: '0',
    avg_entry: '0',
    realized_pnl: '0',
    tpsl: null,
    created_at: Date.now(),
    ...overrides,
  };
}

function makeFill(overrides: Partial<FillRecord> = {}): FillRecord {
  return {
    tradeId: '1',
    orderId: '100',
    clientOrderId: 'VP-abc123-123-001',
    virtual_position_id: 'vp_test01',
    symbol: 'BTCUSDT',
    side: 'BUY',
    positionSide: 'LONG',
    qty: '1',
    price: '90000',
    commission: '0.1',
    commissionAsset: 'USDT',
    realizedPnl: '0',
    ts: Date.now(),
    ...overrides,
  };
}

describe('WAC engine — LONG position', () => {
  it('opens new position from zero', () => {
    const vp = makeVP();
    const fill = makeFill({ qty: '1', price: '90000' });
    const updated = applyFillToVP(vp, fill);
    expect(updated.net_qty).toBe('1');
    expect(updated.avg_entry).toBe('90000');
    expect(updated.realized_pnl).toBe('0');
  });

  it('adds to position — WAC update', () => {
    const vp = makeVP({ net_qty: '1', avg_entry: '90000' });
    const fill = makeFill({ qty: '1', price: '92000' });
    const updated = applyFillToVP(vp, fill);
    expect(updated.net_qty).toBe('2');
    // WAC = (1*90000 + 1*92000) / 2 = 91000
    expect(parseFloat(updated.avg_entry)).toBeCloseTo(91000, 2);
    expect(updated.realized_pnl).toBe('0');
  });

  it('reduces position — realized PnL', () => {
    const vp = makeVP({ net_qty: '2', avg_entry: '90000' });
    const fill = makeFill({ qty: '1', price: '95000', side: 'SELL' });
    const updated = applyFillToVP(vp, fill);
    expect(updated.net_qty).toBe('1');
    expect(parseFloat(updated.avg_entry)).toBeCloseTo(90000, 2); // unchanged
    // realized = 1 * (95000 - 90000) * 1 = 5000
    expect(parseFloat(updated.realized_pnl)).toBeCloseTo(5000, 2);
  });

  it('closes entire position', () => {
    const vp = makeVP({ net_qty: '1', avg_entry: '90000' });
    const fill = makeFill({ qty: '1', price: '95000', side: 'SELL' });
    const updated = applyFillToVP(vp, fill);
    expect(updated.net_qty).toBe('0');
    expect(parseFloat(updated.realized_pnl)).toBeCloseTo(5000, 2);
  });
});

describe('WAC engine — SHORT position', () => {
  it('opens short position', () => {
    const vp = makeVP({ positionSide: 'SHORT' });
    const fill = makeFill({ side: 'SELL', positionSide: 'SHORT', qty: '1', price: '90000' });
    const updated = applyFillToVP(vp, fill);
    expect(updated.net_qty).toBe('1');
    expect(updated.avg_entry).toBe('90000');
  });

  it('short close — profit when price drops', () => {
    const vp = makeVP({ positionSide: 'SHORT', net_qty: '1', avg_entry: '90000' });
    const fill = makeFill({ side: 'BUY', positionSide: 'SHORT', qty: '1', price: '85000' });
    const updated = applyFillToVP(vp, fill);
    expect(updated.net_qty).toBe('0');
    // realized = 1 * (85000 - 90000) * (-1) = 5000
    expect(parseFloat(updated.realized_pnl)).toBeCloseTo(5000, 2);
  });
});

describe('calcUnrealizedPnl', () => {
  it('calculates unrealized PnL for long', () => {
    const vp = makeVP({ net_qty: '1', avg_entry: '90000' });
    expect(calcUnrealizedPnl(vp, 95000)).toBeCloseTo(5000, 2);
  });

  it('calculates unrealized PnL for short', () => {
    const vp = makeVP({ positionSide: 'SHORT', net_qty: '1', avg_entry: '90000' });
    expect(calcUnrealizedPnl(vp, 85000)).toBeCloseTo(5000, 2);
  });
});
