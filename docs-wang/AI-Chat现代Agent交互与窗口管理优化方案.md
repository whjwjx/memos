# AI Chat 现代 Agent 交互与窗口管理优化方案

日期：2026-09-12
分支：`codex/ai-chat-streaming`
状态：方案设计，待评审后实现

## 背景

当前 AI Chat 已经具备基础对话、流式输出、工具调用、工具确认卡片、工具活动折叠展示等能力，但整体体验还没有完全达到现代 Agent 对话界面的状态。

两个明显问题：

1. 用户确认工具卡片后，聊天记录里会出现内部控制文本：

   ```text
   [用户已批准上述待确认工具，请直接执行并继续]
   ```

   这条文本不是用户真正输入，却被当作 `role=user` 消息落库、渲染，并进入后续模型上下文。

2. AI Chat 侧栏点击“新建对话”时会一直创建新窗口。即使已经有空的 AI 对话窗口，也不会复用，导致侧栏堆积很多无标题空会话。

目标是把 AI Chat 调整为更接近 ChatGPT / Claude / Cursor / Codex 这类现代 Agent 产品的交互模型：用户输入、工具调用、工具确认、工具结果、最终回答都作为不同类型的事件处理，而不是把内部流程塞进普通用户消息。

## 当前代码现状

### 工具确认被伪装成用户消息

前端确认工具调用后，`resolveToolCall` 会组装一条固定中文控制文本，再调用 `send`：

```ts
send({
  content: "[用户已批准上述待确认工具，请直接执行并继续]",
  approvedToolCallIds: approvedIds,
  rejectedToolCallIds: rejectedIds,
  toolApprovals,
});
```

位置：`web/src/hooks/useAIChat.ts`

后端 `prepareAIChatTurn` 对所有 `SendMessageRequest` 都执行同一条路径：

1. 要求 `content` 非空。
2. 创建一条 `conversation_message(role=user)`。
3. 加载历史。
4. 将 `req.Content` 作为 `UserContent` 交给 assistant loop。

位置：`server/router/api/v1/ai_chat_service.go`

assistant loop 内部又会无条件追加最新用户消息：

```go
messages = append(messages, chat.Message{Role: chat.RoleUser, Content: req.UserContent})
```

位置：`internal/ai/assistant/assistant.go`

因此这条“用户已批准”文本会有三层副作用：

- UI 显示一条不属于用户的消息。
- 数据库存储一条假的用户消息。
- 后续上下文继续污染模型输入。

### 结构化工具决策字段已经存在

当前 proto 已经定义了确认续跑所需字段：

```proto
repeated string approved_tool_call_ids = 3;
repeated string rejected_tool_call_ids = 5;
repeated ToolApproval tool_approvals = 4;
```

位置：`proto/api/v1/ai_chat_service.proto`

assistant loop 也已经支持通过这些字段直接执行或跳过上轮等待确认的工具：

- `ApprovedToolCallIDs`
- `RejectedToolCallIDs`
- `Approvals`
- `applyApprovedResults`
- `applyRejectedResults`

这说明系统已经具备“结构化确认事件”的基础，只是 API 准备层和前端调用层还没有完全切过去。

### 新建 AI 对话总是创建新窗口

AI Chat 侧栏的 `handleCreate` 当前直接调用：

```ts
const res = await createConversation.mutateAsync({});
navigate(`${ROUTES.AI_CHAT}?conversation=${res.id}`);
```

位置：`web/src/components/AppSidebar/AppSidebar.tsx`

这会导致每次点击新建按钮都创建一个新会话。当前 `Conversation` 列表只包含 `id/title/agent_id/llm_id/create_time/update_time`，没有消息数量，因此前端不能仅凭 `ListConversations` 判断某个会话是否为空。

当前标题策略也比较粗：

- 新建会话默认 `title=""`。
- 侧栏展示 `conv.title || conv.id`。
- 第一次发送真实用户消息后，前端用输入内容前 24 个字符更新标题。

