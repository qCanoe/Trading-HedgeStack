import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import OrderPanel from '../../src/components/OrderPanel/index.tsx';
import { useStore } from '../../src/store/index.js';

function resetStore() {
  useStore.setState({
    wsConnected: true,
    activeAccountId: 'ALL',
    accounts: [
      {
        id: 'main',
        name: 'Main',
        type: 'MAIN',
        testnet: true,
        enabled: true,
        ws_status: 'CONNECTED',
        last_error: null,
        last_connected_at: Date.now(),
      },
    ],
    virtualPositions: [],
    openOrders: [],
    recentFills: [],
    externalPositions: [],
    marketTicks: {},
    consistencyStatuses: {},
    selectedVpId: null,
    orderFilterVpId: null,
    activeTab: 'positions',
  });
}

describe('frontend smoke', () => {
  it('shows read-only hint and disabled submit in ALL view', () => {
    resetStore();
    const html = renderToStaticMarkup(<OrderPanel />);
    expect(html).toContain('All view order placement is disabled.');
    expect(html).toContain('disabled');
  });

  it('applies account stream status updates in store', () => {
    resetStore();
    useStore.getState().applyAccountStatus({
      account_id: 'main',
      ws_status: 'DISCONNECTED',
      reason: 'user_data_error',
      last_error: 'timeout',
      last_connected_at: null,
      updated_at: Date.now(),
    });
    const current = useStore.getState().accounts.find((a) => a.id === 'main');
    expect(current?.ws_status).toBe('DISCONNECTED');
    expect(current?.last_error).toBe('timeout');
  });
});
