import { describe, expect, it } from 'vitest';
import { decodePositionKey, positionKey } from '../../src/store/state.js';

describe('position key encoding', () => {
  it('encodes and decodes account ids with underscore', () => {
    const key = positionKey('sub_a', 'BTCUSDT', 'LONG');
    const decoded = decodePositionKey(key);
    expect(decoded).toEqual(['sub_a', 'BTCUSDT', 'LONG']);
  });

  it('encodes and decodes account ids with dash and underscore', () => {
    const key = positionKey('sub-prod_1', 'ETHUSDT', 'SHORT');
    const decoded = decodePositionKey(key);
    expect(decoded).toEqual(['sub-prod_1', 'ETHUSDT', 'SHORT']);
  });
});

