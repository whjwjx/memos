# AI Agent 对话式助手 —— 设计讨论记录

> 作者：whjwjx
> 状态：设计讨论已完结（2026-08-26），待进入技术设计
> 时间线：2026-08-26 起
> 关联文档：`AI-Agents-需求.md`（既有"AI 自动评论 Agent"需求，已实现 P0~P2）

---

## 0. 背景：本轮要解决的问题

既有 AI 能力（见 `AI-Agents-需求.md`）是"被动触发"的：
- 音频转写（Transcribe）
- 新建 memo 后自动评论（Agent Reply）
- 新建 memo 后自动打标签（Auto Tag）

本轮目标是新增一个**对话式 Agent（Chat Bot）**，让 AI 从"被动执行单个任务"升级为"能与用户对话、主动编排上述能力、并扩展出查询/配置/管理类能力"。

---

## 1. 总体架构方向（已确认）

### 1.1 统一一个 Chat，角色感知
- **不**做"用户侧 Bot"和"管理侧 Bot"两套。只有**一个**对话入口 `ai:chat`。
- 角色在**请求时由登录态判定**，而非 Bot 身份。
- 后端在**组装工具列表时按角色过滤**：user 看不到 admin 工具，越权天然不可能。

### 1.2 agent = LLM + 工具/插件（可单独启用或关闭）
- 工具（tool / plugin）做成**插件化、可独立开关**。
- 复用既有 `InstanceAISetting` 配置体系（provider / agent / tagger 已是该思路）。
- 每个工具是一个插件：`enabled` 开关 + 可能的自有配置。
- 新增工具 = 注册一个新插件，不碰核心代码。
- **admin 工具默认关闭**，需显式开启。

### 1.3 现有 AI 功能整合为工具
- 自动回复（Agent Reply）→ 封装为 `agent_reply` 工具
- 自动打标签（Auto Tag）→ 封装为 `auto_tag` 工具
- 语音转写（Transcribe）→ 改造为 `transcribe_memo_audio` 工具（参数传附件 id，内部复用 `stt`/`audiollm`；2026-08-26 已确认，见 4.1）
- 原有"新建 memo 自动触发"行为**保留**（worker 不变），同时额外暴露成工具供 Agent 主动调用，两者并存。
- 上述功能配置统一落在线一（Settings → AI 配置区），触发入口保持现状（见 2.4、第 4 节）。

### 1.4 function calling 是硬前置（已核实）
- 现有 `internal/ai/chat/chat.go` 的 `Request` 只有 `System/Messages/Model/Temperature/MaxTokens`，**不支持 tool calling**。
- OpenAI / Gemini 实现均未传 `Tools` 参数。
- 阶段 1 必须先给 `chat` 包补上 function calling 能力（双 provider 都加）。

### 1.5 架构选型：单 Agent + 多 Skill（工具注册表），不采用多 Agent 编排（2026-08-26 确认）
- **结论**：采用**单 Agent + 多 Skill（工具注册表）** 模式。暂不引入"主 Agent + 多子 Agent"编排框架。
- **理由对比**：
  - 多 Agent 的理论优势（专业人格隔离、上下文节省、并行、失败隔离）在本项目几乎无收益——转写/评论/标签/查 memos/查评论均为**简单、单步、无状态**能力，开独立 LLM 会话纯属 overhead，且不会被彼此污染。
  - 多 Agent 明显劣势：复杂度暴增（需写调度/消息传递/聚合/错误传播）、成本更高（每子 Agent 一次独立调用）、延迟更高、调试难。
  - 项目规模（个人/小团队笔记工具）不需要工业级多 Agent 分工。
- **例外处理**：仅对"需要处理大量源数据再生成"的重任务（如 `summarize_requirements` 需求汇总），用**工具内多步检索 + 返回摘要**替代独立子 Agent，避免撑爆主 Agent 上下文，而不引入 Agent 间编排。
- **Skill 与 Tool 同义**："多 Skill"即已确认的"工具注册表"方案，无需额外抽象层。

---

## 2. 两条独立的 AI 主线（务必区分，勿混淆）

> ⚠️ 关键澄清（2026-08-26 确认）：**"AI 配置 UI"** 与 **"Chat 功能入口"** 是两套完全不同的东西，分属不同用户、不同位置、不同目的，不可统称"侧边栏 AI"。

