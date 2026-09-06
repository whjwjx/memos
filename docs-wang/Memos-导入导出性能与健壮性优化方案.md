# Memos 导入导出性能与健壮性优化方案

## 背景

当前用户反馈：

- 灾备备份下载慢。
- Web 页面里的 all export 下载慢。
- 希望检查导入导出相关接口，确认速度和健壮性如何优化。

本方案基于当前代码检查，不改变已有语义，只讨论优化方向和落地顺序。

## 接口范围

### 灾备备份

```http
GET /api/v1/instance/backup:download
```

代码位置：

```text
server/router/api/v1/backup_export.go
```

用途：

- 管理员整站灾备。
- 当前仅支持 SQLite。
- 产物是数据库快照和本地附件组成的 zip。

### 产品级导出

```http
GET /api/v1/export:download?scope=mine
GET /api/v1/export:download?scope=all
```

代码位置：

```text
server/router/api/v1/import_export.go
```

用途：

- `mine`：用户导出自己的数据。
- `all`：管理员导出全站结构化数据。

### 产品级导入

```http
POST /api/v1/import
POST /api/v1/import/uploads
PUT /api/v1/import/uploads/{uploadId}/chunks/{index}
POST /api/v1/import/uploads/{uploadId}/complete
DELETE /api/v1/import/uploads/{uploadId}
```

代码位置：

```text
server/router/api/v1/import_export.go
server/router/api/v1/import_upload.go
```

用途：

- 小文件直接上传导入。
- 大文件分片上传后合并导入。
- 支持 Memos 结构化 zip 和 Flomo zip。

## 当前性能特征

### 1. 下载前无进度

灾备备份和结构化导出都是：

```text
服务端临时目录生成完整 zip
获取 zip size
设置 Content-Length
再把 zip copy 给 HTTP response
```

影响：

- 浏览器会在服务端生成 zip 阶段表现为“卡住”。
- 只有 zip 完整生成后，浏览器才开始显示下载进度。
- 用户会误以为是网络问题，但实际可能是服务端正在打包。

### 2. 附件重复压缩收益低

当前 zip 使用 `zip.Writer.Create`，默认 deflate 压缩。

图片、音频、视频通常已经压缩过，再 deflate：

- 压缩率收益很小。
- CPU 开销明显。
- 大量附件时会拖慢备份和 all export。

### 3. all export 附件内存开销偏高

当前 `writeExportAttachments` 调用：

```go
blob, err := s.GetAttachmentBlob(ctx, attachment)
```

`GetAttachmentBlob` 对本地文件使用：

```go
io.ReadAll(file)
```

影响：

- 每个附件完整读入内存。
- 写 zip 时再从内存写出。
- 计算 sha256 时再次遍历 blob。
- 大附件或并发导出时内存压力较大。

### 4. all export 附件 creator 存在 N+1 查询

`scope=all` 时，`fillAttachmentCreatorUsernames` 会对每条 attachment 再执行一次：

```go
s.Store.GetAttachment(...)
```

影响：

- 附件数量越多，额外查询越多。
- 对 all export 影响最明显。

### 5. 产品级导入会一次性读取 JSONL 和附件

当前导入逻辑：

- `readJSONLFromZip` 把 JSONL 全部读成 slice。
- `importAttachmentsFromZip` 先把附件内容全部读入 `inputs`。
- `readZipEntry` 使用 `io.ReadAll`。

影响：

- 大 zip 导入时内存峰值较高。
- 附件多时，导入前会先累计一批 blob。
- 如果某个大附件异常，错误出现较晚。

### 6. 分片上传基础健壮性较好

当前分片上传已经具备：

- 单片大小限制。
- 总大小限制。
- SHA-256 校验。
- upload id 路径逃逸防护。
- session TTL。
- chunk 临时文件 + rename。
- complete 后清理 session。

主要可继续加强的是：

- 并发 complete 防护。
- 上传 session 状态记录。
- 过期 session 定时清理，而不是只在 create 时顺带清理。
- 完成后导入失败时保留诊断信息或可重试策略。

## 网络因素判断

本机手动远程备份验证结果：

```text
文件大小约 196MB
zip 可打开
包含 database/memos.db
包含 attachments/assets/...
```

下载过程中，本地 zip 文件持续增长，说明：

- 远程接口认证和响应链路正常。
- 慢的一部分确实来自网络传输。
- 但服务端生成 zip 阶段也会造成 Web 初始等待，因此不是纯网络问题。

