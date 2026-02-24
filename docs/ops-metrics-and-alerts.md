# Ops Metrics and Alerts (Pre-v0.3)

## 1. Endpoints

- `GET /v1/ops/metrics?account_id=&window_sec=`
- `GET /v1/ops/health`

`/v1/ops/metrics` returns per-account counters, totals, and threshold alerts.  
`/v1/ops/health` returns startup checks and runtime uptime.

## 2. Metrics Fields

Per `account_id`:

- `order_submit_total`
- `order_submit_success`
- `order_submit_fail`
- `cancel_total`
- `cancel_success`
- `cancel_fail`
- `ws_reconnect_total`
- `reconcile_mismatch_total`
- `error_counts`:
  - `INVALID_ACCOUNT`
  - `ACCOUNT_SCOPE_MISMATCH`
  - `ACCOUNT_ID_REQUIRED_FOR_CANCEL`
- `route_counts` (route-level call distribution)

## 3. Alert Rules (Default)

- `ORDER_SUCCESS_RATE_LOW`: `order_submit_success / order_submit_total < 0.95`
- `CANCEL_ERROR_RATE_HIGH`: `cancel_fail / cancel_total > 0.05`
- `WS_RECONNECT_HIGH`: `ws_reconnect_total >= 3` in 15 minutes
- `RECONCILE_MISMATCH_HIGH`: `reconcile_mismatch_total >= 1` in 15 minutes
- `INVALID_ACCOUNT_HIGH`: `INVALID_ACCOUNT >= 1` in 15 minutes
- `ACCOUNT_SCOPE_MISMATCH_HIGH`: `ACCOUNT_SCOPE_MISMATCH >= 3` in 15 minutes
- `ACCOUNT_ID_REQUIRED_FOR_CANCEL_HIGH`: `ACCOUNT_ID_REQUIRED_FOR_CANCEL >= 5` in 15 minutes

Alert logs are emitted as structured `OPS_ALERT` with 5-minute cooldown per `{account_id, code}`.

## 4. Configurable Environment Variables

- `OPS_METRICS_WINDOW_SEC_DEFAULT`
- `OPS_METRICS_WINDOW_SEC_MIN`
- `OPS_METRICS_WINDOW_SEC_MAX`
- `OPS_ALERT_COOLDOWN_SEC`
- `OPS_THRESHOLD_ORDER_SUCCESS_RATE_MIN`
- `OPS_THRESHOLD_CANCEL_ERROR_RATE_MAX`
- `OPS_THRESHOLD_WS_RECONNECT_TOTAL_MAX`
- `OPS_THRESHOLD_RECONCILE_MISMATCH_TOTAL_MAX`
- `OPS_THRESHOLD_INVALID_ACCOUNT_MAX`
- `OPS_THRESHOLD_ACCOUNT_SCOPE_MISMATCH_MAX`
- `OPS_THRESHOLD_ACCOUNT_ID_REQUIRED_FOR_CANCEL_MAX`

## 5. Triage Playbook

1. `INVALID_ACCOUNT_HIGH`
- check `accounts.json` enabled flags and secret env mapping.

2. `ACCOUNT_SCOPE_MISMATCH_HIGH`
- inspect caller request payload `account_id` vs VP/order ownership.

3. `ACCOUNT_ID_REQUIRED_FOR_CANCEL_HIGH`
- verify caller sends `account_id` when local order mapping is unavailable.

4. `WS_RECONNECT_HIGH`
- inspect Binance user stream stability and reconnect reason.

5. `RECONCILE_MISMATCH_HIGH`
- compare external positions and VP assignments, run `/v1/reconcile` with explicit account scope.
