/**
 * TpSlModal — set/update TP/SL for a virtual position.
 */
import { useState } from 'react';
import { api } from '../../utils/api.js';
import type { VirtualPosition } from '../../types/index.js';

interface Props {
  vp: VirtualPosition;
  onClose: () => void;
  onUpdated: (vp: VirtualPosition) => void;
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const modal: React.CSSProperties = {
  background: '#1e2329', border: '1px solid #2b3139', borderRadius: 8,
  padding: 24, minWidth: 360, color: '#eaecef',
};
const inputStyle: React.CSSProperties = {
  width: '100%', background: '#2b3139', border: '1px solid #363c45',
  borderRadius: 4, color: '#eaecef', padding: '6px 8px', fontSize: 13,
  outline: 'none', marginBottom: 8,
};
const selectStyle: React.CSSProperties = { ...inputStyle };
const labelStyle: React.CSSProperties = { color: '#848e9c', fontSize: 11, marginBottom: 4, display: 'block' };
const btnRow: React.CSSProperties = { display: 'flex', gap: 8, marginTop: 16 };

export default function TpSlModal({ vp, onClose, onUpdated }: Props) {
  const [tpPrice, setTpPrice] = useState(vp.tpsl?.tp_price ?? '');
  const [tpTrigger, setTpTrigger] = useState(vp.tpsl?.tp_trigger_type ?? 'LAST_PRICE');
  const [slPrice, setSlPrice] = useState(vp.tpsl?.sl_price ?? '');
  const [slTrigger, setSlTrigger] = useState(vp.tpsl?.sl_trigger_type ?? 'MARK_PRICE');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!tpPrice && !slPrice) { setError('At least one of TP or SL must be set'); return; }
    setError('');
    setLoading(true);
    try {
      const updated = await api.setTpSl(vp.id, {
        tp_price: tpPrice || null,
        tp_trigger_type: tpTrigger,
        sl_price: slPrice || null,
        sl_trigger_type: slTrigger,
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

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 600, marginBottom: 16 }}>
          设置 TP/SL — {vp.name} ({vp.symbol} {vp.positionSide})
        </div>

        {/* TP */}
        <label style={labelStyle}>止盈价格 (TP)</label>
        <input
          style={inputStyle}
          type="number"
          step="0.01"
          value={tpPrice as string}
          onChange={(e) => setTpPrice(e.target.value)}
          placeholder="留空则不设置"
        />
        <label style={labelStyle}>TP 触发方式</label>
        <select style={selectStyle} value={tpTrigger} onChange={(e) => setTpTrigger(e.target.value as any)}>
          <option value="LAST_PRICE">LAST PRICE（最新价）</option>
          <option value="MARK_PRICE">MARK PRICE（标记价）</option>
        </select>

        {/* SL */}
        <label style={labelStyle}>止损价格 (SL)</label>
        <input
          style={inputStyle}
          type="number"
          step="0.01"
          value={slPrice as string}
          onChange={(e) => setSlPrice(e.target.value)}
          placeholder="留空则不设置"
        />
        <label style={labelStyle}>SL 触发方式</label>
        <select style={selectStyle} value={slTrigger} onChange={(e) => setSlTrigger(e.target.value as any)}>
          <option value="MARK_PRICE">MARK PRICE（标记价）</option>
          <option value="LAST_PRICE">LAST PRICE（最新价）</option>
        </select>

        {error && <div style={{ color: '#f6465d', fontSize: 12 }}>{error}</div>}

        <div style={btnRow}>
          <button
            onClick={handleSave}
            disabled={loading}
            style={{ flex: 2, padding: '8px 0', background: '#f0b90b', color: '#1e2329', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
          >
            {loading ? '设置中...' : '确认设置'}
          </button>
          {vp.tpsl && (
            <button
              onClick={handleClear}
              disabled={loading}
              style={{ flex: 1, padding: '8px 0', background: '#2b3139', color: '#f6465d', border: '1px solid #f6465d', borderRadius: 4, cursor: 'pointer' }}
            >
              清除 TP/SL
            </button>
          )}
          <button
            onClick={onClose}
            style={{ flex: 1, padding: '8px 0', background: '#2b3139', color: '#848e9c', border: '1px solid #363c45', borderRadius: 4, cursor: 'pointer' }}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