> 术语澄清（避免混淆）：项目中存在两种"Agent"——
> - **对话 Agent（chat agent）**：本轮新增。用户在 `/ai-chat` 与之对话的助手（人格 + 模型 + 工具集），配置存于 `InstanceAISetting` 新字段（建议 `chatAgents[]`）。
> - **自动评论 Agent（reply agent）**：既有 `agents[]`，admin 配置的"评论人格"，由 worker 在新建 memo 后自动生成评论，**不参与对话**。
> - 两者都叫 Agent，但**语义 / 存储字段 / 触发方式完全不同**。线一配置 UI 里：reply agent 归"AI 功能配置区"（评论配置），chat agent 归"Agent 配置区"。

### 2.1 线一：管理员 AI 配置 UI（重构对象，位于 Settings 内）
- **归属**：admin 专属，在 **Settings → AI** 配置页内（非主侧边栏），即现有 `web/src/components/Settings/AISection.tsx` 的重组织。
- **目的**：admin 配置 AI 能力与对话 Agent（填 key、选模型、写 prompt、启停）。user 不进入此页。
- **重构内容**：把 `AISection` 内部重组为两个分区：
  - **AI 功能配置区**：转写 / 评论 / 标签 各自的 provider、模型、prompt、启停配置
  - **Agent 配置区**：对话 Agent 预设（内置 2 个 + 可扩展），建议字段：
    - `id` / `name`（显示名）/ `builtin`（内置标记，内置不可删可改）
    - `systemPrompt`（人格 / 系统提示词）
    - `provider` + `model`（绑定的模型，从已配 provider 里选）
    - `tools[]`（被授权工具集，可逐工具开关）
    - `enabled`（总开关）
- **位置性质**：左侧导航进入的 Settings 内页（"左边"）。

### 2.2 线二：用户 Chat 功能入口（使用侧，顶部导航右侧）
- **归属**：所有登录用户（user / admin 均可用），是**使用** Agent 的入口，不做配置。
- **位置**：顶部全局导航栏，在 **inbox 右侧** 新增一个 `AI` 入口（图标 `BotIcon`）——与 inbox/attachments 同构，仅一个图标，**不新增任何"展开/关闭"按钮**。
- **行为**：点击跳转到**无边框的全屏会话页** `/ai-chat`（独立路由页，非抽屉、非侧边栏），页面内含对话流 + 输入区（**阶段 1 单默认 Agent、无选择器**；出现第 2 个预设后才显示 Agent 选择器，见 5.1）；返回靠浏览器后退（移动端全屏页顶部保留返回按钮）。
- **与线一的关系**：admin 在"线一"配好的 Agent 预设，user 在"线二"的对话页使用（多预设时经选择器切换）；两者通过 `InstanceAISetting` 关联。

### 2.3 一句话区分
- **左边（Settings 内）= admin 配 AI**（配置后台）
- **右边（顶部导航）= user 用 Chat**（对话入口）
- 两者通过配置数据解耦，角色分层在后端工具注册阶段拦截。

### 2.4 原"侧边栏 AI 重构"说法的修正
此前讨论中"侧边栏 AI 重构，分为 AI 功能 / Agent"指的是**线一（admin 配置 UI 的内部重组）**，不是主侧边栏新增入口；主侧边栏/顶部导航不新增 AI 功能入口，仅顶部加一个 Chat 跳转项（线二）。

### 2.5 入口形态决策：整页会话而非右侧抽屉（2026-08-26 确认）
- **结论**：**不做右侧抽屉**。采用「整页 `/ai-chat` + 顶部 AI 图标入口」。
- **理由**：
  - chat 是**任务型** UI（专注对话），不是**参考型** UI（需与 memo 列表同屏），天然适合整页。
  - 抽屉方案需要在顶部导航/页面边缘增加"展开/关闭"按钮，**引入多余 UI 样式**；整页方案零额外 UI 层级。
  - **移动端**：整页就是全屏对话页，与手机对话 App 一致；抽屉在移动端要么半屏挤占、要么全屏（等于路由页），体验差。
- **全局可用的补偿方案（阶段 2，非阶段 1）**：
  - **memo 操作菜单 → "问 AI"入口**：点击带上下文跳转 `/ai-chat?memo=xxx`；chat 页顶部显示上下文条（"正在讨论：xxx"）。比抽屉更克制、显式，移动端可用。
  - ~~可选：全局快捷键唤出 chat~~ —— **不做**（2026-08-26 确认），保持无额外快捷键