这个策略能用，但空窗口显示为随机 id，不够友好；连续新建时也没有空窗口复用。

## 设计目标

### 工具确认体验

- 用户点击批准或拒绝后，不再生成任何用户气泡。
- 工具确认作为结构化控制事件发送给后端。
- 后端不落库内部控制文本。
- assistant 可以继续生成自然语言总结，但内部 continuation instruction 不进入用户历史。
- 工具调用记录默认折叠，可展开查看参数、结果、错误和来源。
- 确认卡片状态即时变化：`pending -> submitting -> completed/rejected/error`。
- 刷新页面后，工具调用和工具结果仍能从持久化历史重建。

### 窗口管理体验

- 如果已经存在空 AI 对话，点击新建按钮应复用该空会话，不继续创建新的空窗口。
- 空会话侧栏显示统一占位名，例如“新对话”，不要直接显示 id。
- 用户第一次发送消息后自动命名。
- 用户手动重命名后，自动命名不应覆盖用户标题。
- 如果当前空会话绑定了特定 agent/llm，而用户选择了不同 agent/llm，新建逻辑需要避免误复用配置不匹配的空会话。

## 推荐方案

### 方案 A：最小可落地方案

这是推荐的第一阶段实现，改动小，但能解决主要体验问题。

#### 1. 前端确认续跑传空 content

`resolveToolCall` 不再传固定中文控制文本，改为：

```ts
send({
  content: "",
  approvedToolCallIds: approvedIds,
  rejectedToolCallIds: rejectedIds,
  toolApprovals,
});
```

同时保留当前 `submittedIdsRef`，继续保证同一轮工具决策只提交一次。

#### 2. 后端识别 confirmation continuation

新增辅助判断：

```go
func hasToolDecisions(req *v1pb.SendMessageRequest) bool {
  return len(req.ApprovedToolCallIds) > 0 ||
    len(req.RejectedToolCallIds) > 0 ||
    len(req.ToolApprovals) > 0
}
```

`prepareAIChatTurn` 根据请求类型分支：

- 普通用户消息：要求 `content` 非空，创建 `role=user` 消息。
- 工具确认续跑：允许 `content` 为空，不创建 `role=user` 消息。

这样可以不改数据库结构，不新增 API，也不需要用户看到任何内部控制文本。

#### 3. assistant loop 只在真实用户消息时追加 UserContent

`AssistantRequest` 可以新增字段：

```go
Continuation bool
```

或者使用更明确的字段：

```go
SkipUserMessage bool
ContinuationInstruction string
```

推荐第一阶段用 `SkipUserMessage`：

```go
if !req.SkipUserMessage {
  messages = append(messages, chat.Message{Role: chat.RoleUser, Content: req.UserContent})
}
```

确认续跑时，assistant loop 已经会先执行 `applyApprovedResults/applyRejectedResults`，再让模型基于工具结果生成总结。模型需要的“继续总结”意图可以作为临时 system/user 指令放入本次请求内，但不落库。

#### 4. UI 过滤历史里的旧控制文本

为了兼容已经产生的历史数据，前端渲染时应过滤旧控制文本：

```ts
const isInternalToolDecisionMessage = (message: ConversationMessage) =>
  message.role === "user" && message.content.trim() === "[用户已批准上述待确认工具，请直接执行并继续]";
```

`buildConversationTimeline` 跳过这类消息。

后端 `loadChatHistory` 也建议过滤，避免旧污染继续影响模型。

#### 5. 空窗口复用先在前端完成

短期不改 proto 时，可以在 `handleCreate` 里复用空标题会话：

1. 找到 `title === ""` 的会话。
2. 调 `getConversation` 确认 `messages.length === 0`。
3. 如果存在空会话，直接 navigate 到该会话。
4. 如果没有，再创建新会话。

注意不要只靠 `title === ""` 判断空会话，因为用户可能已有无标题但有历史的旧会话。

