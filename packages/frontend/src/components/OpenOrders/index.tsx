import { useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useStore } from '../../store/index.js';
import { api } from '../../utils/api.js';
import { fmtPrice, fmtQty, fmtTime } from '../../utils/format.js';
import { EmptyState } from '../../App.js';
import type { OrderRecord, PlaceOrderType } from '../../types/index.js';

type AmendType = Exclude<PlaceOrderType, 'MARKET'>;

interface AmendDraft {
  type: AmendType;
  qty: string;
  price: string;
  stopPrice: string;
  triggerPriceType: 'LAST_PRICE' | 'MARK_PRICE';
}

function needsPrice(type: AmendType): boolean {
  return type === 'LIMIT' || type === 'STOP';
}

function needsStopPrice(type: AmendType): boolean {
  return type === 'STOP' || type === 'STOP_MARKET';
}

function isConditional(type: AmendType): boolean {
  return type === 'STOP' || type === 'STOP_MARKET';
}

export function buildAmendPayload(order: OrderRecord, draft: AmendDraft) {
  return {
    account_id: order.account_id,
    symbol: order.symbol,
    virtual_position_id: order.virtual_position_id,
    type: draft.type,
    qty: draft.qty,
    price: needsPrice(draft.type) ? draft.price : undefined,
    stopPrice: needsStopPrice(draft.type) ? draft.stopPrice : undefined,
    triggerPriceType: isConditional(draft.type) ? draft.triggerPriceType : undefined,
    timeInForce: draft.type === 'LIMIT' || draft.type === 'STOP' ? 'GTC' : undefined,
  };
}

function toAmendType(type: string): AmendType {
  if (type === 'STOP') return 'STOP';
  if (type === 'STOP_MARKET') return 'STOP_MARKET';
  return 'LIMIT';
}

const labelStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--text-2)',
  fontWeight: 600,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  marginBottom: 5,
  display: 'block',
};

