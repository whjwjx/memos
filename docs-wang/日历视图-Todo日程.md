# 日历视图 / Todo 日程

> 状态：方案设计中（P1 后端待启动）
> 关联：标签系统研究 → todo 管理 → 日历视图
> 决策日期：2026-08-23

## 一、背景与目标

memos 当前没有"滴答清单式"日历视图。现有的 `ActivityCalendar` 只是 GitHub 风格热力图（按 `created_ts` 统计每天 memo 数量），无法在时间格子上 CRUD、拖拽、改时长。

目标：让用户能在**周视图**（7 天 × 24 小时纵向时间轴）上把 memo 当作日程/ todo 来排期、拖拽、改时长，类似 Google Calendar / 滴答清单。

## 二、设计决策

### 2.1 复用 memo，不新建实体

一切皆 memo。todo = 带日程或带 task list 的 memo，不单独建 Todo 表。

### 2.2 时间字段：`scheduled_time` + `scheduled_duration`（路线 B）

**不用** `start_time + end_time`，**不用**单 `scheduled_time`。理由：

- 周视图纵向时间轴，resize handle 在上下边缘：
  - 拖上边缘 → 改开始时间（`scheduled_time`）
  - 拖下边缘 → 改时长（`scheduled_duration`）
- `start + duration` 两个 handle 各管一个字段，互不干扰。
- `start + end` 方案拖上边缘要同时改两个字段（否则时长跟着变），前端逻辑更乱。
- proto3 两个可选字段，向后兼容：不填 = 普通笔记。

### 2.3 判定口径

```
isTodo      = has_task_list == true  OR  scheduled_time != nil
isTimeBlock = scheduled_time != nil  AND scheduled_duration != nil
```

- 普通笔记：无 task、无时间
- 清单 todo：有 `- [ ]` 但无时间（待办，不排期）
- 点事件 todo：有 `scheduled_time`，无 duration（默认 1 小时，UI 层约定）
- 时段事件 todo：两个字段都有（支持冲突检测 + 多格拉伸）

### 2.4 渲染职责分离

| 信息 | 来源 | 用途 |
| --- | --- | --- |
| 何时（落点） | `scheduled_time` | 决定放哪个格子 |
| 多长（占格） | `scheduled_duration` | 决定纵向拉伸多少格 |
| 是否完成 | `has_incomplete_tasks`（由 `- [ ]` / `- [x]` 自动算出） | 决定格子样式（✓ 全完成 / ◐ 部分 / ○ 未开始） |

### 2.5 冲突检测

两个时段重叠条件：

```
a.scheduled_time < b.scheduled_time + b.scheduled_duration
&& b.scheduled_time < a.scheduled_time + a.scheduled_duration
```

## 三、Proto 字段（待 buf generate）

在 `proto/api/v1/memo_service.proto` 的 `Memo` 消息中，紧跟 `pinned`（field 11）之后新增：

```proto
// Optional. When set, this memo is scheduled at this time.
// Used by calendar views to place the memo on a time grid.
// Unset memos are plain notes (not todos).
google.protobuf.Timestamp scheduled_time = 12
    [(google.api.field_behavior) = OPTIONAL];

// Optional. Duration of the scheduled event.
// When set with scheduled_time, the calendar renders a time block
// and can detect conflicts. UI defaults to 1h when unset.
google.protobuf.Duration scheduled_duration = 13
    [(google.api.field_behavior) = OPTIONAL];
```

**注意**：
- 不能复用 `reserved 6`（`display_time`），reserved 字段号禁止复用。
- `Timestamp` / `Duration` 已被 `create_time` 等使用，工具链就绪。
- 同步在 `proto/store/memo.proto` 的 `MemoPayload` 或顶层 Memo 中加对应存储字段（待定，看 store 层落点）。

## 四、后端改动（P1）

### 4.1 UpdateMemo

`server/router/api/v1/memo_service.go` 的 `UpdateMemo`，在 `for path := range request.UpdateMask.Paths` 循环中追加分支：

