import { useState, type CSSProperties } from 'react';
import { api } from '../../utils/api.js';
import type { VirtualPosition } from '../../types/index.js';

interface Props {
  vp: VirtualPosition;
  onClose: () => void;
  onUpdated: (vp: VirtualPosition) => void;
}

const QUICK_PERCENTS = [25, 50, 75, 100] as const;

const labelStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--text-2)',
  fontWeight: 600,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  marginBottom: 5,
  display: 'block',
};

export function resolveTpSlSizeInput(
  netQtyRaw: string,
  qtyInput: string,
  percentInput: number | null,
): { qty?: string; percent?: number; error?: string } {
  const netQty = parseFloat(netQtyRaw);
  if (!Number.isFinite(netQty) || netQty <= 0) {
    return { error: 'Position size is empty.' };
  }

  const trimmedQty = qtyInput.trim();
  if (trimmedQty) {
    const qty = parseFloat(trimmedQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      return { error: 'qty must be a positive number.' };
    }
    if (qty > netQty) {
      return { error: 'qty exceeds current virtual position size.' };
    }
    return { qty: trimmedQty };
  }

  if (percentInput !== null) {
    if (!Number.isFinite(percentInput) || percentInput <= 0 || percentInput > 100) {
      return { error: 'percent must be within (0, 100].' };
    }
    return { percent: percentInput };
  }

  return {};
}

export default function TpSlModal({ vp, onClose, onUpdated }: Props) {
  const [tpPrice, setTpPrice] = useState(vp.tpsl?.tp_price ?? '');
  const [tpTrigger, setTpTrigger] = useState(vp.tpsl?.tp_trigger_type ?? 'LAST_PRICE');
  const [slPrice, setSlPrice] = useState(vp.tpsl?.sl_price ?? '');
  const [slTrigger, setSlTrigger] = useState(vp.tpsl?.sl_trigger_type ?? 'MARK_PRICE');
  const [selectedPercent, setSelectedPercent] = useState<number | null>(null);
  const [customQty, setCustomQty] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!tpPrice && !slPrice) {
      setError('Set at least one of TP or SL.');
      return;
    }

    const sizeInput = resolveTpSlSizeInput(vp.net_qty, customQty, selectedPercent);
    if (sizeInput.error) {
      setError(sizeInput.error);
      return;
    }

    setError('');
    setLoading(true);
    try {
      const updated = await api.setTpSl(vp.id, {
        tp_price: tpPrice || null,
        tp_trigger_type: tpTrigger,
        sl_price: slPrice || null,
        sl_trigger_type: slTrigger,
        ...sizeInput,
      });
      onUpdated(updated);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleClear() {
    setLoading(true);
    try {
      const updated = await api.clearTpSl(vp.id);
      onUpdated(updated);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const isLong = vp.positionSide === 'LONG';

  return (
    <div className="hl-overlay" onClick={onClose}>
      <div
        className="hl-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ minWidth: 360, maxWidth: 440, color: 'var(--text-1)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.01em' }}>TP / SL</div>
            <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
              {vp.name} / {vp.symbol} /{' '}
              <span
                className={isLong ? 'hl-side-long' : 'hl-side-short'}
                style={{ padding: '1px 5px', fontSize: 9, fontWeight: 700 }}
              >
                {vp.positionSide}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="hl-btn hl-btn-ghost"
            style={{ padding: '2px 7px', fontSize: 13, lineHeight: 1 }}
          >
            X
          </button>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', marginBottom: 14 }} />

        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', letterSpacing: '0.05em' }}>TAKE PROFIT</span>
          </div>
          <label style={labelStyle}>Price (USDT)</label>
          <input
            type="number"
            step="0.01"
            value={tpPrice as string}
            onChange={(e) => setTpPrice(e.target.value)}
            placeholder="Leave empty to skip TP"
            className="hl-input"
            style={{ fontFamily: 'var(--font-mono)', marginBottom: 8 }}
          />
          <label style={labelStyle}>Trigger Price Type</label>
          <select
            value={tpTrigger}
            onChange={(e) => setTpTrigger(e.target.value as any)}
            className="hl-select"
            style={{ width: '100%', fontSize: 11 }}
          >
            <option value="LAST_PRICE">LAST_PRICE</option>
            <option value="MARK_PRICE">MARK_PRICE</option>
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--red)', display: 'inline-block' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)', letterSpacing: '0.05em' }}>STOP LOSS</span>
          </div>
          <label style={labelStyle}>Price (USDT)</label>
          <input
            type="number"
            step="0.01"
            value={slPrice as string}
            onChange={(e) => setSlPrice(e.target.value)}
            placeholder="Leave empty to skip SL"
            className="hl-input"
            style={{ fontFamily: 'var(--font-mono)', marginBottom: 8 }}
          />
          <label style={labelStyle}>Trigger Price Type</label>
          <select
            value={slTrigger}
            onChange={(e) => setSlTrigger(e.target.value as any)}
            className="hl-select"
            style={{ width: '100%', fontSize: 11 }}
          >
            <option value="MARK_PRICE">MARK_PRICE</option>
            <option value="LAST_PRICE">LAST_PRICE</option>
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Partial Size</label>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {QUICK_PERCENTS.map((pct) => (
              <button
                key={pct}
                type="button"
                className={`hl-close-chip${selectedPercent === pct ? ' active' : ''}`}
                onClick={() => {
                  setSelectedPercent(pct);
                  setCustomQty('');
                }}
                style={{ minWidth: 48 }}
              >
                {pct}%
              </button>
            ))}
          </div>
          <input
            type="number"
            step="0.001"
            value={customQty}
            onChange={(e) => {
              setCustomQty(e.target.value);
              if (e.target.value.trim()) setSelectedPercent(null);
            }}
            placeholder="Custom qty (optional)"
            className="hl-input"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
          <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-3)' }}>
            Empty qty and percent means full position size.
          </div>
        </div>

        {error && (
          <div style={{
            marginBottom: 14,
            fontSize: 11,
            color: 'var(--red)',
            background: 'var(--red-dim)',
            padding: '7px 10px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--red-border)',
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="hl-btn hl-btn-lg hl-btn-accent"
            onClick={handleSave}
            disabled={loading}
            style={{ flex: 2 }}
          >
            {loading ? 'Saving...' : 'Confirm'}
          </button>
          {vp.tpsl && (
            <button
              className="hl-btn hl-btn-lg hl-btn-ghost-red"
              onClick={handleClear}
              disabled={loading}
              style={{ flex: 1, fontSize: 11 }}
            >
              Clear
            </button>
          )}
          <button
            className="hl-btn hl-btn-lg hl-btn-ghost"
            onClick={onClose}
            style={{ flex: 1, fontSize: 11 }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
