import { config } from '../config/env.js';
import type { AccountOpsCounters, OpsAlert, OpsMetricsSnapshot } from './types.js';

type MutableCounters = Omit<AccountOpsCounters, 'account_id'>;

interface MetricBucket {
  byAccount: Map<string, MutableCounters>;
}

const MINUTE_MS = 60_000;
const TRACKED_ERROR_CODES = new Set([
  'INVALID_ACCOUNT',
  'ACCOUNT_SCOPE_MISMATCH',
  'ACCOUNT_ID_REQUIRED_FOR_CANCEL',
]);

const buckets = new Map<number, MetricBucket>();
const alertCooldownState = new Map<string, number>();
let alertLogger: (alert: OpsAlert) => void = (alert) => {
  console.warn(JSON.stringify({ event: 'OPS_ALERT', ...alert }));
};

function emptyCounters(): MutableCounters {
  return {
    order_submit_total: 0,
    order_submit_success: 0,
    order_submit_fail: 0,
    conditional_order_submit_total: 0,
    conditional_order_submit_success: 0,
    conditional_order_submit_fail: 0,
    order_amend_total: 0,
    order_amend_success: 0,
    order_amend_fail: 0,
    cancel_total: 0,
    cancel_success: 0,
    cancel_fail: 0,
    ws_reconnect_total: 0,
    reconcile_mismatch_total: 0,
    error_counts: {},
    route_counts: {},
  };
}

function normalizeAccountId(accountId?: string): string {
  const raw = accountId?.trim().toLowerCase();
  return raw || 'unknown';
}

function floorMinute(ts: number): number {
  return Math.floor(ts / MINUTE_MS) * MINUTE_MS;
}

function clampWindowSec(windowSec?: number): number {
  if (!windowSec || Number.isNaN(windowSec) || windowSec <= 0) {
    return config.ops.metricsWindowSecDefault;
  }
  return Math.min(
    Math.max(windowSec, config.ops.metricsWindowSecMin),
    config.ops.metricsWindowSecMax
  );
}

function getOrCreateCounters(bucketTs: number, accountId: string): MutableCounters {
  let bucket = buckets.get(bucketTs);
  if (!bucket) {
    bucket = { byAccount: new Map<string, MutableCounters>() };
    buckets.set(bucketTs, bucket);
  }
  let counters = bucket.byAccount.get(accountId);
  if (!counters) {
    counters = emptyCounters();
    bucket.byAccount.set(accountId, counters);
  }
  return counters;
}

function pruneBuckets(now: number): void {
  const keepMs = (config.ops.metricsWindowSecMax + 120) * 1000;
  const minTs = floorMinute(now - keepMs);
  for (const ts of buckets.keys()) {
    if (ts < minTs) buckets.delete(ts);
  }
}

function addRouteCount(counters: MutableCounters, route?: string): void {
  if (!route) return;
  counters.route_counts[route] = (counters.route_counts[route] ?? 0) + 1;
}

function withMetricMutation(
  accountId: string | undefined,
  route: string | undefined,
  mutate: (counters: MutableCounters) => void
): void {
  const now = Date.now();
  const normalizedAccount = normalizeAccountId(accountId);
  const bucketTs = floorMinute(now);
  const counters = getOrCreateCounters(bucketTs, normalizedAccount);
  mutate(counters);
  addRouteCount(counters, route);
  pruneBuckets(now);
  emitAlertsForAccount(normalizedAccount, now);
}

function mergeCounters(target: MutableCounters, source: MutableCounters): void {
  target.order_submit_total += source.order_submit_total;
  target.order_submit_success += source.order_submit_success;
  target.order_submit_fail += source.order_submit_fail;
  target.conditional_order_submit_total += source.conditional_order_submit_total;
  target.conditional_order_submit_success += source.conditional_order_submit_success;
  target.conditional_order_submit_fail += source.conditional_order_submit_fail;
  target.order_amend_total += source.order_amend_total;
  target.order_amend_success += source.order_amend_success;
  target.order_amend_fail += source.order_amend_fail;
  target.cancel_total += source.cancel_total;
  target.cancel_success += source.cancel_success;
  target.cancel_fail += source.cancel_fail;
  target.ws_reconnect_total += source.ws_reconnect_total;
  target.reconcile_mismatch_total += source.reconcile_mismatch_total;

  for (const [key, value] of Object.entries(source.error_counts)) {
    target.error_counts[key] = (target.error_counts[key] ?? 0) + value;
  }
  for (const [key, value] of Object.entries(source.route_counts)) {
    target.route_counts[key] = (target.route_counts[key] ?? 0) + value;
  }
}

