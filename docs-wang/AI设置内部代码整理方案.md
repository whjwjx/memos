# AI 设置内部代码整理方案

> 日期：2026-09-05
> 基线提交：`f8035b2c refactor: split ai settings panels`
> 目标：删除已确认不再保留的旧 AI tags / AI comment / transcribe 触发面，并继续降低 Admin AI Settings 的维护成本，方便后续二开。

## 0. 本轮执行状态

本轮已进入第二轮整理，按推荐顺序执行：

1. 先提交第一轮 AI Settings 内部整理。
2. 新开分支 `codex/remove-legacy-ai-features`。
3. 删除旧 AI tags / AI comment / transcribe 的可触发面。
4. 拆小 hook，不抽一个大而全的 `useAISettingsDraft.ts`。
5. 删除已不可达的旧 AI comment / AI tags worker 与 AI 转写内部实现。

已完成：

- 新增 `aiSettingMapper.ts`，集中管理 proto config 与 local draft 的转换。
- 新增 `aiSettingFactories.ts`，集中管理 Provider / LLM / Agent / Memory entry 的默认值。
- 新增 `saveAISettingPatch.ts`，把原来的长位置参数保存方式改为 object patch。
- 新增 `dialogs/ProviderDialog.tsx`、`dialogs/LLMDialog.tsx`、`dialogs/ChatAgentDialog.tsx`。
- 新增 `hooks/useAIChatAgents.ts`、`hooks/useAIToolsSettings.ts`、`hooks/useAITranslationSettings.ts`、`hooks/useAIMemorySettings.ts`。
- `AISection.tsx` 从约 2200 行降到约 380 行。
- 保存 Chat Tools 时只覆盖当前可见工具，同时保留 `query_queue` 等当前工具配置。
- 删除 Provider / LLM 时仍会清理被引用的 Chat Agent / Translation，但不会顺手保存其他 panel 未点击保存的草稿。
- `saveAISettingPatch.ts` 会清空旧 `transcription / agents / taggers` 配置，避免旧功能在后续保存中继续保留。
- 后端不再在创建 memo 后调度旧自动评论和自动打标任务。
- `AutoTagMemo` 和 `Transcribe` RPC 暂保留 proto 兼容，但服务端明确返回 `Unimplemented`。
- `project_status` 不再把旧 Agent / Tagger / Transcription 当作当前 AI 能力展示。
- 已删除旧 `agent_reply_worker.go`、`memo_tag_worker.go`、AI STT / audio LLM / WebM 转码内部包。
- 已删除旧 Chatbot 工具 `auto_tag` / `agent_reply` 的后端实现文件；`query_queue` 仍保留历史队列表查询能力。
- 已删除 Admin AI Settings 前端中 legacy Agent / Tagger / Transcription 的本地类型、mapper 和默认工厂。

仍然刻意不做：

- 不抽 `useAISettingsDraft.ts` 大 hook。
- 不物理删除 proto 字段、store 类型、旧任务表和迁移。
- 不删除普通音频录制能力；只删除 AI 转写能力。

当前剩余可以以后再做：

- 如果确认不需要兼容旧 API，再单独做 proto 字段、store 类型、旧任务表的物理删除。
- 如果 `query_queue` 后续只保留新队列，再把 legacy queue 表从查询范围中移除。

## 1. 当前结论

页面层面的第一期重构已经满足需求，不建议继续做用户可见 UI 改动。

当前已经完成：

- `AI Settings` 只展示 `Overview / LLMs / Agents / Chat Tools / Translation / Memory`。
- `AI tags`、`AI comment`、语音转文本配置不再出现在新版设置页。
- Memo 菜单保留 `Ask AI`，不出现 `AI tags`。
- 录音面板不显示 `Transcribe`。
- Chat Tools 不显示 `auto_tag`、`agent_reply`，保留 `query_queue`。
- AI Chat 输入框支持 `Agent + LLM`，并且当前 chat 内可以自由切换。

新一轮整理已经从“只做内部代码结构”推进到“功能级删除旧 AI 入口 + 小 hook 整理”。仍然不做：

- 不改页面信息架构。
- 不改 proto。
- 不改数据库。
- 不物理删除旧 setting 字段和数据库表。
- 不恢复 AI tags、AI comment、语音转文本。

## 2. 当前代码实际状态

核心文件：

```text
web/src/components/Settings/AISection.tsx
web/src/components/Settings/ai-settings/*
```

