# AI Chat 流式对话可行性与影响分析

日期：2026-09-12
分支：`codex/ai-chat-tavily-web-search`

## 背景

当前 AI Chat 的体验是“用户发送后等待较久，最后一次性出现回复”。这在普通问答里已经会显得迟钝，在启用 `web_search`、memo 搜索、数据库查询等工具后更明显：用户不知道系统是在模型生成、调用工具、等待外部 API，还是请求已经卡住。

目标效果不是展示模型思维链，而是像 agent 产品一样展示可见的执行过程：

- 用户消息立即出现。
- Assistant 回复按 chunk 逐步出现。
- 工具调用实时出现，默认折叠，可展开看参数和结果。
- 慢工具，例如 `web_search`，能显示“正在联网搜索 / 已完成 / 出错”。
- 最终以服务端持久化后的消息为准，刷新页面后历史一致。

## 当前代码现状

### 1. AI Chat API 目前是 unary RPC

`proto/api/v1/ai_chat_service.proto` 中 `SendMessage` 定义为：

```proto
rpc SendMessage(SendMessageRequest) returns (SendMessageResponse)
```

这意味着服务端必须完整处理完一次 user turn，才能返回一个完整 `SendMessageResponse`。当前没有 `stream` RPC。

生成后的前端类型也确认了这一点：`web/src/types/proto/api/v1/ai_chat_service_pb.ts` 中 `sendMessage.methodKind` 是 `"unary"`。

生成后的 Go Connect handler 也确认了这一点：`proto/gen/api/v1/apiv1connect/ai_chat_service.connect.go` 里 `SendMessage` 使用 `connect.NewUnaryHandler`，客户端使用 `CallUnary`。

### 2. 前端是等待完整响应后刷新历史

`web/src/hooks/useAIChat.ts` 的 `useSendMessage` 使用 React Query `useMutation`：

```ts
const response = await aiChatServiceClient.sendMessage(...)
```

当前只做了用户消息的 optimistic insert。assistant 回复、工具活动、确认卡片等都要等 `sendMessage` 完整返回后，才通过 `invalidateQueries(["ai-chat", "conversation", conversationId])` 重新拉历史。

所以用户看到的是：

1. 用户气泡马上出现。
2. 等待 spinner。
3. 服务端全部完成后，assistant 回复和工具信息一起出现。

这就是“不丝滑”的直接原因。

### 3. 后端 `SendMessage` 是完整同步执行链路

`server/router/api/v1/ai_chat_service.go` 的 `SendMessage` 当前流程是：

1. 校验 conversation。
2. 持久化 user message。
3. 加载历史。
4. 解析 LLM provider、system prompt、memory context。
5. 注册工具并应用工具开关。
6. 调用 `assistant.ToolLoop(...)`。
7. 等整个 tool loop 完成后，持久化 assistant/tool messages。
8. 返回 `SendMessageResponse`。

这里最耗时的部分都包在第 6 步里，服务端没有把中间状态往前端发出。

### 4. Assistant tool loop 目前只返回最终结构

`internal/ai/assistant/assistant.go` 的 `ToolLoop` 当前抽象是：

```go
func ToolLoop(ctx context.Context, model chat.Model, req *AssistantRequest) (*AssistantResponse, error)
```

内部循环大致是：

1. 调模型 `Generate`。
2. 如果模型返回 tool calls，执行工具。
3. 把 tool results 加回 messages。
4. 再调模型。
5. 直到得到最终文本或需要用户确认。

这个结构适合一次性响应，但不适合实时 UI。要做流式，需要让 loop 在这些时点 emit event：

- 模型开始生成。
- 模型产生文本 delta。
- 模型请求 tool call。
- 工具开始执行。
- 工具执行完成。
- 需要用户确认。
- 最终完成。

### 5. 模型 provider 当前没有 streaming 接口

`internal/ai/chat/chat.go` 当前只有：

```go
type Model interface {
  Generate(ctx context.Context, req Request) (*Response, error)
}
```

OpenAI-compatible provider 位于 `internal/ai/chat/openai/openai.go`，当前调用：

