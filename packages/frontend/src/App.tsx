import { useEffect, useMemo, useState } from 'react';
import { useStore } from './store/index.js';
import { connectWs } from './ws/client.js';
import { api } from './utils/api.js';
import { fmtPrice } from './utils/format.js';
import OrderPanel from './components/OrderPanel/index.js';
import Positions from './components/Positions/index.js';
import OpenOrders from './components/OpenOrders/index.js';
import ReconcilePanel from './components/ReconcilePanel/index.js';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];

// ── shared style tokens ──────────────────────────────────────────────────────
const C = {
  bgDeep:   '#08090b',
  bgBase:   '#0c0e11',
  bgPanel:  '#10141a',
  bgHover:  '#151c24',
  bgActive: '#1a2330',
  bgInput:  '#131820',
  border:   '#1a2028',
  borderMid:'#232d3a',
  text1:    '#dde3ea',
  text2:    '#68808f',
  text3:    '#3a5060',
  green:    '#00c076',
  red:      '#f03058',
  accent:   '#01d5bf',
  amber:    '#e8a900',
};

export default function App() {
  const wsConnected = useStore((s) => s.wsConnected);
  const marketTicks = useStore((s) => s.marketTicks);
  const virtualPositions = useStore((s) => s.virtualPositions);
  const openOrders = useStore((s) => s.openOrders);
  const accounts = useStore((s) => s.accounts);
  const setAccounts = useStore((s) => s.setAccounts);
  const activeAccountId = useStore((s) => s.activeAccountId);
  const setActiveAccountId = useStore((s) => s.setActiveAccountId);
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const upsertVirtualPosition = useStore((s) => s.upsertVirtualPosition);

  const [newVpName, setNewVpName] = useState('');
  const [newVpSymbol, setNewVpSymbol] = useState('BTCUSDT');
  const [newVpSide, setNewVpSide] = useState<'LONG' | 'SHORT'>('LONG');
  const [creatingVp, setCreatingVp] = useState(false);
  const [showCreateVp, setShowCreateVp] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);

  useEffect(() => { connectWs(); }, []);

  useEffect(() => {
    setAccountLoading(true);
    api.getAccounts()
      .then((data) => setAccounts(data.filter((acc) => acc.enabled)))
      .catch((err) => console.error('Load accounts failed', err))
      .finally(() => setAccountLoading(false));
  }, [setAccounts]);

  const visibleVps = useMemo(
    () => virtualPositions.filter((vp) => activeAccountId === 'ALL' || vp.account_id === activeAccountId),
    [virtualPositions, activeAccountId],
  );
  const visibleOrders = useMemo(
    () => openOrders.filter((o) => activeAccountId === 'ALL' || o.account_id === activeAccountId),
    [openOrders, activeAccountId],
  );
  const activeAccount = useMemo(
    () => (activeAccountId === 'ALL' ? null : accounts.find((acc) => acc.id === activeAccountId) ?? null),
    [accounts, activeAccountId],
  );

  async function createVP() {
    if (!newVpName.trim() || activeAccountId === 'ALL') return;
    setCreatingVp(true);
    try {
      const vp = await api.createVP({ name: newVpName, symbol: newVpSymbol, positionSide: newVpSide, account_id: activeAccountId });
      upsertVirtualPosition(vp);
      setNewVpName('');
      setShowCreateVp(false);
    } catch (err: any) {
      alert(`创建失败: ${err.message}`);
    } finally {
      setCreatingVp(false);
    }
  }

  const openCount = visibleVps.filter((v) => parseFloat(v.net_qty) > 0).length;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: C.bgDeep, color: C.text1, overflow: 'hidden' }}>
      {/* ── Header ── */}
      <header style={{
        height: 'var(--header-h)',
        minHeight: 'var(--header-h)',
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        borderBottom: `1px solid ${C.border}`,
        background: C.bgBase,
        padding: '0 16px',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginRight: 28 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, color: C.accent, letterSpacing: '0.04em' }}>
            HEDGESTACK
          </span>
          <span style={{ fontSize: 10, color: C.text3, letterSpacing: '0.03em' }}>USDT-M</span>
        </div>

        {/* Market tickers */}
        <div style={{ display: 'flex', gap: 20, marginRight: 'auto' }}>
          {SYMBOLS.map((sym) => {
            const tick = marketTicks[sym];
            if (!tick) return null;
            const label = sym.replace('USDT', '');
            return (
              <div key={sym} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 10, color: C.text2, fontWeight: 600, letterSpacing: '0.04em' }}>{label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500 }}>
                  {fmtPrice(tick.markPrice)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Account selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select
            value={activeAccountId}
            onChange={(e) => setActiveAccountId(e.target.value as string | 'ALL')}
            disabled={accountLoading}
            className="hl-select"
            style={{ fontSize: 11, padding: '4px 22px 4px 8px', minWidth: 140 }}
          >
            <option value="ALL">All Accounts</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name}
              </option>
            ))}
          </select>

          {activeAccount && (
            <span style={{
              fontSize: 10,
              color: activeAccount.ws_status === 'CONNECTED' ? C.green : C.text3,
              fontFamily: 'var(--font-mono)',
            }}>
              {activeAccount.ws_status}
            </span>
          )}

          {/* WS dot */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {wsConnected
              ? <span className="hl-dot-live" />
              : <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-3)', display: 'inline-block' }} />
            }
            <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
              {wsConnected ? 'LIVE' : 'CONN…'}
            </span>
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* ── Sidebar ── */}
        <aside style={{
          width: 'var(--sidebar-w)',
          minWidth: 'var(--sidebar-w)',
          borderRight: `1px solid ${C.border}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: C.bgPanel,
        }}>
          {/* VP section */}
          <div style={{
            borderBottom: `1px solid ${C.border}`,
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}>
            {/* VP header row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.text2, letterSpacing: '0.08em' }}>
                VIRTUAL POSITIONS
              </span>
              <button
                onClick={() => setShowCreateVp(!showCreateVp)}
                disabled={activeAccountId === 'ALL'}
                className={showCreateVp ? 'hl-btn hl-btn-xs hl-btn-accent' : 'hl-btn hl-btn-xs hl-btn-ghost-accent'}
              >
                + NEW
              </button>
            </div>

            {activeAccountId === 'ALL' && (
              <div style={{ fontSize: 10, color: C.text3 }}>All 视图只读 — 请切换账户</div>
            )}

            {/* Create form */}
            {showCreateVp && activeAccountId !== 'ALL' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 4 }}>
                <input
                  value={newVpName}
                  onChange={(e) => setNewVpName(e.target.value)}
                  placeholder="仓位名称"
                  className="hl-input"
                  style={{ fontSize: 11, padding: '5px 8px' }}
                  onKeyDown={(e) => e.key === 'Enter' && createVP()}
                />
                <div style={{ display: 'flex', gap: 5 }}>
                  <select
                    value={newVpSymbol}
                    onChange={(e) => setNewVpSymbol(e.target.value)}
                    className="hl-select"
                    style={{ flex: 1, fontSize: 11, padding: '4px 20px 4px 6px' }}
                  >
                    {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select
                    value={newVpSide}
                    onChange={(e) => setNewVpSide(e.target.value as 'LONG' | 'SHORT')}
                    className="hl-select"
                    style={{ flex: 1, fontSize: 11, padding: '4px 20px 4px 6px' }}
                  >
                    <option value="LONG">LONG</option>
                    <option value="SHORT">SHORT</option>
                  </select>
                </div>
                <button
                  onClick={createVP}
                  disabled={creatingVp || !newVpName.trim()}
                  className="hl-btn hl-btn-accent hl-btn-full"
                  style={{ fontSize: 11, padding: '6px 0' }}
                >
                  {creatingVp ? '创建中…' : '确认创建'}
                </button>
              </div>
            )}

            {/* VP list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 200, overflowY: 'auto' }}>
              {visibleVps.length === 0 ? (
                <div style={{ fontSize: 11, color: C.text3, padding: '4px 0' }}>暂无仓位</div>
              ) : (
                visibleVps.map((vp) => {
                  const isOpen = parseFloat(vp.net_qty) > 0;
                  return (
                    <div key={vp.id} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '5px 6px',
                      borderRadius: 'var(--radius-sm)',
                      background: isOpen ? 'var(--bg-active)' : 'transparent',
                      transition: 'background var(--t-fast)',
                    }}>
                      <div>
                        <span style={{ fontSize: 11, color: isOpen ? 'var(--text-1)' : 'var(--text-3)' }}>{vp.name}</span>
                        {activeAccountId === 'ALL' && (
                          <span style={{ fontSize: 9, color: 'var(--text-3)', marginLeft: 5 }}>{vp.account_id}</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span
                          className={vp.positionSide === 'LONG' ? 'hl-side-long' : 'hl-side-short'}
                          style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', padding: '1px 5px' }}
                        >
                          {vp.positionSide}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: isOpen ? 'var(--text-1)' : 'var(--text-3)' }}>
                          {parseFloat(vp.net_qty).toFixed(3)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Order panel */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <OrderPanel />
          </div>
        </aside>

        {/* ── Main content ── */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.bgBase }}>
          {/* Reconcile alert */}
          <ReconcilePanel />

          {/* Tab bar */}
          <div className="hl-tabs" style={{ background: C.bgPanel, padding: '0 16px' }}>
            {([
              { key: 'positions',     label: 'Positions',    count: openCount },
              { key: 'open_orders',   label: 'Open Orders',  count: visibleOrders.length },
              { key: 'order_history', label: 'Trade History', count: null },
            ] as const).map(({ key, label, count }) => (
              <button
                key={key}
                className={`hl-tab${activeTab === key ? ' active' : ''}`}
                onClick={() => setActiveTab(key)}
              >
                {label}
                {count != null && count > 0 && (
                  <span style={{
                    marginLeft: 5,
                    background: activeTab === key ? C.accent : C.borderMid,
                    color: activeTab === key ? C.bgBase : C.text2,
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '1px 5px',
                    borderRadius: 9,
                  }}>
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
            {activeTab === 'positions'     && <Positions />}
            {activeTab === 'open_orders'   && <OpenOrders />}
            {activeTab === 'order_history' && <OrderHistory />}
          </div>
        </main>
      </div>
    </div>
  );
}

// ── Order History ────────────────────────────────────────────────────────────
function OrderHistory() {
  const recentFills = useStore((s) => s.recentFills);
  const virtualPositions = useStore((s) => s.virtualPositions);
  const activeAccountId = useStore((s) => s.activeAccountId);
  const visibleFills = recentFills.filter(
    (fill) => activeAccountId === 'ALL' || fill.account_id === activeAccountId,
  );

  const fmt = {
    price: (v: string) => parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    qty:   (v: string) => parseFloat(v).toFixed(4),
    time:  (ts: number) => new Date(ts).toLocaleString('en-US', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };

  function vpName(vpId: string | null): string {
    if (!vpId) return '—';
    return virtualPositions.find((v) => v.id === vpId)?.name ?? vpId.slice(0, 8);
  }

  const headers = ['账户', '合约', '方向', '数量', '成交价', 'VP', '实现PnL', '手续费', '时间'];

  return (
    <div style={{ overflowX: 'auto' }}>
      {visibleFills.length === 0 ? (
        <EmptyState label="暂无成交记录" />
      ) : (
        <table>
          <thead>
            <tr>
              {headers.map((h) => <th key={h} className="hl-th">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {visibleFills.map((fill) => {
              const pnl = parseFloat(fill.realizedPnl);
              return (
                <tr key={fill.tradeId} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td className="hl-td" style={{ color: 'var(--text-2)' }}>{fill.account_id}</td>
                  <td className="hl-td" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fill.symbol}</td>
                  <td className="hl-td">
                    <SideBadge side={fill.side} positionSide={fill.positionSide} />
                  </td>
                  <td className="hl-td" style={{ fontFamily: 'var(--font-mono)' }}>{fmt.qty(fill.qty)}</td>
                  <td className="hl-td" style={{ fontFamily: 'var(--font-mono)' }}>{fmt.price(fill.price)}</td>
                  <td className="hl-td" style={{ color: 'var(--amber)' }}>{vpName(fill.virtual_position_id)}</td>
                  <td className="hl-td" style={{
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 500,
                    color: pnl > 0 ? 'var(--green)' : pnl < 0 ? 'var(--red)' : 'var(--text-2)',
                  }}>
                    {pnl >= 0 ? '+' : ''}{pnl.toFixed(4)}
                  </td>
                  <td className="hl-td" style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
                    -{fill.commission} {fill.commissionAsset}
                  </td>
                  <td className="hl-td" style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {fmt.time(fill.ts)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────
export function SideBadge({ side, positionSide }: { side: string; positionSide: string }) {
  const isBuy = side === 'BUY';
  return (
    <span style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.04em',
      color: isBuy ? 'var(--green)' : 'var(--red)',
      background: isBuy ? 'var(--green-dim)' : 'var(--red-dim)',
      padding: '2px 5px',
      borderRadius: 2,
    }}>
      {side} {positionSide}
    </span>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
      {label}
    </div>
  );
}