#### 6. 空窗口显示占位标题

侧栏展示逻辑从：

```tsx
{conv.title || conv.id}
```

改为：

```tsx
{conv.title || t("aiChat.untitled-conversation")}
```

建议文案：

- zh-Hans：`新对话`
- en：`New chat`

### 方案 B：协议更干净的中期方案

当短期体验稳定后，再做协议层整理。

#### 1. SendMessageRequest 语义调整

当前 `content` 注释是 required：

```proto
// Required for a new user turn. Text the user typed.
string content = 2 [(google.api.field_behavior) = REQUIRED];
```

建议改为：

```proto
// Required for a new user turn. Empty when continuing after tool approvals/rejections.
string content = 2 [(google.api.field_behavior) = OPTIONAL];
```

然后运行 `buf generate` 更新 Go/OpenAPI/TS 生成文件。

#### 2. Conversation 增加 message_count 或 is_empty

为了避免前端点击“新建”时还要逐个 `getConversation`，可以给 `Conversation` 增加只读字段：

```proto
int32 message_count = 8 [(google.api.field_behavior) = OUTPUT_ONLY];
```

或者：

```proto
bool is_empty = 8 [(google.api.field_behavior) = OUTPUT_ONLY];
```

推荐 `message_count`，因为它更通用：侧栏以后可以显示摘要、状态、是否有挂起工具等。

实现方式：

- store 层 `Conversation` 增加 `MessageCount int32`。
- `ListConversations` SQL 左连接或子查询统计 message 数。
- `convertConversationFromStore` 写入 proto 字段。
- 前端通过 `messageCount === 0` 直接判断空窗口。

影响：需要 proto 生成、三种数据库 SQL 调整、store 测试更新。收益是窗口复用更高效、更可靠。

#### 3. Conversation 增加 title_source

如果要避免自动命名覆盖手动命名，后续可以增加：

```proto
enum ConversationTitleSource {
  CONVERSATION_TITLE_SOURCE_UNSPECIFIED = 0;
  CONVERSATION_TITLE_SOURCE_AUTO = 1;
  CONVERSATION_TITLE_SOURCE_MANUAL = 2;
}
```

但第一阶段不建议加这个字段。短期可以约定：只有 `title === ""` 时自动生成标题；用户手动改过后不为空，自然不会被覆盖。

## 确认卡片交互细节

### 当前问题

当前卡片已经能显示 `pending/approved/rejected/submitting`，但还有几个体验点可以继续优化：

- 确认后会触发一次新的 send 流程，视觉上像用户又发了一条消息。
- `requiresConfirmation` 变 false 后，确认卡片可能从底部消失，用户不容易知道刚刚批准的工具是否正在执行。
- 工具结果虽然会进入 `ToolActivity`，但确认卡片和工具活动之间的状态衔接还不够自然。

### 推荐交互

确认卡片应分为两种状态：

1. `ApprovalCard`：只显示当前待确认的工具，用户可以批准/拒绝。
2. `ToolActivity`：显示已经发生的工具调用历史，默认折叠。

用户批准后：

- `ApprovalCard` 里的按钮立刻 disabled。
- 单个工具状态显示“正在执行”。
- 不新增用户消息。
- 收到 `TOOL_RESULT` 后，当前卡片可折叠或转入 `ToolActivity`。
- 收到 `DONE` 后，卡片最终显示“已执行”或隐藏，只保留时间线中的工具活动记录。

对于多个工具：

- 用户可以逐个决定。
- 全部决定后一次性提交。
- 已决定项保持状态，不重复提交。
- 如果其中一个工具执行失败，只标记该工具失败，不影响其他工具结果展示。

## 新窗口与命名策略

### 空窗口定义

第一阶段定义：

- `title === ""`
- `messages.length === 0`
- 当前没有 pending confirmation

如果未来支持会话级 agent/llm 选择，复用时还要比较：

- `agent_id` 是否匹配当前选择
- `llm_id` 是否匹配当前选择