```go
} else if path == "scheduled_time" {
    if nextMemo.Payload == nil {
        nextMemo.Payload = &storepb.MemoPayload{}
    }
    // 写入 payload 或顶层字段，取决于 store 设计
} else if path == "scheduled_duration" {
    if nextMemo.Payload == nil {
        nextMemo.Payload = &storepb.MemoPayload{}
    }
    // 同上
}
```

参考现有 `location` 分支（`memo_service.go:538`）的模式。

### 4.2 CEL 过滤扩展

`ListMemos` 的 `filter` 文档（`memo_service.proto:323`）需补充：

```
scheduled_time (timestamp; nullable),
scheduled_duration (duration; nullable)
```

示例：

```
scheduled_time >= timestamp(...) && scheduled_time < timestamp(...)
has_incomplete_tasks == true && scheduled_time != null
```

### 4.3 数据库迁移

**三库（SQLite / MySQL / PostgreSQL）都要加**，AGENTS.md 强制要求：

- 加列 `scheduled_time`（TIMESTAMP NULL）
- 加列 `scheduled_duration`（BIGINT NULL，存纳秒或秒）
- 更新各驱动的 `LATEST.sql`

## 五、前端改动（P2）

### 5.1 新增日历视图页

- 路由：`/calendar`（待定）
- 周/日/月视图切换
- 纵向时间轴（7 天 × 24 小时）
- 格子内联新建 memo（点空白格 → 弹编辑器，`scheduled_time` 预填）

### 5.2 交互（待用户确认）

| 操作 | 行为 | 改动字段 |
| --- | --- | --- |
| 拖整体移动 | 块整体平移 | `scheduled_time` |
| 拖上边缘 | 改开始时间 | `scheduled_time`（duration 不变） |
| 拖下边缘 | 改时长 | `scheduled_duration`（start 不变） |
| 点空白格新建 | 弹编辑器，时间预填 | 新建 memo + `scheduled_time` |
| 双击块编辑 | 弹编辑器 | 改 content / 其他 |

### 5.3 入口位置（已确认）

- **侧边栏，与 Inbox 同级**加 "Calendar" 入口。
- 不走顶部 tab，也不嵌进 MemoViews。

> 前端验证：侧边栏是常规导航列表，加一项与 Inbox 同级的链接即可，无特殊改造。

### 5.5 memo 编辑器加 ScheduleSelector（前端已验证可行）

在 memo 编辑器工具栏加"选日程时间"控件，**顺现有模式改 5 处**（都是"加一项"，不动现有逻辑）：

| # | 文件 | 改动 |
| --- | --- | --- |
| 1 | `web/src/components/MemoEditor/state/types.ts:12` | `metadata` 加 `scheduledTime?: Date`、`scheduledDuration?: Duration` |
| 2 | 同文件 `defaultState` | `metadata` 加两个 undefined 默认值 |
| 3 | `web/src/components/MemoEditor/Toolbar/EditorToolbar.tsx:66` | `VisibilitySelector` 后加 `ScheduleSelector` |
| 4 | `web/src/components/MemoEditor/services/memoService.ts` | `buildUpdateMask` 加 `scheduledTime` / `scheduledDuration` 比对分支（仿 `location` 分支 47-50 行）；`create(MemoSchema,...)` 加两字段 |
| 5 | 同文件 `fromMemo` | `metadata` 加 `scheduledTime` / `scheduledDuration` 反序列化 |

**布局说明**：`EditorToolbar` 是横向两区布局 `[ InsertMenu + VisibilitySelector ] | [ Cancel | Save ]`。
- `ScheduleSelector` 放**左区**，与 `VisibilitySelector` 并列（两者都是 memo 元数据选择器，语义同源）。
- **不**藏进 `InsertMenu` 下拉里（虽然和 `Location` 同模式更对称，但日程是高频功能且需要状态可见——设了时间后按钮上直接显示"8/25 10:00"，藏下拉里看不见）。
- `InsertMenu` 是 `+` 号下拉按钮，`Location` 藏在里面；日程外露更合适。

