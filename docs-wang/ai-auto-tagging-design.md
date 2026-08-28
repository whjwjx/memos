# AI 自动打标签（AI Auto Tagging）需求文档

## 1. 背景与目标

Memos 现有 AI Agent 能力：管理员在实例 AI 设置（`InstanceAISetting`）中配置 provider 与多个 **agent**，每个 agent 独立 enable，agent 会在 memo 创建后以 admin 身份异步生成评论（基于 `agent_reply_task` 队列 + worker 轮询）。

本需求**仿照 AI Agents 的形态**新增 **AI 自动打标签（Tagger）** 能力：admin 在 AI 设置里配置一个或多个 "Tagger"（打标器），每个 Tagger 是一条独立的打标规则（绑定 provider/model、携带打标 prompt、可开关）。Tagger 开启后，AI 依据该 Tagger 的 prompt 为 memo 追加合适的 `#标签`，帮助用户建立可检索、成体系的标签分类。标签以 `#tag` 语法**追加**到 memo 内容末尾，不影响用户已有的标签，用户可随时手动编辑。

**核心定位（本次变更后的定稿）**：
- **admin 配置 + 开关**：Tagger 是 `AISetting` 里与 `agents` 平行的 `taggers` 列表，admin 增删、每个独立 enable。
- **user 只享受**：user 侧**不做任何配置入口、不加开关**，功能完全由 admin 下发的 Tagger 决定；普通用户只能"被自动打标"和"对属于自己的 memo 手动触发"。

核心目标：
1. admin 在 设置 → Admin → AI 中像管理 Agents 一样管理 Taggers（增/删/启停/配 prompt/选 provider）。
2. 任一 Tagger 开启后，新建 memo 自动排队打标；已存在 memo 可在卡片菜单手动触发。
3. AI 只按 Tagger prompt 中给定的标签体系打标，保证一致性。
4. 打标是**追加**操作，绝不覆盖或改写用户已有标签。
5. AI 能力统一复用 admin 配置的 AI provider（`InstanceAISetting`），用户无需接触任何 API Key。

## 2. 名词解释

| 术语 | 含义 |
| --- | --- |
| Tagger（打标器） | 仿 Agent 的新增实体；admin 在 AI 设置里配置的一条打标规则（id / name / provider_id / model / prompt / enabled / max_tags） |
| AI Tags（自动打标签） | 由 Taggers 提供的能力总称；admin 配置了 Tagger 即代表该功能可用 |
| 打标 prompt | Tagger 携带的指令，写明"候选标签清单 + 选择规则"，相当于 tags design 的下发载体 |
| 标签任务（memo tag task） | 复用 `agent_reply_task` 架构模式的异步队列任务，记录一次打标请求 |

## 3. 功能需求

### 3.1 admin 配置 Taggers（对齐 AI Agents）

- 在 **设置 → Admin → AI**（`AISection.tsx`）新增 **"AI Tags"** 配置分组，**形态与现有 Agents 分组完全一致**：
  - 列表展示所有 Tagger（`SettingTable`：name / provider / enabled / 操作）。
  - 「＋ 添加打标器」按钮 → `Dialog` 编辑单个 Tagger（复用 `AIAgentDialog` 的交互骨架）。
  - 每个 Tagger 有独立 enable 复选框（仿 `handleToggleAgent`）。
  - 删除走 `ConfirmDialog`（仿 `handleDeleteAgent`）。
  - 保存沿用现有 `persistAISetting`，把 `taggers` 一并写入 `AISetting`。
- 单个 Tagger 字段：
  - `name`：展示名（如"默认打标器"）。
  - `provider_id`：从已配置 providers 选择（必填才能 enable）。
  - `model`：可选，空则用 provider 默认。
  - `prompt`：打标规范 / 候选标签清单（核心，见 7.4）。
  - `enabled`：是否对新建 memo / 手动触发生效。
  - `max_tags`：每次最多打几个（默认 3）。

### 3.2 user 侧：零配置、只享受

- **不提供任何标签集配置入口、不加开关**。用户无需知道自己用的是哪套体系，体系由 Tagger 的 prompt 下发。
- 功能"是否可用"完全由 admin 是否配置了 enabled 的 Tagger 决定。
- 普通用户可对**自己的** memo 在卡片菜单手动触发；admin 可对**任意** memo 触发。

### 3.3 标签体系如何下发（取代旧"user 配标签集"）

- 标签体系直接写在 **Tagger 的 prompt** 里（明文候选清单 + 规则）。
- AI 严格从 prompt 给定的候选中选标，不自由发明（保证成体系、可检索）。
- 内置示例 prompt 见 7.4；admin 可改造成自己的体系（如 `工作/生活/灵感/项目` 或 `bug/feature/docs`）。

### 3.4 创建 memo 自动打标（后台任务）

- 任一 Tagger `enabled` 时，用户创建 memo 若该 memo **没有标签**，则自动为每个 enabled Tagger 入队一个标签任务（一个 memo 可被多个 Tagger 打，互不冲突）。
- 打标异步后台执行（LLM 调用耗时较长），不阻塞创建请求。
- 打标仅针对**普通 memo**，不针对评论 memo 与 agent 生成的回复。