### 新建按钮行为

推荐逻辑：

```ts
const handleCreate = async () => {
  const reusable = await findReusableEmptyConversation(conversations);
  if (reusable) {
    navigate(`${ROUTES.AI_CHAT}?conversation=${reusable.id}`);
    setMobileOpen(false);
    return;
  }
  const res = await createConversation.mutateAsync({});
  navigate(`${ROUTES.AI_CHAT}?conversation=${res.id}`);
  setMobileOpen(false);
};
```

`findReusableEmptyConversation` 第一阶段可以通过 `getConversation` 校验候选空标题会话；第二阶段改用 `message_count`。

### 自动命名策略

短期保留当前“首次发送后自动标题”的机制，但改进生成规则：

- 去掉 memo context envelope，只取用户实际问题。
- 压缩空白。
- 限制长度 24 到 32 字符。
- 去掉内部控制文本。
- 标题为空时才自动更新。

示例：

```ts
const title = createConversationTitle(stripMemoContextEnvelope(input.content));
```

推荐默认标题：

- 空会话：`新对话`
- 正在生成标题前：仍显示 `新对话`
- 自动命名后：显示用户问题摘要
- 手动重命名后：不再被自动命名覆盖

## 影响分析

### 正向影响

- 用户不会再看到内部控制文本。
- AI Chat 历史更干净，后续上下文质量更好。
- 工具确认更像现代 Agent 执行流，而不是“用户又发了一条命令”。
- 侧栏不会堆积多个空窗口。
- 无标题窗口更易理解，减少误删和迷路。

### 技术风险

- `prepareAIChatTurn` 分支后，普通消息和确认续跑要保持一致的鉴权、LLM 选择、工具 registry、memory 注入逻辑。
- 确认续跑不落 user message 后，assistant loop 的消息顺序必须仍然符合 provider 要求。
- 旧历史中的内部控制文本需要过滤，否则历史污染会继续存在。
- 前端找空会话如果逐个请求 `getConversation`，会带来少量额外请求；候选通常很少，可接受。

### 兼容性

- 第一阶段不改数据库结构，不改 proto 字段编号，不破坏已有客户端。
- 旧客户端如果仍传控制文本，后端应根据 `approved_tool_call_ids/rejected_tool_call_ids/tool_approvals` 判断这是确认续跑，并避免落库。
- 已存在的旧控制消息不删除，只在 UI 和模型上下文中过滤。

## 实施步骤

### 第一阶段：体验修复

1. 前端 `resolveToolCall` 改为空 content + 结构化决策字段。
2. 后端 `prepareAIChatTurn` 支持确认续跑不落 user message。
3. assistant loop 支持跳过真实用户消息追加。
4. UI 和 `loadChatHistory` 过滤旧控制文本。
5. AI Chat 侧栏空窗口显示为“新对话”。
6. 新建按钮优先复用空窗口。
7. 补充前端测试和后端服务测试。

建议验证：

```bash
go test ./server/router/api/v1 ./internal/ai/assistant
cd web && pnpm lint && pnpm test
```

### 第二阶段：协议整理

1. 调整 `SendMessageRequest.content` 注释和 OpenAPI 语义。
2. 给 `Conversation` 增加 `message_count`。
3. 更新 proto 生成文件。
4. store 三数据库补充 message count 查询。
5. 新建按钮改为纯列表判断，不再额外请求详情。

建议验证：

```bash
cd proto && buf generate && buf lint
go test ./store/... ./server/router/api/v1
cd web && pnpm lint && pnpm test
```

## 推荐结论

建议先做第一阶段，不急着改 proto 和数据库。

第一阶段能直接解决当前用户能感知的问题：确认后不出现内部文本、工具状态更自然、空 AI 窗口不重复创建、空窗口标题更友好。等这套体验稳定后，再做 `message_count` 和 proto 语义整理，把实现从“可用且干净”推进到“协议也完全准确”。
