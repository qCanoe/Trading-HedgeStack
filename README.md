 Trading-HedgeStack

Binance USDT-M Futures 的多账户虚拟仓位聚合终端（`main + sub accounts`）。

## Current Status

- 当前阶段：`v0.2 GA Hardening` 已完成，pre-v0.3（P0+P1）基线已完成代码落地。
- 运行模式：`/v1` 渐进兼容，`account_id` 在 v0.2 继续可选输入，默认 `main`。
- 已实现：多账户 client pool、账户维度归因、All 只读视图、账户流状态事件化。
- 新增运维接口：`GET /v1/ops/metrics`、`GET /v1/ops/health`。

验证快照（2026-02-24）：
- `corepack pnpm lint` -> pass
- `corepack pnpm test` -> backend 22 passed, frontend 2 passed
- `corepack pnpm build` -> pass

## Repository Structure

```text
Trading-HedgeStack/
├─ packages/
│  ├─ backend/
│  │  ├─ config/accounts.json
│  │  ├─ src/
│  │  │  ├─ accounts/      # 账户配置加载与校验
│  │  │  ├─ api/           # REST 路由
│  │  │  ├─ binance/       # REST + UserStream
│  │  │  ├─ engine/        # attribution / reconcile / tpsl
│  │  │  ├─ ops/           # metrics / health
│  │  │  ├─ store/         # sqlite + in-memory state
│  │  │  └─ ws/            # 网关与广播
│  │  └─ tests/
│  │     ├─ unit/
│  │     └─ integration/
│  └─ frontend/
│     ├─ src/
│     │  ├─ components/    # Positions / OrderPanel / ReconcilePanel ...
│     │  ├─ store/         # 全局状态（含 account 维度）
│     │  ├─ types/
│     │  ├─ utils/
│     │  └─ ws/
│     └─ tests/smoke/
├─ docs/
│  ├─ README.md
│  ├─ project-status.md
│  ├─ v0.2-api-contract.md
│  ├─ release-playbook-v0.2.md
│  ├─ ops-metrics-and-alerts.md
│  ├─ schema-migration-pre-v0.3.md
│  └─ drills/pre-v0.3-drill-template.md
├─ .env.example
├─ docker-compose.yml
└─ README.md
```

## Quick Start

```bash
corepack enable
corepack pnpm install
cp .env.example .env
corepack pnpm dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

## Key v0.2 GA Behaviors

- `POST /v1/orders/:orderId/cancel`
  - 当本地无订单映射时，必须显式传 `account_id`
  - 否则返回 `400 ACCOUNT_ID_REQUIRED_FOR_CANCEL`
- `GET /v1/accounts`
  - 返回 `ws_status`, `last_error`, `last_connected_at`
- WS
  - 新增 `ACCOUNT_STREAM_STATUS`
  - `STATE_SNAPSHOT` 包含 `accounts_status`

## Pre-v0.3 Ops Endpoints

- `GET /v1/ops/metrics`
  - 查询维度：`account_id`、`window_sec`
  - 返回：`generated_at`、`window_sec`、`by_account`、`totals`、`alerts`
- `GET /v1/ops/health`
  - 返回：`status (OK|DEGRADED|FAIL)`、`checks[]`、`started_at`、`uptime_sec`

## Docs

- 文档索引：[docs/README.md](./docs/README.md)
- 项目进度与补漏清单：[docs/project-status.md](./docs/project-status.md)
- API 契约（v0.2 冻结）：[docs/v0.2-api-contract.md](./docs/v0.2-api-contract.md)
- 发布/灰度手册：[docs/release-playbook-v0.2.md](./docs/release-playbook-v0.2.md)
- 指标与告警说明：[docs/ops-metrics-and-alerts.md](./docs/ops-metrics-and-alerts.md)
- schema 迁移说明：[docs/schema-migration-pre-v0.3.md](./docs/schema-migration-pre-v0.3.md)
- 演练模板：[docs/drills/pre-v0.3-drill-template.md](./docs/drills/pre-v0.3-drill-template.md)

## Before v0.3 Checklist

- [x] Lint 工程链与 CI 质量闸门。
- [x] 多账户回归矩阵（含 disabled sub account）测试。
- [x] account 维度运行指标与告警阈值。
- [x] 启动健康检查与运维接口。
- [ ] Testnet 演练与回滚记录（需在目标环境执行并留痕）。
- [ ] Mainnet 灰度观察窗口验证（`main + 1 sub`）。
