# SharePaste 当前方案设计梳理与汇报（2026-03-09）

## 1. 文档目的与范围
- 目的：基于现有设计文档与当前代码实现，给出 SharePaste v0.1 内测阶段的“当前方案全景”和“落地状态”。
- 范围：`server`、`client`、`macos`、`proto`、`docs/pre-dev`、`docs/ops`。
- 基线时间：
  - 设计文档基线：2026-03-07
  - 本次梳理时间：2026-03-09

## 2. 输入材料
- 产品与技术基线：
  - `docs/pre-dev/PRD-v0.1-internal-pilot.md`
  - `docs/pre-dev/TECH-DESIGN-v0.1.md`
  - `docs/pre-dev/EXECUTION-WBS-v0.1.md`
  - `docs/pre-dev/SECOPS-BASELINE-v0.1.md`
  - `docs/pre-dev/TEST-RELEASE-PLAN-v0.1.md`
- 运维与发布：
  - `docs/ops/monitoring-baseline.md`
  - `docs/ops/incident-runbook.md`
  - `docs/ops/release-checklist.md`
- 当前实现：
  - `proto/sharepaste.proto`
  - `server/src/**`
  - `client/src/**`
  - `macos/Sources/main.swift`

## 3. 当前方案总览
SharePaste 当前采用“协议先行 + 服务端中继 + 客户端加密封装 + 桌面壳层”的三层方案：
- 协议层：统一使用 gRPC + `proto/sharepaste.proto`。
- 服务层：`DeviceService`、`PairingService`、`PolicyService`、`SyncService` 四类服务。
- 客户端层：CLI/Core 负责设备身份、策略校验、加密封装、同步引擎。
- 桌面层：macOS SwiftUI 原生实现，调用本地命令桥，底层复用 CLI 能力。

方案目标与 PRD 保持一致：覆盖注册、绑定、同步、撤销、恢复五条核心旅程，定位内测而非生产级 SLA。

## 4. 架构设计（按组件）
### 4.1 Server（`server`）
- 启动模式：
  - `memory`：纯内存 `SharePasteStore`
  - `durable`：`DurableSharePasteStore` + Postgres 持久化 + Redis 运行时信号
- 主要职责：
  - 设备注册/恢复、设备管理
  - 绑定码流程（60s TTL、5 次尝试）
  - 组策略读写（乐观并发版本）
  - 同步消息分发、离线队列、ACK 清理
- 关键约束：
  - 每组最多 10 台活跃设备
  - 离线保留 24h
  - 去重窗口上限 1000 项

### 4.2 Client Core + CLI（`client`）
- Core 模块：
  - `SharePasteClient`：统一业务入口
  - `SyncEngine`：去重/回环抑制、item_id 生成
  - `CryptoAgent`：本地密钥、AES-GCM 封装
  - `StateStore`：本地状态落盘（默认 `~/.sharepaste/state.json`）
  - `ClipboardWatcher`：当前仅文本监听
- CLI 提供完整管理与调试能力：`init/devices/bind-code/bind-request/bind-confirm/policy/run/send-*`
- 实时能力：
  - 先 `fetchOffline` 再开启事件流
  - 断线后 2s 重连循环

### 4.3 Desktop（`macos`）
- 前端：SwiftUI 管理连接、设备、策略、绑定、发送等操作。
- 命令桥：通过 `npm run -w client dev -- ...` 调 CLI 子命令，`start_sync` 以子进程方式托管。
- 当前定位：功能壳层，复用核心能力，便于快速覆盖桌面路径。

## 5. 关键流程设计（现状）
### 5.1 注册与恢复
- 注册：新设备创建匿名组并返回 `recoveryPhrase`。
- 恢复：通过 `recoveryPhrase` 找组并重建设备身份。

### 5.2 绑定
- A 创建设备码，B 请求绑定，A 确认。
- 批准后 B 迁移到 A 的组，组密钥版本递增。

### 5.3 在线/离线同步
- 发送端推送密文条目。
- 在线设备走事件流实时下发。
- 离线设备进入队列，重连后拉取并 ACK 删除。
- 同步引擎对回环与重复 item 做抑制。

### 5.4 撤销
- 同组设备可移除目标设备。
- 被移除设备会被标记为不可用并失去后续组操作权限。

## 6. 数据与存储方案（目标 vs 当前）
### 6.1 已落地
- Postgres：
  - `sharepaste_state`（整库快照 JSON）
  - `sharepaste_audit_logs`（审计）
