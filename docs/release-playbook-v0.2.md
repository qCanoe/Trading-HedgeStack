# v0.2 Release Playbook (Beta -> GA)

## 1) Preflight

1. Confirm all tests pass:
   - `corepack pnpm --filter backend test`
   - `corepack pnpm --filter frontend test`
   - `corepack pnpm build`
2. Confirm `accounts.json` + env key pairs are consistent.
3. Confirm `.env` does not contain unintended enabled sub-accounts.

## 2) Testnet Full Regression

1. Enable `main` + target sub-account in `accounts.json`.
2. Validate flows:
   - place/cancel/close/tpsl/reconcile on `main`
   - place/cancel/close/tpsl/reconcile on `sub_a`
   - verify no cross-account side effects
3. Validate WS:
   - `ACCOUNT_STREAM_STATUS` transitions on reconnect/error
   - `STATE_SNAPSHOT.accounts_status` is present on first frame

## 3) Mainnet Gradual Rollout

1. Step A: `main` only.
2. Step B: `main + 1 sub`.
3. Step C: all target sub-accounts.

Promote only when each step runs stable for the agreed observation window.

## 4) Monitoring Checklist

Per account (`account_id`) monitor:

1. order submit success rate
2. cancel success/error rate
3. ws disconnect/reconnect count
4. reconcile mismatch count
5. `ACCOUNT_SCOPE_MISMATCH` / `ACCOUNT_ID_REQUIRED_FOR_CANCEL` frequency

## 5) Rollback

1. Set problematic sub-account to `enabled=false` in `accounts.json`.
2. Restart backend to apply account scope rollback.
3. Keep API compatibility mode (`account_id` optional) unchanged.
4. Do not rollback DB schema; `account_id` columns remain.

## 6) Post-Release Verification

1. `GET /v1/accounts` reflects healthy stream statuses.
2. `GET /v1/state?account_id=sub_a` filters correctly.
3. Frontend `ALL` remains read-only.
4. Target account trading actions execute only within account scope.