`AISection.tsx` 已经从一个更大的长页面，拆出了这些可见面板：

```text
ai-settings/types.ts
ai-settings/toolRegistry.ts
ai-settings/AISettingsTabs.tsx
ai-settings/AISettingsOverviewPanel.tsx
ai-settings/LLMsPanel.tsx
ai-settings/AgentsPanel.tsx
ai-settings/ChatToolsPanel.tsx
ai-settings/TranslationPanel.tsx
ai-settings/MemoryPanel.tsx
```

本轮整理前 `AISection.tsx` 仍然约 2200 行，主要还承担：

1. proto config 与 local draft 的互转。
2. 默认值和兼容旧字段的解析。
3. 所有保存逻辑。
4. Provider / LLM / Chat Agent / legacy Agent / legacy Tagger 弹窗。
5. 隐藏的 legacy Transcription / Agent / Tagger 表单逻辑。

这些转换函数本轮已经迁移到 `aiSettingMapper.ts`：

```text
toLocalProvider / toProviderConfig
toLocalLLM / toLLMConfig / deriveLLMsFromLegacy
toLocalTranscription / toTranscriptionConfig
toLocalTranslation / toTranslationConfig
toLocalAgent / toAgentConfig
toLocalTagger / toTaggerConfig
toLocalChatAgent / toChatAgentConfig
toLocalTool / toToolConfig
toLocalMemory / toMemoryConfig
```

保存逻辑本轮已经从位置参数 helper：

```ts
persistAISetting(
  nextProviders,
  nextTranscription,
  nextAgents,
  nextTaggers,
  nextChatAgents,
  nextTools,
  successMessage,
  nextMemory,
  nextTranslation,
  nextLLMs,
)
```

改为：

```ts
savePatch({ tools: nextTools }, "Toggle chat tool")
savePatch({ translation: toTranslationConfig(normalized) }, "Update translation")
savePatch({ chatAgents: nextChatAgents }, "Update chat agent")
```

这能显式表达每次保存修改了哪个字段。未传字段使用 `originalSetting` 的已保存值，避免保存某个 panel 时误保存其他 panel 的草稿。

## 3. 推荐做不做

本轮已经做，但没有做成一次性大 hook。

原因：

- 当前产品需求已经满足，所以这不是紧急功能修复。
- 但 AI 配置后续大概率会继续迭代，`Agent / LLM / Tools / Memory / Translation` 都会互相引用。
- 如果继续让保存逻辑、mapper、弹窗状态都留在 `AISection.tsx`，以后新增一个 AI 能力时会越来越难判断“保存这个字段会不会误伤别的字段”。

实际执行范围：

1. 已拆 mapper / factory。
2. 已把保存 helper 改成 object patch 风格。
3. 已拆可见弹窗 Provider / LLM / Chat Agent。

hooks 整体抽离仍然先不做。

## 4. 阶段 A：拆 mapper 和 factory

### 4.1 目标

把纯转换、默认值和 local draft 工厂函数从 `AISection.tsx` 移到独立文件。

已新增：

```text
web/src/components/Settings/ai-settings/aiSettingMapper.ts
web/src/components/Settings/ai-settings/aiSettingFactories.ts
```

本轮拆成两个文件：

- `aiSettingMapper.ts`：只负责 proto config <-> local draft。
- `aiSettingFactories.ts`：只负责 `newProvider()`、`newLLM()`、`newChatAgent()`、`newMemoryEntry()` 这类新建默认值。

### 4.2 建议迁移内容

已迁移到 `aiSettingMapper.ts`：

```text
toLocalProvider / toProviderConfig
toLocalLLM / toLLMConfig
deriveLLMsFromLegacy
resolveLLMId
legacyLLMKey
toLocalTranscription / toTranscriptionConfig
toLocalTranslation / toTranslationConfig
toLocalChatAgent / toChatAgentConfig
toLocalTool / toToolConfig
toLocalMemory / toMemoryConfig
```

已迁移到 `aiSettingFactories.ts`：

```text
newProvider
newLLM
newChatAgent
newMemoryEntry
defaultChatModelForProvider
placeholderForProvider
getDefaultEndpointPlaceholder
```

legacy 的 `LocalAgent / LocalTagger / LocalTranscription` 类型也已放入 `types.ts`，对应 mapper 已集中到 `aiSettingMapper.ts`。但隐藏 legacy UI 本身没有拆出，避免扩大用户不可见改动。

### 4.3 可行性

高。

