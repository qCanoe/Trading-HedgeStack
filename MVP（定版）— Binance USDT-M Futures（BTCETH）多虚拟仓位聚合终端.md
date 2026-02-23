## MVP（定版）— Binance USDT-M Futures（BTC/ETH）多虚拟仓位聚合终端

### 0. 目标一句话

在 Web 端复刻 Binance 合约下单/挂单/TP-SL/平仓/挂单管理的操作体验，并新增一个能力：**在同一交易对上维护多个“虚拟仓位”（子仓位）并聚合在一个界面管理**。底层使用 Binance Futures Hedge Mode（多空可同时存在），虚拟仓位用**成交归因**实现。

------

## 1. 产品行为与交互对齐 Binance 的原则

### 1.1 “像 Binance 一样”的定义

MVP 追求的是：你在这个系统里对 BTC/ETH 做的操作，其结果与在 Binance 合约界面做同类操作一致（下单类型、订单状态、TP/SL 行为、部分平仓、撤单/改单、仓位方向与保证金模式），并且 UI 的信息结构（Positions / Open Orders / Order History）尽量一致。

### 1.2 唯一新增：Virtual Positions（虚拟仓位）

你会在 Positions 列表里看到多行，例如：

- BTCUSDT — Long — “Long-Term”
- BTCUSDT — Long — “Mid-Term”
- BTCUSDT — Short — “Hedge-1”
   这些都是系统内部的虚拟仓位卡片，显示与 Binance 仓位行类似的字段（qty/entry/uPnL/rPnL/TP/SL/平仓按钮），并且都能独立设置 TP/SL 与平仓。

> 关键：Binance 真实持仓在 Hedge Mode 下只有两条（Long/Short），而你系统可以有很多条虚拟仓位。你系统负责把这些虚拟仓位的动作映射成 Binance 的真实订单，并用成交回报把账本拆清楚。

------

## 2. 核心规则：Hedge Mode 下的仓位/订单映射

### 2.1 账户前置设置（必须）

- Binance Futures：USDT-M
- Position Mode：Hedge Mode（同一合约可同时 Long/Short）
- 对于 BTC/ETH：建议固定保证金模式（Cross/Isolated）与杠杆（leverage）在 Binance 侧由你设置；MVP 可以只读取展示，不在系统里修改（第一版先别做“改杠杆/切保证金模式”，减少踩坑）。

### 2.2 每笔订单必须带两个维度

- `virtual_position_id`：你要归属到哪个虚拟仓位
- `position_side`：LONG 或 SHORT（Hedge 模式需要）
   系统会把它编码到 `clientOrderId`，保证订单/成交可追溯归因。

### 2.3 仓位账本的真相来源

- **唯一真相是 fills（成交回报）**
   订单 NEW 不改变仓位；PARTIALLY_FILLED 逐笔改变；FILLED 改变完毕。

------

## 3. 四大操作（与 Binance 对齐的定版行为）

### 3.1 开单与挂单（Market/Limit）

支持：

- Market
- Limit
- 可选：Stop Market / Stop Limit（用于开仓条件单，MVP 可做；若不做，先保证 TP/SL 条件单做完）

下单必填：

- symbol ∈ {BTCUSDT, ETHUSDT}
- side: BUY/SELL
- positionSide: LONG/SHORT
- quantity（按合约数量）
- type：MARKET/LIMIT/…
- price（限价时）
- virtual_position_id

行为对齐：

- 订单在 Open Orders/History 的状态与 Binance 一致
- 同价同向多笔订单在你的界面里永远不合并（按订单粒度展示）

### 3.2 止盈止损（TP/SL）— 你要求的默认规则

每个虚拟仓位可以设置独立 TP 与 SL（MVP 先做单档 TP + 单档 SL）。

触发价类型（仿 Binance）：

- `triggerPriceType` ∈ {LAST_PRICE, MARK_PRICE}
   并且你给出的默认策略是：
- **TP 默认 LAST_PRICE**
- **SL 默认 MARK_PRICE**
   用户仍可在 UI 手动切换（像 Binance 的下拉）。

实现方式（关键）：
 对每个虚拟仓位的 TP/SL，都在 Binance 下 **reduceOnly 的条件单**，且 positionSide 必须匹配该虚拟仓位方向。
 当虚拟仓位数量变化时（加仓/减仓），系统需要更新 TP/SL 单的 quantity，以保持与该虚拟仓位绑定一致。MVP 采用最稳的方式：**取消旧 TP/SL 单并重建新单**（cancel+create），并在 UI 上保持“正在同步 TP/SL”状态，直到新单确认。

TP/SL 的数量规则（仿 Binance 的“部分仓位”）：

- 默认 quantity = 当前虚拟仓位的绝对数量（全仓 TP/SL）
- 允许你设置部分数量（例如只给该虚拟仓位的 50% 设置 TP），MVP 可以先做“全仓”，后续再加“部分”。

> 这块做到位，你的“每个单有自己的思路”就能真正落地：每个虚拟仓位都有独立 TP/SL，而不是整个真实 Long 仓位共用一套。

### 3.3 仓位平仓管理（部分/全部）

在每个虚拟仓位卡片上提供：

- 市价平仓（默认）
- 限价平仓（可选）
- 平仓比例按钮（25/50/75/100%）+ 自定义数量

映射：

- 平仓永远走 reduceOnly（避免误开反向）
- positionSide 保持与该虚拟仓位一致，side 为反向（平多=SELL，平空=BUY）