- **不采用**：右侧抽屉（UI 开销高、移动端差）；右上角浮动按钮（突兀）。

---

## 3. 用户确认的四点（2026-08-26）

| # | 议题 | 结论 |
|---|---|---|
| 1 | AI 功能模块的位置 | **保持现在的位置**，主要是 admin 配置、user 只管使用（维持现状） |
| 2 | admin 内容 | **可以内置 2 个**预设 Agent（admin 侧） |
| 3 | 写操作确认机制 | **Agent 帮用户改设置/创建 memo/打标签等写操作，均需用户确认** |
| 4 | 自动评论 / 自动打标签 | **保持现状**（自动触发行为不变，新增手动按钮为补充） |

### 3.1 配置模型决策（2026-08-26 补充，关键）
- **保持实例级配置（模型 A）**：AI 功能（转写/评论/标签）的配置仍只在 admin 侧，user 继续"只管用"，**不各自填自己的 API key**。
- **user 在 Agent 里只能改"自己的用户级设置"（选项 b）**：如默认时区、默认转写语言等 `UserSetting` 字段；**不能改实例级 AI 配置**（provider / api_key / 全局开关）。
- 实例级 AI 配置只有 admin 能改；角色分层在工具注册阶段拦截（user 看不到 admin-only 工具）。
- 理由：与既有 `AI-Agents-需求.md` 设计原则一致（admin 掌控 key 与成本），且成本可控、避免用户 key 泄露。
- 推论：`manage_settings` 工具需区分两层——user 只能写 `UserSetting` 个人字段；admin 才能写 `InstanceAISetting`。

---

## 4. 用户侧「AI 功能」模块（原子能力）

> 归属说明（对齐第 2 节）：**配置在 Settings → AI（线一，admin 配）**；**触发位置保持现状**——散落在 memo 编辑器/附件/操作内，**不在主侧边栏**（见 2.4）。此处描述的是能力定义与触发场景，非独立入口。

### 设计原则
- 每个功能**可单独配置**（provider / 模型 / prompt）——由 admin 在线一配置区完成
- 每个功能**可触发**（在合适上下文出现按钮）——user 在 memo 场景触发
- 状态可见（运行中 / 完成 / 失败重试）

### 4.1 AI 转写（Transcribe）
- 编辑器录音/上传音频 → "转写"按钮 → 文字填入编辑器
- 也可在已有 memo 的音频附件上点"转写"
- 配置：模型（whisper-1 / gpt-4o-transcribe）、语言、自定义提示
- 同时封装为工具 `transcribe_memo_audio(attachment_id)` 供 Agent 对话调用（2026-08-26 确认）；对话内**异步提交 + 查询状态**（转写耗时，不阻塞等结果）

### 4.2 AI 评论（Comment / Agent Reply）
- 写完 memo → 点"让 AI 评论一下"→ 以配置 persona 生成评论
- 或配置"自动评论"（现有 worker 行为保留）
- 配置：Agent 人格、延迟、最大长度、开关

### 4.3 AI 标签（Tags / Auto Tag）
- 写完 memo → 点"自动打标签"→ 从候选集挑 `#标签` 追加
- 或配置"自动打标签"（现有行为保留）
- 配置：tagger 模型、候选标签集、最多几个、开关

> 这三个既是独立按钮，也是 Agent 能调用的工具（工具插件化在用户层的具体落点）。

---

## 5. 用户侧「Agent」模块（对话式助手）

### 5.1 Agent 预设（2026-08-26 确认：阶段 1 单默认 Agent）
- **阶段 1：单默认 Agent**，`/ai-chat` 直接使用，**不显示选择器**；当 admin 配置出第 2 个预设后，选择器才出现（页面顶部下拉）
- 每个 Agent = 一套预设（系统提示词 + 绑定 provider/模型 + 被授权工具集）
- 多预设（admin 内置模板，如 `通用助手`、`需求整理师`）仅是换 system prompt（见 1.5），属 admin 侧扩展能力
- **用户自建 Agent：不做**（2026-08-26 确认）
- 切换 Agent = 切换"人格"与"能力范围"，**始终以当前登录用户身份**操作
- **兜底**：当无任何 Agent 预设（admin 未配置）时，`/ai-chat` 显示空态引导："管理员尚未配置对话 Agent，请到 设置 → AI → Agent 配置区 添加"，入口仍可见（user 只读提示，不引导配置）。
- **对话窗口（会话）**（2026-08-26 确认）：`/ai-chat` 以"对话窗口"为单位组织，用户可新建多个窗口、切换查看；每个窗口**独立持久化历史**（数据库 `conversations` / `messages`），**切换 Agent 不清空历史**（历史归属会话而非 Agent）。当前架构为"1 个 Agent 框架 + 多 skill"（见 1.5），不同预设人格仅是切换 system prompt，不做多 Agent 编排。