```go
m.client.Chat.Completions.New(ctx, params)
```

Gemini provider 位于 `internal/ai/chat/gemini/gemini.go`，当前调用：

```go
m.client.Models.GenerateContent(ctx, ...)
```

不过依赖版本本身是支持 streaming 的：

- `github.com/openai/openai-go/v3@v3.51.0` 有 `Chat.Completions.NewStreaming(...)`。
- `google.golang.org/genai@v1.68.0` 有 `Models.GenerateContentStream(...)` 和 `Chat.SendMessageStream(...)`。

所以不是 SDK 能力不足，而是 memos 目前没有把 streaming 能力封装到自己的 `chat.Model` 抽象里。

### 6. 已有 SSE 不是 AI Chat 请求流

仓库里已有 `server/router/api/v1/sse_handler.go` 和 `SSEHub`，但它们用于 memo 更新事件，例如 memo created/updated/deleted。它是全局订阅式事件通道，不适合直接承载某一次 AI Chat 请求的 token delta 和工具执行过程。

前端浏览器 API 客户端已经走 Connect：

```ts
const transport = createConnectTransport(...)
export const aiChatServiceClient = createClient(AIChatService, transport)
```

服务端也已经注册 Connect handlers：

```go
connectHandler.RegisterConnectHandlers(connectMux, ...)
connectGroup.Any("/memos.api.v1.*", ...)
```

因此更合理的方案是新增 Connect server-streaming RPC，而不是另写一套 AI Chat SSE endpoint。

## 可行性结论

可行性：高。
复杂度：中等偏高。
推荐方案：新增 `StreamMessage`，保留现有 `SendMessage` 作为 fallback。

原因：

- Connect-Go 和 connect-web 已经在项目中使用。
- Proto 生成链路已经存在，`buf generate` 会同时生成 Go、Connect、Gateway、TS 类型。
- OpenAI/Gemini SDK 已经具备 streaming API。
- 最近新增的工具活动持久化结构可以复用，前端已有默认折叠的工具活动 UI。
- 旧 `SendMessage` 可以不动，降低回归风险。

## 推荐架构

### 1. Proto 新增 server-streaming RPC

建议保留 `SendMessageRequest`，新增 stream response：

```proto
rpc StreamMessage(SendMessageRequest) returns (stream SendMessageStreamResponse) {
  option (google.api.http) = {
    post: "/api/v1/ai/chats/{conversation_id}:streamMessage"
    body: "*"
  };
}

message SendMessageStreamResponse {
  string event_id = 1;
  string conversation_id = 2;
  AIChatStreamEventType type = 3;
  ConversationMessage message = 4;
  ToolCall tool_call = 5;
  string delta = 6;
  string error = 7;
  bool requires_confirmation = 8;
  repeated ConversationMessage final_messages = 9;
}

enum AIChatStreamEventType {
  AI_CHAT_STREAM_EVENT_TYPE_UNSPECIFIED = 0;
  AI_CHAT_STREAM_EVENT_TYPE_STARTED = 1;
  AI_CHAT_STREAM_EVENT_TYPE_MESSAGE_CREATED = 2;
  AI_CHAT_STREAM_EVENT_TYPE_ASSISTANT_DELTA = 3;
  AI_CHAT_STREAM_EVENT_TYPE_TOOL_CALL = 4;
  AI_CHAT_STREAM_EVENT_TYPE_TOOL_RESULT = 5;
  AI_CHAT_STREAM_EVENT_TYPE_CONFIRMATION_REQUIRED = 6;
  AI_CHAT_STREAM_EVENT_TYPE_DONE = 7;
  AI_CHAT_STREAM_EVENT_TYPE_ERROR = 8;
}
```

字段可以继续打磨，但事件边界建议保持稳定。`delta` 用于 token/chunk，`message` 用于临时或最终消息，`final_messages` 用于完成后前端和服务端落库结果对齐。

### 2. 后端新增 `StreamMessage`

生成后，Connect handler 会要求实现类似：

