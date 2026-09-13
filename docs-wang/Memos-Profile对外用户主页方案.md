# Memos Profile 对外用户主页方案

> 状态：方案设计中
> 决策日期：2026-09-13
> 核心定位：Profile 不是 Home 的复制品，而是一个对外展示名片。

## 一、背景

当前 Profile 页面整体偏单调，主要由头像、简介、分享按钮、memo 列表和地图组成。对于未登录用户或其他用户来说，Profile 只能看到公开可见 memo，本身是正确的隐私边界；但作为“用户主页”，它还不够像一个可以被用户主动打造的对外名片。

这次讨论后的产品共识：

> 公开内容负责表达“我愿意展示什么”，匿名统计负责表达“我持续在做什么”。

因此 Profile 应该从“某个用户的 memo 列表页”升级为“对外用户主页”。Home 仍然负责完整个人数据、私有统计和个人回顾；Profile 负责公开表达和可选的匿名创作概况。

## 二、现有代码观察

### 2.1 Profile 主体当前比较薄

入口：

```text
web/src/pages/UserProfile.tsx
```

当前结构：

- `ProfileHeader`：头像、名称、简介、分享链接。
- `PagedMemoList`：展示该用户当前访问者可见的 memo。
- `UserMemoMap`：展示该用户当前访问者可见 memo 的位置。

这说明 Profile 现在更像“公开 memo 列表 + 地图”，缺少主页化的概况区域、精选区域和用户可自定义模块。

### 2.2 统计能力已经存在，但不应该直接照搬到 Profile

相关代码：

```text
web/src/hooks/useFilteredMemoStats.ts
web/src/hooks/useUserQueries.ts
server/router/api/v1/user_service_stats.go
proto/api/v1/user_service.proto
```

`UserStats` 已经包含：

- `memo_created_timestamps`
- `memo_updated_timestamps`
- `tag_count`
- `total_memo_count`
- `memo_type_stats`
- `pinned_memos`

后端 `GetUserStats` 当前会按访问者权限过滤：

- 未登录用户：只统计 `PUBLIC`。
- 其他登录用户：统计 `PUBLIC + PROTECTED`。
- 本人：统计全部 memo。

这套行为适合 Home / Sidebar 的个人统计，但直接放到 Profile 会有两个问题：

- 本人打开自己的 Profile 时，会看到完整统计，导致 Profile 和 Home 功能冗余。
- 如果未来想让访客看到“包含私有 memo 的全年活跃度”，不能直接复用原始 timestamps，否则可能泄露私有 memo 的具体时间分布。

### 2.3 地图必须永远只基于可见 memo

相关代码：

```text
web/src/components/UserMemoMap/UserMemoMap.tsx
```

地图展示的是位置数据。位置比普通数量统计敏感得多，因此 Profile 地图不应该出现任何 private memo 的位置。

原则：

- 地图只显示当前访问者可见 memo。
- 即使本人访问自己的 Profile，也不额外展示 private memo 的位置。
- 完整位置回顾应该留在 Home 或未来的个人数据页，而不是 Profile。

## 三、产品定位

Profile 应该分为两层。

### 3.1 公开内容层

公开内容层表达：“我愿意展示什么”。

内容来源只允许使用公开/当前访问者可见的 memo，不能暗中混入 private memo。

建议模块：

- 头像、昵称、用户名、简介、外链。
- 精选公开 memo：用户主动选择想展示的公开 memo。
- 最近公开 memo：按时间展示当前访问者可见 memo。
- 公开标签 / 主题：只统计当前访问者可见 memo 的 tag。
- 公开地图：只展示当前访问者可见 memo 的位置。
- 置顶公开 memo：可以复用现有 pinned memo，但最好和“Profile 精选”分开，避免 Home 内部置顶和对外展示绑死。

### 3.2 匿名统计层

匿名统计层表达：“我持续在做什么”。

这部分可以像 GitHub contributions 一样，不展示具体内容，只展示聚合后的活跃度。

建议指标：

- 一年 memo 活跃热力图。
- 总 memo 数。
- 活跃天数。
- 当前连续记录天数。
- 最长连续记录天数。
- 今年 memo 数。
- 最近 12 个月趋势。

隐私边界：