function evaluateAlertsByAccount(
  accountId: string,
  counters: MutableCounters,
  windowSec: number
): OpsAlert[] {
  const alerts: OpsAlert[] = [];

  if (counters.order_submit_total > 0) {
    const successRate = counters.order_submit_success / counters.order_submit_total;
    if (successRate < config.ops.thresholds.orderSuccessRateMin) {
      alerts.push({
        severity: 'warning',
        code: 'ORDER_SUCCESS_RATE_LOW',
        account_id: accountId,
        value: Number(successRate.toFixed(4)),
        threshold: config.ops.thresholds.orderSuccessRateMin,
        window_sec: windowSec,
      });
    }
  }

  if (counters.cancel_total > 0) {
    const cancelErrorRate = counters.cancel_fail / counters.cancel_total;
    if (cancelErrorRate > config.ops.thresholds.cancelErrorRateMax) {
      alerts.push({
        severity: 'warning',
        code: 'CANCEL_ERROR_RATE_HIGH',
        account_id: accountId,
        value: Number(cancelErrorRate.toFixed(4)),
        threshold: config.ops.thresholds.cancelErrorRateMax,
        window_sec: windowSec,
      });
    }
  }

  if (counters.order_amend_total > 0) {
    const amendErrorRate = counters.order_amend_fail / counters.order_amend_total;
    if (amendErrorRate > config.ops.thresholds.amendErrorRateMax) {
      alerts.push({
        severity: 'warning',
        code: 'AMEND_ERROR_RATE_HIGH',
        account_id: accountId,
        value: Number(amendErrorRate.toFixed(4)),
        threshold: config.ops.thresholds.amendErrorRateMax,
        window_sec: windowSec,
      });
    }
  }

  if (counters.ws_reconnect_total >= config.ops.thresholds.wsReconnectTotalMax) {
    alerts.push({
      severity: 'warning',
      code: 'WS_RECONNECT_HIGH',
      account_id: accountId,
      value: counters.ws_reconnect_total,
      threshold: config.ops.thresholds.wsReconnectTotalMax,
      window_sec: windowSec,
    });
  }

  if (counters.reconcile_mismatch_total >= config.ops.thresholds.reconcileMismatchTotalMax) {
    alerts.push({
      severity: 'critical',
      code: 'RECONCILE_MISMATCH_HIGH',
      account_id: accountId,
      value: counters.reconcile_mismatch_total,
      threshold: config.ops.thresholds.reconcileMismatchTotalMax,
      window_sec: windowSec,
    });
  }

  const invalidAccountCount = counters.error_counts.INVALID_ACCOUNT ?? 0;
  if (invalidAccountCount >= config.ops.thresholds.invalidAccountCountMax) {
    alerts.push({
      severity: 'warning',
      code: 'INVALID_ACCOUNT_HIGH',
      account_id: accountId,
      value: invalidAccountCount,
      threshold: config.ops.thresholds.invalidAccountCountMax,
      window_sec: windowSec,
    });
  }

  const scopeMismatchCount = counters.error_counts.ACCOUNT_SCOPE_MISMATCH ?? 0;
  if (scopeMismatchCount >= config.ops.thresholds.accountScopeMismatchCountMax) {
    alerts.push({
      severity: 'warning',
      code: 'ACCOUNT_SCOPE_MISMATCH_HIGH',
      account_id: accountId,
      value: scopeMismatchCount,
      threshold: config.ops.thresholds.accountScopeMismatchCountMax,
      window_sec: windowSec,
    });
  }

  const cancelAccountIdRequiredCount =
    counters.error_counts.ACCOUNT_ID_REQUIRED_FOR_CANCEL ?? 0;
  if (cancelAccountIdRequiredCount >= config.ops.thresholds.accountIdRequiredForCancelCountMax) {
    alerts.push({
      severity: 'warning',
      code: 'ACCOUNT_ID_REQUIRED_FOR_CANCEL_HIGH',
      account_id: accountId,
      value: cancelAccountIdRequiredCount,
      threshold: config.ops.thresholds.accountIdRequiredForCancelCountMax,
      window_sec: windowSec,
    });
  }

  return alerts;
}