P&L 归因：

- 平仓产生的 realized PnL 归到该虚拟仓位
- 手续费归到该虚拟仓位（按 fill 直接归因，最直观）

### 3.4 挂单管理（撤单/改单）

- Open Orders：显示 BTC/ETH 全部挂单（像 Binance）
- 增加一个筛选：All / 按虚拟仓位筛选
- 撤单：直接 cancel order
- 改单：MVP 采用 cancel+new（更稳），并保留“改单”动作在 UI 上像 Binance（本质两步）

------

## 4. “虚拟仓位”的数据结构与计算（MVP 采用 WAC）

每个 `virtual_position` 针对 `(symbol, positionSide)` 有：

- `net_qty`（>0 表示该方向的仓位量；对 SHORT 也用正数存量更直观）
- `avg_entry`（加权平均入场）
- `realized_pnl`（累计已实现）
- `unrealized_pnl`（基于 mark/last 计算，展示时可选一致用 Mark）
- `tpsl` 配置：tp_price、tp_trigger_type、sl_price、sl_trigger_type、以及对应 Binance 订单 id

WAC 更新规则：

- 加仓：`avg_entry = (old_qty*old_avg + fill_qty*fill_price) / (old_qty + fill_qty)`
- 减仓：`realized += close_qty * (exit_price - avg_entry) * direction_sign`
   其中 direction_sign：LONG 为 +1；SHORT 为 -1（这样空仓盈利时 realized 为正）。

------

## 5. 实时系统：事件流、延迟目标与对账

### 5.1 延迟目标（体感丝滑）

- 交互响应（按钮点击到 UI 有 pending）：< 150ms（本地）
- 订单状态回报显示：通常 200ms~1.5s（网络+交易所）
- 发生 WS 断线：UI 立即显示“同步中”，重连后 3 秒内恢复

### 5.2 后端必须常连两类流

- Binance 用户数据流（订单/成交/仓位更新）
- 行情流（至少 BTC/ETH 的 last price、mark price）

前端只连你后端一个 WebSocket，由后端推统一事件：

- `ORDER_UPSERT`
- `FILL`
- `VIRTUAL_POSITION_UPDATE`
- `EXTERNAL_POSITION_UPDATE`
- `TPSL_SYNC_STATUS`
- `CONSISTENCY_STATUS`

### 5.3 一致性对账（Hedge 模式下对账更重要）

对账对象是每个 symbol 的 LONG 与 SHORT 两个外部仓位：

- `external_long_qty` 应该等于 `sum(virtual_positions where positionSide=LONG).net_qty`
- `external_short_qty` 同理
   如果不一致，系统标红，并阻止“按虚拟仓位减仓/设置 TP/SL”等关键动作，提示你使用“重建”。

------

## 6. “重建/修复”（MVP 必须有，不然你一手动就崩）

你只要在 Binance App 上手动操作一次，就可能让归因链断掉。MVP 的修复流程要非常快：

对 BTC 或 ETH，分别对 LONG/SHORT 做：

1. 系统展示外部仓位 qty
2. 展示当前系统内各虚拟仓位 qty 之和
3. 允许你把外部 qty 以拖动/输入方式分配给各虚拟仓位（必要时创建一个 “UNASSIGNED” 虚拟仓位承接差额）
4. 分配后系统将这些虚拟仓位的 avg_entry 以“当前外部 entry 或当前价格”初始化（MVP 可用外部 entry；拿不到就用 mark/last 近似），PnL 从此刻重新开始统计（或标记为“PnL 已重置”）

这能保证系统永远可恢复可用，而不会因为一次手动操作报废。

------

## 7. MVP API（定稿版）与 clientOrderId 规范

### 7.1 REST（前端 → 后端）

- `POST /v1/virtual-positions`：创建（name, symbol, positionSide）
- `GET /v1/state`：返回 BTC/ETH 外部仓位、虚拟仓位、open orders、recent fills、tpsl 状态、对账状态
- `POST /v1/orders`：下单（virtual_position_id, symbol, positionSide, side, type, qty, price?, reduceOnly?, timeInForce?）
- `POST /v1/orders/:id/cancel`
- `POST /v1/virtual-positions/:id/close`：平仓（qty 或 percent，默认 market reduceOnly）
- `POST /v1/virtual-positions/:id/tpsl`：设置 TP/SL（tp_price, tp_trigger_type, sl_price, sl_trigger_type, qty? 默认全仓）
- `POST /v1/reconcile`：重建（symbol, positionSide, assignments[]）

### 7.2 clientOrderId 编码（保证归因）

格式建议（短、可读、可追踪）：
 `VP-{vpShortId}-{ts}-{nonce}`
 并在后端保存一张映射表：clientOrderId → virtual_position_id。这样 Binance 回报过来就能归因。

------

## 8. UI（完全仿 Binance 的 MVP 页面结构）

单页即可：

- 上方：K线 + 深度 + 最近成交（可以先嵌 TradingView 图表；MVP 不做复杂绘图）
- 左侧/中间：下单面板（Market/Limit，方向，数量，价格），新增一个“虚拟仓位选择器”（默认记忆）
- 下方 Tabs（仿 Binance）：
  - Positions：按 symbol + positionSide 分组，列表里展示多个虚拟仓位行（每行都有 TP/SL、平仓、PnL）
  - Open Orders：全局列表 + 虚拟仓位筛选
  - Order History / Trade History：仿 Binance 的时间线（可先做简版）