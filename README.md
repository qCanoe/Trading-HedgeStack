# Trading-HedgeStack

> Binance USDT-M Futures 下单与仓位管理。  
> **多 API（主账户 + 多子账户）统一下单、独立仓位归属、同界面集中管理**。

[License: MIT](./LICENSE)
[Status: v0.1 Live]()
[Next: Multi-API Migration]()

---

## 目录

- [项目目标（本次更新）](#项目目标本次更新)
- [项目结构（重构后）](#项目结构重构后)
- [当前代码状态（仓库真实情况）](#当前代码状态仓库真实情况)
- [为什么必须迁移到多 API](#为什么必须迁移到多-api)
- [目标架构（vNext）](#目标架构vnext)
- [核心设计原则](#核心设计原则)
- [多账户与仓位归属模型](#多账户与仓位归属模型)
- [API 设计（迁移版）](#api-设计迁移版)
- [数据模型（迁移版）](#数据模型迁移版)
- [配置说明](#配置说明)
- [快速开始（当前 v0.1）](#快速开始当前-v01)
- [迁移实施计划](#迁移实施计划)
- [验收标准（与你的目标一一对应）](#验收标准与你的目标一一对应)
- [测试策略](#测试策略)
- [安全与风控](#安全与风控)
- [路线图](#路线图)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

---

## 项目结构（重构后）

```text
Trading-HedgeStack/
├─ packages/
│  ├─ backend/
│  │  ├─ config/accounts.json            # 账户元数据（不含密钥）
│  │  └─ src/
│  │     ├─ accounts/registry.ts         # 账户配置加载与校验
│  │     ├─ api/routes.ts                # REST 接口（含 account_id 兼容）
│  │     ├─ binance/pool.ts              # 多账户 Binance REST client 池
│  │     ├─ binance/ws.ts                # 多账户 UserStream + 市场流
│  │     ├─ engine/attribution/          # fill 归因与 clientOrderId
│  │     ├─ engine/reconcile/            # 对账检测与重分配
│  │     ├─ store/db.ts                  # SQLite schema + 迁移
│  │     └─ store/state.ts               # 内存状态（按 account_id 过滤）
│  └─ frontend/
│     └─ src/
│        ├─ App.tsx                      # 账户切换器（All/单账户）
│        ├─ components/                  # 各功能面板（All 只读）
│        ├─ store/index.ts               # 全局状态（账户维度）
│        └─ utils/api.ts                 # account_id 兼容 API 封装
├─ .env.example
└─ docker-compose.yml
```

---

## 项目目标（本次更新）

你定义的核心目标已经明确为以下 3 点，本 README 以此为主线：

1. **支持多 API 账户管理**（主账户 + 多个子账户）。
2. **仓位独立归属与独立管理**：
  - 主账户下的单，只影响主账户仓位。
  - 子账户下的单，只影响对应子账户仓位。
3. **统一管理界面**：在一个界面实时查看、筛选、操作所有账户仓位与订单。

换句话说：项目从“单 API 虚拟仓位系统”升级为“**多账户交易与仓位控制台**”。

---

## 当前代码状态（仓库真实情况）

以下是当前仓库已落地能力（不是规划）：


| 模块             | 当前状态  | 说明                                            |
| -------------- | ----- | --------------------------------------------- |
| Binance API 接入 | ✅ 已实现 | 单套 `BINANCE_API_KEY / BINANCE_API_SECRET`     |
| 下单能力           | ✅ 已实现 | `MARKET` / `LIMIT` / `STOP` / `STOP_MARKET` 等 |
| 虚拟仓位（VP）       | ✅ 已实现 | 单账户下多 VP，成交归因与 WAC 账本                         |
| TP/SL 管理       | ✅ 已实现 | VP 级别，`cancel + create` 生命周期                  |
| 对账与修复          | ✅ 已实现 | `external_qty` 与 VP 汇总差异检测 + 重分配              |
| 前端总览           | ✅ 已实现 | 仓位、挂单、成交历史、对账面板                               |
| 多 API / 子账户    | 🟡 基础已实现 | 已有 `account_id` 全链路基础与账户切换，账户 CRUD/告警待后续版本                         |


> 结论：当前版本是很完整的 **v0.1 单 API 基础设施**，非常适合作为多 API 迁移基座。

---

## 为什么必须迁移到多 API

单 API 架构的关键限制：

- 只能绑定一个 Binance 账户，无法原生管理多个子账户。
- 订单和仓位缺少账户维度，无法保证“哪个 API 下单就归属哪个仓位”。
- 无法在统一界面做跨账户对比（风险暴露、PnL、保证金利用率）。

你的目标本质上是把系统提升为 **Account-Scoped OMS + Position Manager**：

- OMS（Order Management System）：按 `account_id` 路由下单。
- Position Manager：按 `account_id + symbol + positionSide` 维护仓位账本。
- Unified Console：一个 UI 管全账户视图与操作。

---

## 目标架构（vNext）

```text
┌──────────────────────────────────────────────────────────────────────┐
│                           Frontend (Single UI)                      │
│                                                                      │
│  Account Switcher / Multi-Account Table / Unified Orders & Fills     │
│                 (筛选: account / symbol / side / strategy)           │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ REST + WS
┌───────────────────────────────▼──────────────────────────────────────┐
│                           Backend Server                              │
│                                                                      │
│  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐  │
│  │ Account Registry │   │ Execution Router │   │ Attribution      │  │
│  │ (API config)     │   │ (by account_id)  │   │ (fill -> VP账本) │  │
│  └──────────────────┘   └──────────────────┘   └──────────────────┘  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ State + DB (all include account_id)                              │ │
│  │ accounts / virtual_positions / orders / fills / client_order_map │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ Binance Clients Pool                                              │ │
│  │ main account client + sub account clients (REST + UserStream)     │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
                  Binance Main Account + Sub Accounts (USDT-M)
```

---

## 核心设计原则

1. **账户域强隔离**
  所有订单、成交、仓位、TP/SL 都必须带 `account_id`，禁止跨账户串写。
2. **路由显式化**
  下单请求必须显式声明 `account_id`，后端据此选择对应 API 客户端。
3. **账本可追溯**
  `clientOrderId` 与映射表必须能反查 `account_id + virtual_position_id`。
4. **统一界面，多维筛选**
  同一 UI 内支持账户筛选、聚合视图、分账户操作。
5. **兼容渐进迁移**
  先兼容单 API，再引入多 API，不破坏现有 v0.1 用户习惯。
6. **安全优先**
  API 密钥不入库明文、不进 Git、支持最小权限与 IP 白名单。

---

## 多账户与仓位归属模型

### 账户层（真实仓位）

- 主账户真实仓位键：`main + BTCUSDT + LONG`
- 子账户 A 真实仓位键：`sub_a + BTCUSDT + LONG`
- 子账户 B 真实仓位键：`sub_b + BTCUSDT + LONG`

三者彼此独立，不可混算。

### 策略层（虚拟仓位）

每个虚拟仓位必须绑定账户：

```text
Virtual Position Identity = (account_id, symbol, positionSide, name)
```

### 归属规则（你要求的核心）

- 主账户下单 -> 只能更新主账户仓位与主账户 VP。
- 子账户下单 -> 只能更新对应子账户仓位与对应子账户 VP。
- 前端统一展示 -> 可以按账户分组，也可以跨账户总览。

---

## API 设计（迁移版）

当前接口前缀保持 `/v1`，核心变化是逐步引入 `account_id`。

### 1) 账户管理（新增）

- `GET /v1/accounts`：获取账户列表（主账户 + 子账户）
- `POST /v1/accounts`：新增账户 API 配置
- `PATCH /v1/accounts/:id`：启用/禁用、备注更新
- `DELETE /v1/accounts/:id`：删除账户（需无活动订单/策略）

### 2) 状态快照（扩展）

- `GET /v1/state` 支持参数：
  - `account_id`（可选，不传表示全量）
  - `symbol`（可选）

### 3) VP 管理（扩展）

- `POST /v1/virtual-positions`
  - 新增必填：`account_id`

### 4) 下单（扩展）

- `POST /v1/orders`
  - 新增必填：`account_id`
  - 路由到对应 Binance client

### 5) 平仓/TP-SL/对账（扩展）

- `POST /v1/virtual-positions/:id/close`（由 VP 反查 `account_id`）
- `POST /v1/virtual-positions/:id/tpsl`（同上）
- `POST /v1/reconcile`（请求内新增 `account_id`）

---

## 数据模型（迁移版）

以下是建议的目标结构（与当前模型兼容演进）：

```ts
interface AccountConfig {
  id: string;                 // main | sub_a | sub_b ...
  name: string;               // 展示名称
  type: 'MAIN' | 'SUB';
  apiKey: string;             // 建议使用加密存储
  apiSecret: string;          // 建议使用加密存储
  testnet: boolean;
  enabled: boolean;
  created_at: number;
}

interface VirtualPosition {
  id: string;
  account_id: string;         // 新增
  name: string;
  symbol: string;
  positionSide: 'LONG' | 'SHORT';
  net_qty: string;
  avg_entry: string;
  realized_pnl: string;
  tpsl: TpSlConfig | null;
  created_at: number;
}

interface OrderRecord {
  orderId: string;
  clientOrderId: string;
  account_id: string;         // 新增
  virtual_position_id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  positionSide: 'LONG' | 'SHORT';
  type: string;
  qty: string;
  status: string;
  created_at: number;
  updated_at: number;
}
```

### `clientOrderId` 升级建议

```text
ACC-{accountShort}-VP-{vpShort}-{ts}-{nonce}
示例: ACC-main-VP-a1b2c3-1739988888123-007
```

这样可以在异常恢复时快速定位账户域与 VP 归属。

---

## 配置说明

### 当前 v0.2 Beta（兼容 v0.1）

`.env` 使用主账户 + 可选子账户密钥：

```dotenv
BINANCE_API_KEY=your_api_key_here
BINANCE_API_SECRET=your_api_secret_here
BINANCE_TESTNET=false
ACCOUNTS_CONFIG_PATH=./config/accounts.json
# BINANCE_API_KEY_SUB_A=...
# BINANCE_API_SECRET_SUB_A=...
# BINANCE_TESTNET_SUB_A=false
SYMBOLS=BTCUSDT,ETHUSDT
PORT=3001
DB_PATH=./data/db.sqlite
LOG_LEVEL=info
```

### vNext（目标）

建议增加账户配置文件（示例）：

```json
{
  "accounts": [
    { "id": "main", "name": "Main Account", "type": "MAIN", "testnet": false, "enabled": true },
    { "id": "sub_a", "name": "Sub Account A", "type": "SUB", "testnet": false, "enabled": true },
    { "id": "sub_b", "name": "Sub Account B", "type": "SUB", "testnet": false, "enabled": true }
  ]
}
```

> 密钥建议放在系统密钥管理或单独加密文件，不建议明文入库。

---

## 快速开始（当前 v0.1）

### 1. 安装依赖

```bash
corepack enable
corepack pnpm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 填写 BINANCE_API_KEY / BINANCE_API_SECRET
```

### 3. 启动开发

```bash
corepack pnpm dev
```

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3001`

Docker 启动：

```bash
docker-compose up --build
```

---

## 迁移实施计划

### Phase 0：Schema 准备（不改业务行为）

- 数据表增加 `account_id` 字段（VP / orders / fills / client_order_map）。
- 给现有数据默认回填 `account_id = main`。

### Phase 1：后端多客户端池

- 引入 `AccountRegistry` 与 `BinanceClientPool`。
- 每个账户独立维护 REST client + user data stream。

### Phase 2：路由与归因升级

- 所有下单入口强制携带 `account_id`。
- `clientOrderId` 编码加入账户前缀。
- Fill 归因先校验账户域，再更新 VP。

### Phase 3：前端统一界面

- 增加账户切换器、账户分组表格、跨账户筛选。
- 支持“全账户总览”和“单账户操作”两种视图。

### Phase 4：对账与告警

- 对账维度从 `(symbol, side)` 升级为 `(account_id, symbol, side)`。
- 增加账户级异常告警（失联、权限失效、流断开）。

### Phase 5：发布与回滚

- 灰度：先主账户 + 1 子账户，再全量。
- 保留单 API 回滚开关。

---

## 验收标准（与你的目标一一对应）

### 1) 多子账户管理

- 可新增/编辑/启停多个账户 API。
- 每个账户连接状态与权限状态可见。

### 2) 独立仓位管理

- 主账户下单后，仅主账户仓位与 VP 变化。
- 子账户下单后，仅对应子账户仓位与 VP 变化。
- 禁止跨账户平仓、跨账户 TP/SL。

### 3) 同一界面统一管理

- 单页面可查看所有账户仓位、挂单、成交。
- 可按账户筛选，也可跨账户聚合统计。
- 关键操作（下单/平仓/TPSL）都可明确看到目标账户。

---

## 测试策略


| 层级   | 目标                          | 状态                            |
| ---- | --------------------------- | ----------------------------- |
| 单元测试 | WAC、归因编码、账户路由逻辑             | v0.1 已有基础测试，需扩展 account_id 维度 |
| 集成测试 | 多账户下单 -> fill 回报 -> VP 更新链路 | vNext 必做                      |
| 回归测试 | 单 API 老流程不受影响               | vNext 必做                      |
| E2E  | 主/子账户 UI 操作闭环               | vNext 必做                      |


---

## 安全与风控

- API Key 最小权限原则，仅开启合约交易必要权限。
- 强制 IP 白名单。
- 禁止将 `.env`、账户密钥文件提交到仓库。
- 关键操作记录审计日志：`operator`, `account_id`, `symbol`, `action`, `ts`。
- 对每个账户做请求频率隔离，避免互相影响。

---

## 路线图

### v0.1（当前）

- 单 API 下单、VP 归因、TP/SL、对账、前端总览已完成。

### v0.2（迁移核心）

- 引入 `account_id` 全链路。
- 多 API client pool。
- 前端账户维度筛选与基础管理（All 只读，单账户可交易）。

### v0.3（稳定性）

- 多账户对账自动化。
- WS 断线补偿与恢复。
- 性能优化与大屏监控。

### v1.0（目标完成）

- 主账户 + 多子账户统一管理全面上线。
- 仓位归属严格隔离，跨账户管理能力稳定可用。

---

## 参与贡献

项目当前处于核心架构迁移阶段，建议先通过 Issue 讨论方案再提交 PR。

---

## 许可证

[MIT](./LICENSE) © 2026 CaNoe