### 5.2 对话中 Agent 能做的事（用户感知）
- "查最近写的 10 条 memos" → `search_memos`
- "我最近都写了哪些 memo / 我的队列任务状态" → `query_my_data`（行级只读，仅自己数据）
- "这条 memo 下面最近的评论" → `get_comments`
- "把今天写的开发需求整理成一条汇总 memo" → `search_memos` + `create_memo`（核心场景 ✅）
- "把这段录音转写一下" → `transcribe_memo_audio`
- "给这条 memo 打个标签" → `auto_tag`
- "把个人时区改成上海" → `manage_settings`（需确认）
- "介绍项目能干什么" → 内置项目知识 / 调工具查实在信息

**体验要点**：工具调用时 UI 显示中间状态（"正在查询 memos…"）、流式输出、会话内多轮记忆、历史跨窗口持久化。

### 5.3 三层含义（对应原话）
- **使用所有功能**：聊天时 Agent 主动调用三个 AI 功能 + 查询类工具
- **帮用户进行配置**：用户说"帮我把自动打标签打开" → `manage_settings`（需确认）
- **使用用户的配置**：Agent 默认继承用户已有的 AI 功能配置（转写模型、tagger 候选集等）

### 5.4 写操作确认卡片（2026-08-26 确认）
- 写操作工具（`create_memo` / `manage_settings` 改设置 / 清队列等）被调用时**不直接执行**，后端先返回"待确认"状态
- 前端弹出**确认卡片**：展示将要执行的操作与参数预览（如"创建 memo：<内容摘要>"、"修改设置：时区 → Asia/Shanghai"）
- 点 **允许** → 放行执行并继续对话；点 **取消** → 不执行，把结果反馈给 Agent 继续沟通
- 查询类工具（`search_memos` / `get_comments` 等）**不需确认**，直接执行

---

## 6. 管理员视角差异（仅补充，不展开实现）
- admin 身份**双用**（勿混淆）：
  - **配置**：在 Settings → AI（线一）配 provider / 功能 / Agent 预设
  - **使用**：在 `/ai-chat`（线二）作为高级用户对话，额外拥有**管理工具**
- 登录为 admin 时，**工具列表按角色多出管理工具**（非因多 Agent 预设）：查队列、查数据库表、看日志、项目状态（见 1.1 角色过滤）
- UI 明显标注"管理操作"，且默认关闭需显式开启
- "角色感知"在用户层表现为"可用 Agent/工具的不同"
- **日志配置（阶段 2）**：日志落盘（保留天数 / 级别）在 admin Settings 可配置，默认保留 3 天（见第 8 节）

---

## 7. 工具全集（规划，含现有功能整合）

| 插件名 | 来源 | 角色 | 默认 |
|---|---|---|---|
| `search_memos` | 新 | USER | 开 |
| `get_comments` | 新 | USER | 开 |
| `manage_settings` | 新 | USER | 开 |
| `create_memo` | 新 | USER | 开 |
| `summarize_requirements` | 新 | USER | 开 |
| `agent_reply` | 现有自动回复 | USER/ADMIN | 开 |
| `auto_tag` | 现有自动打标签 | USER/ADMIN | 开 |
| `transcribe_memo_audio` | 现有转写（改造） | USER | 开 |
| `query_queue` | 新 admin | ADMIN | 关 |
| `query_my_data` | 新 | USER | 开 |
| `query_db` | 新 admin | ADMIN | 关 |
| `get_logs` | 新 admin | ADMIN | 关 |
| `project_status` | 新 admin | ADMIN | 关 |

