# AI Chat 阶段 2 补齐方案

> 状态：阶段性补齐方案
> 基于分支：`dev`
> 日期：2026-09-02
> 依据：`docs-wang/ai-chat-technical-design.md`、`docs-wang/AI-Agent对话式助手-设计讨论.md` 与当前代码核查结果

## 1. 目标

阶段 2 不再按原清单一次性补完，而是拆成可验收、可回滚的小批次。优先补用户能明显感知的入口和已具备基础设施的能力，再补安全边界更重的工具，最后处理架构级体验增强。

核心原则：

- 先补体验闭环，再补工具广度。
- 普通用户可用能力必须优先保证权限边界。
- 管理员诊断工具保持 admin-only，默认关闭或沿用现有工具开关。
- 不把真流式、异步转写这类高影响改动混入低风险入口修复。

## 2. 当前核查结论

### 2.1 已完成或基本完成

| 项目 | 状态 | 说明 |
|---|---|---|
| AI Chat 独立路由 `/ai-chat` | 已完成 | 已有路由、顶部导航入口、会话侧栏。 |
| 会话持久化 | 已完成 | `conversation` / `conversation_message` 三类数据库实现与 migration 已存在。 |
| 工具调用框架 | 已完成 | `internal/ai/assistant` + `internal/ai/tools` 已有 ToolLoop 和注册表。 |
| 写操作确认卡片 | 已完成 | 前端确认卡 + 后端 approved/rejected 续跑已存在。 |
| 日志落盘 + `get_logs` | 已完成 | `cmd/memos/log.go` 写 `data/logs/memos-YYYY-MM-DD.log`，`get_logs` 读取并脱敏。 |
| `query_db` 只读 | 已完成 | admin-only，结构化参数，白名单字段，参数化查询。 |
| `query_db` 写模式 | 已完成阶段 3 的一部分 | 支持 insert/update/delete，写操作需确认，update/delete 需要 `yes` 确认词。 |
| 共享记忆 | 已完成阶段 3 的一部分 | `manage_memory` 与 Settings 共享记忆配置已存在。 |

### 2.2 部分完成

| 项目 | 状态 | 缺口 |
|---|---|---|
| 多预设 Agent | 部分完成 | proto、后端 `agent_id`、Settings 配置已存在；`/ai-chat` 页面没有选择器。 |
| 成本控制 | 部分完成 | 单次工具循环 8 轮已存在；未看到每用户每小时限流、会话 50 轮上限、历史截断 50 条的完整实现。 |

### 2.3 未完成

| 项目 | 状态 | 说明 |
|---|---|---|
| memo 菜单"问 AI" | 未完成 | `MemoActionMenu` 只有 AI 自动打标签，没有跳转 `/ai-chat?memo=xxx`。 |
| `/ai-chat?memo=xxx` 上下文条 | 未完成 | `AIChat.tsx` 只读取 `conversation` 参数，没有读取 `memo` 参数。 |
| `query_my_data` | 未完成 | 当前没有普通用户行级只读通用查询工具。 |
| `query_queue` | 未完成 | 当前没有专门队列诊断工具。 |
| `project_status` | 未完成 | 当前没有专门项目状态工具。 |
| `transcribe_memo_audio` | 未完成 | 已有独立 `AIService.Transcribe`，但没有对话工具形态。 |
| Chat 真流式文本增量 | 未完成 | 当前 `SendMessage` 是 unary RPC，不是 server-streaming。 |
| 分享状态可视化 | 未完成 | 未看到对应页面、工具或导出能力。 |

## 3. 分阶段补齐建议

### 阶段 2A：补齐 memo 场景入口

目标：让用户可以从任意 memo 操作菜单进入 AI Chat，并围绕该 memo 提问。

范围：

- `MemoActionMenu` 新增菜单项："问 AI"。
- 点击后跳转 `/ai-chat?memo=<memo-name-or-uid>`。
- `/ai-chat` 读取 `memo` 参数，调用现有 memo 查询能力加载内容。
- 顶部展示上下文条：正在讨论这条 memo，可关闭。
- 发送消息时把 memo 摘要作为隐藏上下文带给后端，避免用户需要手动复制 memo 内容。