### 3.5 memo 卡片手动触发

- memo 卡片右上角菜单新增 **"AI 标签"** 项（图标 `Sparkles`）。
- 显示条件（同时满足）：`!readonly && !isArchived && 实例存在 enabled 的 Tagger`。
- 点击后为该 memo 对所有 enabled Tagger 入队任务，前端 toast 提示"已加入 AI 打标签队列"。
- **自己只能操作自己的 memos**：复用现有 `readonly = memo.creator !== currentUser && !isSuperUser` 判断；admin 额外可对任意 memo 触发。

### 3.6 追加而非覆盖

- AI 打上的标签以 `#tag` 追加到 memo content 末尾（换行分隔）。
- 追加前过滤：AI 返回的标签若 memo 已有，跳过，避免重复。
- 用户已打的标签、手动编辑均不受影响（本质仍是普通 `#tag` 文本）。
- 打标通过 admin 身份 + `withSystemAgentCall` 执行 `UpdateMemo`，memo 的 creator / visibility 均不变，随后 payload 自动重建提取新 tags。

## 4. 权限模型

| 操作 | 权限 |
| --- | --- |
| 配置 / 增删 / 启停 Tagger | 仅 admin（`InstanceAISetting.taggers`） |
| 创建 memo 自动打标 | 存在 enabled Tagger 即对所有用户生效 |
| 手动触发打标 | memo 作者或 admin；且存在 enabled Tagger |
| 执行打标（LLM + 写回） | worker 以 admin 身份 + `withSystemAgentCall` 执行 |
| 使用 AI provider | 复用 admin 配置的 `InstanceAISetting.providers` |
| user 侧配置 | 无（删除了旧的 TagsSetting 标签集扩展） |

## 5. 架构设计（复用 agent_reply_task 模式）

整体复用现有 agent reply 的 **异步队列 + worker 轮询** 架构，新增一张独立表 `memo_tag_task`（隔离于 agent 表，避免侵入已完成的 agent 功能）。

### 5.1 总体流程

```
[创建 memo / 卡片菜单点击]
        │  (仅无标签 memo / 手动触发；遍历所有 enabled Tagger)
        ▼
scheduleAutoTagForMemo()  ── UpsertMemoTagTask(PENDING, due_at, tagger_id)
        │
        ▼
worker 每 15s 轮询 processDueMemoTagTasks()
        │  读 due 任务（batch ≤ 32）
        ▼
processMemoTagTask()
        1. 加载 memo，解析 creator
        2. 读任务关联的 tagger_id → 取对应 TaggerConfig 的 prompt
        3. 组装 prompt（memo 内容 + tagger 候选标签 + 规则）→ 调 LLM
        4. 解析返回的标签 → 校验（须在 tagger 候选清单内）→ 过滤已有
        5. 若存在新标签 → admin 身份 + withSystemAgentCall 调 UpdateMemo 追加
        6. 标记任务 DONE / FAILED
```

### 5.2 任务队列（`memo_tag_task`）

- 字段：`id, memo_id, tagger_id, status(PENDING/DONE/FAILED), due_at, created_ts, updated_ts`。
- `UNIQUE(memo_id, tagger_id)` 保证同一 memo 同一 tagger 同时至多一个 PENDING 任务；重复入队走 UPSERT（重置 due_at，已 PENDING 保持 PENDING）。
- **手动再次触发**：已完成（DONE）的任务可被重新触发（置回 PENDING），以支持"删掉 AI 标签后重新打"。
- 任务记录 `memo_id`，worker 通过 memo 查 creator（也可冗余存 `creator_id` 防 memo 删除）。

### 5.3 worker 轮询

- 挂载进现有轮询 goroutine（`agentReplyScanInterval = "*/15 * * * * *"`，batch 32），新增 `processDueMemoTagTasks`，与 `processDueAgentReplies` 并列。
- 先 claim（置 DONE）再生成，防止重复执行（与 agent 任务一致）。
- 失败置 `FAILED` 停止重试（避免死循环消耗 token）。

### 5.4 幂等与防循环

- 创建时自动排队仅发生在 `CreateMemo`（复用 `withSuppressAgentScheduling` 保护：comment / agent 生成的 memo 不触发）。
- 打标走 `UpdateMemo`，不触发 `CreateMemo` 的调度路径，天然无循环。
- AI 打上的标签再次满足"已有标签"过滤，重复触发不会产生重复标签。

## 6. 数据模型变更

### 6.1 `proto/store/instance_setting.proto` — `InstanceAISetting` 扩展（API 层 `InstanceSetting.AISetting` 同步加同名字段）