### 7.1 数据查询白名单设计（2026-08-26 更新：user 行级只读 / admin 全量 CRUD）
**默认不暴露"任意 SQL"**，按角色拆两个工具：
- **层 1（优先）专有只读工具**：高频管理场景走项目已有 store API（`query_queue` 查 `agent_reply_task`/`memo_tag_task` 状态、`project_status` 查 memo/用户/队列积压数），天然安全、零注入面。
- **层 2（通用兜底）**：
  - **`query_my_data`（USER，默认开）**：只读 SELECT。后端**强制注入行级过滤**（`memo.creator_id = me`、`inbox.receiver_id = me` 等），Agent 无法指定他人数据；**不开放 INSERT/UPDATE/DELETE**（user 的写走专有工具 + 确认卡片）。
  - **`query_db`（ADMIN，默认关）**：全量 SELECT + INSERT/UPDATE/DELETE，供 admin 维护数据库。**所有写操作走确认卡片**（5.4）；**DELETE/UPDATE 除影响行数展示外需二次确认**（如输入"yes"或目标 id，2026-08-26 确认）。

**实现原则（skill 封装为接口，不裸 SQL）**：
- 所有 skill 优先封装为对项目已有 **store / service 接口**的调用（如 `search_memos` → `store.ListMemos`、`query_queue` → store 查 `agent_reply_task`），skill 内部不直接写 SQL
- `query_db` 是唯一例外（需通用查询）：由后端**基于白名单参数化生成 SQL**——表/字段名经白名单映射为后端常量，where 值参数绑定；**LLM 只传结构化参数 `{table, fields[], where[], limit}`，任何情况下不接收 SQL 字符串**（admin 同样适用）

**表级白名单**（可查/可改）：`memo`、`user`（字段过滤）、`attachment`（元数据）、`agent_reply_task`、`memo_tag_task`、`inbox`、`reaction`、`tag`、`memo_relation`（admin 全量，user 仅个人行）
**表级禁查（admin 同样生效）**：`system_setting`（API key）、`idp`（OAuth secret）、`user_identity`、`resource`（文件内容）、`webhook`——admin 改配置走 Settings UI，不让 Agent 碰
**字段级白名单**：`user` 排除 `password_hash`；`attachment` 排除 `blob`
**强制约束**：参数化查询（防注入）；`limit` 强制 ≤ 100；单次查询超时 ≤ 5s；字段截断（每字段 ≤ 512 字符）；user 版强制行级过滤

---

## 8. 决策记录（2026-08-26 全部确认，无未决）

- [x] memo 卡片统一 AI 入口：**不做独立聚合按钮**，由阶段 2 "memo 菜单 → 问 AI"承担（2026-08-26 确认）
- [x] 用户自建 Agent：**不做**；阶段 1 单默认 Agent（无选择器），多预设作为 admin 侧扩展能力（仅换 system prompt）（2026-08-26 确认）
- [x] 管理侧写操作：admin 可 CRUD 业务表（2026-08-26 确认，走确认卡片）；清队列由 `query_db` 写模式（DELETE）承担；改实例配置走 Settings UI（不让 Agent 碰）；阶段安排：阶段 3
- [x] 数据库查询范围：user 仅**行级只读**（`query_my_data`，强制 `creator_id = me`），admin 可**全量 CRUD**（`query_db`，业务表白名单 + 确认卡片）（2026-08-26 确认，见 7.1）
- [x] 日志落盘：**接受**。按日轮转，默认保留 3 天（admin 可配，集成管理侧 Settings），`get_logs` 返回前脱敏（2026-08-26 确认）
- [x] 对话上下文存储：**数据库新表（`conversations` / `messages`），会话级持久化**（2026-08-26 确认，见"对话历史"条）
- [x] **配置模型**：保持实例级（admin 配 key/模型，user 不各自配）；user 在 Agent 里只能改自己的用户级设置（选项 b），实例级 AI 配置仅 admin 可改（2026-08-26 确认）
- [x] **架构选型**：采用单 Agent + 多 Skill（工具注册表），不引入多 Agent 编排；重任务（如汇总）用工具内多步检索替代（2026-08-26 确认）
- [x] 工具开关存储：扩 `InstanceAISetting` 加 `tools` 字段（`{toolName: {enabled, ...自有配置}}`），admin 线一配置、user 继承（2026-08-26 确认）
- [x] 转写纳入工具：`transcribe_memo_audio(attachment_id)` 复用 stt/audiollm，对话内异步提交 + 查询状态（2026-08-26 确认）
- [x] `manage_settings` 工具两层权限：user→`UserSetting` 个人字段；admin→`InstanceAISetting`（**已确认**，见 3.1 推论；属实现细节，不再待定）
- [x] 全局快捷键唤出 chat：**不做**（2026-08-26 确认）
- [x] **写操作确认的技术形态**：**前端确认卡片**（2026-08-26 确认，交互见 5.4）。后端将写工具标记为"需确认"，被调用时不执行、返回待确认状态；前端渲染确认卡片（操作 + 参数预览），用户点允许/取消后放行或否决。
- [x] **对话历史与切换 Agent**：**历史保留，按会话（对话窗口）组织**（2026-08-26 确认）。多窗口各自持久化，切换 Agent 不清空历史（历史归属会话）。当前为"1 个 Agent 框架 + 多 skill"，多预设人格仅换 system prompt。
- [x] **成本 / 限流（已确认推荐）**：① 单会话轮次上限（如 50 轮，超出提醒开新窗口）；② 每用户每小时请求频率限制；③ 重工具（`summarize_requirements` 等）单次检索上限。对齐既有思路（开关 + 数量约束 + admin 掌控 key/成本，见 `AI-Agents-需求.md`），不做复杂计费。
- [x] **白名单设计（已定，见 7.1）**：`query_my_data`（USER）只读 + 强制行级过滤；`query_db`（ADMIN）全量 CRUD + 确认卡片。`system_setting`/`idp`/`user_identity`/`resource`/`webhook` 禁查（admin 同样生效），`user.password_hash`、`attachment.blob` 禁列；参数化 + LIMIT ≤ 100 + 超时 5s + 字段截断。
- [x] **admin 版 CRUD 确认强度**：确认卡片 + 影响行数展示 + **二次确认**（DELETE/UPDATE 要求输入"yes"或目标 id）（2026-08-26 确认）
- [x] **skill 实现方式**：封装为 store/service 接口，不直接写 SQL；`query_db` 由后端白名单参数化生成 SQL，**不接收 SQL 字符串**（2026-08-26 确认，见 7.1 实现原则）