function maybeLogAlerts(alerts: OpsAlert[], now: number): void {
  const cooldownMs = config.ops.alertCooldownSec * 1000;
  for (const alert of alerts) {
    const key = `${alert.account_id}:${alert.code}`;
    const last = alertCooldownState.get(key) ?? 0;
    if (now - last < cooldownMs) continue;
    alertCooldownState.set(key, now);
    alertLogger(alert);
  }
}

function emitAlertsForAccount(accountId: string, now: number): void {
  const snapshot = getOpsMetricsSnapshot(config.ops.metricsWindowSecDefault, accountId);
  maybeLogAlerts(snapshot.alerts, now);
}

export function setOpsAlertLogger(logger: (alert: OpsAlert) => void): void {
  alertLogger = logger;
}

export function recordOrderSubmit(
  accountId: string | undefined,
  ok: boolean,
  route = 'POST /v1/orders'
): void {
  withMetricMutation(accountId, route, (counters) => {
    counters.order_submit_total += 1;
    if (ok) counters.order_submit_success += 1;
    else counters.order_submit_fail += 1;
  });
}

export function recordConditionalOrderSubmit(
  accountId: string | undefined,
  ok: boolean
): void {
  withMetricMutation(accountId, 'POST /v1/orders', (counters) => {
    counters.conditional_order_submit_total += 1;
    if (ok) counters.conditional_order_submit_success += 1;
    else counters.conditional_order_submit_fail += 1;
  });
}

export function recordOrderAmend(
  accountId: string | undefined,
  ok: boolean
): void {
  withMetricMutation(accountId, 'POST /v1/orders/:orderId/amend', (counters) => {
    counters.order_amend_total += 1;
    if (ok) counters.order_amend_success += 1;
    else counters.order_amend_fail += 1;
  });
}

export function recordCancel(
  accountId: string | undefined,
  ok: boolean,
  route = 'POST /v1/orders/:orderId/cancel'
): void {
  withMetricMutation(accountId, route, (counters) => {
    counters.cancel_total += 1;
    if (ok) counters.cancel_success += 1;
    else counters.cancel_fail += 1;
  });
}

export function recordWsReconnect(accountId: string | undefined): void {
  withMetricMutation(accountId, 'WS_RECONNECT', (counters) => {
    counters.ws_reconnect_total += 1;
  });
}

export function recordReconcileMismatch(accountId: string | undefined): void {
  withMetricMutation(accountId, 'POST /v1/reconcile', (counters) => {
    counters.reconcile_mismatch_total += 1;
  });
}

export function recordErrorCode(
  accountId: string | undefined,
  errorCode: string,
  route?: string
): void {
  if (!TRACKED_ERROR_CODES.has(errorCode)) return;
  withMetricMutation(accountId, route, (counters) => {
    counters.error_counts[errorCode] = (counters.error_counts[errorCode] ?? 0) + 1;
  });
}

export function getOpsMetricsSnapshot(
  windowSec?: number,
  accountId?: string
): OpsMetricsSnapshot {
  const now = Date.now();
  const clampedWindowSec = clampWindowSec(windowSec);
  const normalizedFilterAccount = accountId ? normalizeAccountId(accountId) : undefined;
  const minTs = now - clampedWindowSec * 1000;
  const byAccount = new Map<string, MutableCounters>();

  for (const [bucketTs, bucket] of buckets.entries()) {
    if (bucketTs < minTs) continue;
    for (const [bucketAccountId, counters] of bucket.byAccount.entries()) {
      if (normalizedFilterAccount && bucketAccountId !== normalizedFilterAccount) continue;
      const acc = byAccount.get(bucketAccountId) ?? emptyCounters();
      mergeCounters(acc, counters);
      byAccount.set(bucketAccountId, acc);
    }
  }

  const totals = emptyCounters();
  const byAccountObject: Record<string, AccountOpsCounters> = {};
  const alerts: OpsAlert[] = [];

  for (const [id, counters] of byAccount.entries()) {
    byAccountObject[id] = { account_id: id, ...counters };
    mergeCounters(totals, counters);
    alerts.push(...evaluateAlertsByAccount(id, counters, clampedWindowSec));
  }

  return {
    generated_at: now,
    window_sec: clampedWindowSec,
    by_account: byAccountObject,
    totals,
    alerts,
  };
}

export function __dangerousResetOpsMetricsForTests(): void {
  buckets.clear();
  alertCooldownState.clear();
}