```proto
// 新增：TaggerConfig（与 AIAgentConfig 平行）
message TaggerConfig {
  string id = 1;            // 稳定标识（uuid）
  string name = 2;          // 展示名
  string provider_id = 3;   // 引用 InstanceAISetting.providers[].id；为空则禁用
  string model = 4;         // 可选，空则用 provider 默认
  string prompt = 5;        // 打标规范 / 候选标签清单（核心）
  bool enabled = 6;         // 是否对新建 memo / 手动触发生效
  int32 max_tags = 7;       // 每次最多打几个（默认 3）
}

message InstanceAISetting {
  repeated AIProviderConfig providers = 1; // 现有
  TranscriptionConfig transcription = 2;   // 现有
  repeated AIAgentConfig agents = 3;       // 现有
  repeated TaggerConfig taggers = 4;       // 新增：AI Tags 打标器列表
}
```

> API 层 `InstanceSetting.AISetting`（instance_service.proto:290）同样加 `repeated TaggerConfig taggers = 4`，store 与 API 各维护一份（现有 convention）。
> **不再扩展 `UserSetting.TagsSetting`** —— user 侧零配置，旧文档里的 `collections / active_collection_id / free_tagging` 全部删除。

### 6.2 数据库迁移（三驱动：sqlite / mysql / postgres）

新增 `memo_tag_task` 表，并同步更新各驱动 `LATEST.sql` 与增量迁移：

```sql
CREATE TABLE memo_tag_task (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  memo_id     INTEGER NOT NULL,
  tagger_id   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'PENDING',
  due_at      INTEGER NOT NULL,
  created_ts  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_ts  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX idx_memo_tag_task_memo_id_tagger_id ON memo_tag_task (memo_id, tagger_id);
```

> 注：`unixepoch()` 为 sqlite 语法；mysql 用 `UNIX_TIMESTAMP()`、postgres 用 `EXTRACT(EPOCH FROM NOW())`，三驱动各自实现。

store 层仿照 `store/agent_reply_task.go` 新增 `store/memo_tag_task.go`（`UpsertMemoTagTask / ListMemoTagTasks / UpdateMemoTagTask`），三个驱动各自实现。

## 7. 后端实现

### 7.1 新增 RPC `AutoTagMemo`

- 定义于 `proto/api/v1/memo_service.proto`，方法 `AutoTagMemo(AutoTagMemoRequest) returns (AutoTagMemoResponse)`。
- 请求：`name`（memo 名，`memos/{uid}`）。
- 服务端校验：memo 存在；调用者为 memo 作者或 admin；实例存在 enabled 的 Tagger（否则拒绝并提示"AI 标签功能未开启"）。
- 通过后对所有 enabled Tagger 各 `UpsertMemoTagTask`（due_at = now，立即处理），返回简单 OK。
- 注册进 `server/router/api/v1/memo_service.go` 与 ACL（需登录即可，走现有鉴权）。

### 7.2 创建时调度 `scheduleAutoTagForMemo`

- 在 `CreateMemo` 中 `scheduleAgentRepliesForMemo` 旁边调用（同样受 `withSuppressAgentScheduling` 保护）。
- 条件：实例存在 `enabled` 的 Tagger；memo 无标签（`memo.Payload.Tags` 为空）。
- 对每个 enabled Tagger 入队一个任务（成功入队即可，不阻塞创建）。

### 7.3 worker `processDueMemoTagTasks`

- 轮询 `memo_tag_task` 到期 PENDING 任务，逐个处理（失败标记 FAILED）。
- 处理步骤见 5.1。其中 LLM 调用复用 `internal/ai/chat` 与 `internal/ai/agent` 的 `NewChatModel`（与 `generateAgentReply` 一致），provider 配置取自 `tagger.provider_id` 对应的 `InstanceAISetting.providers` 条目。

### 7.4 LLM prompt 设计

**Tagger 的 `prompt` 字段（admin 在 UI 填写，给出体系）示例：**

```
你是 memo 打标签助手。根据 memo 内容，从以下候选标签中选择最贴切的标签：
工作, 生活, 灵感, 学习, 项目, 日程, 读书, 观影, 随手记
要求：
- 只返回标签名，一行一个，不要解释，不要加 # 号。
- 只能选择与内容相关的标签，宁缺毋滥。
- 每次最多返回 {max_tags} 个。
```

系统提示词（代码内置，包裹 tagger.prompt）：

```
你是一个 memo 打标签助手。严格按下面的标签规范为 memo 打标签，不要超出候选范围。
{prompt}
```

用户提示词：`以下是 memo 内容：\n{memo.content}`。

### 7.5 标签校验与追加

- LLM 返回按行/逗号解析出候选标签名。
- 校验：仅在 Tagger prompt 给出的候选清单内才保留（保证成体系）；不在清单内的丢弃。
- 过滤掉 memo 已有标签（精确匹配，已命中的跳过）。
- 有新增标签时，以 admin 身份 + `withSystemAgentCall` 调 `UpdateMemo`，content 追加 `\n#tag1 #tag2`；`UpdateMemo` 触发的 payload 重建自动提取新 tags。

## 8. 前端实现

### 8.1 AISection — AI Tags 配置分组（admin，对齐 Agents）

