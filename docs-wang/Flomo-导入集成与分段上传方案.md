# Flomo 导入集成与分段上传方案

## 背景

当前项目已经实现产品级导入/导出能力：

- `GET /api/v1/export:download`
- `POST /api/v1/import`
- 支持 Memos 结构化 zip 数据包导入/导出。
- 导入时按 memo UID / attachment UID 做幂等跳过。

现在需要在此基础上接入 flomo 导入能力，并解决生产环境 Nginx `client_max_body_size 50m` 导致大文件无法一次性上传的问题。

目标不是重写导入导出，而是在现有能力上增加：

1. 分段上传层。
2. 导入来源选择入口。
3. flomo 数据包解析器。

## 当前约束

### Memos 项目

- 后端 API 请求体上限为 `MaxAPIRequestBytes = 256 << 20`，约 256MB。
- 当前 `/api/v1/import` 使用 multipart 表单一次性上传 zip。
- 当前导入逻辑会把上传文件保存为临时 zip，然后调用 `importStructuredZip`。
- 当前导入内部直接走 store 层写入 memo / attachment，不会走 `CreateMemo` API。
- 因此导入不会触发外部 Nginx 高频请求，也不会触发 `CreateMemo` 里的 AI agent reply / auto tag 调度。

### Nginx 生产环境

Memos 站点当前配置：

```nginx
client_max_body_size 50m;
```

并且只有认证接口 `/api/v1/auth/` 套了 `limit_req zone=login`，普通 `/api/v1/import` 没有频率限制。

结论：

- 频率限制不是 flomo 导入的主要障碍。
- 大文件上传限制是主要障碍。
- 不调整 Nginx 时，需要做应用层分段上传。

### Flomo 导出包

已检查的 flomo 导出目录：

```text
D:\xunleixiazai\flomo@圣白夜-20260819\flomo@圣白夜-20260819
├─ 圣白夜的笔记.html
└─ file/
```

数据特征：

- 794 条 memo。
- 196 个附件。
- 附件类型主要为 `.png`、`.jpg`、`.jpeg` 和少量 `.m4a`。
- 原始目录约 201MB。
- flomo HTML 中每条记录为 `.memo` 节点，包含 `.time`、`.content`、图片 `<img>` 和音频 `<audio>`。

## 产品入口

推荐入口使用明确按钮，而不是一个模糊的“导入数据”按钮。

普通用户区域：

```text
我的数据
导出或导入当前账号的 memo 和附件。

[导出 Memos 数据包]

导入
[导入 Memos 数据包]
支持从 Memos 导出的 .zip 数据包。

[导入 flomo 数据包]
支持 flomo 完整导出目录的 .zip，需包含 HTML 文件和 file 文件夹。
```

管理员区域：

```text
全部数据
导出或导入所有用户的 Memos 数据。

[导出全部 Memos 数据包]
[导入全部 Memos 数据包]
```

说明：

- flomo 导入只放在“我的数据”区域。
- flomo 本质是单用户数据来源，导入到当前登录账号最符合预期。
- 前端可以传 `source=memos` 或 `source=flomo`，用于后端做更友好的格式校验和错误提示。
- API 用户不传 `source` 时，后端仍然可以自动识别格式。

## 总体架构

将导入能力拆成两层：

```text
上传层
├─ direct upload：小文件直接 POST /api/v1/import
└─ chunk upload：大文件分段上传，complete 后合并为完整 zip

解析层
├─ memos-export zip：现有结构化 Memos 数据包
└─ flomo zip：新增 flomo 数据包解析
```

上传层只关心文件大小和完整性。

解析层只关心 zip 内容格式。

两层不要绑定，否则后续会出现 “Memos 小文件 / Memos 大文件 / flomo 小文件 / flomo 大文件” 的组合复杂度。

## 上传策略

### 前端选择逻辑

前端仍然展示明确的导入来源按钮，但上传方式由文件大小自动决定：

```text
file.size <= 32MB:
  POST /api/v1/import

file.size > 32MB:
  chunk upload
  complete 后服务端执行导入
```

32MB 是建议阈值，低于 Nginx 当前 50MB 限制，留出 multipart 边界和请求头余量。

### 分段上传接口

建议新增接口：

```http
POST /api/v1/import/uploads
```

创建上传会话。

请求参数：

- `filename`
- `size`
- `sha256`
- `source`
- `scope`

返回：

- `uploadId`
- `chunkSize`
- `expiresAt`
- 已上传 chunk 列表，便于断点续传。

```http
PUT /api/v1/import/uploads/{uploadId}/chunks/{index}
```

上传单个 chunk。

要求：

