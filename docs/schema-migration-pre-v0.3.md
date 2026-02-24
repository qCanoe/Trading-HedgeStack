# Schema Migration Guide (Pre-v0.3)

## 1. Current Schema Baseline

Backend SQLite schema is initialized in `packages/backend/src/store/db.ts` and currently includes:

- `virtual_positions`
- `orders`
- `fills`
- `client_order_map`

All core tables are account-aware through `account_id`, with compatibility default `main`.

## 2. Upgrade Notes

1. Stop backend write traffic before upgrade.
2. Backup DB file:
   - default path: `./data/db.sqlite`
3. Deploy new backend version.
4. Start backend once and let bootstrap run schema checks:
   - missing `account_id` columns are added automatically with default `main`
   - indexes are created with `IF NOT EXISTS`
5. Verify:
   - `GET /v1/ops/health` returns `OK` or `DEGRADED`
   - `GET /v1/state` returns expected entities

## 3. Rollback Notes

1. Keep API compatibility mode (`/v1`, optional `account_id`) unchanged.
2. Do not drop `account_id` columns during rollback.
3. If rollback requires binary downgrade:
   - restore DB backup only when downgrade code cannot read current schema
   - otherwise prefer keeping current DB and rolling back app only

## 4. Historical Data Backfill Strategy

When historical rows miss account attribution (legacy data):

1. Use default `main` as deterministic fallback.
2. Backfill scripts must be idempotent.
3. Keep an audit log for modified row counts per table.

## 5. Pre-Release Checklist

- [ ] DB backup verified.
- [ ] Upgrade executed in testnet.
- [ ] `GET /v1/ops/health` checked after upgrade.
- [ ] Rollback drill executed and timing recorded.
