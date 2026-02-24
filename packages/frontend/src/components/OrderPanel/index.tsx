/**
 * OrderPanel — place Market/Limit orders for a selected virtual position.
 */
import { useState } from 'react';
import { useStore } from '../../store/index.js';
import { api } from '../../utils/api.js';
import type { PositionSide, OrderSide } from '../../types/index.js';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];

const s = {
  panel: {
    background: '#1e2329',
    border: '1px solid #2b3139',
    borderRadius: 4,
    padding: 16,
    minWidth: 280,
  } as React.CSSProperties,
  label: { color: '#848e9c', fontSize: 11, marginBottom: 4, display: 'block' } as React.CSSProperties,
  input: {
    width: '100%',
    background: '#2b3139',
    border: '1px solid #363c45',
    borderRadius: 4,
    color: '#eaecef',
    padding: '6px 8px',
    fontSize: 13,
    outline: 'none',
    marginBottom: 8,
  } as React.CSSProperties,
  select: {
    width: '100%',
    background: '#2b3139',
    border: '1px solid #363c45',
    borderRadius: 4,
    color: '#eaecef',
    padding: '6px 8px',
    fontSize: 13,
    marginBottom: 8,
  } as React.CSSProperties,
  tabBar: { display: 'flex', gap: 2, marginBottom: 12 } as React.CSSProperties,
  tab: (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '6px 0',
    textAlign: 'center',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
    background: active ? '#2b3139' : 'transparent',
    color: active ? '#eaecef' : '#848e9c',
    border: 'none',
  }),
  sideBtn: (side: OrderSide, active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '8px 0',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    border: 'none',
    background:
      active
        ? side === 'BUY'
          ? '#0ecb81'
          : '#f6465d'
        : side === 'BUY'
        ? '#1a2e24'
        : '#2e1a1e',
    color: active ? '#fff' : side === 'BUY' ? '#0ecb81' : '#f6465d',
  }),
  submitBtn: (side: OrderSide): React.CSSProperties => ({
    width: '100%',
    padding: '10px 0',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
    border: 'none',
    background: side === 'BUY' ? '#0ecb81' : '#f6465d',
    color: '#fff',
    marginTop: 4,
  }),
  error: { color: '#f6465d', fontSize: 12, marginTop: 4 } as React.CSSProperties,
  success: { color: '#0ecb81', fontSize: 12, marginTop: 4 } as React.CSSProperties,
};

export default function OrderPanel() {
  const virtualPositions = useStore((s) => s.virtualPositions);
  const selectedVpId = useStore((s) => s.selectedVpId);
  const setSelectedVpId = useStore((s) => s.setSelectedVpId);
  const activeAccountId = useStore((s) => s.activeAccountId);

  const [symbol, setSymbol] = useState('BTCUSDT');
  const [positionSide, setPositionSide] = useState<PositionSide>('LONG');
  const [side, setSide] = useState<OrderSide>('BUY');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('LIMIT');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const filteredVPs = virtualPositions.filter(
    (vp) =>
      vp.symbol === symbol
      && vp.positionSide === positionSide
      && (activeAccountId === 'ALL' || vp.account_id === activeAccountId)
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (activeAccountId === 'ALL') {
      setError('All 视图只读，请先选择单一账户');
      return;
    }
    if (!selectedVpId) { setError('Select a virtual position'); return; }
    const selectedVp = virtualPositions.find((vp) => vp.id === selectedVpId);
    if (!selectedVp) { setError('Selected virtual position not found'); return; }
    if (!qty || parseFloat(qty) <= 0) { setError('Enter valid quantity'); return; }
    if (orderType === 'LIMIT' && (!price || parseFloat(price) <= 0)) {
      setError('Enter valid price'); return;
    }
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const res = await api.placeOrder({
        virtual_position_id: selectedVpId,
        account_id: selectedVp.account_id,
        symbol,
        positionSide,
        side,
        type: orderType,
        qty,
        price: orderType === 'LIMIT' ? price : undefined,
        timeInForce: orderType === 'LIMIT' ? 'GTC' : undefined,
      });
      setSuccess(`Order placed: ${res.orderId} (${res.status})`);
      setQty('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.panel}>
      <div style={{ fontWeight: 600, marginBottom: 12, color: '#eaecef' }}>下单</div>
      {activeAccountId === 'ALL' && (
        <div style={{ color: '#848e9c', fontSize: 11, marginBottom: 8 }}>
          All 视图下单已禁用
        </div>
      )}

      {/* Symbol */}
      <label style={s.label}>合约</label>
      <select style={s.select} value={symbol} onChange={(e) => setSymbol(e.target.value)}>
        {SYMBOLS.map((sym) => (
          <option key={sym} value={sym}>{sym}</option>
        ))}
      </select>

      {/* Order Type tabs */}
      <div style={s.tabBar}>
        {(['LIMIT', 'MARKET'] as const).map((t) => (
          <button key={t} style={s.tab(orderType === t)} onClick={() => setOrderType(t)}>
            {t}
          </button>
        ))}
      </div>

      {/* Position Side */}
      <label style={s.label}>方向</label>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {(['LONG', 'SHORT'] as PositionSide[]).map((ps) => (
          <button
            key={ps}
            style={{
              ...s.tab(positionSide === ps),
              color: ps === 'LONG' ? '#0ecb81' : '#f6465d',
              background: positionSide === ps ? '#2b3139' : 'transparent',
              border: 'none',
              cursor: 'pointer',
              flex: 1,
              padding: '6px 0',
              borderRadius: 4,
            }}
            onClick={() => { setPositionSide(ps); setSide(ps === 'LONG' ? 'BUY' : 'SELL'); }}
          >
            {ps}
          </button>
        ))}
      </div>

      {/* Side BUY/SELL */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <button style={s.sideBtn('BUY', side === 'BUY')} onClick={() => setSide('BUY')}>BUY / 开多</button>
        <button style={s.sideBtn('SELL', side === 'SELL')} onClick={() => setSide('SELL')}>SELL / 开空</button>
      </div>

      {/* Virtual Position selector */}
      <label style={s.label}>虚拟仓位</label>
      <select
        style={s.select}
        value={selectedVpId ?? ''}
        onChange={(e) => setSelectedVpId(e.target.value || null)}
      >
        <option value="">— 选择虚拟仓位 —</option>
        {filteredVPs.map((vp) => (
          <option key={vp.id} value={vp.id}>{vp.name}</option>
        ))}
      </select>

      <form onSubmit={handleSubmit}>
        {/* Price (Limit only) */}
        {orderType === 'LIMIT' && (
          <>
            <label style={s.label}>价格 (USDT)</label>
            <input
              style={s.input}
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
            />
          </>
        )}

        {/* Quantity */}
        <label style={s.label}>数量</label>
        <input
          style={s.input}
          type="number"
          step="0.001"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="0.000"
        />

        <button
          type="submit"
          style={s.submitBtn(side)}
          disabled={loading || activeAccountId === 'ALL'}
        >
          {loading ? '下单中...' : side === 'BUY' ? '买入 / Long' : '卖出 / Short'}
        </button>
      </form>

      {error && <div style={s.error}>{error}</div>}
      {success && <div style={s.success}>{success}</div>}
    </div>
  );
}