推荐实现方式：

- 前端先用现有 `memoDetailQueryOptions` 校验并获取 memo。
- 发送时在用户问题前拼接一段受控上下文，例如：

```text
以下是当前用户选择的 memo 上下文，请用于回答本轮问题。不要假设用户授权你访问其他 memo。
memo: <uid>
content:
<截断后的内容>

用户问题：
<用户输入>
```

- 长内容前端先截断到固定长度，例如 4,000 字符；后续如需要更精确，再让模型调用 `get_memo`。
- 不新增后端 API，不改数据库。

影响面：

- 前端中等偏小：`MemoActionMenu.tsx`、`AIChat.tsx`、少量 i18n。
- 后端无改动。
- 安全风险低：memo 内容仍由现有查询权限控制。

验收标准：

- 在 memo 菜单能看到"问 AI"。
- 点击后进入 `/ai-chat?memo=...`，页面显示上下文条。
- 对该 memo 提问时，AI 能理解当前 memo 内容。
- 没有权限的 memo 不显示内容，并提示不可访问或已删除。
- 移动端菜单、跳转、输入框布局正常。

### 阶段 2B：补齐多预设选择器

目标：当 admin 配置了 2 个及以上启用的 Chat Agent 时，用户可在新建会话时选择预设。

范围：

- `/ai-chat` 页面读取 `instance.aiSetting.chatAgents`。
- 启用预设数量大于 1 时显示选择器。
- 新建会话时带上 `agentId`。
- 已有会话继续使用自身 `agent_id`；空 `agent_id` 走默认启用预设。

推荐实现方式：

- 选择器只影响"新建会话"，不在已有会话中随意切换 agent。
- 会话侧栏可显示预设名，方便区分不同人格。
- 没有启用预设时沿用当前空态。

影响面：

- 前端中等：`AIChat.tsx`、`AppSidebar` 的新建会话入口、i18n。
- 后端较小：已有 `CreateConversation.agent_id` 与 `resolveChatProvider(agentID)`。
- 兼容风险低：旧会话 `agent_id` 为空时继续走默认。

验收标准：

- 只有一个启用预设时不显示选择器。
- 两个及以上启用预设时显示选择器。
- 选择不同预设新建会话，后端使用对应 system prompt。
- 旧会话行为不变。

### 阶段 2C：补齐只读诊断工具

目标：补齐 `query_queue`、`project_status`，服务管理侧排障；补齐 `query_my_data`，服务普通用户自助查询。

#### `query_queue`

范围：

- admin-only。
- 查询 `agent_reply_task`、`memo_tag_task` 的状态、memo id、agent/tagger id、due_at、updated_ts。
- 支持 `status`、`memoUid` 或 `memoId` 过滤，限制返回条数。

影响面：

- 后端中等：新增工具、store 查询复用或新增 finder。
- 前端小：Settings 工具开关增加对应项和文案。

风险：

- 低到中。admin-only 且只读，主要风险是返回过多信息。

#### `project_status`

范围：

- admin-only。
- 返回实例级健康摘要：用户数、memo 数、附件数、队列积压数、日志文件统计等。
- 不返回 API key、provider secret、用户敏感字段。

影响面：

- 后端中等。
- 可复用已有 `GetInstanceStats` / `GetInstanceLogStats` 思路。

风险：

- 低。只读 admin-only，重点是结果精简。

#### `query_my_data`

范围：

- user 可用。
- 结构化参数，不接收 SQL。
- 表和字段白名单与 `query_db` 共享一部分。
- 后端强制注入当前用户行级过滤。

建议首批支持表：

- `memo`：强制 `creator_id = me`。
- `inbox`：强制 `receiver_id = me`。
- `attachment`：强制 `creator_id = me`。
- `reaction`：强制 `creator_id = me`。

影响面：

- 后端中到高：需要严肃权限测试。
- 前端小：Settings 工具开关增加对应项。

风险：

- 中到高。普通用户可用，必须覆盖越权、字段白名单、limit、where 注入等测试。

验收标准：

- 非 admin 看不到 admin-only 工具。
- `query_my_data` 无法查询他人 memo、inbox、attachment。
- 所有查询参数化，不接收 SQL 字符串。
- 单次结果有限制并截断长字段。

### 阶段 2D：补齐转写工具

目标：把已有转写能力包装成对话工具 `transcribe_memo_audio`。

建议分两步：

1. 先做同步 MVP：输入 attachment id/name，读取附件，复用 `AIService.Transcribe` 内部逻辑，返回文本。适合短音频。
2. 再做异步正式版：提交任务、返回 task id、可查询状态，避免长音频阻塞聊天。

影响面：

- 后端中到高：附件读取、权限校验、音频大小校验、转写 provider 复用。
- 如做异步：需要任务表或复用现有队列模式，影响更高。

风险：

- 中到高。主要风险是大文件、长耗时、重复提交、权限校验。

验收标准：

- 只能转写当前用户有权限访问的附件。
- 非音频或超大附件明确报错。
- 转写配置缺失时返回可理解错误。
- 不阻塞或超时策略明确。

### 阶段 2E：Chat 真流式文本增量

目标：把当前一次性 `SendMessageResponse` 改成真正的流式响应。

建议暂缓到独立阶段，原因：

- 当前 `SendMessage` 是 unary RPC，改 streaming 会牵动 proto、生成代码、前端 hook、错误处理、确认卡片状态机。
- 工具调用与确认流程已经可用，真流式主要提升体验，不是功能闭环前置条件。
- 如果和工具补齐混在一起，会显著提高回归风险。

影响面：

- proto 高。
- 后端高。
- 前端高。
- 测试高。

验收标准：

- 普通文本按 token/chunk 增量显示。
- 工具调用状态能插入消息流。
- 需要确认时能暂停流并展示确认卡。
- 确认后能续跑并继续流式输出。
- 网络中断、取消、重复提交都有明确状态。

## 4. 推荐执行顺序

第一批只做阶段 2A：

1. memo 菜单"问 AI"。
2. `/ai-chat?memo=...` 上下文条。
3. 发送时携带当前 memo 上下文。

原因：收益最高、改动最小、风险最低，能马上补齐设计里最明显的体验缺口。

第二批做阶段 2B：

1. 多预设选择器。
2. 新建会话绑定 agent。
3. 会话列表展示 agent 名称。

原因：基础设施已经存在，属于把已做能力接到使用界面。

第三批做阶段 2C：

1. `query_queue`。
2. `project_status`。
3. `query_my_data`。

原因：前两个是 admin-only，只读安全风险低；`query_my_data` 需要更严格测试，建议同批但后做。

第四批做阶段 2D：

1. `transcribe_memo_audio` 同步 MVP。
2. 评估是否需要异步任务表。

第五批单独做阶段 2E：

1. 改造 Chat streaming。
2. 重做前端发送状态机。

## 5. 不建议本轮做的内容

- 不在 memo 卡片上新增独立 AI 聚合按钮，仍然只放在操作菜单里。
- 不做用户自建 Agent。
- 不把 Chat 真流式和 `query_my_data` 权限工具混到同一个分支。
- 不在前端绕过权限直接拼接未知 memo 内容。
- 不把 `query_db` 暴露给普通用户。

## 6. 后续实施分支建议

| 分支 | 内容 |
|---|---|
| `codex/ai-chat-memo-entry` | 阶段 2A，memo 菜单"问 AI"。 |
| `codex/ai-chat-agent-selector` | 阶段 2B，多预设选择器。 |
| `codex/ai-chat-readonly-tools` | 阶段 2C，`query_queue` / `project_status` / `query_my_data`。 |
| `codex/ai-chat-transcribe-tool` | 阶段 2D，`transcribe_memo_audio`。 |
| `codex/ai-chat-streaming` | 阶段 2E，真流式输出。 |

## 7. 最小验收命令

文档变更：

```bash
git diff --check
```

阶段 2A 前端变更：

```bash
cd web && pnpm lint
cd web && pnpm test
cd web && pnpm build
```

阶段 2C/2D 后端工具变更：

```bash
go test -v -race ./internal/ai/...
go test -v -race ./server/...
go test -v ./store/...
```

proto 变更：

```bash
cd proto && buf generate
cd proto && buf lint
```

