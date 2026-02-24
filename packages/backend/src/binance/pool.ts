import { BinanceRestClient } from './rest.js';
import type { AccountConfig } from '../accounts/registry.js';

export class BinanceClientPool {
  private readonly clients = new Map<string, BinanceRestClient>();
  private readonly accountsById = new Map<string, AccountConfig>();

  constructor(accounts: AccountConfig[]) {
    for (const account of accounts) {
      this.accountsById.set(account.id, account);
      if (!account.enabled) continue;

      this.clients.set(
        account.id,
        new BinanceRestClient({
          apiKey: account.apiKey,
          apiSecret: account.apiSecret,
          testnet: account.testnet,
        })
      );
    }
  }

  hasAccount(accountId: string): boolean {
    return this.accountsById.has(accountId);
  }

  isEnabled(accountId: string): boolean {
    return this.accountsById.get(accountId)?.enabled ?? false;
  }

  getEnabledAccounts(): AccountConfig[] {
    return Array.from(this.accountsById.values()).filter((a) => a.enabled);
  }

  getAllAccounts(): AccountConfig[] {
    return Array.from(this.accountsById.values());
  }

  getClient(accountId = 'main'): BinanceRestClient {
    const targetId = accountId || 'main';
    const client = this.clients.get(targetId);
    if (client) return client;
    if (targetId !== 'main') {
      throw new Error(`No enabled Binance client available for account "${targetId}"`);
    }
    const mainClient = this.clients.get('main');
    if (!mainClient) throw new Error('No enabled Binance client available for account "main"');
    return mainClient;
  }
}