**模板参考**：`VisibilitySelector.tsx`（54 行）是现成的"下拉选择元数据"模板（DropdownMenu + Trigger + Content + 选项），`ScheduleSelector` 照抄结构，选项换成日期时间选择器。

## 六、分阶段路线

| 阶段 | 内容 | 产出 |
| --- | --- | --- |
| P1 后端 | proto 字段 + 三库迁移 + UpdateMemo 分支 + CEL 扩展 | 数据层就绪，可 API 设时间 |
| P2 前端 | 日历视图页 + 拖拽 CRUD + 时段 resize | 周视图可用 |
| P3 增强 | 冲突检测、提醒、重复日程 | 体验对齐滴答 |

## 六补、提前提醒方案（后续，不纳入当前 MVP）

> 决策状态：先记录方案，暂不实现。
> 当前 MVP：只做“到点提醒”，即 `reminder_offset_seconds = 0`。

### 6.1 用户目标

生日、纪念日、会议等日程不只需要到点提醒，也需要提前提醒。例如：

- 生日：提前 7 天、提前 3 天、提前 1 天、当天提醒。
- 纪念日：提前 7 天、提前 1 天、当天提醒。
- 会议：提前 10 分钟、提前 1 小时、到点提醒。

核心诉求是：一个 memo 仍然只保存一条日程，不因为多次提醒而创建多条 memo。

### 6.2 数据模型建议

在 `Memo` 的日程字段旁新增提醒提前量配置：

```proto
// Optional. Reminder offsets before each scheduled occurrence, in seconds.
// 0 means remind at the scheduled time.
repeated int32 scheduled_reminder_offsets = 22 [(google.api.field_behavior) = OPTIONAL];
```

语义：

```
reminder_time = occurrence_time - scheduled_reminder_offset
```

示例：

| 日程发生时间 | 提醒配置 | 实际提醒时间 |
| --- | --- | --- |
| 2026-09-10 09:00 | 7 天前 | 2026-09-03 09:00 |
| 2026-09-10 09:00 | 3 天前 | 2026-09-07 09:00 |
| 2026-09-10 09:00 | 1 天前 | 2026-09-09 09:00 |
| 2026-09-10 09:00 | 到点 | 2026-09-10 09:00 |

### 6.3 默认策略建议

不同日程类型默认值应不同，避免日常习惯产生过多提醒。

| 类型 | 推荐默认提醒 |
| --- | --- |
| 普通日程 | 到点 |
| 会议 / 预约 | 提前 10 分钟 + 到点 |
| 生日 / 纪念日 | 提前 7 天 + 提前 1 天 + 到点 |
| 每日习惯 | 到点 |
| 工作日/周末循环 todo | 到点 |

前端可先提供快捷多选：

- 到点
- 提前 10 分钟
- 提前 1 小时
- 提前 1 天
- 提前 3 天
- 提前 7 天

### 6.4 后端处理逻辑

当前到点提醒只有一个隐含配置：

```
offset = 0
```

后续扩展为遍历每个 memo 的 `scheduled_reminder_offsets`：

```
for occurrence in occurrences:
  for offset in scheduled_reminder_offsets:
    reminder_time = occurrence_time - offset
    if reminder_time in scan_window:
      claim_delivery(user_id, memo_id, occurrence_time, offset)
      create_inbox_notification(...)
      send_web_push_best_effort(...)
```

其中：

- inbox 是可靠提醒：到点或提前提醒都先写入 inbox。
- Web Push 是额外提醒：浏览器、FCM、代理不可用时不影响 inbox。
- `reminder_offset_seconds` 必须进入去重键，保证“提前 7 天”和“提前 1 天”是两次不同提醒。

### 6.5 去重设计

