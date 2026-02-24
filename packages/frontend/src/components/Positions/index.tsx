/**
 * Positions tab — shows all virtual positions with PnL, TP/SL, and close controls.
 */
import { useState } from 'react';
import { useStore } from '../../store/index.js';
import { api } from '../../utils/api.js';
import { fmtPrice, fmtQty, fmtPnl, pnlColor, calcUPnl } from '../../utils/format.js';
import TpSlModal from '../TpSlModal/index.js';
import type { VirtualPosition } from '../../types/index.js';

const CLOSE_PERCENTS = [25, 50, 75, 100];

const cell: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 12,
  whiteSpace: 'nowrap',
};

export default function Positions() {
  const virtualPositions = useStore((s) => s.virtualPositions);
  const marketTicks = useStore((s) => s.marketTicks);
  const consistencyStatuses = useStore((s) => s.consistencyStatuses);
  const upsertVirtualPosition = useStore((s) => s.upsertVirtualPosition);
  const activeAccountId = useStore((s) => s.activeAccountId);

  const [tpslVp, setTpslVp] = useState<VirtualPosition | null>(null);
  const [closingVpId, setClosingVpId] = useState<string | null>(null);
  const [customCloseQty, setCustomCloseQty] = useState<Record<string, string>>({});

  const visiblePositions = virtualPositions.filter(
    (vp) => activeAccountId === 'ALL' || vp.account_id === activeAccountId
  );
  const openPositions = visiblePositions.filter((vp) => parseFloat(vp.net_qty) > 0);
  const emptyPositions = visiblePositions.filter((vp) => parseFloat(vp.net_qty) === 0);
  const isReadOnlyAll = activeAccountId === 'ALL';

  async function closePosition(vpId: string, percent?: number, qty?: string) {
    const vp = virtualPositions.find((item) => item.id === vpId);
    if (!vp) return;
    setClosingVpId(vpId);
    try {
      await api.closePosition(vpId, {
        type: 'MARKET',
        account_id: vp.account_id,
        ...(percent ? { percent } : { qty }),
      });
    } catch (err: any) {
      alert(`平仓失败: ${err.message}`);
    } finally {
      setClosingVpId(null);
    }
  }

  function isConsistencyMismatch(vp: VirtualPosition): boolean {
    const key = `${vp.account_id}_${vp.symbol}_${vp.positionSide}`;
    return consistencyStatuses[key]?.status === 'MISMATCH';
  }

  function renderRow(vp: VirtualPosition) {
    const tick = marketTicks[vp.symbol];
    const markPrice = tick?.markPrice ?? '0';
    const uPnl = calcUPnl(vp.net_qty, vp.avg_entry, markPrice, vp.positionSide);
    const mismatch = isConsistencyMismatch(vp);

    const tpsl = vp.tpsl;
    const isSyncing = tpsl?.sync_status === 'SYNCING';

    return (
      <tr
        key={vp.id}
        style={{
          borderBottom: '1px solid #2b3139',
          background: mismatch ? '#1a0f0f' : undefined,
        }}
      >
        {/* Symbol + Name */}
        <td style={cell}>
          <div style={{ color: '#848e9c', fontSize: 11 }}>{vp.account_id}</div>
          <div style={{ fontWeight: 600, color: '#eaecef' }}>{vp.symbol}</div>
          <div style={{ color: '#848e9c', fontSize: 11 }}>{vp.name}</div>
        </td>

        {/* Direction */}
        <td style={cell}>
          <span style={{ color: vp.positionSide === 'LONG' ? '#0ecb81' : '#f6465d', fontWeight: 600 }}>
            {vp.positionSide}
          </span>
        </td>

        {/* Size */}
        <td style={cell}>{fmtQty(vp.net_qty)}</td>

        {/* Entry price */}
        <td style={cell}>{fmtPrice(vp.avg_entry)}</td>

        {/* Mark price */}
        <td style={cell}>{fmtPrice(markPrice)}</td>

        {/* Unrealized PnL */}
        <td style={{ ...cell, color: pnlColor(uPnl) }}>{fmtPnl(uPnl)}</td>

        {/* Realized PnL */}
        <td style={{ ...cell, color: pnlColor(vp.realized_pnl) }}>{fmtPnl(vp.realized_pnl)}</td>

        {/* TP/SL */}
        <td style={cell}>
          {isSyncing ? (
            <span style={{ color: '#f0b90b', fontSize: 11 }}>同步中…</span>
          ) : tpsl ? (
            <div style={{ fontSize: 11 }}>
              {tpsl.tp_price && <div style={{ color: '#0ecb81' }}>TP {fmtPrice(tpsl.tp_price)}</div>}
              {tpsl.sl_price && <div style={{ color: '#f6465d' }}>SL {fmtPrice(tpsl.sl_price)}</div>}
            </div>
          ) : (
            <span style={{ color: '#848e9c', fontSize: 11 }}>—</span>
          )}
        </td>

        {/* Actions */}
        <td style={cell}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {/* TP/SL button */}
            <button
              onClick={() => setTpslVp(vp)}
              disabled={mismatch || isReadOnlyAll}
              style={{
                background: '#2b3139', color: '#f0b90b', border: '1px solid #f0b90b',
                borderRadius: 3, padding: '3px 7px', cursor: 'pointer', fontSize: 11,
              }}
            >
              TP/SL
            </button>

            {/* Close buttons */}
            {CLOSE_PERCENTS.map((pct) => (
              <button
                key={pct}
                onClick={() => closePosition(vp.id, pct)}
                disabled={closingVpId === vp.id || mismatch || isReadOnlyAll}
                style={{
                  background: '#2e1a1e', color: '#f6465d', border: '1px solid #f6465d',
                  borderRadius: 3, padding: '3px 6px', cursor: 'pointer', fontSize: 11,
                }}
              >
                {pct}%
              </button>
            ))}

            {/* Custom close qty */}
            <input
              type="number"
              step="0.001"
              value={customCloseQty[vp.id] ?? ''}
              onChange={(e) => setCustomCloseQty((prev) => ({ ...prev, [vp.id]: e.target.value }))}
              placeholder="qty"
              style={{
                width: 54, background: '#2b3139', border: '1px solid #363c45',
                borderRadius: 3, color: '#eaecef', padding: '3px 5px', fontSize: 11, outline: 'none',
              }}
            />
            <button
              onClick={() => closePosition(vp.id, undefined, customCloseQty[vp.id])}
              disabled={!customCloseQty[vp.id] || closingVpId === vp.id || mismatch || isReadOnlyAll}
              style={{
                background: '#2b3139', color: '#f6465d', border: '1px solid #f6465d',
                borderRadius: 3, padding: '3px 6px', cursor: 'pointer', fontSize: 11,
              }}
            >
              平仓
            </button>

            {mismatch && (
              <span style={{ color: '#f0b90b', fontSize: 10 }}>⚠ 对账中</span>
            )}
            {isReadOnlyAll && (
              <span style={{ color: '#848e9c', fontSize: 10 }}>All 只读</span>
            )}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      {openPositions.length === 0 && emptyPositions.length === 0 && (
        <div style={{ padding: 24, color: '#848e9c', textAlign: 'center' }}>
          暂无虚拟仓位 — 请先创建虚拟仓位
        </div>
      )}

      {openPositions.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2b3139' }}>
              {['账户', '合约', '方向', '数量', '开仓价', '标记价', '浮动PnL', '已实现PnL', 'TP/SL', '操作'].map((h) => (
                <th key={h} style={{ ...cell, color: '#848e9c', fontWeight: 400, textAlign: 'left' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{openPositions.map(renderRow)}</tbody>
        </table>
      )}

      {emptyPositions.length > 0 && (
        <div style={{ padding: '8px 10px', color: '#848e9c', fontSize: 12 }}>
          已关闭仓位：{emptyPositions.map((vp) => vp.name).join(', ')}
        </div>
      )}

      {tpslVp && (
        <TpSlModal
          vp={tpslVp}
          onClose={() => setTpslVp(null)}
          onUpdated={(updated) => {
            upsertVirtualPosition(updated);
            setTpslVp(null);
          }}
        />
      )}
    </div>
  );
}
