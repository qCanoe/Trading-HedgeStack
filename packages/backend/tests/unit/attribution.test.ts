import { describe, it, expect } from 'vitest';
import { encodeClientOrderId, decodeClientOrderId } from '../../src/engine/attribution/index.js';

describe('clientOrderId encoding', () => {
  it('encodes with correct prefix and structure', () => {
    const vpId = 'abc123xyz';
    const coid = encodeClientOrderId(vpId);
    // VP-{first6chars of vpId}-{timestamp}-{3-digit nonce}
    expect(coid).toMatch(/^VP-abc123-\d+-\d{3}$/);
  });

  it('decodes to short VP id', () => {
    const coid = 'VP-abc123-1708700123456-001';
    const shortId = decodeClientOrderId(coid);
    expect(shortId).toBe('abc123');
  });

  it('returns null for external orders', () => {
    expect(decodeClientOrderId('some-external-order')).toBeNull();
    expect(decodeClientOrderId('x11223344')).toBeNull();
  });
});
