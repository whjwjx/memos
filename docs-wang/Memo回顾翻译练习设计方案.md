# Memo 回顾翻译练习设计方案

## 背景

用户日常记录的 memos 本身是很好的英文表达练习素材。相比额外写“当日复盘”再翻译，直接在回顾 memos 时把真实 memo 转成练习题，更贴近真实表达需求，也更容易形成长期积累。

这个功能的重点不是“把 memo 翻译成英文”，而是“基于 memo 做英文表达训练”。

## 目标

- 用户在回顾某条 memo 时，可以对这条 memo 做英文表达练习。
- AI 老师先根据当前 memo 进行预教学，让用户获得可用的字、词、短语、句型和表达思路。
- 用户再自行举一反三，把当前 memo 翻译成英文。
- 提交后，AI 老师批改用户版本，给出优化建议、翻译思路和下一轮修改方向。
- 用户可以反复修改并提交批改，直到 AI 老师判断合格。
- 合格后可以保存为英文素材 memo，后续继续通过 Review 回顾。

## 推荐交互形态

推荐采用“结构化练习面板 + 局部 AI 求助”，不建议做成纯 AI 对话，也不建议只做一个简单翻译按钮。

原因：

- 纯 AI 对话太自由，基础弱的用户容易不知道问什么，也容易直接让 AI 给答案。
- 单纯按钮流程太死，用户遇到具体卡点时缺少即时追问空间。
- 结构化流程能保证学习闭环，局部 AI 求助能保留老师式互动。

## 前端入口

入口放在 Review 当前 memo 卡片的操作区。

建议按钮：

```text
翻译练习
```

不要默认展开，避免干扰普通回顾。用户想练习时再主动打开。

## 页面形态

手机端：

- 使用 bottom sheet。
- 从底部弹出，保留当前 Review 语境。
- 分阶段纵向推进，避免 tab 过多。

桌面端：

- 使用右侧 panel。
- 左侧继续显示当前 memo。
- 右侧显示练习流程。

不建议跳转到 `/translate`。翻译页是通用工具页，而这个功能发生在 Review 场景内，跳转会打断回顾节奏。

## 核心流程

### 1. AI 老师备课

用户点击“翻译练习”后，AI 先读取当前 memo 内容，生成一份预教学内容。

这一阶段不直接给完整翻译答案。

展示内容：

- 表达目标：这条 memo 想用英文表达什么。
- 核心词汇：用户可能需要的关键词。
- 可用短语：更自然的英文搭配。
- 句型工具：可套用的表达结构。
- 表达思路：这类中文内容转英文时应该如何拆句、换主语、调整语序。
- 常见坑：直译容易不自然的地方。
- 小片段示范：可以给一个短片段示范，但不要完整翻译整条 memo。

主按钮：

```text
开始练习
```

### 2. 用户练习

进入练习阶段后，用户看到：

- 当前 memo 原文，只读，可折叠。
- AI 老师准备的“表达工具箱”。
- 用户自己的英文输入框。

操作按钮：

```text
问一下老师
提交批改
```

“问一下老师”应该是局部 AI 求助，不跳到全局 AI Chat。它围绕当前 memo、当前备课内容和用户草稿回答。

求助时默认策略：

- 优先给提示。
- 优先解释表达思路。
- 不直接给完整答案，除非用户明确要求。

### 3. AI 批改

用户提交自己的翻译后，AI 老师进行批改。

展示内容：

- 是否合格。
- 总体评价。
- 用户版本中自然的地方。
- 需要修改的表达。
- 修改原因。
- 更地道的替代表达。
- 下一轮修改目标。
- 翻译思路复盘。

如果未合格：

```text
继续修改
```

用户回到输入框，基于反馈修改后可以再次提交。

如果合格：

```text
保存为素材
```

### 4. 合格与存档

当 AI 老师判断合格后，展示完成状态：

- 简短鼓励。
- 最终用户版本。
- AI 地道版本。
- 本次掌握的表达工具。
- 保存按钮。

保存后创建一条新的私有 memo，作为英文素材积累。

建议保存格式：