- 单个 chunk 建议 20MB。
- chunk index 从 0 开始。
- 服务端校验 upload session 归属当前用户。
- 服务端限制 chunk 最大大小，必须小于 Nginx 50MB。

```http
POST /api/v1/import/uploads/{uploadId}:complete
```

完成上传。

服务端行为：

1. 检查所有 chunk 是否存在。
2. 按 index 合并为完整 zip。
3. 校验完整文件大小和 sha256。
4. 调用统一导入入口。
5. 返回导入结果。
6. 清理临时文件。

```http
DELETE /api/v1/import/uploads/{uploadId}
```

取消上传并清理临时文件。

### 临时文件存储

建议目录：

```text
{dataDir}/imports/uploads/{uploadId}/
├─ metadata.json
├─ chunks/
│  ├─ 000000.part
│  ├─ 000001.part
│  └─ ...
└─ complete.zip
```

清理策略：

- 上传会话过期时间默认 24 小时。
- 启动时可以清理过期上传目录。
- 每次创建上传会话时也可以顺手清理少量过期目录。

## 导入格式识别

建议把当前 `importStructuredZip` 外面再包一层统一入口：

```text
importZip(ctx, user, scope, zipFilePath, source)
```

内部逻辑：

```text
如果 zip 存在 manifest.json:
  解析为 Memos 数据包
  校验 format/version
  如果 source=flomo，则提示用户选择了错误入口
  走现有 Memos 导入逻辑

否则如果 zip 内存在 flomo 导出的 html:
  如果 source=memos，则提示用户选择了错误入口
  走 flomo 导入逻辑

否则:
  unsupported import format
```

flomo 识别建议：

- zip 内存在一个 `.html` 文件。
- HTML 中包含 flomo 导出特征，例如 `导出`、`MEMO`、`.memo` 节点。
- zip 内存在 `file/` 目录时可导入附件。
- 如果没有 `file/` 目录，也可以只导入文本，并返回 warning。

## Flomo 解析方案

### 输入要求

用户需要上传 flomo 完整导出目录压缩后的 zip：

```text
flomo-export.zip
├─ 圣白夜的笔记.html
└─ file/
   └─ ...
```

不建议支持单独上传 HTML，因为附件会丢失。

### Memo 映射

flomo 每个 `.memo` 节点映射为一条 Memos memo。

字段映射：

```text
flomo .time        -> CreatedTs / UpdatedTs
flomo .content     -> Content
当前登录用户        -> CreatorID
默认 PRIVATE        -> Visibility
正常状态            -> RowStatus
```

UID 生成：

```text
flomo-{sha256(time + content + index) 前若干位}
```

要求：

- 满足 Memos UID 规则：1-36 字符，只包含字母、数字、连字符，且首尾为字母或数字。
- 同一个 flomo 包重复导入时生成相同 UID。
- 遇到 UID 已存在时沿用现有跳过逻辑。
- `scope=mine` 实际写入前会再按当前登录用户稳定映射 memo UID，避免管理员和普通用户导入同一份 flomo 包时互相去重；同一用户重复导入仍然跳过。

### 内容转换

flomo HTML 转 Markdown：

```text
<p>              -> 段落，段落之间空行
<br>             -> 换行
<ul>/<li>        -> - 列表
<ol>/<li>        -> 1. 列表
<strong>/<b>     -> **加粗**
<em>/<i>         -> *斜体*
<a href>         -> [文本](链接)
<mark>           -> 可转为 ==文本== 或保留纯文本
<u>              -> 可保留纯文本
```

标签：

- flomo 里原有 `#标签` 直接保留。
- Memos 后端会通过 `memopayload.RebuildMemoPayload` 解析 tags。

### 附件映射

flomo 图片：

```html
<img src="file/.../image.jpg">
```

导入为 Memos attachment，并建议在 memo 正文中插入：

```markdown
![image.jpg](/file/attachments/{attachmentUID}/image.jpg)
```

flomo 音频：

```html
<audio src="file/.../audio.m4a">
```

导入为 Memos attachment，并建议在 memo 正文中追加：

```markdown
[audio.m4a](/file/attachments/{attachmentUID}/audio.m4a)
```

如果存在音频转写：

```html
<div class="audio-player__content">...</div>
```

则把转写文本保留到 memo 正文中。

Attachment UID 生成：

```text
flomo-att-{sha256(relativePath + fileContent) 前若干位}
```

导入时：

- 读取 zip 中对应 `file/...` 条目。
- 校验文件存在。
- 推断 MIME type。
- 调用现有 `SaveAttachmentBlob` 保存到目标实例当前存储。
- 通过 `MemoID` 绑定到导入后的 memo。
- `scope=mine` 实际写入前会再按当前登录用户稳定映射 attachment UID，并同步改写 memo 正文中的本地附件链接。