建议后续 inbox 提醒单独建去重表：

```
memo_schedule_reminder_inbox_delivery
- id
- user_id
- memo_id
- occurrence_time
- reminder_offset_seconds
- created_ts

unique(user_id, memo_id, occurrence_time, reminder_offset_seconds)
```

Web Push 可以继续按设备维度去重：

```
unique(user_id, memo_id, occurrence_time, reminder_offset_seconds, subscription_id)
```

这样同一个提醒点：

- inbox 只出现一次；
- 用户有多台设备时，每台设备可各发一次系统通知；
- worker 重启或重复扫描不会产生重复提醒。

### 6.6 前端交互建议

`ScheduleSelector` 中增加“提醒”区域，和重复规则放在同一个弹层内。

交互建议：

- 用户设了 `scheduled_time` 后，默认选中“到点”。
- 对 yearly 日程，如果自然语言识别出“生日 / 纪念日”，可提示推荐提醒组合。
- 用户可以多选快捷项，也可以暂不支持自定义输入。
- memo 卡片上只展示简洁摘要，例如：`9月10日 09:00 · 每年 · 提前7天/1天/到点提醒`。

### 6.7 自然语言识别后续增强

MVP 先不解析提前提醒。后续可支持：

| 输入 | 识别结果 |
| --- | --- |
| `9月10日生日提前7天提醒` | yearly + 7 天前 |
| `下周二下午2点会议提前1小时提醒` | once + 1 小时前 |
| `纪念日提前7天和1天提醒` | yearly + 7 天前 + 1 天前 |

如果用户没有写“提前”，则使用类型默认值；如果类型无法判断，则只用到点提醒。

### 6.8 不做的事

当前阶段不建议做：

- 为每个提前提醒创建一条新 memo。
- 为每个重复日程提前生成未来所有提醒记录。
- 做复杂的自定义提醒规则编辑器。
- 自动归档已经过期的 inbox 提醒。

原因：这些都会增加数据冗余或交互复杂度。先保持“memo 是源，occurrence 和 reminder 都是运行时展开”的模型。

## 七、已确认事项（2026-08-23）

### 7.1 入口位置

- 侧边栏，与 Inbox 同级。（见 5.3）

### 7.2 默认视图

- 默认**月视图**（一格一天，显示当天日程数）。
- 点某天 → 切到**周视图**（7 天 × 24h × 1h 纵向时段，可拖拽）。
- 时间粒度：**1 小时**。

### 7.3 新建 todo 的入口

- **日历内不新建**，统一走 memo 编辑器创建。
- 日历右侧加一个"无时间 todo"列表区（`has_incomplete_tasks == true && scheduled_time == null`），用户拖到日历安排时间。

### 7.4 无 `scheduled_duration` 时的默认时长

- **仅 UI 默认 1 小时**，不写入数据库。
- `scheduled_duration == null` 在数据层就是"点事件"，UI 给 1h 占位高度。
- 用户拉下边缘才把 `scheduled_duration` 写入。

### 7.5 时区

- **浏览器本地时区**。
- 后端只存 UTC `Timestamp`，前端按浏览器时区渲染。
- 不加实例/用户级时区 setting（个人自托管，无需跨时区）。

### 7.6 已有 memo 转日程

- **不加专门"设为日程"按钮**。
- 在 memo 编辑器工具栏加 `ScheduleSelector`（与 `VisibilitySelector` 同级，见 5.5）。
- 设了 `scheduled_time` 即视为日程，自动进日历。
- `- [ ]` 只是"完成状态"，**不**自动转日程（解耦）。

### 7.7 日历内时段视图（点击月格后切到周视图）

- 周/日视图二选一 → **周视图**（7 天 × 24h）。

### 7.8 `- [ ]` 与日程的关系

- `- [ ]` 是"完成状态"，`scheduled_time` 是"排期"，两者独立。
- 有 `- [ ]` 不等于日程；设了 `scheduled_time` 才进日历。