```text
原始 memo：
...

我的最终版本：
...

AI 地道版本：
...

本次学到的表达：
- ...
- ...

批改总结：
...

来源：memos/xxx

#english #translation-practice #review
```

这样后续可以直接使用 Review 的 tag 过滤能力回顾 `#translation-practice`，第一版不需要额外设计新的英语素材系统。

## 状态模型

前端可以按阶段管理：

```text
idle
preparing
lesson_ready
drafting
reviewing
needs_revision
passed
saved
```

含义：

- `idle`：未开始练习。
- `preparing`：AI 老师正在备课。
- `lesson_ready`：备课完成，等待用户开始练习。
- `drafting`：用户正在输入自己的翻译。
- `reviewing`：AI 正在批改。
- `needs_revision`：AI 认为还需要修改。
- `passed`：AI 判断合格，可以保存。
- `saved`：已保存为素材 memo。

## 与现有前端代码的关系

当前代码中已有几个可以复用的能力：

- `web/src/pages/Review.tsx`
  - 已有 `activeMemo`。
  - 已有卡片式 Review UI。
  - 已有手机端左右滑动和完成状态。
  - 适合作为新功能入口和容器。

- `web/src/pages/Translate.tsx`
  - 已有翻译输入、结果展示、历史保存为 memo 的经验。
  - 可以参考其中保存 memo 的格式化逻辑。
  - 不建议直接复用整页 UI。

- `web/src/hooks/useTranslation.ts`
  - 已有调用 AI 翻译的 hook。
  - 新功能不一定适合直接复用 `Translate` RPC，因为它需要“备课、批改、评分、建议”等结构化结果。

- `web/src/pages/AIChat.tsx`
  - 已有带 memo context 问 AI 的能力。
  - 适合参考“局部求助”的上下文组织方式。
  - 不建议把主流程做成跳转到全局 AI Chat。

- `web/src/components/MemoActionMenu/MemoActionMenu.tsx`
  - 已有“问 AI”通用入口。
  - 翻译练习入口更适合放在 Review 场景内，而不是只放在 memo 通用菜单里。

## 推荐第一期范围

第一期先做完整学习闭环，不做复杂历史系统。

包含：

- Review memo 卡片增加“翻译练习”入口。
- 手机端 bottom sheet，桌面端右侧 panel。
- AI 备课。
- 用户输入英文翻译。
- AI 批改。
- 支持多轮修改。
- AI 判断合格后保存为素材 memo。
- 保存内容带 `#english #translation-practice #review`。

暂不做：

- 专门的英语素材数据库。
- 独立练习历史表。
- 长期成绩统计。
- 复杂等级体系。
- 全局英语学习中心。

## 第 1 批实施切片与当前 MVP

第 1 批分成两步：

- `1A`：先验证交互流程和 UI 形态，使用本地占位教学和模拟批改。
- `1B`：接入真实 AI，保留同一套前端流程，用真实接口生成教学内容和批改反馈。

### 1A：UI 流程验证

包含：

- 在 Review 当前 memo 卡片增加“翻译练习”按钮。
- 手机端用 bottom sheet，桌面端用右侧 panel。
- 使用当前 `activeMemo.content` 生成本地占位教学内容。
- 完整跑通 `preparing -> lesson_ready -> drafting -> reviewing -> needs_revision/passed -> saved` 状态流。
- “问一下老师”先给本地提示文案，用于验证求助入口位置和交互节奏。
- “提交批改”先用本地规则模拟 AI 老师反馈，用于验证多轮修改体验。
- “保存为素材”可以直接复用现有 memo 创建能力，保存一条私有素材 memo。

1A 暂不包含：

- 新增后端 RPC。
- 真实 LLM 调用。
- 结构化 AI 返回 schema。
- 练习历史表。
- 练习通过状态持久化到原 memo。

### 1B：真实 AI MVP

当前 MVP 直接复用已有 Translation LLM 配置，不新增 admin 配置项。

包含：