```go
func (s *APIV1Service) StreamMessage(
  ctx context.Context,
  request *connect.Request[v1pb.SendMessageRequest],
  stream *connect.ServerStream[v1pb.SendMessageStreamResponse],
) error
```

实现时不要复制一份完整 `SendMessage`。建议先抽公共准备流程：

```go
type preparedChatTurn struct {
  conv        *store.Conversation
  userMsg     *store.ConversationMessage
  history     []chat.Message
  providerCfg chatProviderConfig
  system      string
  registry    *tools.Registry
  approvals   map[string]string
}

func (s *APIV1Service) prepareChatTurn(ctx context.Context, req *v1pb.SendMessageRequest) (*preparedChatTurn, error)
```

然后：

- `SendMessage` 继续调用原来的 `assistant.ToolLoop`。
- `StreamMessage` 调新的 streaming loop。

这样避免两条 API 的鉴权、LLM 选择、memory context、工具配置逐渐分叉。

### 3. Assistant 层增加事件式 loop

推荐新增一个事件回调，而不是强行把 HTTP stream 传进 assistant 包：

```go
type EventType string

const (
  EventAssistantDelta EventType = "assistant_delta"
  EventToolCall       EventType = "tool_call"
  EventToolResult     EventType = "tool_result"
  EventConfirmation   EventType = "confirmation_required"
)

type Event struct {
  Type     EventType
  Delta    string
  ToolCall chat.ToolCall
  Message  chat.Message
}

type EmitFunc func(Event) error

func ToolLoopStream(ctx context.Context, model chat.Model, req *AssistantRequest, emit EmitFunc) (*AssistantResponse, error)
```

这样 `internal/ai/assistant` 仍然不依赖 Connect/protobuf，包边界比较干净。单元测试也可以用 fake emitter 收集事件。

### 4. Model 层增加可选 streaming 能力

保留当前接口不变：

```go
type Model interface {
  Generate(ctx context.Context, req Request) (*Response, error)
}
```

新增可选接口：

```go
type StreamingModel interface {
  StreamGenerate(ctx context.Context, req Request, emit StreamEmitFunc) (*Response, error)
}

type StreamEvent struct {
  Delta       string
  ToolCalls   []ToolCall
  FinishReason FinishReason
}
```

assistant loop 中判断：

```go
if sm, ok := model.(chat.StreamingModel); ok {
  resp, err = sm.StreamGenerate(ctx, req, emit)
} else {
  resp, err = model.Generate(ctx, req)
}
```

好处：

- OpenAI-compatible 可以先真流式。
- Gemini 可以后续跟进。
- 其他 provider 不需要立刻改，仍然能通过 `Generate` fallback。
- 即使 fallback，后端仍可以 emit “started/tool_call/tool_result/done”，体验也会比现在好。

### 5. OpenAI-compatible provider 优先接入

`internal/ai/chat/openai/openai.go` 可以复用现有 params 构建逻辑，把“构造 ChatCompletionNewParams”抽成 helper：

```go
func buildChatCompletionParams(req chat.Request, messages []chat.Message) (openaisdk.ChatCompletionNewParams, error)
```

然后：

- `Generate` 使用 `m.client.Chat.Completions.New(ctx, params)`。
- `StreamGenerate` 使用 `m.client.Chat.Completions.NewStreaming(ctx, params)`。

OpenAI streaming 需要注意 tool call delta：

- 文本在 `choice.Delta.Content`。
- tool call 的 name/arguments 可能分多个 chunk 到达。
- 需要按 index/id 累积 arguments。
- 最终返回完整 `chat.Response{Text, ToolCalls, FinishReason}`，保持 assistant loop 后续逻辑一致。

第一版可以只在 OpenAI-compatible 上实现 token stream，因为这是用户最可能配置的路径，也能覆盖 OpenRouter、DeepSeek、Groq、Ollama OpenAI-compatible 等场景，但要保留“不支持则 fallback”的保护。

### 6. Gemini provider 可第二阶段接入

`google.golang.org/genai` 已有 `GenerateContentStream`。Gemini 的函数调用和 OpenAI 的 chunk 结构不一样，建议不要和 OpenAI 混在同一个补丁里硬做。

