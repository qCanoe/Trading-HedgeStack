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

  useEffect(() => {
    connectWs();
  }, []);

  useEffect(() => {
    setAccountLoading(true);
    api.getAccounts()
      .then((data) => {
        setAccounts(data.filter((acc) => acc.enabled));
      })
      .catch((err) => {
        console.error('Load accounts failed', err);
      })
      .finally(() => setAccountLoading(false));
  }, [setAccounts]);

  const visibleVps = useMemo(
    () => virtualPositions.filter((vp) => activeAccountId === 'ALL' || vp.account_id === activeAccountId),
    [virtualPositions, activeAccountId]
  );
  const visibleOrders = useMemo(
    () => openOrders.filter((o) => activeAccountId === 'ALL' || o.account_id === activeAccountId),
    [openOrders, activeAccountId]
  );

  async function createVP() {
    if (!newVpName.trim() || activeAccountId === 'ALL') return;
    setCreatingVp(true);
    try {
      const vp = await api.createVP({
        name: newVpName,
        symbol: newVpSymbol,
        positionSide: newVpSide,
        account_id: activeAccountId,
      });
      upsertVirtualPosition(vp);
      setNewVpName('');
      setShowCreateVp(false);
    } catch (err: any) {
      alert(`创建失败: ${err.message}`);
    } finally {
      setCreatingVp(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: '#2b3139', border: '1px solid #363c45', borderRadius: 4,
    color: '#eaecef', padding: '6px 8px', fontSize: 13, outline: 'none',
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0b0e11', color: '#eaecef' }}>
      <header
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 20px', borderBottom: '1px solid #2b3139', background: '#1e2329',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 16, color: '#f0b90b' }}>
          HedgeStack
          <span style={{ fontSize: 11, color: '#848e9c', marginLeft: 8 }}>USDT-M Futures</span>
        </div>

        <div style={{ display: 'flex', gap: 24 }}>
          {SYMBOLS.map((sym) => {
            const tick = marketTicks[sym];
            return tick ? (
              <div key={sym} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#848e9c' }}>{sym}</div>
                <div style={{ fontWeight: 600 }}>{fmtPrice(tick.markPrice)}</div>
              </div>
            ) : null;
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <select
            value={activeAccountId}
            onChange={(e) => setActiveAccountId(e.target.value as string | 'ALL')}
            disabled={accountLoading}
            style={{
              background: '#2b3139', border: '1px solid #363c45', borderRadius: 4,
              color: '#eaecef', padding: '5px 8px', fontSize: 12, outline: 'none',
            }}
          >
            <option value="ALL">All Accounts</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name} ({acc.id})
              </option>
            ))}
          </select>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 8, height: 8, borderRadius: '50%',
                background: wsConnected ? '#0ecb81' : '#f6465d',
                display: 'inline-block',
              }}
            />
            <span style={{ fontSize: 12, color: '#848e9c' }}>
              {wsConnected ? '已连接' : '连接中...'}
            </span>
          </div>
        </div>
      </header>

      <div style={{ display: 'flex', height: 'calc(100vh - 49px)' }}>
        <aside
          style={{
            width: 300, minWidth: 280, padding: 16,
            borderRight: '1px solid #2b3139', overflowY: 'auto', background: '#161a1e',
          }}
        >
          <div
            style={{
              background: '#1e2329', border: '1px solid #2b3139',
              borderRadius: 4, padding: 12, marginBottom: 12,
            }}
          >
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}
            >
              <span style={{ fontWeight: 600, fontSize: 13 }}>虚拟仓位</span>
              <button
                onClick={() => setShowCreateVp(!showCreateVp)}
                disabled={activeAccountId === 'ALL'}
                style={{
                  background: '#f0b90b', color: '#1e2329', border: 'none',
                  borderRadius: 3, padding: '3px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                  opacity: activeAccountId === 'ALL' ? 0.5 : 1,
                }}
              >
                + 创建
              </button>
            </div>

            {activeAccountId === 'ALL' && (
              <div style={{ color: '#848e9c', fontSize: 11, marginBottom: 8 }}>
                All 视图为只读，请切换到账户后再创建或交易
              </div>
            )}

            {showCreateVp && activeAccountId !== 'ALL' && (
              <div style={{ marginBottom: 8 }}>
                <input
                  value={newVpName}
                  onChange={(e) => setNewVpName(e.target.value)}
                  placeholder="仓位名称"
                  style={{ ...inputStyle, width: '100%', marginBottom: 4 }}
                />
                <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  <select
                    value={newVpSymbol}
                    onChange={(e) => setNewVpSymbol(e.target.value)}
                    style={{ ...inputStyle, flex: 1 }}
                  >
                    {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select
                    value={newVpSide}
                    onChange={(e) => setNewVpSide(e.target.value as 'LONG' | 'SHORT')}
                    style={{ ...inputStyle, flex: 1 }}
                  >
                    <option value="LONG">LONG</option>
                    <option value="SHORT">SHORT</option>
                  </select>
                </div>
                <button
                  onClick={createVP}
                  disabled={creatingVp || !newVpName.trim()}
                  style={{
                    width: '100%', background: '#f0b90b', color: '#1e2329',
                    border: 'none', borderRadius: 4, padding: '6px 0', cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  {creatingVp ? '创建中...' : '确认创建'}
                </button>
              </div>
            )}

            {visibleVps.length === 0 ? (
              <div style={{ color: '#848e9c', fontSize: 12 }}>暂无虚拟仓位</div>
            ) : (
              visibleVps.map((vp) => (
                <div
                  key={vp.id}
                  style={{
                    display: 'flex', justifyContent: 'space-between',
                    padding: '4px 0', borderBottom: '1px solid #2b3139', fontSize: 12,
                  }}
                >
                  <span style={{ color: '#eaecef' }}>
                    {vp.name}
                    {activeAccountId === 'ALL' && (
                      <span style={{ color: '#848e9c', marginLeft: 6 }}>[{vp.account_id}]</span>
                    )}
                  </span>
                  <span style={{ color: vp.positionSide === 'LONG' ? '#0ecb81' : '#f6465d' }}>
                    {vp.positionSide} {parseFloat(vp.net_qty).toFixed(3)}
                  </span>
                </div>
              ))
            )}
          </div>

          <OrderPanel />
        </aside>

        <main style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '0 16px' }}>
            <ReconcilePanel />
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'flex', borderBottom: '1px solid #2b3139',
                padding: '0 16px', background: '#161a1e',
              }}
            >
              {(
                [
                  { key: 'positions', label: `仓位 (${visibleVps.filter((v) => parseFloat(v.net_qty) > 0).length})` },
                  { key: 'open_orders', label: `挂单 (${visibleOrders.length})` },
                  { key: 'order_history', label: '成交历史' },
                ] as const
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  style={{
                    padding: '12px 16px', background: 'transparent',
                    border: 'none', cursor: 'pointer', fontSize: 13,
                    color: activeTab === key ? '#f0b90b' : '#848e9c',
                    borderBottom: activeTab === key ? '2px solid #f0b90b' : '2px solid transparent',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, padding: 0, overflowX: 'auto' }}>
              {activeTab === 'positions' && <Positions />}
              {activeTab === 'open_orders' && <OpenOrders />}
              {activeTab === 'order_history' && <OrderHistory />}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function OrderHistory() {
  const recentFills = useStore((s) => s.recentFills);
  const virtualPositions = useStore((s) => s.virtualPositions);
  const activeAccountId = useStore((s) => s.activeAccountId);
  const visibleFills = recentFills.filter((fill) => activeAccountId === 'ALL' || fill.account_id === activeAccountId);

  const { fmtPrice, fmtQty, fmtTime } = {
    fmtPrice: (v: string) => parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    fmtQty: (v: string) => parseFloat(v).toFixed(4),
    fmtTime: (ts: number) => new Date(ts).toLocaleString(),
  };
  const cell: React.CSSProperties = { padding: '7px 10px', fontSize: 12 };

  function vpName(vpId: string | null): string {
    if (!vpId) return '—';
    return virtualPositions.find((v) => v.id === vpId)?.name ?? vpId.slice(0, 8);
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      {visibleFills.length === 0 ? (
        <div style={{ padding: 24, color: '#848e9c', textAlign: 'center' }}>暂无成交记录</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2b3139' }}>
              {['账户', '合约', '方向', '数量', '成交价', 'VP', '已实现PnL', '手续费', '时间'].map((h) => (
                <th key={h} style={{ ...cell, color: '#848e9c', fontWeight: 400, textAlign: 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleFills.map((fill) => (
              <tr key={fill.tradeId} style={{ borderBottom: '1px solid #1e2329' }}>
                <td style={{ ...cell, color: '#848e9c' }}>{fill.account_id}</td>
                <td style={cell}>{fill.symbol}</td>
                <td style={{ ...cell, color: fill.side === 'BUY' ? '#0ecb81' : '#f6465d', fontWeight: 600 }}>
                  {fill.side} {fill.positionSide}
                </td>
                <td style={cell}>{fmtQty(fill.qty)}</td>
                <td style={cell}>{fmtPrice(fill.price)}</td>
                <td style={{ ...cell, color: '#f0b90b' }}>{vpName(fill.virtual_position_id)}</td>
                <td
                  style={{
                    ...cell,
                    color: parseFloat(fill.realizedPnl) >= 0 ? '#0ecb81' : '#f6465d',
                  }}
                >
                  {parseFloat(fill.realizedPnl) >= 0 ? '+' : ''}{parseFloat(fill.realizedPnl).toFixed(4)}
                </td>
                <td style={{ ...cell, color: '#848e9c' }}>
                  -{fill.commission} {fill.commissionAsset}
                </td>
                <td style={{ ...cell, color: '#848e9c' }}>{fmtTime(fill.ts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