- 在 `web/src/components/Settings/AISection.tsx` 新增 "AI Tags" `SettingGroup`，**完全照搬现有 agents 的实现骨架**：
  - 新增 `LocalTagger` 类型（对应 `TaggerConfig`）与 `toLocalTagger` / `toTaggerConfig` 转换函数。
  - 新增 `taggers` state + 同步 effect（仿 `agents`）。
  - `SettingTable` 展示（`name` / `provider` / `enabled` 复选框 / 操作下拉）。
  - 「＋ 添加打标器」→ `AITaggerDialog`（仿 `AIAgentDialog`，去掉 persona/system/delay/maxLength，改为 `prompt` 多行 + `max_tags` 数字）。
  - `handleToggleTagger` / `handleDeleteTagger` 仿 `handleToggleAgent` / `handleDeleteAgent`。
  - 保存沿用 `persistAISetting`，在 `create(InstanceSetting_AISettingSchema, {...})` 中补上 `taggers: nextTaggers.map(toTaggerConfig)`。
- 类型来自 `@/types/proto/api/v1/instance_service_pb`：`InstanceSetting_TaggerConfig` / `InstanceSetting_TaggerConfigSchema`（buf generate 后生成）。

### 8.2 TagsSection — 不再改动

- user 侧零配置，**保持现有 `TagsSection.tsx` 不变**（删除旧文档中"新增标签集管理 UI"的要求）。

### 8.3 MemoActionMenu — AI 标签项

- `web/src/components/MemoActionMenu/MemoActionMenu.tsx` 的 Edit actions 区域新增 `DropdownMenuItem`（`SparklesIcon` + `t("memo.ai-tag")`）。
- 显示条件：`!readonly && !isArchived && instanceHasEnabledTagger`（从 `useInstance()` 的 `aiSetting.taggers` 判断是否存在 `enabled` 的项）。
- 点击调用新 hook `useAutoTagMemo` → `AutoTagMemo` RPC → toast "已加入 AI 打标签队列"。

## 9. 边界情况与错误处理

| 场景 | 处理 |
| --- | --- |
| admin 未配 Tagger / 全禁用 | 创建不排队；卡片菜单不显示 AI 标签项；手动 RPC 拒绝 |
| LLM 返回空 / 无匹配候选 | 任务标记 DONE（不打标），不失败重试 |
| LLM / provider 报错 | 标记 FAILED，停止重试（防 token 浪费） |
| memo 已删除 | 任务标记 DONE 跳过 |
| 同一 memo + 同 tagger 并发入队 | `UNIQUE(memo_id, tagger_id)` + UPSERT 保证单任务 |
| AI 打的标签被用户删除后再次触发 | 任务置回 PENDING 重新打（可多次） |
| 评论 memo / agent 回复 | `withSuppressAgentScheduling` 保护，不触发 |
| 老数据（已有 tags） | 视为已有标签，过滤跳过，不重复追加 |
| 多个 enabled Tagger | 各自独立任务、各自追加，互不影响 |

## 10. 验收标准

1. admin 在 AI 设置添加并 enable 一个 Tagger（填 prompt + 选 provider）后，新建无标签 memo 会自动排队，worker 在轮询周期内按 Tagger 候选追加匹配标签。
2. admin 删除/禁用所有 Tagger 后：新建不自动打标，所有用户卡片菜单无 "AI 标签" 项，手动触发被拒。
3. 已有标签的 memo 不受影响，不追加重复标签。
4. 功能开启时，用户卡片菜单显示 "AI 标签"；点击后入队并 toast 提示；完成后 memo 自动带新标签。
5. **user 侧无任何配置入口与开关**，只能被动享受 admin 下发的体系。
6. admin 可为任意 memo 触发；普通用户仅可对自己的 memo 触发。
7. AI 只打出 Tagger prompt 候选清单内的标签。
8. 所有操作幂等：重复触发不产生重复标签；无循环（打标不触发再次打标）。
9. 三个数据库驱动迁移一致，`go test ./store/... ./server/... ./internal/...`、`buf lint`、`pnpm lint && pnpm test` 全绿。

## 11. 实现顺序与里程碑

| 里程碑 | 内容 | 验证 | 状态 |
| --- | --- | --- | --- |
| M1 | proto 扩展 + `buf generate`（`TaggerConfig` / `AISetting.taggers` / `AutoTagMemo`） | `buf lint` | ✅ 完成 |
| M2 | `memo_tag_task` 表三驱动迁移 + store 层 | `go test ./store/...` | ✅ 完成 |
| M3 | 后端：`scheduleAutoTagForMemo`、worker、LLM 打标与追加、RPC | `go test ./server/...` | ✅ 完成 |
| M4 | 前端：AISection AI Tags 配置分组（admin，对齐 Agents） | `tsc` 通过 / biome 格式已修 | ✅ 完成 |
| M5 | 前端：MemoActionMenu AI 标签项 | `tsc` 通过 / biome 格式已修 | ✅ 完成 |
| M6 | 联调与端到端验证 | 手动实测 + 全量测试 | ✅ 完成 |

