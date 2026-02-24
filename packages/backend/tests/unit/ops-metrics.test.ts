import { beforeEach, describe, expect, it } from 'vitest';
import {
  __dangerousResetOpsMetricsForTests,
  getOpsMetricsSnapshot,
  recordCancel,
  recordConditionalOrderSubmit,
  recordErrorCode,
  recordOrderAmend,
  recordOrderSubmit,
  recordWsReconnect,
  setOpsAlertLogger,
} from '../../src/ops/metrics.js';

describe('ops metrics', () => {
  beforeEach(() => {
    __dangerousResetOpsMetricsForTests();
    setOpsAlertLogger(() => {});
  });

  it('aggregates counters by account', () => {
    recordOrderSubmit('main', true);
    recordOrderSubmit('main', false);
    recordConditionalOrderSubmit('main', true);
    recordOrderAmend('main', false);
    recordCancel('main', false);
    recordWsReconnect('main');
    recordErrorCode('main', 'INVALID_ACCOUNT', 'POST /v1/orders');

    const snapshot = getOpsMetricsSnapshot(900, 'main');
    expect(snapshot.by_account.main.order_submit_total).toBe(2);
    expect(snapshot.by_account.main.order_submit_success).toBe(1);
    expect(snapshot.by_account.main.order_submit_fail).toBe(1);
    expect(snapshot.by_account.main.conditional_order_submit_total).toBe(1);
    expect(snapshot.by_account.main.order_amend_total).toBe(1);
    expect(snapshot.by_account.main.order_amend_fail).toBe(1);
    expect(snapshot.by_account.main.cancel_fail).toBe(1);
    expect(snapshot.by_account.main.ws_reconnect_total).toBe(1);
    expect(snapshot.by_account.main.error_counts.INVALID_ACCOUNT).toBe(1);
  });

  it('emits expected alerts for threshold violations', () => {
    recordOrderSubmit('sub_a', false);
    recordOrderAmend('sub_a', false);
    recordCancel('sub_a', false);
    recordCancel('sub_a', false);
    recordErrorCode('sub_a', 'ACCOUNT_SCOPE_MISMATCH', 'POST /v1/reconcile');
    recordErrorCode('sub_a', 'ACCOUNT_SCOPE_MISMATCH', 'POST /v1/reconcile');
    recordErrorCode('sub_a', 'ACCOUNT_SCOPE_MISMATCH', 'POST /v1/reconcile');
    recordWsReconnect('sub_a');
    recordWsReconnect('sub_a');
    recordWsReconnect('sub_a');

    const snapshot = getOpsMetricsSnapshot(900, 'sub_a');
    const alertCodes = snapshot.alerts.map((alert) => alert.code);
    expect(alertCodes).toContain('ORDER_SUCCESS_RATE_LOW');
    expect(alertCodes).toContain('AMEND_ERROR_RATE_HIGH');
    expect(alertCodes).toContain('CANCEL_ERROR_RATE_HIGH');
    expect(alertCodes).toContain('ACCOUNT_SCOPE_MISMATCH_HIGH');
    expect(alertCodes).toContain('WS_RECONNECT_HIGH');
  });
});
