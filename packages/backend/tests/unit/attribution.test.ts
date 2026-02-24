import { describe, it, expect } from 'vitest';
import {
  encodeClientOrderId,
  decodeClientOrderId,
  extractAccountIdFromClientOrderId,
} from '../../src/engine/attribution/index.js';

describe('clientOrderId encoding', () => {
  it('encodes with correct prefix and structure', () => {
    const vpId = 'abc123xyz';
    const coid = encodeClientOrderId(vpId, 'main');
    // ACC-{account}-VP-{first6chars of vpId}-{timestamp}-{3-digit nonce}
    expect(coid).toMatch(/^ACC-main-VP-abc123-\d+-\d{3}$/);
  });

  it('decodes to short VP id (new format)', () => {
    const coid = 'ACC-main-VP-abc123-1708700123456-001';
    const shortId = decodeClientOrderId(coid);
    expect(shortId).toBe('abc123');
  });

  it('supports legacy VP format', () => {
    const coid = 'VP-abc123-1708700123456-001';
    expect(decodeClientOrderId(coid)).toBe('abc123');
    expect(extractAccountIdFromClientOrderId(coid)).toBe('main');
  });

  it('returns null for external orders', () => {
    expect(decodeClientOrderId('some-external-order')).toBeNull();
    expect(extractAccountIdFromClientOrderId('some-external-order')).toBeNull();
    expect(decodeClientOrderId('x11223344')).toBeNull();
  });
});