第一版可接受：

- Gemini 继续 `Generate`。
- 前端仍收到 `started`、`tool_call`、`tool_result`、`done` 等阶段事件。
- 后续再补 Gemini token delta。

## 前端设计

### 1. 新增 `useStreamMessage`

`web/src/hooks/useAIChat.ts` 中可以保留 `useSendMessage`，新增或替换为 stream 优先：

```ts
for await (const event of aiChatServiceClient.streamMessage(input, { signal })) {
  // patch query cache
}
```

建议第一版用一个新 hook：

```ts
export const useStreamMessage = (conversationId: string | undefined) => {
  // stream send, abort, state, fallback
}
```

之后 AIChat 页面只消费一个统一接口：

```ts
const { send, stop, isPending, streamingMessageId, error } = useStreamMessage(conversationId);
```

### 2. Query cache 作为单一渲染来源

前端当前已经倾向让 conversation history 做单一来源。streaming 时也应该延续这个思路：

- 发送时 optimistic 插入 user message。
- 收到 `started` 后插入临时 assistant message，例如 `local-assistant-${timestamp}`。
- 收到 `assistant_delta` 后 append 到这条临时 assistant message 的 content。
- 收到 `tool_call` / `tool_result` 后插入或更新临时工具活动。
- 收到 `done` 后用服务端返回的 `final_messages` 替换本轮临时消息。
- 最后 invalidate conversation，确保和数据库一致。

不要每个 token 都落库；否则数据库写入频率、锁竞争和历史一致性都会变复杂。

### 3. 工具活动 UI 可以复用

当前 `web/src/pages/AIChat.tsx` 已经有 `ToolActivity` 和 `buildConversationTimeline`，可以复用。

需要补的只是：

- 支持临时 tool call id。
- 支持 `pending/running/completed/error/skipped` 状态。
- `tool_result` 事件回来时更新对应 call。
- `confirmation_required` 事件回来时显示确认卡片。

### 4. 加停止生成

建议第一版顺手加停止按钮，否则 streaming UI 会让用户更自然地期待“能停”。

实现方式：

- 前端保存 `AbortController`。
- 调用 stream 时传 `signal`。
- 用户点击停止后 `abort()`。
- 后端使用 `ctx.Done()` 取消 provider stream 和工具执行。

停止后的持久化策略建议第一版简单处理：

- 如果用户取消发生在最终 assistant message 之前，不持久化半条 assistant 回复。
- 前端显示“已停止”临时状态。
- 后续高级版再考虑保存 partial output。

## 持久化策略

推荐第一版：流式期间前端临时显示，完成后一次性落库。

原因：

- 当前 store schema 已经支持 conversation messages、tool calls、tool results，不需要 DB schema change。
- 避免 token 级 DB update。
- 避免刷新页面后看到半条不完整 assistant 消息。
- 失败/取消语义简单。

需要复用当前 `SendMessage` 的持久化逻辑：

- user message 仍然一开始落库。
- automatic tool-call assistant message 和 tool result message 按顺序落库。
- confirmation pending placeholder 继续写入，便于后续 approval continuation。
- final assistant message 最后落库。
- `done` 事件返回本轮服务端消息，前端替换临时消息。

后续如果想做“刷新后恢复生成中对话”，再升级为：

- assistant message 先落库。
- token delta 批量 update，例如每 500ms 或每 256 chars。
- conversation 状态标记 `generating/stopped/failed`。

但这会牵涉 schema 和恢复逻辑，不建议第一版做。

## 兼容策略

### 保留 `SendMessage`

不要直接替换原接口。`SendMessage` 继续保留用于：

- 旧前端或外部调用方。
- provider 不支持 streaming 时的服务端 fallback。
- stream 出错后的降级路径。
- 测试和排障。

### `StreamMessage` 优先，失败回落

前端可以优先调用 `streamMessage`。如果遇到 `Unimplemented`、网络代理不支持 streaming、或者其它不可恢复错误，再回落到 `sendMessage`。

但要避免重复发送用户消息。建议回落只在“stream 请求尚未被服务端接受、没有收到 started/message_created”时发生。一旦 user message 已经落库，就不能自动重发，否则会重复消息。