export default function OpenOrders() {
  const openOrders = useStore((s) => s.openOrders);
  const virtualPositions = useStore((s) => s.virtualPositions);
  const activeAccountId = useStore((s) => s.activeAccountId);
  const orderFilterVpId = useStore((s) => s.orderFilterVpId);
  const setOrderFilterVpId = useStore((s) => s.setOrderFilterVpId);
  const setOpenOrders = useStore((s) => s.setOpenOrders);

  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [amendOrder, setAmendOrder] = useState<OrderRecord | null>(null);
  const [amending, setAmending] = useState(false);
  const [amendError, setAmendError] = useState('');
  const [amendDraft, setAmendDraft] = useState<AmendDraft>({
    type: 'LIMIT',
    qty: '',
    price: '',
    stopPrice: '',
    triggerPriceType: 'LAST_PRICE',
  });

  const filterableVps = useMemo(
    () =>
      virtualPositions.filter(
        (vp) => activeAccountId === 'ALL' || vp.account_id === activeAccountId,
      ),
    [virtualPositions, activeAccountId],
  );

  const filtered = useMemo(() => {
    const accountFiltered = openOrders.filter(
      (o) => activeAccountId === 'ALL' || o.account_id === activeAccountId,
    );
    return orderFilterVpId
      ? accountFiltered.filter((o) => o.virtual_position_id === orderFilterVpId)
      : accountFiltered;
  }, [openOrders, activeAccountId, orderFilterVpId]);

  function vpName(vpId: string): string {
    return virtualPositions.find((v) => v.id === vpId)?.name ?? vpId.slice(0, 8);
  }

  async function refreshOrders(accountId?: string) {
    const state = await api.getState(accountId ? { account_id: accountId } : undefined);
    setOpenOrders(state.open_orders);
  }

  async function cancelOrder(orderId: string, symbol: string, accountId: string) {
    setCancelingId(orderId);
    setMessage('');
    try {
      await api.cancelOrder(orderId, symbol, accountId);
      setMessage(`Canceled order ${orderId}.`);
      await refreshOrders(accountId);
    } catch (err: any) {
      setMessage(`Cancel failed: ${err.message}`);
    } finally {
      setCancelingId(null);
    }
  }

  function openAmend(order: OrderRecord) {
    setAmendOrder(order);
    setAmendError('');
    setAmendDraft({
      type: toAmendType(order.type),
      qty: order.qty,
      price: order.price ?? '',
      stopPrice: order.stopPrice ?? '',
      triggerPriceType: 'LAST_PRICE',
    });
  }

  async function submitAmend(e: FormEvent) {
    e.preventDefault();
    if (!amendOrder) return;

    const qtyNum = parseFloat(amendDraft.qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setAmendError('qty must be a positive number.');
      return;
    }
    if (needsPrice(amendDraft.type)) {
      const priceNum = parseFloat(amendDraft.price);
      if (!Number.isFinite(priceNum) || priceNum <= 0) {
        setAmendError(`price is required for ${amendDraft.type}.`);
        return;
      }
    }
    if (needsStopPrice(amendDraft.type)) {
      const stopNum = parseFloat(amendDraft.stopPrice);
      if (!Number.isFinite(stopNum) || stopNum <= 0) {
        setAmendError(`stopPrice is required for ${amendDraft.type}.`);
        return;
      }
    }

    setAmendError('');
    setAmending(true);
    try {
      const res = await api.amendOrder(
        amendOrder.orderId,
        buildAmendPayload(amendOrder, amendDraft),
      );
      setMessage(`Amended ${res.old_order_id} -> ${res.new_order_id} (${res.status}).`);
      setAmendOrder(null);
      await refreshOrders(amendOrder.account_id);
    } catch (err: any) {
      setAmendError(err.message);
    } finally {
      setAmending(false);
    }
  }

  const isReadOnlyAll = activeAccountId === 'ALL';
  const headers = [
    'Account',
    'Symbol',
    'Side',
    'Type',
    'Price',
    'Qty',
    'VP',
    'Status',
    'Time',
    'Actions',
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-3)',
            letterSpacing: '0.07em',
            fontWeight: 700,
            marginRight: 2,
          }}
        >
          FILTER
        </span>
        <button
          className={`hl-filter-chip${!orderFilterVpId ? ' active' : ''}`}
          onClick={() => setOrderFilterVpId(null)}
        >
          ALL
        </button>
        {filterableVps.map((vp) => (
          <button
            key={vp.id}
            className={`hl-filter-chip${orderFilterVpId === vp.id ? ' active' : ''}`}
            onClick={() => setOrderFilterVpId(vp.id === orderFilterVpId ? null : vp.id)}
          >
            {vp.name}
          </button>
        ))}
        {isReadOnlyAll && (
          <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 4 }}>
            ALL view is read-only.
          </span>
        )}
      </div>

      {message && (
        <div
          style={{
            margin: '8px 12px',
            fontSize: 11,
            color: 'var(--text-2)',
            background: 'var(--bg-hover)',
            border: '1px solid var(--border-mid)',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 8px',
          }}
        >
          {message}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState label="No open orders" />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                {headers.map((h) => (
                  <th key={h} className="hl-th">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => {
                const isBuy = order.side === 'BUY';
                return (
                  <tr key={order.orderId} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td
                      className="hl-td"
                      style={{
                        color: 'var(--text-2)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                      }}
                    >
                      {order.account_id}
                    </td>
                    <td className="hl-td" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      {order.symbol}
                    </td>
                    <td className="hl-td">
                      <span
                        className={isBuy ? 'hl-side-long' : 'hl-side-short'}
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 6px',
                          letterSpacing: '0.03em',
                        }}
                      >
                        {order.side} {order.positionSide}
                        {order.reduceOnly && (
                          <span style={{ opacity: 0.6, fontWeight: 400 }}> RO</span>
                        )}
                      </span>
                    </td>
                    <td
                      className="hl-td"
                      style={{
                        fontSize: 10,
                        color: 'var(--text-2)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {order.type}
                    </td>
                    <td className="hl-td" style={{ fontFamily: 'var(--font-mono)' }}>
                      {order.price ? (
                        fmtPrice(order.price)
                      ) : (
                        <span style={{ color: 'var(--text-3)' }}>MKT</span>
                      )}
                    </td>
                    <td className="hl-td" style={{ fontFamily: 'var(--font-mono)' }}>
                      {fmtQty(order.qty)}
                    </td>
                    <td className="hl-td">
                      <span style={{ color: 'var(--amber)', fontSize: 11 }}>
                        {vpName(order.virtual_position_id)}
                      </span>
                    </td>
                    <td className="hl-td">
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--text-2)',
                          fontFamily: 'var(--font-mono)',
                          background: 'var(--bg-hover)',
                          padding: '1px 6px',
                          borderRadius: 2,
                        }}
                      >
                        {order.status}
                      </span>
                    </td>
                    <td
                      className="hl-td"
                      style={{
                        fontSize: 10,
                        color: 'var(--text-3)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {fmtTime(order.created_at)}
                    </td>
                    <td className="hl-td">
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="hl-btn hl-btn-xs hl-btn-ghost-amber"
                          onClick={() => openAmend(order)}
                          disabled={isReadOnlyAll}
                        >
                          Amend
                        </button>
                        <button
                          className="hl-btn hl-btn-xs hl-btn-ghost-red"
                          onClick={() =>
                            cancelOrder(order.orderId, order.symbol, order.account_id)
                          }
                          disabled={cancelingId === order.orderId || isReadOnlyAll}
                        >
                          {cancelingId === order.orderId ? 'Canceling...' : 'Cancel'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {amendOrder && (
        <div className="hl-overlay" onClick={() => setAmendOrder(null)}>
          <div
            className="hl-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ minWidth: 360, maxWidth: 440, color: 'var(--text-1)' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: 14,
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.01em' }}>
                  Amend Order
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--text-2)',
                    marginTop: 3,
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {amendOrder.symbol} #{amendOrder.orderId}
                </div>
              </div>
              <button
                onClick={() => setAmendOrder(null)}
                className="hl-btn hl-btn-ghost"
                style={{ padding: '2px 7px', fontSize: 13, lineHeight: 1 }}
              >
                X
              </button>
            </div>

            <form onSubmit={submitAmend} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <label style={labelStyle}>Type</label>
                <select
                  value={amendDraft.type}
                  onChange={(e) =>
                    setAmendDraft((prev) => ({
                      ...prev,
                      type: e.target.value as AmendType,
                    }))
                  }
                  className="hl-select"
                  style={{ width: '100%', fontSize: 11 }}
                >
                  <option value="LIMIT">LIMIT</option>
                  <option value="STOP">STOP</option>
                  <option value="STOP_MARKET">STOP_MARKET</option>
                </select>
              </div>

              {needsPrice(amendDraft.type) && (
                <div>
                  <label style={labelStyle}>Price</label>
                  <input
                    type="number"
                    step="0.01"
                    className="hl-input"
                    value={amendDraft.price}
                    onChange={(e) =>
                      setAmendDraft((prev) => ({ ...prev, price: e.target.value }))
                    }
                  />
                </div>
              )}

              {needsStopPrice(amendDraft.type) && (
                <div>
                  <label style={labelStyle}>Stop Price</label>
                  <input
                    type="number"
                    step="0.01"
                    className="hl-input"
                    value={amendDraft.stopPrice}
                    onChange={(e) =>
                      setAmendDraft((prev) => ({ ...prev, stopPrice: e.target.value }))
                    }
                  />
                </div>
              )}

              {isConditional(amendDraft.type) && (
                <div>
                  <label style={labelStyle}>Trigger Price Type</label>
                  <select
                    value={amendDraft.triggerPriceType}
                    onChange={(e) =>
                      setAmendDraft((prev) => ({
                        ...prev,
                        triggerPriceType: e.target.value as 'LAST_PRICE' | 'MARK_PRICE',
                      }))
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
                  className="hl-input"
                  value={amendDraft.qty}
                  onChange={(e) =>
                    setAmendDraft((prev) => ({ ...prev, qty: e.target.value }))
                  }
                />
              </div>

              {amendError && (
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--red)',
                    background: 'var(--red-dim)',
                    padding: '7px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--red-border)',
                  }}
                >
                  {amendError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                <button
                  type="submit"
                  className="hl-btn hl-btn-lg hl-btn-accent"
                  disabled={amending}
                  style={{ flex: 2 }}
                >
                  {amending ? 'Amending...' : 'Confirm Amend'}
                </button>
                <button
                  type="button"
                  className="hl-btn hl-btn-lg hl-btn-ghost"
                  onClick={() => setAmendOrder(null)}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