## 优化目标

1. 让用户知道当前处于哪个阶段：生成中、传输中、完成或失败。
2. 降低服务端 CPU、内存和磁盘 I/O。
3. 大文件导入导出时避免一次性读入内存。
4. 避免 N+1 查询。
5. 保持现有 API 语义和导入幂等行为。
6. 不优先引入重依赖，不改变认证和权限模型。

## 推荐优化顺序

### 阶段 1：加耗时日志和结果指标

先做可观测性，低风险，收益直接。

建议给以下阶段加日志：

灾备备份：

- 认证完成。
- SQLite `VACUUM INTO` 耗时。
- 数据库快照加入 zip 耗时。
- 附件扫描数量、跳过数量、总字节数、打包耗时。
- manifest 写入耗时。
- zip 总大小。
- HTTP copy 耗时。

结构化导出：

- users/memos/attachments/relations/reactions 查询耗时。
- JSONL 写入耗时。
- 附件读取、sha256、写 zip 耗时。
- skipped 数量和原因计数。
- zip 总大小。
- HTTP copy 耗时。

导入：

- manifest 读取耗时。
- JSONL 读取条数和耗时。
- memo/attachment/relation/reaction 导入耗时。
- created/skipped 数量。
- checksum mismatch 数量。

建议日志字段：

```text
operation=backup|export|import
scope=all|mine
phase=...
durationMs=...
bytes=...
count=...
skipped=...
```

验收：

- 一次备份或 all export 后，可以从服务端日志判断慢在生成、附件处理还是 HTTP 传输。

### 阶段 2：附件不重复压缩

对常见已经压缩的附件使用 zip Store 模式：

```text
.jpg .jpeg .png .gif .webp .mp3 .m4a .aac .ogg .mp4 .mov .webm .zip .gz .7z .pdf
```

做法：

- 新增 `createZipFileHeader` helper。
- 对不可压缩类型设置 `Method: zip.Store`。
- 对 JSON、SQLite 快照、manifest 仍保留 deflate。

注意：

- `archive/zip` 使用 Store 时需要 CRC 和 size 信息。
- 对本地文件可以提前 stat 并流式计算 CRC，或先保守只对 export 附件优化为流式 deflate。
- 若实现复杂，第一版可以只加日志，不急着 Store。

验收：

- 相同附件集下，服务端 CPU 降低。
- zip 体积不明显增大。
- zip 可正常解压。

### 阶段 3：all export 附件流式处理

当前流程：

```text
GetAttachmentBlob -> []byte
entry.Write(blob)
sha256.Sum256(blob)
```

建议改为：

```text
打开附件 reader
io.Copy(io.MultiWriter(zipEntry, sha256Hasher), reader)
```

需要新增内部能力：

- `openAttachmentReader(ctx, attachment)`，返回 `io.ReadCloser`、size、storage type。
- 本地附件用 `os.Open`。
- S3 附件如果当前 driver 只能返回 `[]byte`，可以先保持原行为，后续再扩展 S3 streaming。
- DB blob 暂时仍是内存，但保持接口统一。

好处：

- 本地附件不再完整进内存。
- 写 zip 和 sha256 一次遍历完成。
- all export 大附件更稳。

验收：

- all export 包内容和 manifest 不变。
- sha256 仍可校验。
- 大附件导出内存峰值下降。

### 阶段 4：去掉 all export 附件 creator 的 N+1

当前 `writeExportAttachments` 在遍历附件时其实已经拿到了 `CreatorID`，但 record 先填了当前 user，之后 all scope 再逐条查询附件补 creator。

建议：

1. 遍历 attachments 时收集 `CreatorID`。
2. 批量调用现有 `listUsersByID`。
3. 生成 record 时直接填 `creator.Username`。
4. 删除或简化 `fillAttachmentCreatorUsernames`。

验收：

- `scope=all` 导出附件 creator 正确。
- 附件多时查询数量明显下降。

### 阶段 5：导入附件边读边处理

当前导入先把所有附件 zip entry 读成 `inputs`，再统一创建。

建议改成：

```text
for record in attachmentRecords:
  validate content path
  open zip entry reader
  创建临时文件或直接保存 blob
  同时计算 sha256
  创建 attachment 记录
```

如果 `SaveAttachmentBlob` 目前要求 `[]byte`，可分两步：

第一步：

