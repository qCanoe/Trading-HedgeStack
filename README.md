# Trading-HedgeStack

> Binance USDT-M Futures 多虚拟仓位聚合终端 —— 在同一交易对上维护多个独立"虚拟仓位"，以完整的 Hedge Mode 映射与成交归因引擎，复刻并扩展 Binance 合约交易体验。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Status: WIP](https://img.shields.io/badge/Status-WIP-orange.svg)]()
[![Target: BTC/ETH](https://img.shields.io/badge/Instruments-BTCUSDT%20%7C%20ETHUSDT-blue.svg)]()

---

## 目录

- [项目概述](#项目概述)
- [核心概念](#核心概念)
- [架构总览](#架构总览)
- [功能特性](#功能特性)
- [技术栈（规划）](#技术栈规划)
- [项目结构（规划）](#项目结构规划)
- [前置条件](#前置条件)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [API 参考](#api-参考)
- [数据模型](#数据模型)
- [实时事件](#实时事件)
- [clientOrderId 规范](#clientorderid-规范)
- [对账与修复](#对账与修复)
- [开发指南](#开发指南)
- [路线图](#路线图)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

---

## 项目概述

Trading-HedgeStack 解决的核心问题：**Binance 合约 Hedge Mode 下，同一交易对的 Long/Short 只有两条真实持仓，但交易者往往同时持有多个不同逻辑的仓位（趋势单 / 波段单 / 对冲单）**，现有界面无法独立追踪每笔仓位的盈亏、TP/SL 与操作记录。

本项目通过**虚拟仓位（Virtual Position）+ 成交归因（Fill Attribution）**的方式，在不改变 Binance 底层结算逻辑的前提下，为每一个虚拟仓位提供：

- 独立的加权平均入场价（WAC）
- 独立的已实现 / 浮动 PnL
- 独立的 TP/SL 条件单绑定
- 独立的平仓/加仓操作面板

---

## 核心概念

### Virtual Position（虚拟仓位）

虚拟仓位是系统内部的账本单元，由 `(symbol, positionSide, name)` 三元组标识。多个虚拟仓位可以共享同一 Binance 真实持仓（同一 `symbol + positionSide`），系统通过 `clientOrderId` 编码追踪每笔成交归属于哪个虚拟仓位。

```
Binance 真实持仓（Hedge Mode）        系统虚拟仓位
─────────────────────────────        ──────────────────────────────
BTCUSDT LONG  qty=3.0    ←───────── VP "Long-Term"    qty=2.0
                                     VP "Mid-Term"     qty=1.0

BTCUSDT SHORT qty=1.5    ←───────── VP "Hedge-1"      qty=1.5
```

### WAC（加权平均成本）

加仓时更新均价，减仓时仅计算 PnL，均价不变：

```
加仓: avg_entry = (old_qty × old_avg + fill_qty × fill_price) / (old_qty + fill_qty)
减仓: realized_pnl += close_qty × (exit_price − avg_entry) × direction_sign
      direction_sign: LONG=+1, SHORT=−1
```

### Fill-Driven Accounting（成交驱动账本）

仓位状态的唯一真相来源是 **Binance 成交回报（fills）**，而非订单状态：

- `ORDER NEW` → 不改变仓位
- `PARTIALLY_FILLED` → 逐笔更新仓位
- `FILLED` → 仓位更新完毕

---

## 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (SPA)                            │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────────┐  │
│  │  下单面板     │  │  Positions    │  │  Orders / History   │  │
│  │  (VP 选择器) │  │  (虚拟仓位行) │  │  (Open/Filled)      │  │
│  └──────┬───────┘  └───────┬───────┘  └──────────┬──────────┘  │
│         └──────────────────┴─────────────────────┘             │
│                      REST + WebSocket                           │
└─────────────────────────────┬───────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────┐
│                       Backend Server                            │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  REST API   │  │  WS Gateway  │  │  Attribution Engine  │   │
│  │  /v1/...    │  │  (→ Browser) │  │  (Fill → VP 账本)    │   │
│  └─────────────┘  └──────────────┘  └──────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    State Store                          │   │
│  │  virtual_positions  │  order_map  │  reconcile_status   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Binance Connector                          │   │
│  │  REST (Order CRUD)  │  WS User Data Stream  │  Market   │   │
│  └──────────────────────────────┬──────────────────────────┘   │
└─────────────────────────────────┼───────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────┐
│               Binance USDT-M Futures (Hedge Mode)               │
│         BTCUSDT Long / BTCUSDT Short / ETHUSDT Long / ...       │
└─────────────────────────────────────────────────────────────────┘
```

**数据流向：**

```
用户操作 → REST POST → 后端构造 Binance 订单（编码 clientOrderId）
                      → Binance REST 下单
                        → Binance WS User Data Stream 推送 FILL
                          → Attribution Engine 解析 clientOrderId
                            → 更新 VP 账本（WAC / PnL / TP/SL 同步）
                              → 后端 WS 推送 VIRTUAL_POSITION_UPDATE
                                → 前端实时刷新
```

---

## 功能特性

### MVP 范围

| 模块 | 功能 | 状态 |
|------|------|------|
| 虚拟仓位管理 | 创建 / 删除虚拟仓位，绑定 symbol + positionSide | 规划中 |
| 开单 | Market / Limit，指定虚拟仓位 | 规划中 |
| 挂单管理 | Open Orders 列表，按虚拟仓位筛选，撤单，cancel+new 改单 | 规划中 |
| TP/SL | 每个虚拟仓位独立设置单档 TP + SL，默认 TP=LAST / SL=MARK，cancel+create 同步 | 规划中 |
| 仓位平仓 | 市价/限价，25/50/75/100% 或自定义数量，reduceOnly | 规划中 |
| PnL 归因 | 加权均价（WAC）、浮动 PnL（Mark Price）、已实现 PnL（Fill 归因） | 规划中 |
| 实时数据 | Binance WS 用户流 + 行情流，后端统一推送前端 | 规划中 |
| 对账 / 重建 | 外部持仓与 VP 总量对比、差额分配、UNASSIGNED 承接 | 规划中 |

### MVP 明确不做

- 修改杠杆 / 切换保证金模式（Cross/Isolated）
- 多档 TP/SL（仅单档）
- 止盈止损的"部分仓位"（仅全仓）
- 复杂止损策略（Trailing Stop 等）

---

## 技术栈（规划）

| 层级 | 候选方案 | 说明 |
|------|----------|------|
| 后端运行时 | Node.js (TypeScript) | 异步 I/O 适合 WS 高并发 |
| 后端框架 | Fastify / Express | REST API + WS 混合服务 |
| 前端框架 | React + TypeScript | SPA，组件化 |
| 状态管理 | Zustand / Redux Toolkit | 轻量实时状态 |
| 图表 | TradingView Lightweight Charts | K 线 / 深度图嵌入 |
| Binance SDK | binance-connector / 自封装 | REST + WS 用户流 |
| 持久化 | SQLite（开发）/ PostgreSQL（生产）| 虚拟仓位账本持久化 |
| 容器化 | Docker + docker-compose | 本地一键启动 |

> 技术栈在首次开发启动前可调整。

---

## 项目结构（规划）

```
Trading-HedgeStack/
├── packages/
│   ├── backend/                  # 后端服务
│   │   ├── src/
│   │   │   ├── api/              # REST 路由 (/v1/...)
│   │   │   ├── ws/               # WebSocket Gateway（推送前端）
│   │   │   ├── binance/          # Binance REST + WS 连接器
│   │   │   ├── engine/           # 核心引擎
│   │   │   │   ├── attribution/  # Fill 成交归因
│   │   │   │   ├── tpsl/         # TP/SL 生命周期管理
│   │   │   │   └── reconcile/    # 对账与重建
│   │   │   ├── store/            # 内存状态 + 持久化层
│   │   │   └── config/           # 环境变量 / 常量
│   │   ├── tests/
│   │   └── package.json
│   └── frontend/                 # 前端 SPA
│       ├── src/
│       │   ├── components/
│       │   │   ├── OrderPanel/   # 下单面板
│       │   │   ├── Positions/    # 虚拟仓位列表
│       │   │   ├── OpenOrders/   # 挂单管理
│       │   │   └── TpSlModal/    # TP/SL 设置弹窗
│       │   ├── store/            # 前端状态（Zustand 等）
│       │   ├── ws/               # 后端 WS 客户端
│       │   └── utils/
│       ├── public/
│       └── package.json
├── docs/                         # 详细设计文档
├── scripts/                      # 开发脚本
├── docker-compose.yml
├── MVP（定版）.md                 # 原始需求规格
├── README.md
└── LICENSE
```

---

## 前置条件

- **Binance 账户**：已开通 USDT-M 合约，且已开启 **Hedge Mode**（双向持仓）
- **API Key**：具有合约交易权限（`FUTURES` 权限）；建议仅开放 IP 白名单
- Node.js >= 18
- pnpm >= 8 (推荐) 或 npm >= 9
- Docker & docker-compose（可选，用于一键启动）

> **安全警告**：API Key 和 Secret 绝对不得提交到 Git 仓库。请使用 `.env` 文件，并已在 `.gitignore` 中排除。

---

## 快速开始

> ⚠️ 项目正在开发中，以下为规划阶段的启动流程，待代码框架初始化后更新。

### 1. 克隆仓库

```bash
git clone https://github.com/qCanoe/Trading-HedgeStack.git
cd Trading-HedgeStack
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入 Binance API Key / Secret
```

`.env` 必填项：

```dotenv
BINANCE_API_KEY=your_api_key
BINANCE_API_SECRET=your_api_secret
BINANCE_TESTNET=false          # true=测试网, false=正式网
PORT=3001                      # 后端端口
```

### 3. 安装依赖

```bash
pnpm install
```

### 4. 启动开发环境

```bash
# 同时启动后端 + 前端（开发模式）
pnpm dev
```

或使用 Docker：

```bash
docker-compose up
```

### 5. 访问

浏览器打开 `http://localhost:5173`（前端）；后端 API 运行于 `http://localhost:3001`。

---

## 配置说明

| 环境变量 | 必填 | 默认值 | 说明 |
|----------|------|--------|------|
| `BINANCE_API_KEY` | 是 | — | Binance API Key |
| `BINANCE_API_SECRET` | 是 | — | Binance API Secret |
| `BINANCE_TESTNET` | 否 | `false` | 是否使用测试网 |
| `SYMBOLS` | 否 | `BTCUSDT,ETHUSDT` | 监听的合约品种 |
| `PORT` | 否 | `3001` | 后端监听端口 |
| `DB_PATH` | 否 | `./data/db.sqlite` | SQLite 数据库路径 |
| `LOG_LEVEL` | 否 | `info` | 日志级别 |

---

## API 参考

所有接口均以 `/v1` 为前缀，返回 JSON，错误时返回标准结构：

```json
{ "error": "ERROR_CODE", "message": "human-readable description" }
```

### 状态查询

#### `GET /v1/state`

返回完整快照：外部真实持仓、所有虚拟仓位、挂单、最近成交、TP/SL 状态、对账状态。

**Response（示例）：**

```json
{
  "external_positions": [
    { "symbol": "BTCUSDT", "positionSide": "LONG", "qty": "3.000", "avgEntryPrice": "95000.00", "unrealizedPnl": "450.00" }
  ],
  "virtual_positions": [
    {
      "id": "vp_abc123",
      "name": "Long-Term",
      "symbol": "BTCUSDT",
      "positionSide": "LONG",
      "net_qty": "2.000",
      "avg_entry": "94500.00",
      "unrealized_pnl": "310.00",
      "realized_pnl": "120.50",
      "tpsl": {
        "tp_price": "100000.00",
        "tp_trigger_type": "LAST_PRICE",
        "sl_price": "90000.00",
        "sl_trigger_type": "MARK_PRICE",
        "tp_order_id": "1234567",
        "sl_order_id": "1234568",
        "sync_status": "OK"
      }
    }
  ],
  "open_orders": [],
  "reconcile": { "BTCUSDT": { "LONG": "OK", "SHORT": "OK" }, "ETHUSDT": { "LONG": "OK", "SHORT": "OK" } }
}
```

---

### 虚拟仓位管理

#### `POST /v1/virtual-positions`

创建虚拟仓位。

```json
// Request
{ "name": "Long-Term", "symbol": "BTCUSDT", "positionSide": "LONG" }

// Response
{ "id": "vp_abc123", "name": "Long-Term", "symbol": "BTCUSDT", "positionSide": "LONG", "net_qty": "0", "avg_entry": "0" }
```

---

### 下单

#### `POST /v1/orders`

向指定虚拟仓位下单。

```json
// Request
{
  "virtual_position_id": "vp_abc123",
  "symbol": "BTCUSDT",
  "positionSide": "LONG",
  "side": "BUY",
  "type": "LIMIT",
  "qty": "0.1",
  "price": "94000.00",
  "timeInForce": "GTC"
}

// Response
{ "orderId": "987654321", "clientOrderId": "VP-abc123-1708700000-001", "status": "NEW" }
```

**字段说明：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `virtual_position_id` | string | 是 | 归属的虚拟仓位 ID |
| `symbol` | string | 是 | `BTCUSDT` \| `ETHUSDT` |
| `positionSide` | string | 是 | `LONG` \| `SHORT` |
| `side` | string | 是 | `BUY` \| `SELL` |
| `type` | string | 是 | `MARKET` \| `LIMIT` \| `STOP_MARKET` \| `STOP` |
| `qty` | string | 是 | 合约张数（字符串保精度） |
| `price` | string | Limit 时必填 | 限价价格 |
| `reduceOnly` | boolean | 否 | 默认 `false` |
| `timeInForce` | string | Limit 时必填 | `GTC` \| `IOC` \| `FOK` |

---

#### `POST /v1/orders/:orderId/cancel`

撤销挂单。

```json
// Response
{ "orderId": "987654321", "status": "CANCELED" }
```

---

### 平仓

#### `POST /v1/virtual-positions/:id/close`

对指定虚拟仓位执行平仓（自动加 `reduceOnly=true`）。

```json
// Request（全仓市价平）
{ "type": "MARKET" }

// Request（50% 限价平）
{ "type": "LIMIT", "percent": 50, "price": "96000.00" }

// Request（指定数量）
{ "type": "MARKET", "qty": "0.5" }
```

---

### TP/SL 管理

#### `POST /v1/virtual-positions/:id/tpsl`

设置或更新虚拟仓位的止盈止损。后端采用 cancel+create 方式原子更新。

```json
// Request
{
  "tp_price": "100000.00",
  "tp_trigger_type": "LAST_PRICE",
  "sl_price": "90000.00",
  "sl_trigger_type": "MARK_PRICE"
}
// qty 可选，默认为虚拟仓位当前 net_qty（全仓）
```

设置后 `tpsl.sync_status` 会经历 `SYNCING → OK` 状态，前端需监听 `TPSL_SYNC_STATUS` 事件。

---

### 对账与重建

#### `POST /v1/reconcile`

将外部真实持仓数量重新分配给各虚拟仓位（修复手动操作导致的归因断链）。

```json
// Request
{
  "symbol": "BTCUSDT",
  "positionSide": "LONG",
  "assignments": [
    { "virtual_position_id": "vp_abc123", "qty": "2.0" },
    { "virtual_position_id": "vp_def456", "qty": "0.8" }
  ]
}
// 如果 assignments 总和 < 外部 qty，差额自动归入 UNASSIGNED 虚拟仓位
```

---

## 数据模型

### VirtualPosition

```typescript
interface VirtualPosition {
  id: string;                    // 系统生成，形如 vp_xxxxxxxx
  name: string;                  // 用户自定义名称
  symbol: 'BTCUSDT' | 'ETHUSDT';
  positionSide: 'LONG' | 'SHORT';
  net_qty: string;               // 当前持仓量（正数）
  avg_entry: string;             // 加权平均入场价
  realized_pnl: string;         // 累计已实现 PnL（USDT）
  tpsl: TpSlConfig | null;
  created_at: number;           // Unix timestamp (ms)
}

interface TpSlConfig {
  tp_price: string | null;
  tp_trigger_type: 'LAST_PRICE' | 'MARK_PRICE';
  tp_order_id: string | null;   // Binance 订单 ID
  sl_price: string | null;
  sl_trigger_type: 'LAST_PRICE' | 'MARK_PRICE';
  sl_order_id: string | null;
  sync_status: 'OK' | 'SYNCING' | 'ERROR';
}
```

### OrderRecord

```typescript
interface OrderRecord {
  orderId: string;               // Binance 订单 ID
  clientOrderId: string;        // VP-{vpShortId}-{ts}-{nonce}
  virtual_position_id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  positionSide: 'LONG' | 'SHORT';
  type: string;
  qty: string;
  price: string | null;
  status: string;               // Binance 订单状态
  reduceOnly: boolean;
  created_at: number;
}
```

---

## 实时事件

后端通过 WebSocket 向前端推送以下事件（统一格式）：

```typescript
interface WsEvent {
  type: EventType;
  payload: unknown;
  ts: number;   // 服务器 Unix timestamp (ms)
}
```

| 事件类型 | 触发时机 | Payload |
|----------|----------|---------|
| `ORDER_UPSERT` | 订单状态变化 | `OrderRecord` |
| `FILL` | 成交回报 | `FillRecord` |
| `VIRTUAL_POSITION_UPDATE` | VP 账本变更（加仓/减仓/PnL 更新） | `VirtualPosition` |
| `EXTERNAL_POSITION_UPDATE` | Binance 真实持仓变更 | `ExternalPosition` |
| `TPSL_SYNC_STATUS` | TP/SL 同步状态变更 | `{ vp_id, status, tp_order_id?, sl_order_id? }` |
| `CONSISTENCY_STATUS` | 对账状态更新 | `{ symbol, positionSide, status: 'OK' \| 'MISMATCH' }` |
| `WS_RECONNECT` | Binance WS 重连通知 | `{ reason }` |

前端收到 `CONSISTENCY_STATUS: MISMATCH` 时应**高亮显示并禁用**相关虚拟仓位的减仓与 TP/SL 设置操作，直到对账完成。

---

## clientOrderId 规范

所有由本系统发出的订单，`clientOrderId` 遵循以下格式：

```
VP-{vpShortId}-{ts}-{nonce}

示例: VP-abc123-1708700123456-001
```

| 段 | 说明 |
|----|------|
| `VP-` | 固定前缀，标识来自本系统 |
| `{vpShortId}` | 虚拟仓位 ID 的前 6 字符 |
| `{ts}` | 下单时 Unix timestamp (ms) |
| `{nonce}` | 3 位序号，防止同毫秒冲突 |

后端维护映射表 `clientOrderId → virtual_position_id`，当 Binance WS 推送成交回报时，通过解析 `clientOrderId` 立即完成成交归因。

---

## 对账与修复

**触发条件：** 以下操作会导致 VP 账本与 Binance 真实持仓不一致：

- 在 Binance App / 其他客户端手动下单或平仓
- 系统 WS 断线期间发生的成交
- TP/SL 被触发但 WS 事件丢失

**修复流程：**

1. 系统检测到 `external_qty ≠ sum(VP.net_qty)` → 触发 `CONSISTENCY_STATUS: MISMATCH`
2. 用户在"对账"面板看到：外部 qty、各 VP qty、差额
3. 用户通过拖动/输入将外部 qty 分配给各 VP
4. `POST /v1/reconcile` 提交分配方案
5. 系统将分配结果写入账本，差额进入 `UNASSIGNED` VP
6. `avg_entry` 以当前外部 entry price 初始化，PnL 从此刻重计，标记"已重置"

---

## 开发指南

### 本地开发启动（规划）

```bash
# 安装依赖
pnpm install

# 后端（监视模式）
pnpm --filter backend dev

# 前端（Vite 开发服务器）
pnpm --filter frontend dev
```

### 代码规范

- TypeScript strict mode
- ESLint + Prettier（配置见 `.eslintrc` / `.prettierrc`）
- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)

### 测试策略

| 层级 | 工具 | 覆盖重点 |
|------|------|----------|
| 单元测试 | Vitest | WAC 计算逻辑、归因引擎、clientOrderId 解析 |
| 集成测试 | Vitest + 模拟 WS | Fill 事件 → VP 账本更新链路 |
| E2E 测试 | Playwright | 核心下单 / 平仓 / TP/SL 操作流程 |

```bash
pnpm test          # 运行所有测试
pnpm test:unit     # 仅单元测试
pnpm test:e2e      # E2E（需启动服务）
```

### 环境隔离

- 开发阶段优先使用 **Binance 测试网**（Testnet）验证逻辑
- 设置 `BINANCE_TESTNET=true`，测试网 Base URL 不同，请参考 [Binance Testnet 文档](https://testnet.binancefuture.com)

---

## 路线图

### v0.1 — 骨架与核心引擎

- [ ] 项目工程化初始化（monorepo / 构建 / lint / CI）
- [ ] Binance 连接器（REST + WS 用户流 + 行情流）
- [ ] VP 数据结构与 WAC 引擎
- [ ] `clientOrderId` 编码与成交归因
- [ ] 基础 REST API（`/v1/state` / `/v1/orders` / `/v1/virtual-positions`）

### v0.2 — 完整 MVP 功能

- [ ] TP/SL 生命周期管理（cancel+create 同步）
- [ ] 平仓操作（市价/限价/比例）
- [ ] 对账与重建逻辑
- [ ] 前端 SPA 初版（下单面板 + Positions + Open Orders）
- [ ] 后端 → 前端 WS 推送全事件

### v0.3 — 体验打磨

- [ ] 前端实时响应（< 150ms 本地感知）
- [ ] WS 断线重连与"同步中"状态指示
- [ ] TradingView 图表嵌入
- [ ] Order History / Trade History 视图
- [ ] Docker 一键部署

### 后续（v1.0+）

- [ ] 多档 TP/SL
- [ ] 部分仓位 TP/SL 数量设置
- [ ] 更多合约品种支持
- [ ] 移动端适配

---

## 参与贡献

本项目目前处于早期开发阶段，暂不接受外部 PR。如有建议或 Bug 报告，欢迎提交 [Issue](https://github.com/qCanoe/Trading-HedgeStack/issues)。

---

## 许可证

[MIT](./LICENSE) © 2026 CaNoe
