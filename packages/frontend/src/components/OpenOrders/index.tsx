/**
 * OpenOrders tab — list all open orders with VP filter and cancel.
 */
import { useState } from 'react';
import { useStore } from '../../store/index.js';
import { api } from '../../utils/api.js';
import { fmtPrice, fmtQty, fmtTime } from '../../utils/format.js';

const cell: React.CSSProperties = { padding: '8px 10px', fontSize: 12, whiteSpace: 'nowrap' };

export default function OpenOrders() {
  const openOrders = useStore((s) => s.openOrders);
  const virtualPositions = useStore((s) => s.virtualPositions);
  const orderFilterVpId = useStore((s) => s.orderFilterVpId);
  const setOrderFilterVpId = useStore((s) => s.setOrderFilterVpId);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const filtered = orderFilterVpId
    ? openOrders.filter((o) => o.virtual_position_id === orderFilterVpId)
    : openOrders;

  function vpName(vpId: string): string {
    return virtualPositions.find((v) => v.id === vpId)?.name ?? vpId.slice(0, 8);
  }

  async function cancelOrder(orderId: string, symbol: string) {
    setCancelingId(orderId);
    try {
      await api.cancelOrder(orderId, symbol);
    } catch (err: any) {
      alert(`撤单失败: ${err.message}`);
    } finally {
      setCancelingId(null);
    }
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, padding: '8px 10px', borderBottom: '1px solid #2b3139' }}>
        <button
          onClick={() => setOrderFilterVpId(null)}
          style={{
            background: !orderFilterVpId ? '#2b3139' : 'transparent',
            color: '#eaecef', border: '1px solid #363c45', borderRadius: 4,
            padding: '4px 10px', cursor: 'pointer', fontSize: 12,
          }}
        >
          全部
        </button>
        {virtualPositions.map((vp) => (
          <button
            key={vp.id}
            onClick={() => setOrderFilterVpId(vp.id === orderFilterVpId ? null : vp.id)}
            style={{
              background: orderFilterVpId === vp.id ? '#2b3139' : 'transparent',
              color: '#eaecef', border: '1px solid #363c45', borderRadius: 4,
              padding: '4px 10px', cursor: 'pointer', fontSize: 12,
            }}
          >
            {vp.name}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 24, color: '#848e9c', textAlign: 'center' }}>暂无挂单</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2b3139' }}>
              {['合约', '方向', '类型', '价格', '数量', 'VP', '状态', '时间', '操作'].map((h) => (
                <th key={h} style={{ ...cell, color: '#848e9c', fontWeight: 400, textAlign: 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((order) => (
              <tr key={order.orderId} style={{ borderBottom: '1px solid #1e2329' }}>
                <td style={cell}>{order.symbol}</td>
                <td style={{ ...cell, color: order.side === 'BUY' ? '#0ecb81' : '#f6465d', fontWeight: 600 }}>
                  {order.side} {order.positionSide}
                  {order.reduceOnly && <span style={{ color: '#848e9c', fontSize: 10 }}> (RO)</span>}
                </td>
                <td style={cell}>{order.type}</td>
                <td style={cell}>{order.price ? fmtPrice(order.price) : 'MKT'}</td>
                <td style={cell}>{fmtQty(order.qty)}</td>
                <td style={cell}><span style={{ color: '#f0b90b' }}>{vpName(order.virtual_position_id)}</span></td>
                <td style={cell}><span style={{ color: '#848e9c' }}>{order.status}</span></td>
                <td style={cell}>{fmtTime(order.created_at)}</td>
                <td style={cell}>
                  <button
                    onClick={() => cancelOrder(order.orderId, order.symbol)}
                    disabled={cancelingId === order.orderId}
                    style={{
                      background: 'transparent', color: '#f6465d',
                      border: '1px solid #f6465d', borderRadius: 3,
                      padding: '2px 8px', cursor: 'pointer', fontSize: 11,
                    }}
                  >
                    {cancelingId === order.orderId ? '撤单...' : '撤单'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
