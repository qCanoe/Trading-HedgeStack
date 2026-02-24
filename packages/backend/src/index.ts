import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config } from './config/env.js';
import { initState, initFills } from './store/state.js';
import { registerWsGateway } from './ws/gateway.js';
import { registerRoutes } from './api/routes.js';
import { startUserDataStream, startMarketStream } from './binance/ws.js';
import { BinanceClientPool } from './binance/pool.js';
import { loadAccountConfigs } from './accounts/registry.js';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const fastify = Fastify({
  logger: {
    level: config.logLevel,
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, ignore: 'pid,hostname' },
    },
  },
});

async function bootstrap(): Promise<void> {
  // Ensure data directory exists
  mkdirSync(dirname(config.dbPath), { recursive: true });

  // Load persisted state
  initState();
  initFills();

  // Fastify plugins
  await fastify.register(cors, { origin: true });
  await fastify.register(websocket);

  // Routes
  const accountConfigs = loadAccountConfigs();
  const pool = new BinanceClientPool(accountConfigs);
  registerWsGateway(fastify);
  registerRoutes(fastify, pool);

  // Start server
  await fastify.listen({ port: config.port, host: '0.0.0.0' });
  fastify.log.info(`Backend listening on http://0.0.0.0:${config.port}`);

  // Start Binance streams
  try {
    const enabledAccounts = pool.getEnabledAccounts();
    for (const account of enabledAccounts) {
      await startUserDataStream(account.id, pool.getClient(account.id), account.testnet);
    }
    startMarketStream(enabledAccounts[0]?.testnet ?? config.binance.testnet);
    fastify.log.info('Binance WebSocket streams started');
  } catch (err) {
    fastify.log.warn({ err }, 'Failed to start Binance streams — running in offline mode');
  }
}

bootstrap().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});
