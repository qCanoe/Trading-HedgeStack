# Project Status (Pre-v0.3 Full Scope)

## 1. Progress Snapshot

v0.3 前 P0 + P1 代码与文档基线已落地：

- 工程闸门：ESLint 工程链完成，`pnpm lint` 可执行。
- CI：新增 GitHub Actions `ci.yml`，执行 `install -> lint -> test -> build`。
- 可观测性：新增 `/v1/ops/metrics`，支持按 `account_id` 统计与阈值告警。
- 健康检查：新增 `/v1/ops/health`，返回启动检查、状态与 uptime。
- 路由埋点：下单/撤单、关键错误码、WS 重连、reconcile mismatch 已纳入统计。
- 测试扩展：新增 disabled sub-account 矩阵、ops metrics/health 覆盖。
- 运维文档：新增 schema 迁移、指标告警说明、演练模板。

## 2. Validation Snapshot

验证快照（2026-02-24）：

- `corepack pnpm lint` -> pass
- `corepack pnpm test` -> backend 22 passed, frontend 2 passed
- `corepack pnpm build` -> pass

## 3. Implemented Deliverables

### P0

- [x] ESLint 依赖与统一配置。
- [x] GitHub Actions CI 质量闸门。
- [x] account 维度运行指标与阈值告警。
- [x] 关键错误码频率统计：
  - `INVALID_ACCOUNT`
  - `ACCOUNT_SCOPE_MISMATCH`
  - `ACCOUNT_ID_REQUIRED_FOR_CANCEL`
- [x] 结构化告警日志 `OPS_ALERT`（5 分钟冷却）。

### P1

- [x] 多账户回归矩阵（含 `sub_b` disabled）测试。
- [x] TP/SL 多账户路径回归（disabled account 保护）。
- [x] schema 迁移说明文档。
- [x] 启动健康检查与运维接口。

## 4. Remaining Non-Code Gates Before v0.3

以下为发布流程门槛，需在环境执行并留痕：

- [ ] Testnet 执行并记录完整多账户回归。
- [ ] 故障演练记录（流断连、Binance API 异常、子账户禁用回滚）。
- [ ] 回滚演练时长满足目标 SLO。
- [ ] Mainnet 灰度观察窗口通过（`main + 1 sub`）。

## 5. References

- 指标与告警：[ops-metrics-and-alerts.md](./ops-metrics-and-alerts.md)
- schema 迁移：[schema-migration-pre-v0.3.md](./schema-migration-pre-v0.3.md)
- 演练模板：[drills/pre-v0.3-drill-template.md](./drills/pre-v0.3-drill-template.md)