- Redis：
  - `presence` 心跳
  - `ratelimit` 计数

### 6.2 与 TECH-DESIGN v0.1 的差异
`TECH-DESIGN-v0.1` 目标是分领域表（groups/devices/policies/bind/offline/audit）+ Redis 承载短期绑定状态。当前实现仍是“快照持久化”模式，差异如下：
- 差异 1：尚未落地领域化关系模型（目前为单 JSON 快照）。
- 差异 2：绑定状态仍由内存域模型承载，非 Redis 主导。
- 差异 3：审计目前记录成功路径为主，失败路径与字段完备度有待增强。

结论：已实现“可持久化”和“可恢复”，但数据层尚未达到技术设计文档定义的最终形态。

## 7. 安全方案现状
### 7.1 已具备
- 客户端本地生成身份密钥。
- 传输内容以 `ciphertext + nonce` 形式流转，服务端按密文转发。
- 设备撤销、组权限、策略限制等基础访问控制生效。

### 7.2 主要缺口
- `sealed_group_key` 目前在服务端实现为 base64 包装 JSON（含 `groupKeyBase64`），并非真正按设备公钥加密封装。
- 客户端虽有 `seal/unseal` 能力实现，但当前主流程未形成端到端密钥封装闭环。

结论：当前更接近“加密传输结构 + 访问控制”阶段，尚未完全达到文档中“每设备密钥密封分发”的安全目标。

## 8. 运行与发布方案现状
- 已有基线文档：监控指标、告警阈值、事故处理、发布检查、回滚步骤均已定义。
- 当前代码层仍偏“工程骨架”：
  - 有存储与运行时组件，但结构化日志字段、链路关联 ID 注入、可观测性埋点尚未系统落地。

## 9. 测试与质量现状
### 9.1 已覆盖
- Server 单测：绑定过期/冲突、策略冲突、离线 TTL、文件策略限制等。
- Durable 单测：持久化恢复路径。
- Integration（条件运行）：Postgres/Redis 连通和行为验证。
- Client 单测：加密往返、去重回环、历史上限。

### 9.2 缺口
- Desktop 暂无单元测试。
- PRD 里的端到端桌面旅程（尤其图像/文件双向路径）尚未形成自动化 E2E。

## 10. 与 PRD/计划的对齐评估
- 已对齐：
  - 匿名组 + 恢复短语
  - 6 位绑定码 + TTL + 次数限制
  - 设备管理、策略版本检查
  - 同步、离线队列、ACK
- 部分对齐：
  - Durable 形态已启用，但与目标数据模型仍有差距
  - 安全密钥分发有能力储备，但主链路未闭环
  - 运维指标有文档基线，落地观测仍需补齐
- 未充分对齐：
  - 桌面 E2E 自动化覆盖
  - NFR 指标验证闭环（如延迟/重连 SLA 的自动门禁）

## 11. 当前主要风险
- R1 数据层演进风险：从快照模型迁移到分表模型时，行为兼容与回放迁移复杂度较高。
- R2 安全落差风险：`sealed_group_key` 未真实密封，存在与安全基线文档不一致的实现偏差。
- R3 可观测性风险：缺少统一结构化日志与关联 ID，故障定位与归因效率受限。
- R4 客户端能力边界：自动监听目前主要为文本，图片/文件更多依赖主动发送，不利于“无感剪贴板”体验验证。

## 12. 建议的下一步（按优先级）
1. 完成密钥分发闭环（高优先级）
- 让服务端返回真正密封后的组密钥，客户端使用私钥解封，移除明文式封装。

2. 将 durable 从“快照表”演进到“领域表”（高优先级）
- 分阶段引入 groups/devices/policies/bind/offline/audit 表，保留兼容迁移脚本。

3. 补齐失败审计与结构化日志（高优先级）
- 覆盖成功/失败全路径，并统一 request_id/device_id/group_id 字段。

4. 建立桌面 E2E 回归（中优先级）
- 覆盖 PRD 五条核心旅程，纳入发布门禁。

5. 验证并固化 NFR 门禁（中优先级）
- 把延迟、重连时延、错误率阈值接入 CI/发布检查。

## 13. 结论
截至 2026-03-09，SharePaste 已具备可运行的 v0.1 内测骨架，核心业务流程基本可走通。当前最关键的问题不在“有没有功能”，而在“持久化形态、安全闭环、可观测性与 E2E 门禁”四个方向的工程收敛。
