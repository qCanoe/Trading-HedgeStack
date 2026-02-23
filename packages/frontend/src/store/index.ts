import { create } from 'zustand';
import type {
  VirtualPosition,
  OrderRecord,
  FillRecord,
  ExternalPosition,
  MarketTick,
  ConsistencyStatus,
} from '../types/index.js';

interface AppState {
  // Connection
  wsConnected: boolean;
  setWsConnected: (v: boolean) => void;

  // Virtual Positions
  virtualPositions: VirtualPosition[];
  setVirtualPositions: (vps: VirtualPosition[]) => void;
  upsertVirtualPosition: (vp: VirtualPosition) => void;
  removeVirtualPosition: (id: string) => void;

  // Orders
  openOrders: OrderRecord[];
  setOpenOrders: (orders: OrderRecord[]) => void;
  upsertOrder: (order: OrderRecord) => void;

  // Fills
  recentFills: FillRecord[];
  setRecentFills: (fills: FillRecord[]) => void;
  addFill: (fill: FillRecord) => void;

  // External Positions
  externalPositions: ExternalPosition[];
  setExternalPositions: (positions: ExternalPosition[]) => void;
  upsertExternalPosition: (pos: ExternalPosition) => void;

  // Market Ticks
  marketTicks: Record<string, MarketTick>;
  setMarketTicks: (ticks: Record<string, MarketTick>) => void;
  updateMarketTick: (tick: MarketTick) => void;

  // Consistency
  consistencyStatuses: Record<string, ConsistencyStatus>;
  updateConsistencyStatus: (s: ConsistencyStatus) => void;

  // TPSL sync
  updateTpSlSyncStatus: (
    vpId: string,
    status: string,
    tpOrderId?: string,
    slOrderId?: string
  ) => void;

  // UI state
  selectedVpId: string | null;
  setSelectedVpId: (id: string | null) => void;
  orderFilterVpId: string | null;
  setOrderFilterVpId: (id: string | null) => void;
  activeTab: 'positions' | 'open_orders' | 'order_history';
  setActiveTab: (tab: 'positions' | 'open_orders' | 'order_history') => void;
}

export const useStore = create<AppState>((set) => ({
  // Connection
  wsConnected: false,
  setWsConnected: (v) => set({ wsConnected: v }),

  // Virtual Positions
  virtualPositions: [],
  setVirtualPositions: (vps) => set({ virtualPositions: vps }),
  upsertVirtualPosition: (vp) =>
    set((s) => {
      const idx = s.virtualPositions.findIndex((v) => v.id === vp.id);
      if (idx >= 0) {
        const next = [...s.virtualPositions];
        next[idx] = vp;
        return { virtualPositions: next };
      }
      return { virtualPositions: [...s.virtualPositions, vp] };
    }),
  removeVirtualPosition: (id) =>
    set((s) => ({ virtualPositions: s.virtualPositions.filter((v) => v.id !== id) })),

  // Orders
  openOrders: [],
  setOpenOrders: (orders) => set({ openOrders: orders }),
  upsertOrder: (order) =>
    set((s) => {
      const terminal = ['CANCELED', 'FILLED', 'EXPIRED', 'REJECTED'];
      if (terminal.includes(order.status)) {
        return { openOrders: s.openOrders.filter((o) => o.orderId !== order.orderId) };
      }
      const idx = s.openOrders.findIndex((o) => o.orderId === order.orderId);
      if (idx >= 0) {
        const next = [...s.openOrders];
        next[idx] = order;
        return { openOrders: next };
      }
      return { openOrders: [order, ...s.openOrders] };
    }),

  // Fills
  recentFills: [],
  setRecentFills: (fills) => set({ recentFills: fills }),
  addFill: (fill) =>
    set((s) => ({ recentFills: [fill, ...s.recentFills].slice(0, 100) })),

  // External Positions
  externalPositions: [],
  setExternalPositions: (positions) => set({ externalPositions: positions }),
  upsertExternalPosition: (pos) =>
    set((s) => {
      const idx = s.externalPositions.findIndex(
        (p) => p.symbol === pos.symbol && p.positionSide === pos.positionSide
      );
      if (idx >= 0) {
        const next = [...s.externalPositions];
        next[idx] = pos;
        return { externalPositions: next };
      }
      return { externalPositions: [...s.externalPositions, pos] };
    }),

  // Market Ticks
  marketTicks: {},
  setMarketTicks: (ticks) => set({ marketTicks: ticks }),
  updateMarketTick: (tick) =>
    set((s) => ({ marketTicks: { ...s.marketTicks, [tick.symbol]: tick } })),

  // Consistency
  consistencyStatuses: {},
  updateConsistencyStatus: (s) =>
    set((state) => ({
      consistencyStatuses: {
        ...state.consistencyStatuses,
        [`${s.symbol}_${s.positionSide}`]: s,
      },
    })),

  // TPSL sync
  updateTpSlSyncStatus: (vpId, status, tpOrderId, slOrderId) =>
    set((s) => {
      const vps = s.virtualPositions.map((vp) => {
        if (vp.id !== vpId) return vp;
        const tpsl = vp.tpsl
          ? {
              ...vp.tpsl,
              sync_status: status as 'OK' | 'SYNCING' | 'ERROR',
              ...(tpOrderId !== undefined && { tp_order_id: tpOrderId }),
              ...(slOrderId !== undefined && { sl_order_id: slOrderId }),
            }
          : null;
        return { ...vp, tpsl };
      });
      return { virtualPositions: vps };
    }),

  // UI
  selectedVpId: null,
  setSelectedVpId: (id) => set({ selectedVpId: id }),
  orderFilterVpId: null,
  setOrderFilterVpId: (id) => set({ orderFilterVpId: id }),
  activeTab: 'positions',
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
