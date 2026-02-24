# Pre-v0.3 Drill Record Template

## 1. Metadata

- Date:
- Environment: `testnet` / `mainnet-sim`
- Operator:
- Branch / commit:

## 2. Scenario

- [ ] User stream disconnect and auto-reconnect
- [ ] Binance API temporary error and recovery
- [ ] Disable sub-account rollback (`enabled=false` + restart)

## 3. Steps

1. Trigger method:
2. Expected behavior:
3. Actual behavior:
4. Recovery completed at:

## 4. Evidence

- Command logs:
- API checks:
  - `GET /v1/ops/health`
  - `GET /v1/ops/metrics`
  - `GET /v1/accounts`
- Screenshots / terminal captures:

## 5. Timing

- Detection time:
- Mitigation start:
- Service restored:
- Total duration:

## 6. Result

- Status: `PASS` / `FAIL` / `PASS_WITH_RISK`
- Residual risk:
- Follow-up action items:
