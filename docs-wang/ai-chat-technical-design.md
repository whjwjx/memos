# AI Chat（AI 对话助手）统一实现方案

> 状态：统一实现方案（评审通过后开工）
> 承接：`AI-Agent对话式助手-设计讨论.md`（已全部定案）与早期技术设计合并。本文件是唯一实现依据，两文档不一致处以本文件为准。

## 1. 背景与目标

memos 已有多种独立 AI 能力（agent 自动评论、自动打标签、语音转写），彼此孤立、无统一入口。AI Chat 提供统一对话入口（`/ai-chat`）：用户与默认 AI 助手对话，助手通过 function calling 编排既有能力（查评论、查 memos、查队列、查库、看日志、写 memo/设置等）。

### 1.1 范围

- **阶段 1**：对话引擎 + 工具系统 + 会话持久化 + 默认助手 + 用户侧工具集 + 敏感工具确认卡片 + 成本控制。
- **阶段 2**：日志落盘 + `get_logs`、管理侧只读诊断（`query_queue`/`query_db` 只读/`project_status`）、`query_my_data`、`transcribe_memo_audio` 异步、多预设选择器、memo 菜单"问 AI"。
- **阶段 3**：`query_db` 写模式（CRUD + 二次确认）、跨会话长期偏好记忆、分享状态可视化。

### 1.2 非目标

不做用户自建 Agent、不做全局快捷键、不做 memo 卡片独立 AI 聚合按钮（阶段 2 由 memo 菜单承担）；阶段 1 不做多助手选择器。

## 2. 设计决策（合并两文档定案，已全部确认）

| # | 决策 | 结论 |
|---|---|---|
| 1 | memo 卡片 AI 入口 | 不做独立按钮，阶段 2 由 memo 菜单"问 AI"承担 |
| 2 | 用户自建 Agent | 不做。阶段 1 单默认助手、无选择器；出现第 2 个预设才显示选择器 |
| 3 | 架构选型 | 单 Agent + 多 Skill（工具注册表），不引入多 Agent 编排；重任务用工具内多步检索替代 |
| 4 | 配置模型 | 保持实例级（admin 配 key/模型，user 不各自配）；user 在 Agent 里只能改自己的 `UserSetting`，实例级 AI 配置仅 admin 可改 |
| 5 | 工具开关存储 | 扩 `InstanceAISetting` 加 `tools` 字段（`{toolName: {enabled, requires_confirmation}}`），admin 配置、user 继承；admin 工具默认关闭 |
| 6 | 日志落盘 | **阶段 2**。按日轮转、默认保留 3 天、`get_logs` 返回前脱敏；保留天数/级别集成 admin Settings |
| 7 | 转写纳入工具 | `transcribe_memo_audio(attachment_id)` 异步提交 + 查状态；入阶段 2 |
| 8 | 全局快捷键 | 不做 |
| 9 | 角色感知 | 工具列表组装时按 `user.Role` 过滤：user 看不到 admin 工具，越权天然不可能 |
| 10 | 写操作确认 | 敏感工具被调用时不执行，返回"待确认"；前端确认卡片展示操作与参数预览，允许/取消后放行或否决 |
| 11 | 会话持久化 | 历史落库（`conversations`/`messages`），多窗口各自持久化，切换 Agent 不清空历史（历史归属会话）；可删除会话 |
| 12 | 入口形态 | 顶部全局导航栏（`GlobalNavigation`）inbox 右侧新增 `AI`（BotIcon）→ 无边框全屏 `/ai-chat`；不做右侧抽屉 |
| 13 | 数据访问范围 | user 仅行级只读（`query_my_data` 强制 `creator_id = me`）；admin 可全量 CRUD（`query_db`，业务表白名单 + 确认卡片） |
| 14 | query_db 形态 | **任何情况下不接收 SQL 字符串**。LLM 只传结构化参数 `{table, fields[], where[], limit}`，后端白名单映射参数化生成 SQL |
| 15 | 成本/限流 | 单会话轮次上限 50 轮（超出提醒开新窗口）+ 每用户每小时请求频率限制 + 重工具单次检索上限 + 单次输入内工具循环 ≤8 轮 |
| 16 | admin 写确认强度 | 确认卡片 + 影响行数 + 二次确认（DELETE/UPDATE 需输入 "yes" 或目标 id）（阶段 3） |
| 17 | 工具实现方式 | 封装为对既有 store/service 接口的调用，不直接写 SQL；`query_db` 唯一例外（后端白名单参数化生成） |

## 3. 现状与接入点调研

- **`internal/ai/chat`**：`Model` 接口仅 `Generate(ctx, Request) (*Response, error)`，纯文本，无 tool calling。openai-go v3 / genai v1.68 两条 SDK **均原生支持 function calling 与流式**。结论：扩展 `chat.Request/Message/Response` 承载工具定义/调用/结果，**保持 `Model` 接口签名不变**（兼容 agent/transcribe/TestAIProvider；`internal/ai/agent/factory.go` 的 `NewChatModel` 是统一构造入口）。
- **配置模型**：`InstanceAISetting`（`proto/store/instance_setting.proto`）现有 `providers`/`transcription`/`agents`/`taggers`。扩展 `chat_agents` + `tools`。provider 解析复用 `resolveAIProvider`，默认模型复用 `ai.DefaultChatModel`。
- **存储层**：facade + 三 driver migration 机制成熟（模板 `store/agent_reply_task.go`、`0.32/00__agent_reply_task.sql`）。工具所需既有 store API **已全部存在**：`ListMemos`（`FindMemo.CreatorID` 行级过滤）、`CreateMemo`、`UpsertUserSetting`、`ListAgentReplyTasks`、`ListMemoTagTasks`、`ListMemoRelations`（评论即 `MemoRelation{Type: Comment}`）。新增 `conversation`/`conversation_message` 两表走同一机制。
- **API 层**：`proto/api/v1/ai_service.proto` 的 `AIService` 现有 `Transcribe`/`TestAIProvider`；注册链路 `connect_handler.go`/`connect_services.go`/`v1.go` 标准。
- **前端**：`GlobalNavigation`（`web/src/components/AppSidebar/AppSidebar.tsx`，现有 calendar/attachments/inbox items）可加 BotIcon；`getSidebarRouteKind`（`AppSidebar/routes.ts`）处理路由；`Settings/AISection.tsx` 为 admin 配置页。
- **日志**：`cmd/memos/log.go` slog 输出 stderr；阶段 2 加旁路日志文件。

## 4. 总体架构

```
前端 /ai-chat（全屏 AIChatPage：会话列表 / 消息流 / 工具事件 / 确认卡片 / 输入框）
   │ Connect RPC（阶段 1 服务端收集后一次性返回，proto 为 server-streaming）
   ▼
server/router/api/v1/ai_chat_service.go（新增）
   ▼
internal/ai/assistant（新增）工具编排引擎：ToolRegistry(按角色过滤) · ToolLoop(≤8轮)
   ├─ SensitiveToolHang(挂起/确认) · RateLimiter · RoundLimit(会话轮次50)
   ▼
internal/ai/chat（改造，function calling：openai / gemini）
   ▼
internal/ai/tools（新增，工具注册表：13 个工具，见 §8）
   ▼
store（conversation / conversation_message + 既有 store API）
```

## 5. 数据模型

`conversation`：`id` / `creator_id`(FK user) / `title` / `status`(ACTIVE|ARCHIVED) / `pending_tool`(JSON，挂起敏感工具+confirm_token) / `created_ts` / `updated_ts`；索引 `(creator_id, updated_ts DESC)`。

`conversation_message`：`id` / `conversation_id`(FK) / `role`(user|assistant|tool) / `content`(tool 消息为结果文本) / `tool_calls`(JSON，assistant 消息携带) / `created_ts`；索引 `(conversation_id, created_ts)`。

- 工具调用完整往返（assistant tool_calls + tool 结果）**逐条落库**，保证历史重放上下文完整。
- store：`store/conversation.go` 定义模型 + facade 方法（`CreateConversation`/`ListConversations`/`DeleteConversation`/`ListConversationMessages`/`CreateConversationMessage`/`UpsertConversationPendingTool`）；三 driver 实现 `store/db/{driver}/conversation.go`；migration `0.33/00__conversation.sql` ×3 + 同步 LATEST.sql。
- 挂起：`pending_tool` JSON 含 `confirm_token`(uuid 一次性) + `tool_calls`。同会话同时只允许一个挂起；确认前不能发新对话（前端禁用输入框）。`ConfirmToolCalls` 校验 token 后执行；`CancelToolCalls` 清空并让模型回复"已取消"。

## 6. 配置模型扩展（proto/store/instance_setting.proto）

```proto
message InstanceAISetting {
  // ...现有字段 1-4 不变...
  repeated ChatAgentConfig chat_agents = 5;   // 阶段 1 仅第一个启用预设生效
  map<string, ToolConfig> tools = 6;          // key 为工具名，如 "query_db"
}
message ChatAgentConfig {
  string id = 1;
  string name = 2;          // 助手名（阶段 2 选择器显示）
  bool builtin = 3;         // 内置标记：内置预设不可删除、可改名/改 prompt
  string provider_id = 4;   // 引用 providers[].id；空=禁用
  string model = 5;         // 空=引擎默认
  string system_prompt = 6;
  bool enabled = 7;
  // per-agent tools 授权集（tools[]）入阶段 2
}
message ToolConfig {
  bool enabled = 1;
  bool requires_confirmation = 2; // 敏感工具：执行前需确认卡片
}
```

- 阶段 1 UI：AISection "对话助手"卡片（provider/model/system_prompt 单条）+ "对话工具"列表（每工具 enabled + confirmation 开关；admin 工具默认关闭）。
- 内置工具不可删除，仅可启停；admin 关闭后所有用户不可见。

## 7. API 设计（proto/api/v1/ai_service.proto，AIService 追加）

```proto
rpc Chat(ChatRequest) returns (stream ChatResponse) {
  option (google.api.http) = { post: "/api/v1/ai:chat" body: "*" };
}
rpc ListConversations(ListConversationsRequest) returns (ListConversationsResponse) {
  option (google.api.http) = { get: "/api/v1/ai/conversations" };
}
rpc CreateConversation(CreateConversationRequest) returns (Conversation) {
  option (google.api.http) = { post: "/api/v1/ai/conversations" body: "*" };
}
rpc DeleteConversation(DeleteConversationRequest) returns (DeleteConversationResponse) {
  option (google.api.http) = { delete: "/api/v1/ai/conversations/{id}" };
}
rpc ListConversationMessages(ListConversationMessagesRequest) returns (ListConversationMessagesResponse) {
  option (google.api.http) = { get: "/api/v1/ai/conversations/{id}/messages" };
}
rpc ConfirmToolCalls(ConfirmToolCallsRequest) returns (ConfirmToolCallsResponse) {
  option (google.api.http) = { post: "/api/v1/ai/conversations/{conversation_id}:confirmToolCalls" body: "*" };
}
rpc CancelToolCalls(CancelToolCallsRequest) returns (CancelToolCallsResponse) {
  option (google.api.http) = { post: "/api/v1/ai/conversations/{conversation_id}:cancelToolCalls" body: "*" };
}
```

`ChatRequest{ conversation_id(空=新建), content }`。`ChatResponse{ type, message_id, text, pending, result }`，type 为 `text_delta`/`tool_pending`/`tool_result`/`done`/`error`。**阶段 1 非流式**：服务端收集完事件一次性返回全部；阶段 2 切真流式，事件模型与前端接口不变。

权限：会话仅 `creator_id == 当前用户` 可访问；未登录/未配置默认助手返回相应错误。

## 8. 工具系统设计

### 8.1 抽象（internal/ai/tools）

```go
type Tool interface {
	Name() string
	Description() string
	Parameters() map[string]any // JSON Schema
	RequiresConfirmation() bool // 默认读 ToolConfig
	AdminOnly() bool
	Execute(ctx context.Context, params map[string]any) (string, error)
}
```

`tools.Registry map[string]Tool` 包级注册，按 `user.Role` 过滤 `AdminOnly`。工具实现**封装对 store/service 接口的调用**（不直接写 SQL），`query_db` 是唯一例外。

### 8.2 工具全集（13 个）

**阶段 1（用户侧核心对话）**：

| 工具 | 参数 | 角色 | 敏感 | 实现 |
|---|---|---|---|---|
| `search_memos` | `query`, `limit` | USER | 否 | `store.ListMemos`（user 强制 `CreatorID=me`） |
| `get_comments` | `memo_id` | USER | 否 | `store.ListMemoRelations(Type=Comment)` + `GetMemo`；工具内可见性过滤 |
| `manage_settings` | `operation`, `settings[]` | USER | 是 | user→`UpsertUserSetting` 个人字段；admin→`UpsertInstanceSetting` |
| `create_memo` | `content`, `visibility` | USER | 是 | `store.CreateMemo` |
| `summarize_requirements` | `query`, `timeframe` | USER | 是 | 工具内多步检索 + 生成汇总 → 内部 `create_memo` 需确认 |
| `agent_reply` | `memo_id` | USER/ADMIN | 是 | 复用 `scheduleAgentRepliesForMemo`/`UpsertAgentReplyTask` |
| `auto_tag` | `memo_id` | USER/ADMIN | 是 | 复用 memo_tag_worker 调度逻辑 |

**阶段 2（增强）**：

| 工具 | 参数 | 角色 | 敏感 | 实现 |
|---|---|---|---|---|
| `query_queue` | `memo_id?`, `status?` | ADMIN | 否 | `ListAgentReplyTasks` + `ListMemoTagTasks` |
| `query_my_data` | `table`, `fields[]`, `where[]`, `limit` | USER | 否 | 行级只读，强制注入 `creator_id/receiver_id = me` |
| `query_db`（只读） | `table`, `fields[]`, `where[]`, `limit` | ADMIN | 否 | 白名单参数化 SELECT |
| `get_logs` | `level?`, `limit`, `since?` | ADMIN | 否 | 读 `data/logs/`，返回前脱敏 |
| `project_status` | 无 | ADMIN | 否 | 各表计数（memo/用户/队列积压） |
| `transcribe_memo_audio` | `attachment_id` | USER | 否 | 异步提交 + 查状态 |

**阶段 3**：`query_db` 写模式（CRUD + 确认卡片 + 影响行数 + 二次确认）。

### 8.3 数据访问白名单与安全约束

- **工具优先走既有 store API**（`search_memos`/`query_queue`/`project_status` 天然安全零注入面）。
- **`query_my_data`（USER）**：只读 SELECT，后端**强制注入行级过滤**（`memo.creator_id = me` 等），Agent 无法指定他人数据；不开放 INSERT/UPDATE/DELETE（user 写走专有工具 + 确认卡片）。
- **`query_db`（ADMIN，唯一例外）**：由后端基于**白名单参数化生成 SQL**——表/字段名经白名单映射为后端常量，where 值参数绑定；**LLM 只传结构化参数，任何情况下不接收 SQL 字符串**（admin 同样适用）。
- **表级白名单**（可查/可改）：`memo`、`user`（字段过滤）、`attachment`（元数据）、`agent_reply_task`、`memo_tag_task`、`inbox`、`reaction`、`tag`、`memo_relation`。
- **表级禁查**（admin 同样生效）：`system_setting`（API key）、`idp`（OAuth secret）、`user_identity`、`resource`（文件内容）、`webhook`——admin 改配置走 Settings UI，不让 Agent 碰。
- **字段级白名单**：`user` 排除 `password_hash`；`attachment` 排除 `blob`。
- **强制约束**：参数化查询；`limit` ≤ 100；单次查询超时 ≤ 5s；字段截断每字段 ≤ 512 字符；user 版强制行级过滤。
- **所有工具**：执行套 context 超时（30s），结果截断（8KB）。
- **`get_logs`**：返回前对 api_key/token/password/secret/Authorization 键值正则脱敏。

## 9. 对话引擎（internal/ai/assistant）

### 9.1 单轮工具循环（ToolLoop）

```
Run(ctx, user, conversation, userInput):
  1. 追加 user 消息落库；组装历史 messages（含历史 tool_calls/结果；保留最近 50 条）
  2. 构建工具列表 = Registry 中 enabled 且按角色过滤后的定义
  3. for round := 0; round < 8; round++:
     a. resp = chat.Generate(messages, tools)      // 仅取文本部分
     b. if resp 无 ToolCalls: 返回最终文本，done
     c. for each call in resp.ToolCalls:
          - 工具被禁用/不存在 → 生成 tool 错误消息
          - 敏感(requires_confirmation) → 存 pending_tool，发 tool_pending 事件，挂起返回
          - 否则执行，append tool 结果消息
     d. append assistant(tool_calls) 消息；继续循环
  4. 达轮次上限 → 以"工具调用过多已中止"结束
```

- 挂起后 `ConfirmToolCalls` 校验 token 执行挂起工具 → 追加 tool 消息 → 复用循环继续生成；`CancelToolCalls` 插入"用户已取消"结果 → 模型续写。
- 普通工具执行结果以 `tool_result` 事件推给前端。

### 9.2 成本控制（阶段 1）

- **工具循环**：单次用户输入内 ≤ 8 轮（超限终止并提示）。
- **会话轮次上限**：50 轮，超出提醒开新窗口。
- **频率限制**：每用户每小时 Chat 请求 ≤ N（默认 10，in-memory 滑动窗口；多实例下软限制可接受）。
- **重工具检索上限**：`summarize_requirements` 等单次检索条数上限（如 50）。
- **长度**：单条消息 ≤ 32KB；LLM 返回 ≤ MaxTokens（默认 2048）。
- **上下文截断（已确认）**：历史重放保留最近 50 条消息，超出不参与生成但保留在库；后续阶段做摘要压缩。

## 10. chat 包改造（function calling，Model 接口不变）

```go
type Request struct {
	System string; Messages []Message; Model string
	Temperature *float32; MaxTokens int
	Tools []Tool
}
type Tool struct { Name, Description string; Parameters map[string]any /* JSON Schema */ }
type Message struct {
	Role, Content string
	ToolCalls []ToolCall // assistant 消息携带
	ToolCallID string    // tool 消息引用
}
type ToolCall struct { ID, Name string; Arguments string /* JSON 字符串 */ }
type Response struct { Text string; FinishReason FinishReason; ToolCalls []ToolCall }
```

- openai：`params.Tools` → `ChatCompletionToolParam`；`role=tool` 映射 `ToolCallID`；响应解析 `Message.ToolCalls`。
- gemini：`cfg.Tools = []*genai.Tool{{FunctionDeclarations}}`；请求映射 FunctionCall/FunctionResponse part；响应从 `Candidates[0].Content.Parts` 提取 FunctionCall。
- 阶段 2 流式：openai `NewStreaming`、gemini `GenerateContentStream`。

## 11. 日志落盘（阶段 2）

- `cmd/memos/log.go` 新增多 handler：slog 同时写 stderr 与 `data/logs/memos-YYYY-MM-DD.log`。
- 按日轮转，启动清理早于保留天数（默认 3 天，常量，阶段 2 可配）的文件。
- `get_logs` 工具按目录读取当天/历史日志文件。

## 12. 前端设计

### 12.1 路由与入口

- `ROUTES.AI_CHAT = "/ai-chat"`（`web/src/router/routes.ts`）。
- `GlobalNavigation`（AppSidebar.tsx）inbox 右侧新增 `AI` 项（`BotIcon`），点击跳转 `/ai-chat`。
- `getSidebarRouteKind`（AppSidebar/routes.ts）增加 `"ai-chat"` 分支——**全屏页不渲染主侧边栏**，返回空容器/全屏布局。
- 未配置默认助手：页面显示空态引导（跳转 admin AISection 配置；user 只读提示）。

### 12.2 组件（web/src/components/AIChat/）

- `AIChatPage.tsx`：全屏布局（左侧会话列表 + 右侧对话）。
- `ConversationSidebar.tsx`：新建/切换/删除会话。
- `MessageList.tsx`/`MessageBubble.tsx`：markdown 渲染 + 工具中间状态（"正在查询 memos…"）。
- `ToolCallCard.tsx`：确认卡片（工具名、参数摘要、[执行] [取消]）；普通工具结果折叠卡片。
- `ChatComposer.tsx`：输入框 + 发送；挂起期间禁用。

### 12.3 hooks

- `useConversations`/`useConversationMessages`（React Query，`aiServiceClient`）。
- `useChatStream`：调用 `chat()`，消费 `ChatResponse` 事件驱动消息状态机。

## 13. 实施步骤

### 阶段 1

1. chat 包扩展 function calling 类型 + openai/gemini 实现 + 单测。
2. `internal/ai/tools`：工具抽象 + 注册表 + 阶段 1 七工具（含安全约束）+ 单测。
3. store：conversation 两表 migration（三 driver + LATEST.sql）+ facade + driver + 测试。
4. proto：`chat_agents` + `tools` 字段；Chat 系列 RPC；`cd proto && buf generate`。
5. `internal/ai/assistant`：ToolLoop + 挂起确认 + 限流 + 轮次上限 + 单测。
6. `server/router/api/v1/ai_chat_service.go`：RPC 实现 + Connect 注册 + acl_config + 测试。
7. 前端：路由 + 顶部导航入口（BotIcon）+ AIChat 页面 + AISection 扩展（助手配置 + 工具开关）+ hooks。
8. 验证（见 §14）。