## 影响面

### 会修改的文件/目录

预计涉及：

- `proto/api/v1/ai_chat_service.proto`
- `proto/gen/api/v1/*ai_chat_service*` 生成文件
- `web/src/types/proto/api/v1/ai_chat_service_pb.ts` 生成文件
- `internal/ai/chat/chat.go`
- `internal/ai/chat/openai/openai.go`
- `internal/ai/chat/gemini/gemini.go`，第二阶段
- `internal/ai/assistant/assistant.go`
- `internal/ai/assistant/assistant_test.go`
- `server/router/api/v1/ai_chat_service.go`
- `server/router/api/v1/ai_chat_service_test.go`
- `web/src/hooks/useAIChat.ts`
- `web/src/pages/AIChat.tsx`
- `web/src/locales/en.json`
- `web/src/locales/zh-Hans.json`

### 不需要修改的部分

第一版不需要：

- 数据库 migration。
- 新增重依赖。
- 改 auth/token 行为。
- 单独新增 SSEHub。
- 改 Docker/release workflow。

### 部署影响

Connect streaming 走 `/memos.api.v1.AIChatService/StreamMessage` 这类路径。需要注意反向代理缓冲：

- nginx 需要禁用响应缓冲，否则流式响应可能被代理攒到最后才发给浏览器。
- 当前 SSE handler 已经设置了 `X-Accel-Buffering: no`，Connect stream 路径也应考虑类似 header。
- Vite dev proxy 和浏览器 fetch 一般没有问题，但生产环境要测试。

### 性能影响

正向影响：

- 用户感知延迟显著降低。
- 慢工具执行过程可见。
- 长回答不再等完整生成。

成本：

- 每个生成请求会持有一个长连接。
- 后端 goroutine 生命周期更长。
- 前端 cache patch 频率增加，需要节流或只做轻量 append。
- provider stream 的 tool-call arguments 需要累积，代码复杂度上升。

### 错误处理影响

streaming 后错误不再只有“最终失败”一种：

- user message 可能已落库，但 assistant 还没完成。
- tool call 可能已展示，但 tool result 失败。
- provider stream 中途断开。
- 用户手动停止。
- 前端刷新导致连接断开。

第一版建议规则：

- 收到 `started` 之前失败：可以提示并允许重试。
- 收到 `started` 之后失败：不自动重发，避免重复 user message。
- 工具失败：作为 `tool_result` error 展示，再由模型决定是否继续，或直接返回 error event。
- 用户停止：取消 context，不落库 partial assistant。

## 风险点

### 1. Tool call streaming 比文本 streaming 更复杂

OpenAI-compatible 的 tool call arguments 常常是分片返回的。不能收到一个 chunk 就马上执行工具，必须等完整 tool call 组装完成。

建议实现方式：

- 文本 delta 可以实时 emit。
- tool call delta 先内部累计。
- 当模型 stream finish 且 tool calls 完整后，再 emit `tool_call` 并执行工具。

这样第一版不会做到“模型正在拼工具参数时实时显示参数”，但已经能在工具真正开始执行时展示进度，足够改善体验。

### 2. 文本后接工具调用的处理

有些模型可能先输出文字，再决定调用工具。当前非流式逻辑会把 assistant message 的 `Content` 和 `ToolCalls` 一起保存。

streaming 时要保持同样语义：

- 已经 emit 的 assistant delta 先显示在临时 assistant bubble。
- 如果同一轮又出现 tool call，这条 assistant 临时消息需要保留对应 tool calls。
- 最终持久化以 `AssistantResponse.Messages` 为准。

### 3. 确认流转不能被破坏

敏感工具当前有 confirmation flow。streaming 不能绕过它。

规则：

- `RequiresConfirmation` 的工具只 emit `confirmation_required`。
- 写入 pending tool placeholder。
- 不执行工具。
- 用户确认后再发 approval continuation。

这一块可以复用当前 `ToolLoop` 的确认逻辑，但需要事件化。

### 4. 前端回落可能导致重复消息