这些函数大部分是纯函数，不依赖 React state。迁移后只需要修正 import。

### 4.4 影响

正向影响：

- `AISection.tsx` 会明显变短。
- 后续后端字段或兼容逻辑变化时，只改 mapper 文件。
- 更容易给转换逻辑补单元测试。

风险：

- `deriveLLMsFromLegacy` 和 `resolveLLMId` 关系到旧配置兼容，迁移时不能改 fallback 顺序。
- `toTranslationConfig` 必须保持“选择 LLM 后仍写 providerId/model 兼容字段”的逻辑。

### 4.5 验收

- AI Settings 刷新后配置展示不变。
- 旧配置如果没有 `llms`，仍能从旧 Chat Agent / Translation 的 provider/model 派生 LLM。
- 保存 Translation 后，`llmId/providerId/model` 仍能正确写回。
- `cd web && pnpm lint` 或至少 `tsc --noEmit --skipLibCheck` 通过。

## 5. 阶段 B：保存逻辑改为 patch helper

### 5.1 目标

已把位置参数式 `persistAISetting(...)` 改成对象 patch。

已新增：

```text
web/src/components/Settings/ai-settings/saveAISettingPatch.ts
```

或者如果需要 React Query / toast，可以叫：

```text
web/src/components/Settings/ai-settings/useAISettingPatchSaver.ts
```

当前采用普通 helper，没有抽 hook。

### 5.2 推荐 API

```ts
type AISettingPatch = {
  providers?: LocalAIProvider[];
  llms?: LocalLLM[];
  transcription?: InstanceSetting_TranscriptionConfig;
  agents?: LocalAgent[];
  taggers?: LocalTagger[];
  chatAgents?: LocalChatAgent[];
  tools?: LocalTool[];
  memory?: LocalMemory;
  translation?: LocalTranslation;
};
```

调用侧已经从：

```ts
persistAISetting(providers, originalSetting.transcription, agents, taggers, chatAgents, nextTools, "Toggle chat tool");
```

变成：

```ts
saveAISettingPatch({
  tools: nextTools,
  successMessage: "Toggle chat tool",
});
```

helper 内部负责：

```text
没有传入的字段 -> 使用当前 draft 或 originalSetting
隐藏字段 transcription / agents / taggers -> 默认保留 originalSetting 中的旧值
传入的字段 -> 转换成 proto config 后写入
```

### 5.3 可行性

中高。

逻辑并不复杂，但要非常小心“默认保留哪个来源”。这是这轮内部整理里最值得做、也最需要谨慎的部分。

### 5.4 影响

正向影响：

- 后续保存任意 panel 时，不容易因为参数位置错导致清空配置。
- 能把“隐藏旧功能但保留旧配置”的策略集中到一个地方。
- 更方便后续加新的 AI capability。

风险：

- 如果 patch helper 默认值处理错，可能导致保存 LLM 时覆盖 Translation，或保存 Tools 时覆盖 Memory。
- 如果 helper 混用 local draft 和 original proto，可能出现 UI 未保存草稿被意外保存。

### 5.5 推荐规则

为了避免隐式保存未确认草稿，当前规则如下：

```text
可见 panel 保存哪个字段，就只 patch 哪个字段。
未传字段使用 originalSetting 的已保存值。
隐藏 legacy 字段永远使用 originalSetting 的已保存值。
```

这样保存 LLM 不会顺手保存 Translation 未点击保存的草稿；保存 Translation 也不会顺手保存 Memory 草稿。

### 5.6 验收

- 保存 Provider/LLM 不会清空 Translation、Chat Agents、Memory。
- 保存 Chat Tools 不会清空 Provider/LLM。
- 保存 Translation 不会清空 Chat Agents。
- 保存 Memory 不会清空 Tools。
- 保存任何 panel 都不会清空隐藏的 `transcription / agents / taggers`。
- 旧 AI settings 数据刷新后仍存在。

## 6. 阶段 C：拆 dialogs

### 6.1 目标

已把可见编辑弹窗从 `AISection.tsx` 拆到独立文件。

已新增：

```text
web/src/components/Settings/ai-settings/dialogs/ProviderDialog.tsx
web/src/components/Settings/ai-settings/dialogs/LLMDialog.tsx
web/src/components/Settings/ai-settings/dialogs/ChatAgentDialog.tsx
```

legacy 弹窗本轮暂时不拆。以后如果要继续拆，可以放到：