## 代码落点

建议新增或调整：

```text
server/router/api/v1/import_export.go
server/router/api/v1/import_upload.go
server/router/api/v1/import_flomo.go
server/router/api/v1/import_flomo_test.go
web/src/helpers/import-export.ts
web/src/components/Settings/DataSection.tsx
web/src/locales/en.json
web/src/locales/zh-Hans.json
```

### 后端

`import_export.go`：

- 保留现有 direct upload。
- direct upload 保存临时 zip 后，改为调用统一 `importZip`。
- 现有 `importStructuredZip` 保留为 Memos 数据包导入分支。
- 可抽取 “records -> store” 的导入函数，供 flomo 转换后复用。

`import_upload.go`：

- 负责 chunk upload session。
- 负责 chunk 写入、合并、校验、取消、清理。
- complete 后调用 `importZip`。

`import_flomo.go`：

- 负责识别 flomo zip。
- 负责解析 flomo HTML。
- 负责把 flomo memo 转换为内部导入 records。
- 负责生成稳定 UID。

### 前端

`DataSection.tsx`：

- 将“导入我的数据”拆成：
  - `导入 Memos 数据包`
  - `导入 flomo 数据包`
- flomo 只放在“我的数据”区域。
- 管理员区域保留 Memos 全量导入。
- 按钮旁加短说明，不写长说明。

`import-export.ts`：

- `importMemosExport(scope, file)` 扩展为支持 `source` 参数。
- 根据 `file.size` 自动选择 direct upload 或 chunk upload。
- 分段上传时返回上传进度，用于 UI 展示。

### i18n

新增文案建议：

```text
导入 Memos 数据包
支持从 Memos 导出的 .zip 数据包。

导入 flomo 数据包
支持 flomo 完整导出目录的 .zip，需包含 HTML 文件和 file 文件夹。
```

## 错误提示

需要给用户更明确的错误：

- 选择了 Memos 入口，但上传的是 flomo 包。
- 选择了 flomo 入口，但上传的是 Memos 包。
- flomo zip 中没有 HTML 文件。
- flomo zip 中没有 `file/` 目录，附件将无法导入。
- HTML 解析失败。
- 附件文件缺失。
- 文件过大。
- 上传分片缺失。
- 上传 sha256 校验失败。

## 第一阶段 MVP 范围

建议第一阶段完成：

1. 保留现有 Memos 导入导出。
2. 新增 flomo 导入入口。
3. 新增 direct/chunk 自动上传。
4. 支持 flomo zip 文本、图片、音频导入。
5. 支持重复导入自动跳过。
6. 返回导入结果：新增、跳过、warning。

暂不做：

- 后台导入任务表。
- 导入记录页面。
- 复杂进度持久化。
- flomo 单 HTML 导入。
- 覆盖式导入。
- 删除目标端已有数据。

## 第二阶段增强

后续可以增加后台导入任务：

```text
import_task
├─ id
├─ creator_id
├─ source
├─ scope
├─ filename
├─ status
├─ total_memos
├─ processed_memos
├─ created_memos
├─ skipped_memos
├─ created_attachments
├─ skipped_attachments
├─ warnings
├─ error
├─ created_ts
├─ started_ts
└─ finished_ts
```

用户可在页面查看导入记录、进度、失败原因。

这一步不是当前必须项。当前 794 条 memo + 196 个附件可以先用同步 complete 导入验证。

## 推荐实施顺序

1. 抽出统一 `importZip`，让 direct upload 先走新入口，但行为保持不变。
2. 增加 `source` 参数和入口校验。
3. 实现 flomo zip 识别和 HTML parser。
4. 复用现有 store 导入逻辑写入 flomo memo / attachment。
5. 前端拆分导入按钮和文案。
6. 实现 chunk upload。
7. 前端按大小自动 direct/chunk。
8. 加测试覆盖：
   - Memos 原生 zip 不回归。
   - flomo 文本导入。
   - flomo 图片/音频导入。
   - 重复导入跳过。
   - chunk 缺失/sha256 错误。

## 最终结论

当前需求技术可行，且非常适合建立在现有导入导出功能之上。

最优方向：

- 用户入口明确区分“导入 Memos 数据包”和“导入 flomo 数据包”。
- 上传层按文件大小自动选择 direct 或 chunk。
- 后端统一识别和校验数据包格式。
- flomo parser 输出现有导入 records，复用现有幂等写库逻辑。

这样既解决 Nginx 50MB 限制，也不会让导入逻辑分裂成多套。
