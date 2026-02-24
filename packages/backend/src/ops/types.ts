export type OpsAlertSeverity = 'warning' | 'critical';

export interface AccountOpsCounters {
  account_id: string;
  order_submit_total: number;
  order_submit_success: number;
  order_submit_fail: number;
  conditional_order_submit_total: number;
  conditional_order_submit_success: number;
  conditional_order_submit_fail: number;
  order_amend_total: number;
  order_amend_success: number;
  order_amend_fail: number;
  cancel_total: number;
  cancel_success: number;
  cancel_fail: number;
  ws_reconnect_total: number;
  reconcile_mismatch_total: number;
  error_counts: Record<string, number>;
  route_counts: Record<string, number>;
}

export interface OpsAlert {
  severity: OpsAlertSeverity;
  code: string;
  account_id: string;
  value: number;
  threshold: number;
  window_sec: number;
}

export interface OpsMetricsSnapshot {
  generated_at: number;
  window_sec: number;
  by_account: Record<string, AccountOpsCounters>;
  totals: Omit<AccountOpsCounters, 'account_id'>;
  alerts: OpsAlert[];
}

export type StartupCheckStatus = 'PASS' | 'WARN' | 'FAIL';
export type StartupHealthStatus = 'OK' | 'DEGRADED' | 'FAIL';

export interface StartupHealthCheck {
  name: string;
  status: StartupCheckStatus;
  message: string;
}

export interface StartupHealthReport {
  status: StartupHealthStatus;
  checks: StartupHealthCheck[];
  started_at: number;
  uptime_sec: number;
}
