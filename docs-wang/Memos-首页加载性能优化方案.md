# Memos 首页加载性能优化方案

## 背景

当前观察到的问题：

- 重新部署后，强制刷新首页会感觉有点卡。
- 首页 memo 中的图片，尤其是大图，加载较慢。
- 附件图片区的小图相对更快。

本方案基于当前代码检查，目标是把首页首屏加载拆成两轮优化：第一轮先解决低风险、收益明显的问题；第二轮再处理需要更多后端设计或缓存策略权衡的问题。

## 首页加载链路

首页入口：

```text
web/src/pages/Home.tsx
```

首页列表：

```text
web/src/components/PagedMemoList/PagedMemoList.tsx
web/src/hooks/useMemoQueries.ts
```

memo 卡片渲染：

```text
web/src/components/MemoView/MemoView.tsx
web/src/components/MemoView/components/MemoBody.tsx
web/src/components/MemoContent/MemoMarkdownRenderer.tsx
web/src/components/MemoContent/markdown/Image.tsx
```

附件图片区：

```text
web/src/components/MemoMetadata/Attachment/AttachmentListView.tsx
web/src/utils/media-item.ts
web/src/utils/attachment.ts
```

后端附件文件服务：

```text
server/router/fileserver/fileserver.go
```

侧边栏统计：

```text
web/src/hooks/useFilteredMemoStats.ts
web/src/hooks/useUserQueries.ts
server/router/api/v1/user_service_stats.go
```

## 当前性能特征

### 1. 部署后第一次强刷会重新拉前端资源

前端由 Vite 构建，静态资源带 hash。重新部署后旧资源缓存失效，第一次强制刷新需要重新下载、解析、执行 JS/CSS。

这属于正常现象。若只是部署后的第一次慢，通常不是业务接口问题。

### 2. 首页首屏会并发拉多类数据

首页打开时，通常会同时发生：

- 当前用户和用户设置。
- 实例配置。
- memo 列表。
- 侧边栏统计和 tags。
- memo views。
- 图片、音频等附件资源。

这些请求叠加后，低配置服务器、弱网络或图片较多时，会产生明显的首屏等待感。

### 3. 附件图片区会走缩略图

附件图片区里的图片使用：

```text
/file/attachments/{uid}/{filename}?thumbnail=true
```

后端会生成最大边 `600px` 的 JPEG 缩略图，并缓存到：

```text
{data}/.thumbnail_cache
```

所以附件小图通常更快。大图第一次访问慢，可能是因为服务端正在读取原图、解码、缩放、编码并写入缩略图缓存。

### 4. 正文内嵌图片目前更可能拉原图

用户通过编辑器插入到正文里的托管图片类似：

```markdown
![image](/file/attachments/{uid})
```

当前渲染链路会把托管图片解析为附件原始地址：

```text
resolveManagedAttachmentImageSource -> getAttachmentUrl
```

这意味着 feed 首页展示正文内嵌图片时，可能直接加载原图，而不是缩略图。若首页首屏包含多张大图，这是最容易感知到的慢点。

### 5. 私有附件缓存策略很保守

文件服务当前默认：

```text
privateAttachmentCacheControl = "private, no-store"
```

公开附件为：

```text
publicAttachmentCacheControl = "public, no-cache"
```

`no-store` 对隐私最保守，但代价是浏览器刷新时不能稳定复用私有图片缓存。对于个人自用实例，这会让图片列表更容易重复加载。

### 6. 首页列表会自动续拉

默认 memo 列表 page size：

```text
DEFAULT_LIST_MEMOS_PAGE_SIZE = 16
```

`PagedMemoList` 有自动续拉逻辑：如果当前页面高度不够滚动，会继续拉下一页，直到页面可滚动。

这对纯文本体验很好，但在图片未加载完成时，页面高度可能暂时偏低，容易触发额外分页请求，进一步放大图片和 memo 渲染压力。

### 7. 侧边栏统计接口会扫描 memo 聚合

`GetUserStats` 会分页读取该用户 memo，聚合：

- 创建/更新时间戳。
- tag 计数。
- pin 信息。
- memo 类型统计。
- memo 总数。

新增的“笔记、标签、天数”统计只是复用已有 stats 数据做前端计数，不会新增接口。但 stats 接口本身属于首页并发请求的一部分，后续仍有优化空间。