---

## 9. 建议落地顺序（待确认）

- **阶段 1（核心对话 + 用户侧工具）**
  - `ai:chat` 流式接口 + Tool Calling 框架（基于 `chat.Model` 补 function calling）
  - 用户工具：search_memos / get_comments / get&update_settings / create_memo / summarize_requirements + **现有 AI 功能工具化**（agent_reply / auto_tag 包装即用；transcribe_memo_audio 异步化归阶段 2）
  - **会话存储**：`conversations` / `messages` 表（新建窗口、历史拉取、多窗口切换）
  - **写工具确认机制**：后端"待确认"状态 + 前端确认卡片（5.4）
  - **成本/限流基础版**：会话轮次上限（50 轮）+ 每用户每小时请求频率限制（阶段 1 即需，见第 8 节）
  - 重点做"需求汇总到一条 memo"（高价值、低风险）
  - 前端 Chat 页面 `/ai-chat`（独立路由页）+ 顶部导航入口（inbox 右侧，线二）；配置 UI 重构（Settings → AI 分两区，线一）
- **阶段 2（增强）**
  - **memo 操作菜单 → "问 AI"入口**：带上下文跳转 `/ai-chat?memo=xxx`，chat 页顶部显示上下文条（全局可用补偿，见 2.5）
  - **日志落盘 + `get_logs`**：按日轮转、默认保留 3 天、返回前脱敏；保留天数/级别在 admin Settings 可配置
  - **管理侧只读诊断**：admin 鉴权复用 `user.Role == admin`；新增 `query_queue`、`query_db`（只读模式）、`project_status`
  - **user 版 `query_my_data`**：行级只读通用查询（"查我自己的数据"）
  - **多 Agent 预设**（admin 扩展，仅换 system prompt，选择器在出现第 2 个预设后启用）
- **阶段 3（增强与收尾）**
  - （会话历史已在阶段 1 持久化）跨会话长期偏好记忆
  - **admin 版 `query_db` 写模式（CRUD）**：确认卡片加固（影响行数展示 + 二次确认），业务表白名单，后端参数化生成 SQL（不接收 SQL 字符串）
  - "分享项目状态"可视化/导出

---

## 10. 备注

- 本设计为对话记录，未进入编码。进入技术设计前需先核实 `internal/ai/chat` function calling 支持度（已核实：当前不支持，需补）。
- 既有 `AI-Agents-需求.md`（自动评论）与本设计互补：前者是"被动触发"，本设计是"主动对话 + 工具编排"，两者共享底层 `internal/ai` 能力与 `InstanceAISetting` 配置。
