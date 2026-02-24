import { useState, type CSSProperties, type FormEvent } from 'react';
import { useStore } from '../../store/index.js';
import { api } from '../../utils/api.js';
import type { OrderSide, PlaceOrderType, PositionSide } from '../../types/index.js';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
const ORDER_TYPES: PlaceOrderType[] = ['LIMIT', 'MARKET', 'STOP', 'STOP_MARKET'];

const labelStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--text-2)',
  fontWeight: 600,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  marginBottom: 5,
  display: 'block',
};

export function needsPrice(type: PlaceOrderType): boolean {
  return type === 'LIMIT' || type === 'STOP';
}

export function needsStopPrice(type: PlaceOrderType): boolean {
  return type === 'STOP' || type === 'STOP_MARKET';
}

export function supportsTimeInForce(type: PlaceOrderType): boolean {
  return type === 'LIMIT' || type === 'STOP';
}

export function isConditional(type: PlaceOrderType): boolean {
  return type === 'STOP' || type === 'STOP_MARKET';
}

export default function OrderPanel() {
  const virtualPositions = useStore((s) => s.virtualPositions);
  const selectedVpId = useStore((s) => s.selectedVpId);
  const setSelectedVpId = useStore((s) => s.setSelectedVpId);
  const activeAccountId = useStore((s) => s.activeAccountId);

  const [symbol, setSymbol] = useState('BTCUSDT');
  const [positionSide, setPositionSide] = useState<PositionSide>('LONG');
  const [side, setSide] = useState<OrderSide>('BUY');
  const [orderType, setOrderType] = useState<PlaceOrderType>('LIMIT');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [triggerPriceType, setTriggerPriceType] = useState<'LAST_PRICE' | 'MARK_PRICE'>(
    'LAST_PRICE',
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const isReadOnly = activeAccountId === 'ALL';

  const filteredVPs = virtualPositions.filter(
    (vp) =>
      vp.symbol === symbol &&
      vp.positionSide === positionSide &&
      (activeAccountId === 'ALL' || vp.account_id === activeAccountId),
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isReadOnly) {
      setError('All view is read-only. Select a single account.');
      return;
    }
    if (!selectedVpId) {
      setError('Select a virtual position first.');
      return;
    }
    const selectedVp = virtualPositions.find((vp) => vp.id === selectedVpId);
    if (!selectedVp) {
      setError('Selected virtual position no longer exists.');
      return;
    }

    const qtyNum = parseFloat(qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError('qty must be a positive number.');
      return;
    }

    if (needsPrice(orderType)) {
      const priceNum = parseFloat(price);
      if (!Number.isFinite(priceNum) || priceNum <= 0) {
        setError(`price is required for ${orderType}.`);
        return;
      }
    }

    if (needsStopPrice(orderType)) {
      const stopNum = parseFloat(stopPrice);
      if (!Number.isFinite(stopNum) || stopNum <= 0) {
        setError(`stopPrice is required for ${orderType}.`);
        return;
      }
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
        price: needsPrice(orderType) ? price : undefined,
        stopPrice: needsStopPrice(orderType) ? stopPrice : undefined,
        triggerPriceType: isConditional(orderType) ? triggerPriceType : undefined,
        timeInForce: supportsTimeInForce(orderType) ? 'GTC' : undefined,
      });
      setSuccess(`Placed ${orderType} order ${res.orderId.slice(-8)} (${res.status})`);
      setQty('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const isBuy = side === 'BUY';

  return (
    <div style={{ padding: '14px 12px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--text-3)',
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
        }}
      >
        Place Order
      </div>

      {isReadOnly && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--text-3)',
            background: 'var(--bg-hover)',
            padding: '5px 8px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-mid)',
          }}
        >
          All view order placement is disabled.
        </div>
      )}

      <div className="hl-sym-tabs">
        {SYMBOLS.map((sym) => (
          <button
            key={sym}
            className={`hl-sym-btn${symbol === sym ? ' active' : ''}`}
            onClick={() => setSymbol(sym)}
          >
            {sym.replace('USDT', '')}
          </button>
        ))}
      </div>

      <div className="hl-seg">
        {ORDER_TYPES.map((type) => (
          <button
            key={type}
            className={`hl-seg-btn${orderType === type ? ' active' : ''}`}
            onClick={() => setOrderType(type)}
          >
            {type}
          </button>
        ))}
      </div>

      <div className="hl-seg">
        {(['LONG', 'SHORT'] as PositionSide[]).map((ps) => (
          <button
            key={ps}
            className={`hl-seg-btn${positionSide === ps ? ` active ${ps.toLowerCase()}` : ''}`}
            onClick={() => {
              setPositionSide(ps);
              setSide(ps === 'LONG' ? 'BUY' : 'SELL');
            }}
          >
            {ps}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 4 }}>
        {(['BUY', 'SELL'] as OrderSide[]).map((s) => (
          <button
            key={s}
            className={`hl-action-btn ${s.toLowerCase()}${side === s ? ' active' : ''}`}
            onClick={() => setSide(s)}
          >
            {s === 'BUY' ? 'BUY / LONG' : 'SELL / SHORT'}
          </button>
        ))}
      </div>

      <div>
        <label style={labelStyle}>Virtual Position</label>
        <select
          value={selectedVpId ?? ''}
          onChange={(e) => setSelectedVpId(e.target.value || null)}
          className="hl-select"
          style={{ width: '100%', fontSize: 11 }}
        >
          <option value="">Select virtual position</option>
          {filteredVPs.map((vp) => (
            <option key={vp.id} value={vp.id}>
              {vp.name}
            </option>
          ))}
        </select>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {needsPrice(orderType) && (
          <div>
            <label style={labelStyle}>Price (USDT)</label>
            <input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className="hl-input"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </div>
        )}

        {needsStopPrice(orderType) && (
          <div>
            <label style={labelStyle}>Stop Price (USDT)</label>
            <input
              type="number"
              step="0.01"
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
              placeholder="0.00"
              className="hl-input"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </div>
        )}

        {isConditional(orderType) && (
          <div>
            <label style={labelStyle}>Trigger Price Type</label>
            <select
              value={triggerPriceType}
              onChange={(e) =>
                setTriggerPriceType(e.target.value as 'LAST_PRICE' | 'MARK_PRICE')
              }
              className="hl-select"
              style={{ width: '100%', fontSize: 11 }}
            >
              <option value="LAST_PRICE">LAST_PRICE</option>
              <option value="MARK_PRICE">MARK_PRICE</option>
            </select>
          </div>
        )}

        <div>
          <label style={labelStyle}>Quantity</label>
          <input
            type="number"
            step="0.001"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="0.000"
            className="hl-input"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
          />
        </div>

        <button
          type="submit"
          disabled={loading || isReadOnly}
          className={`hl-submit ${isBuy ? 'buy' : 'sell'}`}
          style={{ marginTop: 2 }}
        >
          {loading ? 'Submitting...' : isBuy ? 'BUY / LONG' : 'SELL / SHORT'}
        </button>
      </form>

      {error && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--red)',
            background: 'var(--red-dim)',
            padding: '6px 9px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--red-border)',
            lineHeight: 1.4,
          }}
        >
          {error}
        </div>
      )}

      {success && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--green)',
            background: 'var(--green-dim)',
            padding: '6px 9px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--green-border)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {success}
        </div>
      )}
    </div>
  );
}