## 两轮修复建议

### 第一轮：低风险、收益明显

第一轮目标是减少首页首屏的大图传输和重复请求，不改变权限语义，不做复杂后端缓存。

#### 1. Feed 中正文内嵌托管图片改用缩略图

做法：

- 在 compact/feed 渲染场景下，正文里的托管图片使用 `?thumbnail=true`。
- 图片预览弹窗仍使用原图地址，保证点击查看时是高清图。
- 外链图片不改，避免代理和跨域问题。

涉及位置：

```text
web/src/components/MemoContent/MemoMarkdownRenderer.tsx
web/src/components/MemoContent/markdown/Image.tsx
web/src/utils/managed-attachment.ts
web/src/utils/attachment.ts
web/src/components/MemoView/hooks/useImagePreview.ts
```

可行性：

- 高。现有附件图片区已经有 `getAttachmentThumbnailUrl`，服务端也支持 `thumbnail=true`。
- 可以复用已有工具函数，不需要新增 API。

影响：

- 首页列表加载明显变轻。
- 图片在卡片里会以 600px 缩略图展示，视觉上足够用于列表浏览。
- 点击预览需要确保加载原图，而不是缩略图。

风险：

- 正文图片点击预览需要保留原图 URL，否则预览也会变成缩略图。
- 非托管图片、外链图片不要误改。

验收：

- 首页 feed 中托管内嵌图片的网络请求带 `thumbnail=true`。
- 点击图片预览时请求原图地址，不带 `thumbnail=true`。
- 附件图片区现有行为不回退。

#### 2. 私有缩略图允许短时间浏览器缓存

做法：

- 仅对 `thumbnail=true` 的私有附件响应设置短缓存，例如：

```text
Cache-Control: private, max-age=3600
```

- 原图、音频、视频等仍保持原有策略，尤其是私有原图不放开。

涉及位置：

```text
server/router/fileserver/fileserver.go
```

可行性：

- 中高。服务端已经能区分 `wantThumbnail` 和读权限类型。
- 只改变缩略图响应头，不改变授权判断。

影响：

- 刷新首页时，浏览器可以复用近期私有缩略图。
- 对个人实例体验改善明显。

风险：

- `private, max-age` 表示只允许当前浏览器私有缓存，不允许共享代理缓存；但本机浏览器仍会保留缩略图一段时间。
- 如果用户非常在意“退出登录后本机缓存不留图”，可以保持 `no-store`。因此这项可以做成保守方案或配置项。

验收：

- 私有缩略图响应头为 `private, max-age=3600`。
- 私有原图仍保持 `private, no-store`。
- 未授权访问仍返回 401/403/404，不因缓存策略绕过权限。

#### 3. 统计查询增加 staleTime

做法：

- 给 `useUserStats` 和 `useAllUserStats` 增加明确的 `staleTime`，建议 2 分钟。
- 数据变更后现有 create/update/delete/pin/tag 操作已经会 invalidate `userKeys.stats()`，所以实时性仍可接受。

涉及位置：

```text
web/src/hooks/useUserQueries.ts
```

可行性：

- 高。React Query 已在其他统计类查询中使用类似策略。

影响：

- 短时间切页、返回首页、窗口重新聚焦时减少重复 stats 请求。
- 新增/修改 memo 后，因为已有 invalidate，仍会刷新。

风险：

- 若某些修改路径漏掉 invalidate，统计可能最多延迟 2 分钟更新。需要检查常见 memo 保存、删除、pin、tag 重命名路径。

验收：

- 短时间重复进入首页，不重复请求 stats。
- 新增/删除/修改 memo 后，侧边栏统计仍刷新。

#### 4. 自动续拉避免图片未撑高时过早连拉

做法：

- 保留“不够一屏时自动补一页”的体验。
- 给自动续拉增加更保守的触发条件，例如：
  - 首次渲染后等待更久一点再判断。
  - 如果首屏 memo 中包含图片或附件，最多自动补一页。
  - 用户滚动到底部时仍按原逻辑继续加载。

涉及位置：

```text
web/src/components/PagedMemoList/PagedMemoList.tsx
```

可行性：

- 中高。逻辑集中在 `useAutoFetchWhenNotScrollable`。

