import 'dotenv/config';

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optional(name: string, defaultVal: string): string {
  return process.env[name] ?? defaultVal;
}

function optionalNumber(name: string, defaultVal: number): number {
  const raw = process.env[name];
  if (raw === undefined) return defaultVal;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : defaultVal;
}

export const config = {
  binance: {
    apiKey: required('BINANCE_API_KEY'),
    apiSecret: required('BINANCE_API_SECRET'),
    testnet: optional('BINANCE_TESTNET', 'false') === 'true',
  },
  accountsConfigPath: optional('ACCOUNTS_CONFIG_PATH', './config/accounts.json'),
  symbols: optional('SYMBOLS', 'BTCUSDT,ETHUSDT').split(',') as string[],
  port: parseInt(optional('PORT', '3001'), 10),
  dbPath: optional('DB_PATH', './data/db.sqlite'),
  logLevel: optional('LOG_LEVEL', 'info') as 'trace' | 'debug' | 'info' | 'warn' | 'error',
  ops: {
    metricsWindowSecDefault: optionalNumber('OPS_METRICS_WINDOW_SEC_DEFAULT', 900),
    metricsWindowSecMin: optionalNumber('OPS_METRICS_WINDOW_SEC_MIN', 60),
    metricsWindowSecMax: optionalNumber('OPS_METRICS_WINDOW_SEC_MAX', 3600),
    alertCooldownSec: optionalNumber('OPS_ALERT_COOLDOWN_SEC', 300),
    thresholds: {
      orderSuccessRateMin: optionalNumber('OPS_THRESHOLD_ORDER_SUCCESS_RATE_MIN', 0.95),
      cancelErrorRateMax: optionalNumber('OPS_THRESHOLD_CANCEL_ERROR_RATE_MAX', 0.05),
      amendErrorRateMax: optionalNumber('OPS_THRESHOLD_AMEND_ERROR_RATE_MAX', 0.2),
      wsReconnectTotalMax: optionalNumber('OPS_THRESHOLD_WS_RECONNECT_TOTAL_MAX', 3),
      reconcileMismatchTotalMax: optionalNumber(
        'OPS_THRESHOLD_RECONCILE_MISMATCH_TOTAL_MAX',
        1
      ),
      invalidAccountCountMax: optionalNumber('OPS_THRESHOLD_INVALID_ACCOUNT_MAX', 1),
      accountScopeMismatchCountMax: optionalNumber(
        'OPS_THRESHOLD_ACCOUNT_SCOPE_MISMATCH_MAX',
        3
      ),
      accountIdRequiredForCancelCountMax: optionalNumber(
        'OPS_THRESHOLD_ACCOUNT_ID_REQUIRED_FOR_CANCEL_MAX',
        5
      ),
    },
  },
} as const;

export type Symbol = 'BTCUSDT' | 'ETHUSDT' | (string & {});
export type PositionSide = 'LONG' | 'SHORT';
export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'STOP' | 'TAKE_PROFIT_MARKET' | 'TAKE_PROFIT';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK' | 'GTX';
