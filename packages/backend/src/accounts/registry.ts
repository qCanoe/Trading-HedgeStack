import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { config } from '../config/env.js';
import type { AccountType } from '../store/types.js';

interface AccountMeta {
  id: string;
  name?: string;
  type?: AccountType;
  testnet?: boolean;
  enabled?: boolean;
}

interface AccountsFileShape {
  accounts?: AccountMeta[];
}

export interface AccountConfig {
  id: string;
  name: string;
  type: AccountType;
  testnet: boolean;
  enabled: boolean;
  apiKey: string;
  apiSecret: string;
}

function normalizeAccountId(id: string): string {
  return id.trim().toLowerCase();
}

function envSuffix(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
}

function resolveAccountSecrets(id: string, enabled: boolean): { apiKey: string; apiSecret: string } {
  if (!enabled) {
    return { apiKey: '', apiSecret: '' };
  }

  const suffix = envSuffix(id);
  const apiKey = process.env[`BINANCE_API_KEY_${suffix}`];
  const apiSecret = process.env[`BINANCE_API_SECRET_${suffix}`];

  if (apiKey && apiSecret) {
    return { apiKey, apiSecret };
  }

  if (id === 'main') {
    return { apiKey: config.binance.apiKey, apiSecret: config.binance.apiSecret };
  }

  throw new Error(`Missing API credentials for enabled account "${id}"`);
}

function resolveAccountTestnet(id: string, fileValue: boolean | undefined): boolean {
  if (typeof fileValue === 'boolean') return fileValue;
  const suffix = envSuffix(id);
  const envValue = process.env[`BINANCE_TESTNET_${suffix}`];
  if (envValue === 'true') return true;
  if (envValue === 'false') return false;
  return config.binance.testnet;
}

function defaultMainAccount(): AccountMeta {
  return {
    id: 'main',
    name: 'Main Account',
    type: 'MAIN',
    enabled: true,
    testnet: config.binance.testnet,
  };
}

function loadAccountMeta(): AccountMeta[] {
  const filePath = resolve(config.accountsConfigPath);
  if (!existsSync(filePath)) {
    return [defaultMainAccount()];
  }

  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as AccountsFileShape;
  const accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
  if (accounts.length === 0) {
    return [defaultMainAccount()];
  }

  const normalized: AccountMeta[] = accounts.map((item, idx) => {
    if (!item.id) throw new Error(`accounts[${idx}] is missing "id"`);
    const id = normalizeAccountId(item.id);
    return {
      id,
      name: item.name?.trim() || `${id.toUpperCase()} Account`,
      type: item.type ?? (id === 'main' ? 'MAIN' : 'SUB'),
      enabled: item.enabled ?? true,
      testnet: item.testnet,
    };
  });

  if (!normalized.some((a) => a.id === 'main')) {
    normalized.unshift(defaultMainAccount());
  }

  return normalized;
}

export function loadAccountConfigs(): AccountConfig[] {
  const meta = loadAccountMeta();
  const unique = new Map<string, AccountMeta>();
  for (const item of meta) {
    unique.set(item.id, item);
  }

  return Array.from(unique.values()).map((item) => {
    const enabled = item.enabled ?? true;
    const { apiKey, apiSecret } = resolveAccountSecrets(item.id, enabled);
    return {
      id: item.id,
      name: item.name ?? `${item.id.toUpperCase()} Account`,
      type: item.type ?? (item.id === 'main' ? 'MAIN' : 'SUB'),
      enabled,
      testnet: resolveAccountTestnet(item.id, item.testnet),
      apiKey,
      apiSecret,
    };
  });
}