```text
web/src/components/Settings/ai-settings/legacy/LegacyAIAgentDialog.tsx
web/src/components/Settings/ai-settings/legacy/LegacyAITaggerDialog.tsx
web/src/components/Settings/ai-settings/legacy/TranscriptionForm.tsx
```

### 6.2 可行性

高。

弹窗本身主要依赖 props、local draft state、Select/Input/Textarea 组件。拆出去不会改变业务逻辑。

### 6.3 影响

正向影响：

- `AISection.tsx` 会进一步缩短。
- Provider / LLM / Chat Agent 的编辑行为更容易单独维护。
- 后续如果要改 LLM 配置 UI，不需要在大文件里找。

风险：

- `LLMDialog` 里有 `TestAIProvider` 调用和 toast，需要保留原行为。
- `ChatAgentDialog` 的 LLM 选择会同时回填 `llmId/providerId/model`，不能漏。
- 如果同时拆 legacy dialogs，可能增加无意义改动；建议第三步先只拆新版可见弹窗。

### 6.4 验收

- 新增/编辑 Provider 可用。
- Provider API key 仍然是 write-only，保存后只显示 hint。
- 新增/编辑 LLM 可用，测试 Provider 可用。
- 新增/编辑 Chat Agent 可用，选择 LLM 后能正确保存。

## 7. 阶段 D：抽 hook

### 7.1 目标

等 mapper 和 patch helper 稳定后，再考虑把状态同步和 handlers 抽为 hook。

建议文件：

```text
web/src/components/Settings/ai-settings/useAISettingsDraft.ts
```

hook 可以负责：

```text
读取 originalSetting
维护各 panel draft state
计算 hasChanges
暴露 save/toggle/create/delete handlers
```

### 7.2 可行性

中。

这一步收益明显，但也最容易变成“大搬家”。建议不是下一步马上做，而是在 A/B/C 稳定后再做。

### 7.3 影响

正向影响：

- `AISection.tsx` 最终会变成真正的壳组件。
- 未来可以更容易写测试或复用设置逻辑。

风险：

- hook 返回值会很多，如果设计不好，只是把大文件换成大 hook。
- 当前多个保存动作依赖 toast、translationLLMRef、chatAgents、llms、providers 等交叉状态，直接抽 hook 容易引入回归。

### 7.4 推荐判断

阶段 D 当前仍不做为必选项。A/B/C 完成后，`AISection.tsx` 已明显收敛；后续只有在继续增长或保存逻辑继续复杂化时再抽 hook。

## 8. 推荐实施顺序

### 本轮实际完成 A + B + C

```text
拆 aiSettingMapper / aiSettingFactories
persistAISetting 改为 saveAISettingPatch
拆可见 dialogs
```

当前保留不做的原因：

- 大 hook 容易只是把大组件换成大 hook。
- legacy UI 当前不可见，继续拆它用户收益很低。
- 旧后端删除需要单独确认产品取舍，不应该夹在前端整理里。

### 如果后续还想继续

下一步只建议在两个场景下继续：

- 发现 `AISection.tsx` 仍然频繁冲突或难维护，再抽小 hook。
- 确认旧 AI tags / AI comment / transcribe 永久不恢复，再做旧代码删除评估。

## 9. 测试建议

本轮内部整理至少跑：

```bash
cd web && .\node_modules\.bin\tsc.cmd --noEmit --skipLibCheck
git diff --check
```

如果改动包含 mapper，建议补一个轻量单元测试：

```text
web/src/components/Settings/ai-settings/aiSettingMapper.test.ts
```

重点测：

- legacy provider/model 能派生 LLM。
- Translation 的 `llmId/providerId/model` 兼容字段保留。
- tools 只从 `toolRegistry` 生成当前可见工具，`query_queue` 保留。
- hidden legacy config 不会被 patch helper 清空。

## 10. 总体可行性和影响性

可行性：中高。

主要原因是这轮不碰后端、不碰 proto、不碰数据库，改动集中在前端设置页内部。

影响性：对用户低，对开发维护中高。

用户侧几乎无感，因为 UI 和行为不变；开发侧收益比较明显，尤其是：

- 减少大文件维护压力。
- 降低保存逻辑传参错误风险。
- 给后续 Agent / LLM / Tools / Memory 继续迭代留出清晰边界。

我推荐下一轮做，但范围控制在 A + B。做到这里就已经能明显改善二开体验；dialogs 和 hook 可以作为之后的“第二轮内部整理”。