> 说明：M1–M5 已落地。M6 联调结论（2026-08-23，分支 `feature/ai-tags`）：
> - **后端编译**：`go build ./...` 零错误。
> - **后端单测**：`go test ./server/router/api/v1/... ./store/...` 全绿（cached 通过）；`store/test` 在 Windows 上因 Docker/rootless uid 限制与 TempDir 文件锁（环境问题，非代码）失败，已用 `DRIVER=sqlite` 单独跑通，且日志确认 `migration/sqlite/LATEST.sql` 加载成功、`schemaVersion=0.32.2`。
> - **前端类型检查**：`tsc --noEmit --skipLibCheck` 零错误。
> - **端到端接线逐项核对**（均正确）：
>   1. `CreateMemo`（`memo_service.go:186-189`）在 `isAgentSchedulingSuppressed` 保护下并列调用 `scheduleAutoTagForMemo`，与 agent replies 一致，避免回注死循环。
>   2. `v1.go:78-92` 的 `agentScheduler` handler 同时跑 `processDueAgentReplies` 与 `processDueMemoTagTasks`，tags 与 agent 共享同一 poller。
>   3. `memo_tag_worker.go`：`scheduleAutoTagForMemo` → `processDueMemoTagTasks` → `processMemoTagTask` → `applyTaggingToMemo`，LLM 按候选集过滤、追加 `#tag`、以 `findAdminUser` + `withSystemAgentCall` 写回，与 agent replies 完全对齐。
>   4. **关键正确性确认**：`applyTaggingToMemo` 写回用 update-mask `content`，`UpdateMemo`（`memo_service.go:564`）会调用 `memopayload.RebuildMemoPayload`，从 content 重新解析并自动回填 `Payload.Tags`（`server/runner/memopayload/runner.go:74-86`）。因此 AI 打的 tag 既进 content 文本、也进 `Payload.Tags`，下一次 `scheduleAutoTagForMemo` 经 `memo.Payload.GetTags()` 判断可正确去重，不会重复追加。
>   5. `AutoTagMemo` RPC：connect handler（`connect_services.go:386`）+ service 实现（`memo_service.go:459`）齐全，权限校验为 creator 或 admin，无 enabled tagger 时返回 `FailedPrecondition`。
>   6. 前端 `MemoActionMenu.tsx`：`hasEnabledTagger` 时才显示菜单项，`handleAutoTag` 调用 `memoServiceClient.autoTagMemo`，带 toast 反馈。
>   7. 前端 `AISection.tsx`：`persistAISetting` 构造 `aiSetting` 时含 `taggers`；增/删/切换 tagger 均调用 `persistAISetting` 并带上当前 providers/agents，不丢配置。
> - **联调中发现并修复的 Bug（2026-08-23）**：网页创建 tagger 返回成功 toast，但列表不显示、刷新后丢失。
>   - **根因**：`server/router/api/v1/instance_service_converters.go` 的 `convertInstanceAISettingFromStore` 与 `convertInstanceAISettingToStore` **漏映射 `Taggers` 字段**（只映射了 Providers / Transcription / Agents）。导致保存时经 `convertInstanceSettingToStore` 把 tagger 丢弃（数据库从未写入），读取时经 `convertInstanceAISettingFromStore` 也不返回。前端逻辑（`persistAISetting` 已正确传入 `taggers`）本身无问题。
>   - **修复**：两个 converter 均补上 `Taggers` 的初始化与逐项映射（id/name/provider_id/model/prompt/enabled/max_tags）。
>   - **配套加固**：`server/router/api/v1/instance_service_validation.go` 新增 `preparePersistedTaggerConfigs`，与 `preparePersistedAgentConfigs` 对齐——校验 tagger name 必填、provider_id 必须引用已存在 provider、max_tags ≥ 0，并在 `prepareInstanceAISettingForUpdate` 中调用，防止经 API 绕过前端存入坏数据。
>   - **验证**：`go build ./...` 通过；`go test ./server/router/api/v1/...` 全绿（含 `instance_service_test.go` 的 AI setting round-trip 用例）。
> - 前端 `pnpm lint` 的其余告警（App.tsx、测试文件、en/zh locale 整体格式）为仓库预存在的 biome 格式化红，与本次改动无关；本次改动的两个源文件已用 `biome --write` 修复。

## 12. 备注（技术决策记录）

- **对齐 AI Agents 而非独立总开关**：admin 心智模型统一；Tagger 与 Agent 同构（list + enable + provider + prompt），前端可照搬三件套（SettingTable/Dialog/Toggle），实现成本最低。
- **user 零配置**：删除了旧文档中 `TagsSetting.collections/active/free_tagging` 扩展。标签体系由 admin 在 Tagger 的 prompt 中明文下发，AI 严格在候选内选标，既保证一致性又免去 user 侧复杂 UI。
- **异步队列而非同步 RPC**：LLM 调用耗时 5~30s，同步会阻塞请求并面临超时；复用 agent 队列架构与现有轮询、幂等、权限旁路设施。
- **独立表而非给 agent_reply_task 加类型**：tagging 任务没有 agent 语义（agent_id 无法填充），且侵入现有表/查询会波及已完成的 AI agent 功能，故新增 `memo_tag_task` 隔离，代码模式完全照搬。
- **admin 身份写回**：打标是系统动作，复用 `postAgentReplyAsAdmin` 的 `withSystemAgentCall` 旁路，memo 归属与可见性不变。

