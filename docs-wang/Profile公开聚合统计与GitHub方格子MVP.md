# Profile 公开聚合统计与 GitHub 方格子 MVP

> 状态：待实现
> 决策日期：2026-09-13
> 核心目标：内容权限保持现状；用户开启设置后，Profile 可以展示全部聚合统计，让访客看见整体记录量和持续度。

## 一、背景

当前 `/u/:username` Profile 页面已经可以作为用户对外主页的基础入口。用户希望先不改 memo 列表权限、不做反馈、浏览量、chatbot、广告等扩展功能，而是优先增强 Profile 的统计展示：

- 左侧统计区域显示用户整体数量。
- 头像下方区域显示完整统计和 GitHub contributions 风格方格子。
- memo 列表内容保持现状，继续按访问者权限展示。

这个版本的核心思路是：

> 内容可见性和统计可见性分开。内容仍然按权限保护；统计只展示聚合结果。

## 二、权限与可见性规则

### 2.1 memo 列表保持现状

Profile 页面中的 memo 列表不改变现有权限语义：

- 未登录访客：只能看到 `PUBLIC` memo。
- 已登录其他用户：可以看到 `PUBLIC + PROTECTED` memo。
- 用户本人：可以看到自己的全部 memo。

这意味着本次 MVP 不改变 memo 内容、评论、附件、位置等具体内容的可见性。

### 2.2 统计展示由用户开关控制

新增用户设置：

```text
show_full_profile_stats
```

含义：

- 关闭：Profile 统计仍按当前访问者可见内容统计，最保守。
- 开启：Profile 统计展示目标用户的全部聚合数据，不因访问者身份而改变。

默认值：

```text
false
```

理由：总记录量、活跃天数、连续记录和方格子虽然不暴露内容，但仍然属于用户行为信息，应该由用户主动开启。

开启后，Profile 统计模块展示：

- 总 memo 数。
- 总 tag 数。
- 总活跃天数。
- 今年 memo 数。
- 当前连续记录天数。
- 最长连续记录天数。
- GitHub 方格子按天展示全部 memo 的聚合数量。

这些数据只表达“这个用户总体记录了多少、持续了多久”，不暴露具体 private memo 内容。

### 2.3 禁止暴露 private 具体信息

即使统计包含 private memo，也不能返回或展示以下信息：

- private memo 内容、标题、snippet。
- private tag 名称或 private tag 排名。
- private memo 列表。
- private memo 位置。
- private 附件、链接、评论。
- private memo 的具体创建时间点。

GitHub 方格子只展示“某一天有多少条记录”的聚合 count，不展示当天有哪些 memo。

## 三、页面展示范围

### 3.1 左侧统计区域

当前左侧红框区域显示轻量统计和小月历。MVP 中改为基于全部 memo 的聚合统计：

- Notes：全部 memo 总数。
- Tags：全部 tag 数量。
- Days：全部活跃天数。
- 小月历：显示全部 memo 的日级活跃情况。

注意：左侧 tag 列表如果展示 tag 名称，仍应保持现有可见内容逻辑，不展示 private-only tag 名称。总 tag 数可以包含全部 tag 的聚合数量。

### 3.2 头像下方统计区域

头像和用户信息下方新增完整统计区：

- 总 memo 数。
- 总活跃天数。
- 今年 memo 数。
- 当前连续记录天数。
- 最长连续记录天数。
- GitHub contributions 风格方格子。

视觉上作为 Profile 的主要“持续记录证明”模块，不影响下面 memo 列表。

## 四、技术建议

### 4.1 新增 Profile 专用统计 API

现有 `GetUserStats` 会按当前访问者权限过滤，且本人访问时会返回完整数据。这套行为适合当前 Home / Sidebar，但不完全适合“对所有访问者展示同一份聚合统计”的 Profile 模块。

新增 Profile 专用统计接口，例如：

```text
GetUserProfileStats
```

返回结构建议：

```text
ProfileStats:
  total_memo_count
  total_tag_count
  active_day_count
  current_streak
  longest_streak
  year_memo_count
  daily_activity:
    date
    count
```

实现要求：

- 服务端只返回聚合后的 count。
- `daily_activity` 使用日期级别聚合，不返回原始 timestamp。
- 不返回 memo id、uid、content、tag name、location、attachment、link。
- 开关关闭时，沿用当前访问者可见范围做聚合。
- 开关开启时，使用目标用户全部正常 memo 做聚合。
- 缓存 key 需要包含目标用户、访问者身份、统计年份/范围，以及 `show_full_profile_stats` 的开关状态。

这个接口只服务 `/u/:username` Profile 页面，不接入 Home、Explore、Memo Detail 或现有 Sidebar 的其他统计逻辑，避免改变已有页面语义。

### 4.2 数据来源

统计应基于目标用户的全部正常 memo：

- 包含 `PUBLIC / PROTECTED / PRIVATE`。
- 默认排除 archived memo。
- 默认排除 comment memo，除非后续产品明确要把评论也算作记录。

当用户未开启 `show_full_profile_stats` 时，统计应基于当前访问者可见 memo：

- 未登录访客：`PUBLIC`。
- 已登录其他用户：`PUBLIC + PROTECTED`。
- 用户本人：全部 memo。

### 4.3 前端影响

主要涉及：

```text
web/src/pages/UserProfile.tsx
web/src/components/AppSidebar/AppSidebar.tsx
web/src/components/ActivityCalendar/
```

建议先复用现有 ActivityCalendar / YearCalendar 组件能力，避免重新写一套方格子。

## 五、隐私说明

这个 MVP 接近 GitHub private contributions 的思路：访客能知道用户持续记录的总体情况，但看不到私有内容。

隐私风险主要在于：

- 访客可以知道某一天是否有记录。
- 访客可以知道用户总体记录量。
- 访客可以知道连续记录情况。

当前决策是通过用户设置控制是否公开这些聚合信息。后续如果需要更细粒度，可以把布尔开关升级为枚举设置：

```text
profile_stats_visibility:
  - VISIBLE_MEMOS_ONLY
  - ANONYMIZED_ALL_MEMOS
- HIDDEN
```

本次 MVP 先实现布尔开关 `show_full_profile_stats`。

## 六、验收标准

- 默认关闭 `show_full_profile_stats` 时，Profile 统计按当前访问者可见内容展示。
- 用户开启 `show_full_profile_stats` 后，未登录访客访问公开实例上的 `/u/:username`，memo 列表仍只显示 `PUBLIC`，但统计显示该用户全部聚合数据。
- 用户开启 `show_full_profile_stats` 后，已登录其他用户访问 `/u/:username`，memo 列表仍显示 `PUBLIC + PROTECTED`，统计显示该用户全部聚合数据。
- 用户本人访问自己的 Profile，memo 列表仍显示全部，统计显示全部聚合数据。
- 左侧统计区域展示全部 Notes / Tags / Days。
- 头像下方展示完整统计和 GitHub 方格子。
- 方格子只能体现每日 count，不能点开 private memo。
- private memo 的内容、tag 名称、位置、附件、链接不会通过 Profile 统计接口返回。

## 七、暂不包含

本次 MVP 不包含：

- 浏览量统计。
- 匿名反馈页。
- public chatbot。
- 广告或 sponsor 位。
- Profile 模块自定义。
- 本人视角 / 访客视角切换。
- 改动 memo 列表权限语义。