- 可以选择是否包含 private memo。
- 如果包含 private memo，只返回聚合数字。
- 不返回 private memo 的内容、标题、标签、位置、链接、附件、具体时间点。
- 热力图建议按天聚合，而不是返回原始 timestamp。

## 四、隐私设置建议

Profile 需要明确的设置项，而不是用当前访问者权限隐式决定所有内容。

### 4.1 内容展示范围

固定规则：

```text
Profile 内容展示 = 当前访问者可见 memo
```

这包括：

- memo 列表
- 精选 memo
- 标签
- 地图
- 最近动态

精选 memo 建议只允许选择 `PUBLIC` memo。这样用户知道自己是在打造公开名片，而不是把 protected/private 内容误放到主页上。

### 4.2 统计展示范围

建议新增 Profile 统计可见性：

```text
profile_stats_visibility:
  - HIDDEN
  - VISIBLE_MEMOS_ONLY
  - ANONYMIZED_ALL_MEMOS
```

含义：

- `HIDDEN`：不展示个人概况。
- `VISIBLE_MEMOS_ONLY`：只统计当前访问者可见 memo，隐私最保守。
- `ANONYMIZED_ALL_MEMOS`：统计全部 memo，但只展示匿名聚合数字，类似 GitHub private contributions。

默认值建议：

```text
VISIBLE_MEMOS_ONLY
```

理由：包含 private memo 的匿名统计也会暴露“某天是否写过东西”这种行为信息，应该由用户主动开启。

## 五、可行性分析

### 5.1 前端 MVP：低风险

可以先在 `UserProfile.tsx` 增加 Profile 概况区域，复用现有统计 hook 和日历组件。

可做内容：

- Profile header 下方展示统计摘要。
- 加一年热力图或月历活动图。
- 加“基于可见 memo”的提示。
- 增加精选公开 memo 展示区域的 UI 入口设计。

优点：

- 不改数据库。
- 不改 proto。
- 不改后端权限模型。
- 能立刻让 Profile 更像主页。

限制：

- 这个阶段统计仍然只适合展示“当前访问者可见 memo”的数据。
- 还不能实现“包含 private memo 的匿名总创作概况”。

### 5.2 匿名全部统计：中等风险

如果要实现 GitHub 类似的“包含 private memo 的匿名统计”，建议新增专门的 Profile Stats API，而不是复用 `GetUserStats`。

建议返回结构：

```text
ProfilePublicStats:
  total_memo_count
  active_day_count
  current_streak
  longest_streak
  yearly_activity:
    date -> count
```

注意：

- `yearly_activity` 应该是日期级别 count，不是 timestamp 列表。
- 不返回 tag_count，因为 private tag 会泄露主题。
- 不返回 pinned_memos，因为 private memo 不能出现在公开主页。
- 不返回 memo_type_stats，除非确认不会泄露用户隐私偏好。

后端需要做：

- 读取目标用户的 Profile 统计可见性设置。
- 如果是 `VISIBLE_MEMOS_ONLY`，沿用当前访问者可见性过滤。
- 如果是 `ANONYMIZED_ALL_MEMOS`，只聚合 count，不返回任何 memo 细节。
- 缓存 key 需要包含目标用户、访问者身份和 stats visibility。

### 5.3 Profile 自定义：中等风险

后期用户自己打造展示名片，需要存储 Profile 配置。

可能配置：

```text
profile_layout:
  bio_enabled
  stats_enabled
  featured_memo_names
  map_enabled
  tags_enabled
  links
```

注意：

- `featured_memo_names` 只允许 PUBLIC memo。
- 如果 memo 后来改成 private，需要自动从 Profile 精选中隐藏或移除。
- 外链需要做 URL 校验和安全渲染。

## 六、影响性分析

### 6.1 用户体验影响

正向影响：

- Profile 从“单调列表”变成真正的对外主页。
- 用户可以用公开 memo 表达自己。
- 访客可以通过匿名活跃度理解这个用户是否持续记录。
- Home 和 Profile 的职责不再重复。

需要注意：

- 本人访问自己的 Profile 时，应该明确这是“公开主页预览”。
- 完整私有统计仍然放在 Home / Statistics，不要混进 Profile。