- 新增 `GenerateTranslationPracticeLesson` RPC，用当前 memo 内容生成“表达目标、核心词汇、可用短语、句型工具、表达思路”。
- 新增 `ReviewTranslationPracticeDraft` RPC，用当前 memo、用户草稿和提交轮次生成“是否通过、总体评价、优点、改进建议、下一步目标、AI 地道版本”。
- 前端 `MemoTranslationPracticePanel` 从本地 mock 切换为真实 AI mutation。
- “问一下老师”第一版仍保持轻量：基于已生成 lesson 和用户当前状态给局部提示，不额外新增对话式接口。
- 保存素材仍创建私有 memo，继续带 `#english #translation-practice #review`，暂不新增素材表。

1B 暂不包含：

- 独立的练习历史表。
- 持久化每条 memo 的练习通过状态。
- 可配置的专用“翻译练习老师” Agent。
- 自由追问式 teacher chat。
- 成绩统计、错题聚合和间隔复习。

验收重点：

- 用户在 Review 中是否能自然发现“翻译练习”。
- 打开练习后是否能先学工具，再写翻译。
- “问老师”和“提交批改”的位置是否顺手。
- 未通过时继续修改是否清晰。
- 通过后保存素材是否符合预期。
- 手机端是否不影响 Review 左右滑动。
- Translation LLM 配置可用时，打开面板能生成真实教学内容。
- 提交用户英文草稿后，能拿到真实 AI 批改和地道版本。

第 1 批 UI 收敛原则：

- 不把练习面板做成英语资料页。
- 教学内容只保留当前练习最需要的少量表达工具。
- 关键词、短语、句型合并在一张“AI 老师先教你”卡片中。
- 开始练习后，教学卡片收缩为参考条，优先露出输入框。
- 思路提示只显示 1 条，更多细节留给“问老师”和批改反馈。

## 第 2 批：手机端轻量拼句版

### 背景

第 1 批已经跑通了“AI 备课 -> 用户输入翻译 -> AI 批改 -> 保存素材”的完整闭环，但实际体验偏重：

- 手机端打英文不方便，输入成本高。
- 回顾场景本身是轻量浏览，用户不一定愿意进入完整写作练习。
- 教学、输入、批改、保存全部放在一个面板里，容易让用户感觉像一节正式课程，而不是“顺手练一下”。

因此第 2 批建议把 user story 简化为：

```text
用户回顾 memo 时，顺便了解这条 memo 的基础英文表达和更地道英文表达。
AI 先给出两个版本及其必要的字词句工具。
用户不用手动输入英文，只需要点击表达块，把表达块拼成完整句子。
只要拼出基础版本或地道版本之一，就算通过。
拼错时给一个简短 AI 提示；通过后可以保存为素材 memo，方便以后回顾。
```

### 推荐交互

入口仍放在 Review 当前 memo 卡片下方，按钮文案可以从“翻译练习”改为“表达练习”或“拼表达”。

面板打开后的流程：

```text
当前 memo
下周二下午2点有个线上会议

表达参考
基础表达：There is an online meeting next Tuesday at 2 PM.
地道表达：We have an online meeting scheduled for next Tuesday at 2 PM.

拼一句
[ There is ] [ an online meeting ] [ next Tuesday ] [ at 2 PM ]

可选表达
[ scheduled for ] [ at 2 PM ] [ There is ] [ next Tuesday ]
[ We have ] [ an online meeting ] [ there is ] [ online ]

[提示] [重置] [检查]
```

用户行为：

- 点击“可选表达”里的 chip，加入“拼一句”区域。
- 点击“拼一句”里的 chip，将其移回可选区。
- 用户可以自由选择拼基础版本，也可以拼地道版本。
- 点击“检查”后，前端把用户选择的表达块顺序提交给后端。
- 后端判断是否等于任一可接受答案；通过则展示轻庆祝和“保存为 memo”。
- 未通过则展示 1 条短提示，不展示长篇批改。

### 可选表达区设计

可选表达区可以同时放入两个版本的表达块。

推荐规则：

- `basic_blocks`：基础版本表达块。
- `native_blocks`：地道版本表达块。
- `extra_blocks`：可选干扰块，第一版可以不做，避免挫败感。
- 前端合并 `basic_blocks + native_blocks + extra_blocks` 后去重并打乱。
- 用户拼出的答案只要匹配 `basic_blocks` 或 `native_blocks` 的顺序，就通过。

