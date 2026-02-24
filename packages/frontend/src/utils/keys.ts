export function consistencyKey(accountId: string, symbol: string, positionSide: string): string {
  return JSON.stringify([accountId, symbol, positionSide]);
}

