/**
 * ReconcilePanel — shows mismatched positions and allows user-driven re-assignment.
 */
import { useState } from 'react';
import { useStore } from '../../store/index.js';
import { api } from '../../utils/api.js';
import type { VirtualPosition } from '../../types/index.js';

interface Assignment {
  virtual_position_id: string;
  qty: string;
}

export default function ReconcilePanel() {
  const consistencyStatuses = useStore((s) => s.consistencyStatuses);
  const virtualPositions = useStore((s) => s.virtualPositions);
  const upsertVirtualPosition = useStore((s) => s.upsertVirtualPosition);
  const activeAccountId = useStore((s) => s.activeAccountId);

  const mismatches = Object.values(consistencyStatuses).filter(
    (s) => s.status === 'MISMATCH' && (activeAccountId === 'ALL' || s.account_id === activeAccountId)
  );

  if (mismatches.length === 0) return null;

  return (
    <div
      style={{
        background: '#1a0f0f',
        border: '1px solid #f6465d',
        borderRadius: 4,
        padding: 16,
        margin: '8px 0',
      }}
    >
      <div style={{ color: '#f6465d', fontWeight: 600, marginBottom: 12 }}>
        ⚠ 发现仓位对账不一致 ({mismatches.length} 项)
      </div>
      {mismatches.map((mismatch) => (
        <MismatchItem
          key={`${mismatch.account_id}_${mismatch.symbol}_${mismatch.positionSide}`}
          accountId={mismatch.account_id}
          symbol={mismatch.symbol}
          positionSide={mismatch.positionSide as 'LONG' | 'SHORT'}
          externalQty={mismatch.external_qty}
          virtualQty={mismatch.virtual_qty}
          vps={virtualPositions.filter(
            (v) =>
              v.account_id === mismatch.account_id
              && v.symbol === mismatch.symbol
              && v.positionSide === mismatch.positionSide
          )}
          readOnly={activeAccountId === 'ALL'}
          onReconciled={(updated) => updated.forEach(upsertVirtualPosition)}
        />
      ))}
    </div>
  );
}

interface MismatchItemProps {
  accountId: string;
  symbol: string;
  positionSide: 'LONG' | 'SHORT';
  externalQty: string;
  virtualQty: string;
  vps: VirtualPosition[];
  readOnly: boolean;
  onReconciled: (updated: VirtualPosition[]) => void;
}

function MismatchItem({
  accountId,
  symbol,
  positionSide,
  externalQty,
  virtualQty,
  vps,
  readOnly,
  onReconciled,
}: MismatchItemProps) {
  const [assignments, setAssignments] = useState<Record<string, string>>(
    Object.fromEntries(vps.map((v) => [v.id, v.net_qty]))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const assignedTotal = Object.values(assignments).reduce((sum, v) => sum + parseFloat(v || '0'), 0);
  const remainder = parseFloat(externalQty) - assignedTotal;

  async function handleReconcile() {
    setLoading(true);
    setError('');
    try {
      const asgn: Assignment[] = vps.map((v) => ({
        virtual_position_id: v.id,
        qty: assignments[v.id] ?? '0',
      }));
      const res = await api.reconcile({ account_id: accountId, symbol, positionSide, assignments: asgn });
      onReconciled(res.updated);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ color: '#eaecef', fontSize: 13, marginBottom: 6 }}>
        <strong>{accountId} / {symbol} {positionSide}</strong>
        <span style={{ color: '#848e9c', marginLeft: 8 }}>
          交易所: {externalQty} | 系统: {virtualQty}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
        {vps.map((vp) => (
          <div key={vp.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#f0b90b', fontSize: 12 }}>{vp.name}:</span>
            <input
              type="number"
              step="0.001"
              value={assignments[vp.id] ?? ''}
              onChange={(e) =>
                setAssignments((prev) => ({ ...prev, [vp.id]: e.target.value }))
              }
              style={{
                width: 80, background: '#2b3139', border: '1px solid #363c45',
                borderRadius: 3, color: '#eaecef', padding: '3px 6px', fontSize: 12, outline: 'none',
              }}
            />
          </div>
        ))}
      </div>
      {remainder > 0.0001 && (
        <div style={{ color: '#f0b90b', fontSize: 12 }}>
          差额 {remainder.toFixed(8)} 将进入 UNASSIGNED 仓位
        </div>
      )}
      {error && <div style={{ color: '#f6465d', fontSize: 12 }}>{error}</div>}
      {readOnly && <div style={{ color: '#848e9c', fontSize: 12 }}>All 视图仅浏览，请切换到账户后操作</div>}
      <button
        onClick={handleReconcile}
        disabled={loading || readOnly}
        style={{
          marginTop: 8, background: '#f0b90b', color: '#1e2329', border: 'none',
          borderRadius: 4, padding: '6px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 12,
        }}
      >
        {loading ? '提交中...' : '确认对账'}
      </button>
    </div>
  );
}
