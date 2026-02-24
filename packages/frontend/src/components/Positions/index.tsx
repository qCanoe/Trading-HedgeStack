/**
 * Positions tab — virtual positions with PnL, TP/SL, and close controls.
 */
import { useState } from 'react';
import { useStore } from '../../store/index.js';
import { api } from '../../utils/api.js';
import { fmtPrice, fmtQty, fmtPnl, pnlColor, calcUPnl } from '../../utils/format.js';
import { consistencyKey } from '../../utils/keys.js';
import TpSlModal from '../TpSlModal/index.js';
import type { VirtualPosition } from '../../types/index.js';
import { EmptyState } from '../../App.js';

const CLOSE_PERCENTS = [25, 50, 75, 100];

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
    (vp) => activeAccountId === 'ALL' || vp.account_id === activeAccountId,
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
    const key = consistencyKey(vp.account_id, vp.symbol, vp.positionSide);
    return consistencyStatuses[key]?.status === 'MISMATCH';
  }

  const headers = ['合约 / 仓位', '方向', '数量', '开仓价', '标记价', '浮动PnL', '实现PnL', 'TP / SL', '操作'];

  function renderRow(vp: VirtualPosition) {
    const tick = marketTicks[vp.symbol];
    const markPrice = tick?.markPrice ?? '0';
    const uPnl = calcUPnl(vp.net_qty, vp.avg_entry, markPrice, vp.positionSide);
    const mismatch = isConsistencyMismatch(vp);
    const isLong = vp.positionSide === 'LONG';
    const tpsl = vp.tpsl;
    const isSyncing = tpsl?.sync_status === 'SYNCING';
    const isClosing = closingVpId === vp.id;
    const disabled = isClosing || mismatch || isReadOnlyAll;

    return (
      <tr
        key={vp.id}
        style={{
          borderBottom: '1px solid var(--border)',
          background: mismatch ? 'rgba(240,48,88,0.04)' : undefined,
        }}
      >
        {/* Contract + VP name */}
        <td className="hl-td">
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 12 }}>{vp.symbol}</div>
          <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 2 }}>
            {vp.name}
            {activeAccountId === 'ALL' && (
              <span style={{ color: 'var(--text-3)', marginLeft: 5 }}>{vp.account_id}</span>
            )}
          </div>
        </td>

        {/* Direction */}
        <td className="hl-td">
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.05em',
            padding: '2px 7px',
            borderRadius: 3,
          }} className={isLong ? 'hl-side-long' : 'hl-side-short'}>
            {vp.positionSide}
          </span>
        </td>

        {/* Size */}
        <td className="hl-td" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
          {fmtQty(vp.net_qty)}
        </td>

        {/* Entry */}
        <td className="hl-td" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>
          {fmtPrice(vp.avg_entry)}
        </td>

        {/* Mark */}
        <td className="hl-td" style={{ fontFamily: 'var(--font-mono)' }}>
          {fmtPrice(markPrice)}
        </td>

        {/* uPnL */}
        <td className="hl-td" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: pnlColor(uPnl) }}>
          {fmtPnl(uPnl)}
        </td>

        {/* rPnL */}
        <td className="hl-td" style={{ fontFamily: 'var(--font-mono)', color: pnlColor(vp.realized_pnl) }}>
          {fmtPnl(vp.realized_pnl)}
        </td>

        {/* TP/SL */}
        <td className="hl-td">
          {isSyncing ? (
            <span style={{ fontSize: 10, color: 'var(--amber)' }}>同步中…</span>
          ) : tpsl ? (
            <div style={{ fontSize: 10, lineHeight: 1.7, fontFamily: 'var(--font-mono)' }}>
              {tpsl.tp_price && <div style={{ color: 'var(--green)' }}>TP {fmtPrice(tpsl.tp_price)}</div>}
              {tpsl.sl_price && <div style={{ color: 'var(--red)' }}>SL {fmtPrice(tpsl.sl_price)}</div>}
            </div>
          ) : (
            <span style={{ color: 'var(--text-3)', fontSize: 11 }}>—</span>
          )}
        </td>

        {/* Actions */}
        <td className="hl-td">
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'nowrap' }}>
            <button
              className="hl-btn hl-btn-xs hl-btn-ghost-amber"
              onClick={() => setTpslVp(vp)}
              disabled={mismatch || isReadOnlyAll}
            >
              TP/SL
            </button>

            {CLOSE_PERCENTS.map((pct) => (
              <button
                key={pct}
                className="hl-close-chip"
                onClick={() => closePosition(vp.id, pct)}
                disabled={disabled}
              >
                {pct}%
              </button>
            ))}

            <input
              type="number"
              step="0.001"
              value={customCloseQty[vp.id] ?? ''}
              onChange={(e) => setCustomCloseQty((prev) => ({ ...prev, [vp.id]: e.target.value }))}
              placeholder="qty"
              className="hl-input"
              style={{ width: 52, padding: '2px 5px', fontSize: 10, fontFamily: 'var(--font-mono)' }}
            />
            <button
              className="hl-btn hl-btn-xs hl-btn-ghost-red"
              onClick={() => closePosition(vp.id, undefined, customCloseQty[vp.id])}
              disabled={!customCloseQty[vp.id] || disabled}
            >
              平仓
            </button>

            {mismatch && (
              <span style={{ color: 'var(--amber)', fontSize: 10, fontWeight: 600 }}>⚠ 对账中</span>
            )}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div>
      {openPositions.length === 0 && emptyPositions.length === 0 && (
        <EmptyState label="暂无虚拟仓位 — 请先在侧边栏创建" />
      )}

      {openPositions.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                {headers.map((h) => <th key={h} className="hl-th">{h}</th>)}
              </tr>
            </thead>
            <tbody>{openPositions.map(renderRow)}</tbody>
          </table>
        </div>
      )}

      {emptyPositions.length > 0 && (
        <div style={{ padding: '8px 12px', color: 'var(--text-3)', fontSize: 11, borderTop: '1px solid var(--border)' }}>
          已关闭：{emptyPositions.map((vp) => vp.name).join('、')}
        </div>
      )}

      {tpslVp && (
        <TpSlModal
          vp={tpslVp}
          onClose={() => setTpslVp(null)}
          onUpdated={(updated) => { upsertVirtualPosition(updated); setTpslVp(null); }}
        />
      )}
    </div>
  );
}