- 不再把所有附件 blob 存进 `inputs`。
- 每条附件读入后立即处理，处理完释放内存。

第二步：

- 再扩展 `SaveAttachmentBlob` 支持 reader。

验收：

- 重复导入仍跳过，不产生重复 memo/attachment。
- checksum mismatch 仍能跳过并记录 warning。
- 大 zip 导入内存峰值下降。

### 阶段 6：导出 streaming zip

这是体验最好但复杂度最高的优化。

目标：

- 请求进入后尽快返回 response header。
- 服务端边生成 zip 边写 HTTP response。
- 浏览器很快看到下载开始。

风险：

- 一旦 header 发出，中途失败不能再返回正常 JSON 错误。
- `Content-Length` 不好提前知道。
- 浏览器下载失败体验需要额外处理。
- 代理层超时策略要重新确认。

建议：

- 不作为第一阶段。
- 等阶段 1 日志确认生成阶段确实是主要瓶颈后再做。
- 可新增异步 export job，而不是直接 streaming 当前接口。

## Web 体验优化

页面发起 all export 时，建议不要只依赖浏览器下载行为。

更好的体验：

1. 点击导出后显示 loading 状态。
2. 文案区分：
   - 正在生成导出包。
   - 正在下载。
   - 导出完成。
   - 导出失败。
3. 对 all export 给出提示：
   - 全站导出可能包含大量附件，需要较长时间。
4. 如果采用异步 job：
   - `POST /api/v1/export/jobs`
   - `GET /api/v1/export/jobs/{id}`
   - `GET /api/v1/export/jobs/{id}:download`

MVP 可以先不做 job，只在前端按钮上加“正在准备导出包...”。

## 健壮性检查清单

### 权限

- 灾备备份只允许 admin。
- `scope=all` export/import 只允许 admin。
- `scope=mine` 只能处理当前用户数据。
- PAT 和 Cookie 认证路径保持一致。

### 大小限制

- 直接 import 受 `MaxAPIRequestBytes` 限制。
- 分片上传总大小限制为 `2GB`。
- 单片限制为 `32MB`。
- zip entry 解压后大小应继续校验，避免 zip bomb。

### 路径安全

- 导入附件路径必须以 `attachments/` 开头。
- 禁止 `..`、反斜杠、绝对路径。
- upload id 已使用 UID matcher 和 root rel 校验。

### 幂等

- memo UID 重复跳过。
- attachment UID 重复跳过。
- relation/reaction 重复跳过。
- `scope=mine` 使用稳定 UID 映射，避免跨用户冲突。

### 清理

- 临时 export/backup 目录 `defer os.RemoveAll`。
- import upload complete 后清理 session。
- expired upload session 当前只在 create 时清理，建议后续加后台清理或启动清理。

### 错误可诊断

- warning 数量目前有限制，避免响应过大。
- 建议补充 warning category 计数，避免只看到前 N 条样本。
- 建议服务端日志记录 skipped reason 聚合。

## 推荐落地版本

### MVP 优化

优先做：

1. 备份/export/import 阶段耗时日志。
2. all export 附件 creator 批量映射，去掉 N+1。
3. all export 附件处理改为单附件即时释放，不累计全部 blob。
4. Web all export 按钮显示“正在准备导出包...”。

这组改动风险低，能直接定位瓶颈并降低 all export 压力。

### 第二版优化

继续做：

1. 本地附件真正流式写 zip + sha256。
2. 导入附件逐条处理，不构造大 `inputs`。
3. expired upload session 后台清理。
4. zip entry 解压大小上限和异常包测试。

### 第三版优化

再考虑：

1. 异步 export job。
2. streaming zip download。
3. export 进度查询。
4. Web 下载中心/任务列表。

## 不建议第一版做的事

- 不建议先改成全 streaming zip，错误处理复杂。
- 不建议引入新的压缩库或队列系统。
- 不建议改变现有 zip 格式。
- 不建议取消 sha256，导入健壮性会下降。
- 不建议把灾备备份和产品级 export 合并成一个接口。

## 结论

当前慢不是单一网络问题：

- 备份和 all export 的服务端生成阶段会让 Web 初始等待较久。
- 196MB 级别的备份包跨公网下载也会受到网络速度影响。
- all export 代码里还有可明确优化的内存读取、重复遍历和 N+1 查询。

推荐先做可观测性和低风险服务端优化，再根据日志决定是否做 streaming 或异步导出任务。