这样设计的好处：

- 用户不会被迫选择“标准答案只有一个”的死板体验。
- 基础弱的用户可以先拼基础表达。
- 有能力的用户可以尝试拼更地道表达。
- 两套表达块混在一起，本身就是一次“表达选择”的训练。

需要注意：

- 两个版本不要差异过大，否则可选区 chip 太多，手机端会拥挤。
- 每条 memo 第一版建议控制在 4-8 个 chip。
- 如果 memo 内容太长，AI 应只抽取一个核心句做练习，不要要求用户拼完整长 memo。
- 同义表达可能很多，第一版先只接受 AI 给出的两个目标版本，避免校验逻辑复杂化。

### 手机端 UI 原则

- 不再默认显示长解释。
- 顶部只保留当前 memo 摘要，超过 2 行折叠。
- “基础表达 / 地道表达”默认可见，但解释默认隐藏。
- 表达块详情按需展开：用户点某个 chip 后，在底部或就近弹出简短说明。
- 主操作区固定为“拼一句 + 可选表达 + 检查按钮”。
- 不优先做拖拽。手机端 bottom sheet 里拖拽容易和滚动、关闭手势冲突，第一版点击拼句更稳。
- 错误反馈只给一条最关键提示，例如“时间表达通常放在句末”。

### 接口设计建议

现有接口：

- `GenerateTranslationPracticeLesson`
- `ReviewTranslationPracticeDraft`

它们偏向“自由输入 + AI 批改”。第 2 批可以新增一组更贴合拼句的接口，避免把老接口语义越改越混：

```proto
rpc GenerateTranslationBuilderPractice(GenerateTranslationBuilderPracticeRequest) returns (GenerateTranslationBuilderPracticeResponse)
rpc ReviewTranslationBuilderPractice(ReviewTranslationBuilderPracticeRequest) returns (ReviewTranslationBuilderPracticeResponse)
```

当前落地第一步采用更小的兼容方案：先扩展现有 `GenerateTranslationPracticeLesson` 的返回结构，增加 `basic_version`、`native_version`、`basic_blocks`、`native_blocks`、`option_blocks` 和 `quick_tip`；前端默认使用这些字段做点击拼句。旧的 `ReviewTranslationPracticeDraft` 暂时保留，但新的默认 UI 不再调用它。等后续确认不会恢复自由输入批改模式，再单独收敛或重命名接口。

建议返回结构：

```proto
message TranslationBuilderPractice {
  string source_text = 1;
  string basic_version = 2;
  string native_version = 3;
  repeated TranslationBuilderBlock basic_blocks = 4;
  repeated TranslationBuilderBlock native_blocks = 5;
  repeated TranslationBuilderBlock option_blocks = 6;
  string quick_tip = 7;
}

message TranslationBuilderBlock {
  string id = 1;
  string text = 2;
  string explanation = 3;
}
```

校验请求：

```proto
message ReviewTranslationBuilderPracticeRequest {
  string memo_content = 1;
  repeated string selected_block_ids = 2;
  string locale = 3;
}
```

校验响应：

```proto
message ReviewTranslationBuilderPracticeResponse {
  bool passed = 1;
  string matched_version = 2; // basic / native / empty
  string hint = 3;
  string explanation = 4;
}
```

第一版也可以不让 AI 重新判断答案，而是在生成时由后端保存/返回两个正确 block id 序列，前端提交后后端做确定性比较：

- 与 `basic_blocks` id 顺序完全一致：通过。
- 与 `native_blocks` id 顺序完全一致：通过。
- 否则调用 AI 生成一条短提示，或先用本地规则返回通用提示。

这比每次“检查”都让 AI 判分更稳定，也更省 token。

### 保存为 memo

通过后仍复用现有创建 memo 能力，不新增素材表。

推荐保存格式：

```text
原始 memo：
下周二下午2点有个线上会议

基础表达：
There is an online meeting next Tuesday at 2 PM.

地道表达：
We have an online meeting scheduled for next Tuesday at 2 PM.

本次掌握的表达块：
- There is
- an online meeting
- next Tuesday
- at 2 PM
- scheduled for

来源：memos/xxx

#english #translation-practice #review
```