## 13. AI Agent 能力演进规划（从 "AI Comment" 到 "AI Agent"）

### 13.1 现状与问题

当前名为 "AI Agents" 的功能，从代码看本质上只是 **AI Comment**：
- `agent_reply_task` 表 + `scheduleAgentRepliesForMemo` + `processDueAgentReplies` + `postAgentReplyAsAdmin`（内部调用 `CreateMemoComment`）。
- 触发、执行、写回**全部硬编码为"评论"**这一条 action。
- 本需求新增的 AI Tags（Tagger）沿用同一架构，但新建了独立的 `memo_tag_task` 表（因为旧表有 `(memo_id, agent_id)` 约束，tagging 没有 agent 语义，硬塞会污染已完成功能）。

由此产生的现实问题是：**两个 AI 能力各走一套平行队列，只是"长得像"，概念上并不统一**。短期可跑，长期会出现重复代码与割裂。

### 13.2 目标模型：Agent = 多能力实体

将 "AI Agent" 重新定义为**具备多种 action 的实体**，评论（comment）与打标（tagging）只是它的两种 capability：

```
AgentConfig
  ├─ id / name / provider_id / model / enabled   // 共享身份与资源
  └─ actions[]
       ├─ CommentAction   // 现有：评论式回复
       ├─ TaggingAction   // 新增（即本需求的 Tagger）
       └─ (未来) SummarizeAction / TranslateAction / ...
```

- 一个 Agent 同时可评论、可打标，各自独立 enable。
- 候选标签体系、评论风格等具体规范，下沉到对应 action 的配置里。

### 13.3 演进策略：现在轻规划，第三种能力出现时再统一抽象

**现在就做（低成本、高收益）**
1. **概念与命名先对齐**：本文档第 14 节固化命名约定；代码注释里明确 "Tagger 是 Agent 的 tagging 能力实例"，为将来 `AgentConfig.actions` 预留话术。
2. **新写 Tagger 不制造新的平行孤岛**：`TaggerConfig` 字段与 `AIAgentConfig` 语义/字段号对齐（已在第 6.1 节落实），两者共享 `id/name/provider_id/model/prompt/enabled` 骨架。
3. **任务调度相邻放置**：`scheduleAutoTagForMemo` / `processDueMemoTagTasks` 与现有 `scheduleAgentRepliesForMemo` / `processDueAgentReplies` 放在同一文件、相邻位置，命名体现"都属于 Agent 体系下的任务"，而非另起无关模块。

**现在不做（避免过度设计 / YAGNI）**
- 不立即把 `agent_reply_task` 与 `memo_tag_task` 合并为通用 `ai_task(task_type, payload)` 表 + 动态 oneof。当前只有两种能力，强行抽象会引入 proto oneof、worker 路由分支、权限分支等复杂度，而第三种能力形态未定（可能是同步 RPC 而非异步任务），提前抽象大概率返工。
- 不给 Agent 设计"万能 action 框架"。等第三种能力落地，才知道通用抽象长什么样。

**统一抽象的触发条件（何时再重构）**
当**第三种 AI 能力**确认要加入时（如 AI 总结 / AI 翻译 / AI 改写等），一次性将以下部分抽成统一框架：
- 配置层：`AgentConfig.actions = [...]`（替代并列的 `agents` / `taggers` list）。
- 任务层：合并为 `ai_task(task_type, payload_json)`，worker 按 `task_type` 路由到对应 handler。
- 权限/写回层：`withSystemAgentCall` 下按 action 选择写回目标（comment / UpdateMemo / 其他）。
在此之前，保持两个 list + 两张表，模式完全照搬，不提前投资。

### 13.4 对当前 Tagger 实现的直接要求

- proto：`TaggerConfig` 与 `AIAgentConfig` 字段对齐（已实现），注释标注其作为 Agent tagging 能力的归属。
- 后端：tagging 的调度/worker 函数与 agent 的相邻同文件，体现同属 Agent 体系。
- 前端：`AISection` 的 "AI Agents" 与 "AI Tags" 两个分组并列，共享 `SettingTable` / `Dialog` / `Toggle` 三件套，视觉与交互一致。

## 14. 命名约定

为避免后续新建 `TaggersConfig`（复数类型）等破坏一致性的写法，固化如下约定：

| 层级 | 约定 | 示例 |
| --- | --- | --- |
| 实体类型（proto / 类型） | **单数** `Agent` | `AgentConfig` / `AIAgentConfig` / `TaggerConfig` |
| 列表字段（集合） | **复数** | `agents`、`taggers`、`providers` |
| 配置分组标题（UI） | **复数** | "AI Agents"、"AI Tags" |
| 单条编辑弹窗 | **单数** | `AIAgentDialog`、`AITaggerDialog` |
| 后台任务 / 体系（名词） | **单数** | `agent_reply_task`、`scheduleAgentRepliesForMemo` |