影响：

- 图片多的首页不会因为图片尚未加载完成而连续拉多页。
- 首屏网络压力更平稳。

风险：

- 在超高屏或纯文本很短的场景，可能需要用户滚动或等待后才加载更多。
- 需要小心不要破坏现有无限滚动体验。

验收：

- 图片多的首页强刷后，不会瞬间连续请求多页 memo。
- 纯文本短 memo 场景仍能自动补足可滚动页面。

### 第二轮：更深层优化

第二轮适合在第一轮上线稳定后继续做，重点是减少服务端重复计算和第一次访问大图的等待。

#### 1. 上传后预生成缩略图

做法：

- 图片上传成功后，后台异步生成缩略图。
- 首页第一次展示时直接读 `.thumbnail_cache`。

涉及位置：

```text
server/router/api/v1/attachment_service.go
server/router/fileserver/fileserver.go
store/attachment.go
```

可行性：

- 中。已有缩略图生成函数，但当前在 fileserver 中按需生成；需要抽出可复用逻辑或新增后台任务。

影响：

- 大图第一次出现在首页时更快。

风险：

- 上传接口耗时或后台任务复杂度增加。
- 需要控制并发，避免批量上传大图时 CPU/内存压力过高。

#### 2. Stats 后端缓存或增量统计

做法：

- 方案 A：服务端短 TTL 缓存 `GetUserStats` 结果，memo 变更时失效。
- 方案 B：维护统计表/物化统计，按 memo 变更增量更新。

涉及位置：

```text
server/router/api/v1/user_service_stats.go
store/
store/db/{sqlite,mysql,postgres}/
```

可行性：

- TTL 缓存：中高。
- 增量统计表：中低，涉及数据库迁移和一致性，影响更大。

影响：

- 减少首页强刷时 stats 扫 memo 的成本。
- 对 memo 数量上万后更明显。

风险：

- 缓存失效策略需要覆盖 create/update/delete/archive/pin/tag 等路径。
- 增量统计表需要三套数据库迁移，测试成本更高。

#### 3. 更细粒度的图片懒加载和预览策略

做法：

- 列表图只加载进入视口附近的缩略图。
- 预览弹窗打开时再加载原图。
- 对多图 memo 做首张优先、其余延后。

可行性：

- 中。当前已有 `loading="lazy"`，但瀑布流和浏览器 lazy 策略不一定足够细。

影响：

- 图片很多时首屏更稳。

风险：

- 需要保证布局估算和懒加载不会造成明显跳动。

## 推荐落地顺序

### 第一轮先做

1. Feed 正文托管图片使用缩略图，预览用原图。
2. 私有缩略图短缓存。
3. stats 查询增加 `staleTime`。
4. 自动续拉策略变保守。

原因：

- 改动范围可控。
- 不需要数据库迁移。
- 对首页图片慢和强刷慢都有直接帮助。
- 可以独立验证和回滚。

### 第二轮后做

1. 上传后预生成缩略图。
2. stats 后端缓存。
3. 更细粒度图片懒加载。

原因：

- 需要更充分的服务端设计。
- 涉及并发、缓存失效、上传路径和测试覆盖。
- 更适合在第一轮稳定后基于实际瓶颈继续推进。

## 不建议第一轮就做的事

- 不建议直接增大首页 page size。图片多时会更慢。
- 不建议直接缓存私有原图。隐私风险比缓存缩略图更高。
- 不建议为了 stats 立刻加统计表。当前数据量下投入偏重。
- 不建议代理所有外链图片。会引入安全、缓存和跨域复杂度。

## 验收建议

手动验收：

1. 准备几条包含大图的 memo，其中至少一条是正文内嵌托管图片。
2. 强制刷新首页。
3. 在浏览器 Network 中确认 feed 内嵌托管图片请求带 `thumbnail=true`。
4. 点击图片预览，确认预览加载原图。
5. 刷新第二次，确认缩略图明显更快。
6. 确认未授权用户不能访问私有附件。

技术验收：

```bash
cd web && pnpm lint
cd web && pnpm build
go test -v -race ./server/router/fileserver/...
```

如第一轮只改前端图片 URL 和 React Query staleTime，可先跑前端检查；若改服务端缓存响应头，则必须补 fileserver 测试。

