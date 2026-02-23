import 'dotenv/config';

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optional(name: string, defaultVal: string): string {
  return process.env[name] ?? defaultVal;
}

export const config = {
  binance: {
    apiKey: required('BINANCE_API_KEY'),
    apiSecret: required('BINANCE_API_SECRET'),
    testnet: optional('BINANCE_TESTNET', 'false') === 'true',
  },
  symbols: optional('SYMBOLS', 'BTCUSDT,ETHUSDT').split(',') as string[],
  port: parseInt(optional('PORT', '3001'), 10),
  dbPath: optional('DB_PATH', './data/db.sqlite'),
  logLevel: optional('LOG_LEVEL', 'info') as 'trace' | 'debug' | 'info' | 'warn' | 'error',
} as const;

export type Symbol = 'BTCUSDT' | 'ETHUSDT' | (string & {});
export type PositionSide = 'LONG' | 'SHORT';
export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'STOP' | 'TAKE_PROFIT_MARKET' | 'TAKE_PROFIT';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK' | 'GTX';