### 可行性分析

可行性较高，原因：

- Review 页已有当前 `activeMemo`，入口和面板容器可以继续复用。
- `MemoTranslationPracticePanel` 已经具备 bottom sheet / desktop right panel 的响应式基础。
- 当前已接入真实 AI provider，生成结构化练习内容的后端路径已经跑通。
- 保存素材 memo 已经实现，可以继续复用 `useCreateMemo`。
- 新方案减少用户输入，前端状态机可以比第 1 批更简单。

主要改动：

- 前端需要把 `Textarea + Ask teacher + Submit for feedback` 改为 `answer chips + option chips + check/reset/hint`。
- 后端需要新增或重命名 proto 消息，生成拼句练习结构。
- 生成 prompt 需要约束输出短句、短 chip、两个可接受版本。
- 测试需要覆盖“基础版本通过”“地道版本通过”“顺序错误不通过”。

### 影响性分析

正向影响：

- 手机端操作成本明显降低。
- 更符合 Review 场景，不会打断回顾节奏。
- 用户不需要凭空写英文，而是从“可用表达块”中做选择和组合。
- 同时支持基础表达和地道表达，适合不同水平用户。
- 检查逻辑可确定化，减少 AI 批改不稳定。

风险与代价：

- 当前第 1 批自由输入练习会被弱化，喜欢完整写作训练的用户可能觉得不够自由。
- 如果两个版本的表达块都放入可选区，chip 数量控制不好会显得乱。
- 只接受两个目标版本会牺牲开放性，但这是第一版为了稳定体验的合理取舍。
- 需要新增 proto 和生成文件，改动面会覆盖后端、前端类型和 OpenAPI。

推荐取舍：

- 第 2 批先保留旧接口和旧保存格式兼容，但前端默认切到“点击拼句版”。
- 不做拖拽，只做点击拼句。
- 不做复杂成绩/历史表。
- 不做多句长 memo，AI 只抽取当前 memo 的核心表达。
- 等轻量版体验稳定后，再考虑在面板里增加“高级：自己输入翻译”入口。

### 第 2 批验收标准

- 手机端打开练习面板后，不需要弹出键盘即可完成一次练习。
- 可选表达区同时包含基础版本和地道版本的表达块。
- 用户拼出基础版本时通过。
- 用户拼出地道版本时通过。
- 用户拼错时只展示一条短提示，不进入长篇批改。
- 通过后可以保存为素材 memo。
- 保存后的 memo 包含原始 memo、基础表达、地道表达、表达块和标签。
- Review 左右滑动不被练习面板内的操作误触发。

### 第 2 批本轮 UI/Prompt 调整

本轮把教学区进一步收敛为两个版本 + 一个表达工具箱：

- `Basic version`：只给基于当前 memo 内容的最基础、最简单表达。它的目标是降低门槛，让基础用户先知道“这条 memo 至少可以怎样说”。
- `Natural AI version`：给进阶表达。根据 memo 内容动态决定升级方式，可以是同义词替换、更自然的句式、更地道的口语表达，或更符合英文习惯的信息重组。
- `Expression toolkit`：替代原来容易重复的 `Expression blocks` / `Core words` / `Useful phrases` 三段展示。工具箱内只保留可用的字、词、短语块和句式。
- 工具箱默认只显示表达本身，解释默认收起；用户需要时点击展开。
- 拼句区继续单独展示 `Available blocks`，它服务于操作，不再承担教学解释展示。

这样可以减少文字负担，尤其适合手机端回顾时顺手练习：用户先看两个答案版本，再按需展开工具解释，最后用可选块完成拼句。

## 后续增强

第二期可以考虑：

- 练习过的 memo 在 Review 中显示状态。
- 按 `#translation-practice` 做专门回顾入口。
- 记录每次批改轮次。
- 做“常错表达”聚合。
- 做间隔复习。
- 支持把同一条 memo 改写成不同英文风格。

## 产品判断

推荐把它定义为：

```text
Memo 驱动的英文表达训练
```

而不是：

```text
Memo 翻译
```

前者强调学习闭环，后者容易退化成普通翻译工具。
