import { describe, expect, it } from 'vitest';
import {
  isConditional,
  needsPrice,
  needsStopPrice,
  supportsTimeInForce,
} from '../../src/components/OrderPanel/index.tsx';
import { buildAmendPayload } from '../../src/components/OpenOrders/index.tsx';
import { resolveTpSlSizeInput } from '../../src/components/TpSlModal/index.tsx';
import type { OrderRecord } from '../../src/types/index.js';

describe('order panel field matrix', () => {
  it('matches v0.3 order type requirements', () => {
    expect(needsPrice('LIMIT')).toBe(true);
    expect(needsPrice('STOP')).toBe(true);
    expect(needsPrice('MARKET')).toBe(false);
    expect(needsPrice('STOP_MARKET')).toBe(false);

    expect(needsStopPrice('STOP')).toBe(true);
    expect(needsStopPrice('STOP_MARKET')).toBe(true);
    expect(needsStopPrice('MARKET')).toBe(false);
    expect(needsStopPrice('LIMIT')).toBe(false);

    expect(isConditional('STOP')).toBe(true);
    expect(isConditional('STOP_MARKET')).toBe(true);
    expect(isConditional('LIMIT')).toBe(false);

    expect(supportsTimeInForce('LIMIT')).toBe(true);
    expect(supportsTimeInForce('STOP')).toBe(true);
    expect(supportsTimeInForce('MARKET')).toBe(false);
  });
});

describe('open orders amend payload', () => {
  const baseOrder: OrderRecord = {
    orderId: '1',
    clientOrderId: 'cid',
    account_id: 'main',
    virtual_position_id: 'vp_main',
    symbol: 'BTCUSDT',
    side: 'BUY',
    positionSide: 'LONG',
    type: 'LIMIT',
    qty: '0.1',
    price: '90000',
    stopPrice: null,
    status: 'NEW',
    reduceOnly: false,
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  it('builds STOP_MARKET payload without price', () => {
    const payload = buildAmendPayload(baseOrder, {
      type: 'STOP_MARKET',
      qty: '0.2',
      price: '91000',
      stopPrice: '90500',
      triggerPriceType: 'MARK_PRICE',
    });

    expect(payload.type).toBe('STOP_MARKET');
    expect(payload.price).toBeUndefined();
    expect(payload.stopPrice).toBe('90500');
    expect(payload.triggerPriceType).toBe('MARK_PRICE');
    expect(payload.timeInForce).toBeUndefined();
  });

  it('builds LIMIT payload with price and GTC', () => {
    const payload = buildAmendPayload(baseOrder, {
      type: 'LIMIT',
      qty: '0.2',
      price: '91000',
      stopPrice: '90500',
      triggerPriceType: 'LAST_PRICE',
    });

    expect(payload.type).toBe('LIMIT');
    expect(payload.price).toBe('91000');
    expect(payload.stopPrice).toBeUndefined();
    expect(payload.timeInForce).toBe('GTC');
  });
});

describe('tp/sl partial sizing', () => {
  it('prefers qty over percent', () => {
    const resolved = resolveTpSlSizeInput('2', '0.5', 50);
    expect(resolved.qty).toBe('0.5');
    expect(resolved.percent).toBeUndefined();
  });

  it('accepts percent when qty is empty', () => {
    const resolved = resolveTpSlSizeInput('2', '', 75);
    expect(resolved.percent).toBe(75);
    expect(resolved.error).toBeUndefined();
  });

  it('rejects out-of-range qty', () => {
    const resolved = resolveTpSlSizeInput('1', '2', null);
    expect(resolved.error).toContain('exceeds');
  });
});
