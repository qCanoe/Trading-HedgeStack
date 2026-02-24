import { accessSync, constants, existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { mkdirSync } from 'fs';
import { config } from '../config/env.js';
import type { AccountConfig } from '../accounts/registry.js';
import type {
  StartupHealthCheck,
  StartupHealthReport,
  StartupHealthStatus,
} from './types.js';

let startupChecks: StartupHealthCheck[] = [];
let startedAt = Date.now();

function resolveStatus(checks: StartupHealthCheck[]): StartupHealthStatus {
  if (checks.some((check) => check.status === 'FAIL')) return 'FAIL';
  if (checks.some((check) => check.status === 'WARN')) return 'DEGRADED';
  return 'OK';
}

function checkAccountsConfigReadable(): StartupHealthCheck {
  const filePath = resolve(config.accountsConfigPath);
  if (!existsSync(filePath)) {
    return {
      name: 'accounts_config_readable',
      status: 'WARN',
      message: `accounts config not found at ${filePath}; fallback main account will be used`,
    };
  }

  try {
    const raw = readFileSync(filePath, 'utf8');
    JSON.parse(raw);
    return {
      name: 'accounts_config_readable',
      status: 'PASS',
      message: `accounts config loaded from ${filePath}`,
    };
  } catch (err) {
    return {
      name: 'accounts_config_readable',
      status: 'FAIL',
      message: `failed to read or parse accounts config: ${String(err)}`,
    };
  }
}

function checkAccountIdUnique(accounts: AccountConfig[]): StartupHealthCheck {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const account of accounts) {
    const id = account.id.trim().toLowerCase();
    if (seen.has(id)) duplicate.add(id);
    seen.add(id);
  }
  if (duplicate.size > 0) {
    return {
      name: 'accounts_unique_id',
      status: 'FAIL',
      message: `duplicate account ids: ${Array.from(duplicate).join(', ')}`,
    };
  }
  return {
    name: 'accounts_unique_id',
    status: 'PASS',
    message: 'account ids are unique',
  };
}

function checkAtLeastOneEnabledAccount(accounts: AccountConfig[]): StartupHealthCheck {
  const enabled = accounts.filter((account) => account.enabled);
  if (enabled.length === 0) {
    return {
      name: 'enabled_account_exists',
      status: 'FAIL',
      message: 'no enabled account found',
    };
  }
  return {
    name: 'enabled_account_exists',
    status: 'PASS',
    message: `${enabled.length} enabled account(s)`,
  };
}

function checkEnabledAccountCredentials(accounts: AccountConfig[]): StartupHealthCheck {
  const invalid = accounts
    .filter((account) => account.enabled)
    .filter((account) => !account.apiKey || !account.apiSecret)
    .map((account) => account.id);

  if (invalid.length > 0) {
    return {
      name: 'enabled_account_credentials',
      status: 'FAIL',
      message: `missing API credentials for: ${invalid.join(', ')}`,
    };
  }
  return {
    name: 'enabled_account_credentials',
    status: 'PASS',
    message: 'all enabled accounts have API credentials',
  };
}

function checkSymbols(): StartupHealthCheck {
  const symbols = config.symbols.map((item) => item.trim()).filter(Boolean);
  if (symbols.length === 0) {
    return {
      name: 'symbols_config_valid',
      status: 'FAIL',
      message: 'SYMBOLS is empty',
    };
  }
  return {
    name: 'symbols_config_valid',
    status: 'PASS',
    message: `symbols configured: ${symbols.join(', ')}`,
  };
}

function checkDbPathWritable(): StartupHealthCheck {
  try {
    const dbDir = dirname(config.dbPath);
    mkdirSync(dbDir, { recursive: true });
    accessSync(dbDir, constants.W_OK);
    const probeFile = resolve(dbDir, '.healthcheck-write-probe');
    writeFileSync(probeFile, 'ok');
    rmSync(probeFile, { force: true });
    return {
      name: 'db_path_writable',
      status: 'PASS',
      message: `db path writable: ${config.dbPath}`,
    };
  } catch (err) {
    return {
      name: 'db_path_writable',
      status: 'FAIL',
      message: `db path is not writable: ${String(err)}`,
    };
  }
}

export function runStartupHealthChecks(accounts: AccountConfig[]): StartupHealthReport {
  startedAt = Date.now();
  startupChecks = [
    checkAccountsConfigReadable(),
    checkAccountIdUnique(accounts),
    checkAtLeastOneEnabledAccount(accounts),
    checkEnabledAccountCredentials(accounts),
    checkSymbols(),
    checkDbPathWritable(),
  ];

  return getStartupHealthReport();
}

export function getStartupHealthReport(): StartupHealthReport {
  const now = Date.now();
  return {
    status: resolveStatus(startupChecks),
    checks: startupChecks,
    started_at: startedAt,
    uptime_sec: Math.max(0, Math.floor((now - startedAt) / 1000)),
  };
}

export function __dangerousSetStartupHealthForTests(
  checks: StartupHealthCheck[],
  customStartedAt?: number
): void {
  startupChecks = checks;
  startedAt = customStartedAt ?? Date.now();
}
