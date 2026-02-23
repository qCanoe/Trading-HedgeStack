import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      BINANCE_API_KEY: 'test_key',
      BINANCE_API_SECRET: 'test_secret',
      BINANCE_TESTNET: 'true',
      DB_PATH: ':memory:',
    },
  },
});