### 阶段 1 关键决策（已定，2026-08-26）

实现前对三个架构卡点做了可行性分析并定案，全链路据此落地：

- **D1 · chat.Model 扩展方式**：在 `chat.Request` 加可选字段 `Tools []ToolSpec`、`ToolChoice string`；在 `chat.Response` 加可选 `ToolCalls []ToolCall`。**不改 `Generate(ctx, req)` 签名**，保证 `agentpkg.NewChatModel` 及 `agent_reply_worker.go` 两个现有调用方 + 两个 provider 测试零破坏。openai/gemini 的 `Generate` 内部按"有 tools 才带 tools 参数"分支适配各自 SDK。
- **D2 · 挂起确认机制**：选 **A（同步续跑）**。阶段 1 不做流式，`SendMessage` 首次返回 `finish_reason=tool_call` + `tool_calls[]`（含 `requires_confirmation=true` 标记）；前端渲染确认卡 → 用户确认 → 前端发第二次 `SendMessage`（带 `approved_tool_call_ids`），后端接着跑 ToolLoop 后续轮次。不引入后台 goroutine / SSE 推送（避免 replica 下 SSE 连接归属与并发状态问题）。阶段 3 的 `query_db` 写模式仍用此同步确认，二次确认在同一会话内追加一轮。
- **D3 · Chat RPC 归属**：**新建 `AIChatService`**（不扩展 `AIService`）。`AIService` 仅保留 `Transcribe`/`TestAIProvider` 等 AI 基础设施运维；对话 + 工具执行归 `AIChatService`。`connect_handler.go` 加一行 `wrap(apiv1connect.NewAIChatServiceHandler(s, opts...))` 注册。`chat_agents`/`tools` 配置字段仍经 `InstanceService` 读写（本分支 `feature/ai-chat-config` 已完成）。

### 阶段 2

日志落盘 + `get_logs`；`query_queue`/`query_db`(只读)/`project_status`；`query_my_data`；`transcribe_memo_audio` 异步；多预设选择器；memo 菜单"问 AI"；Chat 流式文本增量。

### 阶段 3

`query_db` 写模式（确认卡片 + 影响行数 + 二次确认）；跨会话长期偏好记忆；分享状态可视化。

## 14. 验证计划

- 后端：`go test -v -race ./internal/ai/...`、`go test -v ./store/...`（DRIVER=sqlite 单跑）、`go test -v -race ./server/...`。
- proto：`cd proto && buf lint`（buf generate 已含）。
- 前端：`cd web && pnpm lint && pnpm test`、`pnpm build`。
- 手动：配置 DeepSeek/OpenAI provider → 配默认助手与工具 → `/ai-chat` 对话：查评论、搜 memos、汇总成 memo（确认卡片）、admin 查队列/状态、取消/确认挂起、删会话。

## 15. 风险与注意

- **SDK 兼容**：openai-go v3 / genai 的 tools 类型需实测确认（实现时以两包源码为准）；DeepSeek 等 OpenAI 兼容 provider 的 function calling 需实测（历史上 agent 已在 DeepSeek 实测可用，风险低）。
- **评论可见性**：`get_comments` 工具内需做可见性过滤（复用 `checkMemoReadAccess` 语义），避免泄露 Private memo 评论。
- **上下文长度（已确认）**：阶段 1 历史重放保留最近 50 条消息，超出部分截断不参与生成；后续阶段做摘要压缩。
- **成本失控**：频率限制 + 工具循环轮次上限为第一道闸；`query_db`/`get_logs` 结果截断防 token 放大。
- **多实例部署**：in-memory 限流在 replica 下不精确，可接受（软限制）。
- **方言差异**：`query_db` 白名单参数化生成 SQL 需兼容三 driver（占位符 `?`/`$n`）；阶段 2 实现时走 store 现有连接封装。
- **D1 兼容性**：chat 包扩展走"加可选字段"而非改签名，现有 `agent_reply_worker.go` 与 provider 测试不受影响（见 §13 阶段 1 关键决策）。
- **D2 同步确认**：阶段 1 挂起确认用同步续跑（两次 `SendMessage`），不依赖 SSE；replica 下无 SSE 连接归属问题。
- **D3 服务拆分**：对话 RPC 归新建 `AIChatService`，与 `AIService` 运维类 RPC 解耦，acl 规则独立成段。
