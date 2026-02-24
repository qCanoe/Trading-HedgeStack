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
    (s) =>
      s.status === 'MISMATCH' &&
      (activeAccountId === 'ALL' || s.account_id === activeAccountId),
  );

  if (mismatches.length === 0) return null;

  return (
    <div style={{
      borderBottom: '1px solid rgba(240,48,88,0.18)',
      background: 'rgba(240,48,88,0.03)',
      padding: '10px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%', background: 'var(--red)', display: 'inline-block',
          boxShadow: '0 0 8px var(--red-glow)',
          animation: 'pulse-dot 2s ease-in-out infinite',
        }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)', letterSpacing: '0.05em' }}>
          POSITION MISMATCH — {mismatches.length} 项对账不一致
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                v.account_id === mismatch.account_id &&
                v.symbol === mismatch.symbol &&
                v.positionSide === mismatch.positionSide,
            )}
            readOnly={activeAccountId === 'ALL'}
            onReconciled={(updated) => updated.forEach(upsertVirtualPosition)}
          />
        ))}
      </div>
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
  accountId, symbol, positionSide, externalQty, virtualQty, vps, readOnly, onReconciled,
}: MismatchItemProps) {
  const [assignments, setAssignments] = useState<Record<string, string>>(
    Object.fromEntries(vps.map((v) => [v.id, v.net_qty])),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const assignedTotal = Object.values(assignments).reduce((sum, v) => sum + parseFloat(v || '0'), 0);
  const remainder = parseFloat(externalQty) - assignedTotal;
  const isLong = positionSide === 'LONG';

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
    <div style={{
      background: 'var(--bg-panel)',
      border: '1px solid var(--border-mid)',
      borderRadius: 'var(--radius)',
      padding: '10px 12px',
      transition: 'border-color var(--t-fast)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600 }}>
          {accountId} / {symbol}
        </span>
        <span
          className={isLong ? 'hl-side-long' : 'hl-side-short'}
          style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', padding: '1px 5px' }}
        >
          {positionSide}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
          交易所: <strong style={{ color: 'var(--text-1)' }}>{externalQty}</strong>
          {' · '}
          系统: <strong style={{ color: 'var(--text-1)' }}>{virtualQty}</strong>
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        {vps.map((vp) => (
          <div key={vp.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 600 }}>{vp.name}</span>
            <input
              type="number"
              step="0.001"
              value={assignments[vp.id] ?? ''}
              onChange={(e) => setAssignments((prev) => ({ ...prev, [vp.id]: e.target.value }))}
              className="hl-input"
              style={{ width: 82, padding: '3px 7px', fontSize: 11, fontFamily: 'var(--font-mono)' }}
            />
          </div>
        ))}
      </div>

      {remainder > 0.0001 && (
        <div style={{ fontSize: 10, color: 'var(--amber)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
          差额 {remainder.toFixed(8)} → UNASSIGNED
        </div>
      )}
      {error && (
        <div style={{ fontSize: 10, color: 'var(--red)', marginBottom: 6, background: 'var(--red-dim)', padding: '4px 8px', borderRadius: 'var(--radius-sm)' }}>
          {error}
        </div>
      )}
      {readOnly && (
        <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 6 }}>All 视图仅浏览</div>
      )}

      <button
        className="hl-btn hl-btn-sm hl-btn-accent"
        onClick={handleReconcile}
        disabled={loading || readOnly}
        style={{ marginTop: 2 }}
      >
        {loading ? '提交中…' : '确认对账'}
      </button>
    </div>
  );
}