如果 stream 已经成功创建 user message，前端再自动调用 unary `sendMessage`，会重复写入用户消息。

所以 fallback 必须带状态机：

- `idle`
- `connecting`
- `accepted`
- `streaming`
- `completed`
- `failed`

只有 `connecting` 阶段失败才允许自动 fallback。

## 分阶段落地建议

### Phase 1：请求级 streaming + 工具状态事件

目标：即使没有 token 级流式，也让用户看到系统正在做什么。

内容：

- 新增 `StreamMessage` proto。
- 新增 `SendMessageStreamResponse` 和 event type。
- 后端 `StreamMessage` 复用 `SendMessage` 准备流程。
- Assistant loop 增加 event emit。
- provider 仍可先用 `Generate`。
- 前端支持 async stream，实时显示 started/tool_call/tool_result/done。

收益：

- `web_search` 等慢工具立刻有反馈。
- 风险比 token streaming 小。
- 为 Phase 2 铺好协议和 UI。

### Phase 2：OpenAI-compatible token streaming

目标：真正看到 assistant 文本逐字/逐 chunk 出现。

内容：

- `chat.StreamingModel`。
- OpenAI provider 实现 `StreamGenerate`。
- 累积 text 和 tool calls。
- Assistant loop 把 text delta emit 到 `StreamMessage`。

收益：

- 最明显的“ChatGPT 式流式输出”体验。
- 覆盖 OpenAI-compatible endpoint，包括 OpenRouter/DeepSeek/Groq/Ollama compatible。

### Phase 3：Gemini token streaming

目标：补齐 Gemini provider。

内容：

- Gemini provider 实现 `StreamGenerate`。
- 处理 `GenerateContentStream` 的 text 和 function call parts。

收益：

- 多 provider 体验一致。

### Phase 4：停止生成、恢复和更强持久化

目标：完善长任务体验。

内容：

- 前端 Stop button。
- AbortController。
- 后端 context cancel。
- 可选 partial message 持久化。
- 可选 conversation generating state。

## 推荐第一版验收标准

- AI Chat 发送消息后 300ms 内出现 assistant 临时状态。
- 调用 `web_search` 时，工具活动在结果返回前就出现，并显示 pending/running。
- 工具完成后，工具活动状态变为 completed/error。
- OpenAI-compatible provider 输出文本时，assistant bubble 按 chunk 增长。
- 完成后刷新页面，历史消息和工具活动保持一致。
- 不支持 streaming 的 provider 能回落到非 token streaming，但仍有阶段事件或最终响应。
- 敏感工具确认流程保持不变。
- 失败时不重复写入 user message。

## 测试建议

后端：

- `internal/ai/assistant` 增加 fake streaming model，验证 delta/tool events 顺序。
- `server/router/api/v1` 增加 Connect stream handler 测试，读取完整 stream。
- 覆盖 confirmation required、approval continuation、tool error、provider error。

前端：

- `useAIChat` hook 测试 stream event cache patch。
- AIChat 页面测试 streaming assistant bubble 和工具活动状态更新。
- 测试 stream accepted 后失败不会 fallback 重发。

手动验证：

- OpenAI-compatible 普通长回答。
- `web_search` 慢请求。
- 需要确认的敏感工具。
- 用户点击停止。
- 刷新页面后历史一致。

命令：

```bash
cd proto && buf generate && buf lint
go test -v ./internal/ai/assistant ./server/router/api/v1
cd web && pnpm lint && pnpm test
```

## 最终建议

建议实施，并按 Phase 1 + Phase 2 合并为第一轮功能：

1. 新增 `StreamMessage`。
2. 打通后端事件式 tool loop。
3. OpenAI-compatible 先支持 token streaming。
4. Gemini 暂时 fallback。
5. 前端实时 patch query cache，完成后用服务端 final messages 对齐。

这个范围能直接解决当前“不丝滑、等待太久不知道发生什么”的核心问题，同时不需要动数据库 schema，也不破坏现有 `SendMessage`。整体风险可控，但需要认真处理 stream 状态机和“避免重复消息”的边界。