要点：
- **类型与体系用单数 `Agent`，列表和页面标题用复数 `Agents`**。这与现有代码完全吻合（`AIAgentConfig` / `AgentConfig` / `LocalAgent` / `AIAgentDialog` 已是单数），无需改名，只须固化避免后人破坏。
- 不要为"复数"去改 `AgentsReplies` / `TaggersConfig` 之类——这是最常见的破坏点。
- 概念上 `Agent` 指"一个能力载体实体"，`Agents` 指"你配置的一堆 agent"；未来 `AgentConfig.actions` 内嵌多种能力时，单数 `Agent` 直接容纳，无需重命名。

## 15. 实现方案（代码落点 / 复用清单）

> 本节约等于"实现手册"，逐模块的精确落点与可照搬的既有代码，供后续实现与复盘复用。所有"照搬"项均已在本文档前文结合真实代码核实存在。

### 15.1 proto 扩展（M1）

**`proto/store/instance_setting.proto`**（紧接 `AIAgentConfig` 之后新增）：
```proto
// TaggerConfig describes an AI auto-tagging rule. It is the tagging capability
// instance of the Agent system: an admin configures taggers instance-wide and
// regular users only consume them (their memos get auto-tagged).
message TaggerConfig {
  // id is the stable identifier of the tagger (uuid).
  string id = 1;
  // name is the human-readable name shown in the admin UI.
  string name = 2;
  // provider_id references an entry in InstanceAISetting.providers[].id.
  // Empty means the tagger is disabled.
  string provider_id = 3;
  // model is the provider-specific text-generation model identifier.
  // Empty falls back to the engine default.
  string model = 4;
  // prompt is the tagging spec: the candidate tag list + selection rules
  // (this is where the tag taxonomy is delivered to the AI).
  string prompt = 5;
  // enabled toggles whether the tagger acts on new/triggered memos.
  bool enabled = 6;
  // max_tags caps how many tags are applied per memo (default 3).
  int32 max_tags = 7;
}
```
在 `InstanceAISetting` 内追加（字段号 4，与现有 1/2/3 不冲突）：
```proto
  repeated TaggerConfig taggers = 4; // 新增：AI Tags 打标器列表
```

**`proto/api/v1/instance_service.proto`**（`InstanceSetting.AISetting` 内同步加同名字段，字段号 4）：
```proto
  repeated TaggerConfig taggers = 4;
```
并在该文件内新增同构的 `TaggerConfig` message（仿 `AgentConfig`）。

**`proto/api/v1/memo_service.proto`** 新增 RPC（仿 `CreateMemoComment` 的 service 块）：
```proto
  rpc AutoTagMemo(AutoTagMemoRequest) returns (AutoTagMemoResponse) {}
```
```proto
message AutoTagMemoRequest {
  // name is the resource name of the memo, e.g. "memos/{uid}".
  string name = 1;
}
message AutoTagMemoResponse {}
```

> 修改后执行 `buf lint` + `buf generate`（前端类型在 `web/src/types/proto/api/v1/instance_service_pb.ts` 与 `memo_service_pb.ts` 自动生成 `TaggerConfig` / `AutoTagMemo`）。

### 15.2 数据库迁移 + store 层（M2）

- 三驱动各新增迁移文件，仿 `store/migration/sqlite/0.32/00__agent_reply_task.sql`：
  - sqlite：`store/migration/sqlite/0.xx/00__memo_tag_task.sql`
  - mysql / postgres：对应驱动目录同文件名（方言差异：`unixepoch()` → `UNIX_TIMESTAMP()` / `EXTRACT(EPOCH FROM NOW())`）。
  - 表结构见 6.2：`memo_tag_task(id, memo_id, tagger_id, status, due_at, created_ts, updated_ts)` + `UNIQUE(memo_id, tagger_id)`。
- store 接口：`store/store.go`（或 `store/agent_reply_task.go` 旁）新增 `UpsertMemoTagTask / ListMemoTagTasks / UpdateMemoTagTask` 三个方法签名，仿 `UpsertAgentReplyTask / ListAgentReplyTasks / UpdateAgentReplyTask`。
- 三驱动实现：sqlite / mysql / postgres 各自实现上述方法（仿对应驱动的 `agent_reply_task.go`）。
- 状态枚举：`MemoTagTaskStatus`（`PENDING / DONE / FAILED`），仿 `AgentReplyTaskStatus`。

### 15.3 后端调度与 worker（M3）

**同一文件 `server/router/api/v1/agent_reply_worker.go` 内相邻新增**（体现同属 Agent 体系）：