### 6.2 隐私影响

主要风险：

- 匿名统计如果包含 private memo，会暴露用户在某些日期是否活跃。
- 标签、地图、精选 memo 都可能泄露具体内容，因此不能包含 private memo。

控制方式：

- 默认只统计可见 memo。
- 全部 memo 匿名统计必须由用户主动开启。
- 全部 memo 匿名统计只返回按天聚合数字。
- 地图永远只使用可见 memo。

### 6.3 技术影响

前端 MVP 影响较小：

- 主要修改 `UserProfile.tsx`。
- 可能复用 `ActivityCalendar/YearCalendar`、`StatisticsView`。
- 需要补充 Profile 页面测试或组件测试。

匿名统计增强影响中等：

- 可能需要改 `proto/api/v1/user_service.proto`。
- 需要新增/调整 generated API。
- 需要新增后端 service 逻辑。
- 需要新增用户设置字段。
- 如设置存储沿用现有 user setting 结构，可能不需要数据库迁移；如果新增独立表或字段，则需要三种数据库迁移。

缓存影响：

- 现有 `UserStats` cache 按 viewer 区分。
- Profile 匿名统计需要单独 cache，避免把 owner 全量统计错误返回给访客。

## 七、推荐实施阶段

### 阶段 1：Profile 可见数据主页化

目标：先把 Profile 做成更像主页，但不引入新的隐私风险。

内容：

- Header 下方增加公开概况区域。
- 展示基于当前访问者可见 memo 的摘要和活动图。
- 展示精选公开 memo 区域。
- 地图保持只显示可见 memo。
- 本人访问自己的 Profile 时显示“公开主页预览”提示。

验收：

- 未登录用户只看到 public memo 及其统计。
- 其他登录用户只看到自己有权限看到的 memo 及其统计。
- 本人打开 Profile 不展示 private memo 的内容和位置。
- Home 仍然保留完整私有统计。

### 阶段 2：匿名全部统计

目标：支持 GitHub 类似的“我持续在做什么”。

内容：

- 增加 `profile_stats_visibility` 设置。
- 新增 Profile 专用匿名统计 API。
- 支持 `HIDDEN / VISIBLE_MEMOS_ONLY / ANONYMIZED_ALL_MEMOS`。
- 前端在 Profile 上按设置展示统计说明。

验收：

- 默认不暴露 private memo 活跃。
- 用户开启后，访客只能看到按天聚合数字。
- 访客不能通过接口拿到 private memo 的时间点、标签、位置、内容。

### 阶段 3：用户自定义名片

目标：让用户主动打造自己的 Profile。

内容：

- 选择精选公开 memo。
- 自定义模块顺序。
- 控制是否显示统计、地图、标签、最近公开 memo。
- 增加个人外链。

验收：

- 只能选择 public memo 作为精选。
- memo 可见性变化后，Profile 自动遵守最新权限。
- 未登录访问效果稳定。

## 八、参考产品

- GitHub Profile contributions：公开贡献展示活跃度；私有贡献可选择以匿名数量展示，但不暴露具体内容。
- GitHub Profile README：用户可以主动打造个人主页内容。
- Strava Profile privacy：个人主页可见性和具体活动详情分开控制。
- Duolingo Streak：连续记录和活跃天数适合作为轻量激励指标。

参考链接：

- https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference
- https://docs.github.com/en/account-and-profile/how-tos/contribution-settings/manage-visibility-settings-for-private-contributions-and-achievements
- https://docs.github.com/en/account-and-profile/how-tos/setting-up-and-managing-your-github-profile/customizing-your-profile/about-your-profile
- https://support.strava.com/en-us/articles/15401967-profile-page-privacy-controls
- https://blog.duolingo.com/improving-the-streak/

## 九、当前结论

Profile 应该按“对外用户主页”设计，而不是 Home 的另一个入口。

短期先做“公开内容 + 可见统计”的主页化 MVP；中期再做“匿名全部统计”的后端能力；长期支持用户自定义自己的展示名片。

最终边界：

- 公开内容负责表达“我愿意展示什么”。
- 匿名统计负责表达“我持续在做什么”。
- private memo 的内容、标签、位置和具体时间点不进入 Profile。