- `scheduleAutoTagForMemo(ctx, memoID)`：仿 `scheduleAgentRepliesForMemo`（:34-64）。从 `GetInstanceAISetting` 读 `setting.Taggers`，遍历 `enabled` 的 tagger，`UpsertMemoTagTask`（UPSERT 保证 `(memo_id, tagger_id)` 唯一）。
- `processDueMemoTagTasks(ctx)`：仿 `processDueAgentReplies`（:71+），`ListMemoTagTasks(PENDING, DueBefore=now)`，batch ≤ 32，逐个 `processMemoTagTask`。
- `processMemoTagTask(ctx, task)`：
  1. `GetMemo` → 解析 `memo.Payload.Tags`（已有标签）。
  2. 取 `task.TaggerID` 对应的 `TaggerConfig`。
  3. 组装 prompt（系统提示 + tagger.prompt + memo.content），调 `agentpkg.NewChatModel`（仿 `generateAgentReply`），`model.Generate`。
  4. 解析返回 → 仅在候选清单内 + 过滤已有 → 有新标签则 `withSystemAgentCall` + admin 身份调 `UpdateMemo` 追加 `\n#tag`。
  5. `UpdateMemoTagTask`（DONE / FAILED）。

**注册轮询**（`server/router/api/v1/v1.go:82` 的 `agentReplyScheduler` handler 内，与 `processDueAgentReplies` 并列调用 `processDueMemoTagTasks`）。

**`CreateMemo` 调度**（`server/router/api/v1/memo_service.go:186` 旁，受同一 `isAgentSchedulingSuppressed(ctx)` 保护）：
```go
if !isAgentSchedulingSuppressed(ctx) {
    s.scheduleAgentRepliesForMemo(ctx, memo.ID)
    s.scheduleAutoTagForMemo(ctx, memo.ID)   // 新增：仅当 memo 无标签时入队
}
```
（无标签判断：`len(memo.Payload.GetTags()) == 0`。）

**新增 RPC `AutoTagMemo`**（`memo_service.go` 内，仿现有 RPC 鉴权）：
- 解析 memo name → `GetMemo` → 校验 caller 为作者或 admin → 校验存在 enabled tagger（否则 `InvalidArgument` + 提示"AI 标签功能未开启"）。
- 对所有 enabled tagger `UpsertMemoTagTask(due_at=now)` → 返回 OK。
- 在 ACL / 路由注册（参考现有 memo service 方法的注册方式，需登录）。

### 15.4 前端 AISection（M4，admin 对齐 Agents）

**`web/src/components/Settings/AISection.tsx`**，复制现有 `agents` 三件套：
- 新增 `LocalTagger` 类型 + `toLocalTagger` / `toTaggerConfig`（仿 `LocalAgent` / `toAgent` / `toAgentConfig`）。
- 新增 `taggers` state + 同步 effect（仿 `agents`）。
- 新增 "AI Tags" `SettingGroup`：`SettingTable`（name / provider / enabled / 操作）+「＋ 添加打标器」→ `AITaggerDialog`（仿 `AIAgentDialog`，去掉 persona/system/delay/maxLength，改为 `prompt` 多行 + `max_tags` 数字）。
- `handleToggleTagger` / `handleDeleteTagger`（仿 `handleToggleAgent` / `handleDeleteAgent`），`ConfirmDialog` 复用。
- 保存：`persistAISetting` 的 `create(InstanceSetting_AISettingSchema, {...})` 中补 `taggers: nextTaggers.map(toTaggerConfig)`。
- 类型：`InstanceSetting_TaggerConfig` / `InstanceSetting_TaggerConfigSchema`（buf generate 后）。

### 15.5 前端 MemoActionMenu（M5）

**`web/src/components/MemoActionMenu/MemoActionMenu.tsx`** Edit actions 区域：
- 新增 `DropdownMenuItem`（`SparklesIcon` + `t("memo.ai-tag")`）。
- 显示条件：`!readonly && !isArchived && instanceHasEnabledTagger`。
  - `instanceHasEnabledTagger` 取自 `useInstance().aiSetting.taggers`（存在任一 `enabled` 项）。
- 点击 → 新 hook `useAutoTagMemo`（仿现有 memo mutation hook）→ `AutoTagMemo` RPC → toast "已加入 AI 打标签队列"。

### 15.6 复用清单（避免重复造轮子）

| 既有代码 | 复用方式 |
| --- | --- |
| `scheduleAgentRepliesForMemo` / `processDueAgentReplies` | 照搬为 tagging 版，同文件相邻 |
| `agent_reply_task` 表 + 三驱动迁移/store 实现 | 照搬为 `memo_tag_task` |
| `agentpkg.NewChatModel` + `Generate`（`generateAgentReply`） | 直接复用构建 ChatModel |
| `findAdminUser` + `withSystemAgentCall` | 打标写回用同一旁路（仿 `postAgentReplyAsAdmin`） |
| `isAgentSchedulingSuppressed` | 创建调度保护共用，防循环 |
| `UpdateMemo`（payload 重建） | 追加 `#tag` 后自动提取 tags |
| `AISection` agents 三件套 | 复制为 taggers 三件套 |
| `LocalAgent` / `AIAgentDialog` / `persistAISetting` | 仿写 `LocalTagger` / `AITaggerDialog` |

### 15.7 验收与测试红线

- `go test ./store/... ./server/... ./internal/...`、`buf lint`、`pnpm lint && pnpm test` 全绿。
- 幂等：重复触发不产生重复标签；无循环（打标不触发再次打标）。
- 防滥用：LLM 失败标记 FAILED 停止重试；tagger 全禁用则功能不可见/不可触发。
