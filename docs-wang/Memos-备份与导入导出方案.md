# Memos 备份与导入导出方案

> 本文把两类能力分开：一类是面向管理员灾备的“整站备份”，另一类是面向用户和管理员的“产品级导入/导出”。二者都可以生成 zip，但目标、数据格式、权限和恢复方式不同。

## 结论

当前最稳的设计是同时保留两条线：

- **灾备备份**：管理员通过 API 导出整站 SQLite 快照和附件，本机定时任务拉取 zip，用于事故恢复。
- **导入/导出**：用户或管理员在页面/API 中导出结构化数据包，也可以导入；导入时支持去重，避免重复导入产生重复 memo。

不要把这两件事混成一个功能。灾备追求完整快照和快速恢复；导入/导出追求跨环境迁移、用户自助和幂等导入。

## 1. 灾备备份

### 1.1 使用场景

灾备备份用于“服务坏了以后恢复整站数据”，不是给普通用户日常导入导出的功能。

典型场景：

- 每晚定时把生产 Memos 数据拉到本机。
- 服务器磁盘损坏、误操作、升级失败时回滚。
- 管理员保留最近 30 天备份。

### 1.2 当前 MVP API

接口：

```http
GET /api/v1/instance/backup:download
Authorization: Bearer memos_pat_xxx
```

权限：

- 只允许管理员 PAT 调用。
- 普通用户不能调用。

返回：

- 成功：`200 application/zip`
- 未认证或 PAT 无效：`401`
- 非管理员：`403`
- 非 SQLite 数据库：`501`
- 已有备份执行中：`409`

zip 结构：

```text
memos-backup-yyyyMMdd-HHmmss.zip
├─ database/
│  └─ memos.db
├─ backup.manifest.json
└─ attachments/
   └─ assets/...
```

说明：

- `database/memos.db` 是 SQLite `VACUUM INTO` 生成的一致性快照。
- `attachments/` 只包含本地存储附件。
- 附件引用可以是相对路径，也可以是位于 Memos 数据目录内的绝对路径。
- S3 或数据库 blob 类型附件在 MVP 中暂不完整打包，只在 manifest 中记录跳过信息。

### 1.3 本机定时任务

本机脚本：

```powershell
.\scripts\memos-backup-task.ps1
```

开发环境手动测试：

```powershell
.\scripts\memos-backup-task.ps1 `
  -ApiBase "http://localhost:8081" `
  -PatToken "memos_pat_xxx" `
  -BackupDir "E:\bak\Backups\memos_bak" `
  -RetainDays 30
```

生产环境建议：

```powershell
.\scripts\memos-backup-task.ps1 `
  -ApiBase "http://localhost:5230" `
  -PatToken "memos_pat_xxx" `
  -BackupDir "E:\bak\Backups\memos_bak" `
  -RetainDays 30
```

如果生产环境通过域名访问：

```powershell
-ApiBase "https://memos.example.com"
```

任务计划建议：

- 每晚 23:00 执行。
- 备份目录：`E:\bak\Backups\memos_bak`
- 保留最近 30 天。
- PAT 用环境变量传入，避免直接写在任务命令里。

### 1.4 灾备恢复

当前灾备恢复适合“同一数据目录结构”恢复。

Windows 开发环境备份最适合恢复到：

```text
C:\ProgramData\memos
```

Linux 生产环境备份最适合恢复到：

```text
/var/opt/memos
```

手动恢复步骤：

1. 停止 Memos 服务。
2. 先备份当前线上数据。
3. 解压灾备 zip。
4. 用 `database/memos.db` 覆盖当前 `memos_prod.db`。
5. 删除旧的 `memos_prod.db-wal` 和 `memos_prod.db-shm`。
6. 将 `attachments/` 里的内容合并回 Memos 数据目录。
7. 启动 Memos 服务，检查 memo 和附件。

Windows 开发环境恢复示例：

```powershell
# 1. 停止正在运行的开发后端。
# 如果是当前终端 go run 启动的，直接 Ctrl+C。
# 如果已经后台运行，可以先查找再停止。
Get-NetTCPConnection -State Listen -LocalPort 8081 | Select-Object LocalAddress,LocalPort,OwningProcess
Stop-Process -Id <OwningProcess> -Force

# 2. 备份当前数据目录。
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item "C:\ProgramData\memos" "C:\ProgramData\memos.before-restore-$stamp" -Recurse

# 3. 解压备份 zip 到临时目录。
$restoreDir = "E:\bak\Backups\memos_bak\restore-$stamp"
Expand-Archive "E:\bak\Backups\memos_bak\memos-backup-xxx.zip" $restoreDir

# 4. 覆盖 SQLite 主库，并删除旧 WAL/SHM。
Copy-Item "$restoreDir\database\memos.db" "C:\ProgramData\memos\memos_prod.db" -Force
Remove-Item "C:\ProgramData\memos\memos_prod.db-wal" -Force -ErrorAction SilentlyContinue
Remove-Item "C:\ProgramData\memos\memos_prod.db-shm" -Force -ErrorAction SilentlyContinue

# 5. 如有附件，合并回数据目录。
if (Test-Path "$restoreDir\attachments") {
  Copy-Item "$restoreDir\attachments\*" "C:\ProgramData\memos" -Recurse -Force
}

# 6. 重新启动开发后端。
go run ./cmd/memos --port 8081 --data "C:\ProgramData\memos"
```

注意：Windows 恢复时，`Copy-Item "$restoreDir\attachments\*" "C:\ProgramData\memos"` 会把 zip 里的 `attachments/assets/...` 合并成 `C:\ProgramData\memos\assets\...`。

跨系统恢复的风险：

- 如果数据库里的附件 reference 是绝对路径，Windows 和 Linux 之间不能直接互通。
- 后续如果要支持跨系统灾备恢复，需要恢复脚本做附件路径迁移，或者导出时把附件 reference 规范化为相对路径。

## 2. 产品级导入/导出

### 2.1 使用场景

导入/导出用于“用户数据迁移、归档、自助恢复、跨环境搬迁”，不是直接替代灾备备份。

典型场景：

- 普通用户导出自己的 memo 和附件。
- 普通用户把导出的 zip 导入到另一个 Memos 实例。
- 管理员导出自己的数据。
- 管理员额外拥有导出全部数据的能力。
- 用户重复导入同一个 zip，不应产生重复 memo。

### 2.2 权限模型

普通用户：

- 导出我的数据。
- 导入到我的账号。

管理员：

- 导出我的数据。
- 导入到我的账号。
- 导出全部数据。
- 导入全部数据，作为管理员迁移/恢复入口。

注意：管理员也是一个普通用户，所以管理员必须保留“只导出我的数据”的入口；“导出全部数据”是额外能力。

### 2.3 建议入口

个人设置页：

- `导出我的数据`
- `导入我的数据`

Admin 设置页：

- `导出全部数据`
- `导入全部数据`

也可以先只做 API，页面入口放第二阶段。

## 3. 导出包格式

产品级导出包不要直接导出数据库文件，建议使用结构化迁移格式：

```text
memos-export-v1.zip
├─ manifest.json
├─ users.jsonl              # 全站导出才需要
├─ memos.jsonl
├─ attachments.jsonl
├─ memo_relations.jsonl
├─ reactions.jsonl
└─ attachments/
   ├─ attachment_uid_1/
   │  └─ original-filename.png
   └─ attachment_uid_2/
      └─ audio.mp3
```

推荐 JSONL 而不是一个巨大 JSON：

- 便于流式导入导出。
- 大数据量时内存压力小。
- 单条失败时更容易定位和跳过。

manifest 建议包含：

```json
{
  "format": "memos-export",
  "version": 1,
  "scope": "user",
  "sourceInstance": "https://memos.example.com",
  "exportedAt": "2026-08-29T13:00:00+08:00",
  "exportedBy": "users/xxx",
  "counts": {
    "users": 0,
    "memos": 10,
    "attachments": 3
  }
}
```

## 4. 去重和幂等导入

导入必须是幂等的：同一个包导入多次，不应该产生重复数据。

### 4.1 Memo 去重

优先按源 UID 去重：

```text
source_instance + source_memo_uid
```

如果当前库已经导入过该源 memo，则跳过。

如果不新增映射表，也可以 MVP 先按当前 memo `uid` 去重：

```text
memo.uid 已存在 -> 跳过
```

但更长期的方案应该引入导入映射表，避免不同实例生成了相同 UID 时产生误判。

### 4.2 附件去重

附件建议两层去重：

```text
source_instance + source_attachment_uid
sha256 + size
```

规则：

- 已导入过同一源附件：跳过并复用已有附件。
- 文件内容完全相同：可以复用已有附件。
- 文件名相同但内容不同：生成新附件，避免覆盖。

### 4.3 导入结果报告

导入完成后返回报告：

```text
新增 memo: 12
跳过重复 memo: 8
新增附件: 5
跳过重复附件: 5
失败: 0
```

页面上也应该显示这份报告，让用户知道发生了什么。

## 5. API 草案

个人导出：

```http
GET /api/v1/export:download?scope=mine
```

管理员全站导出：

```http
GET /api/v1/export:download?scope=all
```

个人导入：

```http
POST /api/v1/import
Content-Type: multipart/form-data
```

管理员全站导入：

```http
POST /api/v1/admin/import
Content-Type: multipart/form-data
```

MVP 也可以先放在 instance namespace 下，但长期建议单独做 ImportExportService，避免和灾备 backup API 混淆。

## 6. MVP 分阶段

### 阶段 A：保留当前灾备备份

目标：

- 管理员可通过 API 下载整站 zip。
- 本机脚本可定时拉取。
- 本机保留最近 30 天。

当前已基本完成。

### 阶段 B：个人导出

目标：

- 用户可导出自己的 memos。
- 包含自己 memo 关联的本地附件。
- 导出格式使用 `memos-export-v1.zip`。
- 不直接导出数据库文件。

范围：

- memos
- attachments
- memo 与 attachment 绑定关系
- 基础 relation/reaction 可后续补

### 阶段 C：个人导入

目标：

- 用户上传导出 zip。
- 导入到当前登录账号。
- 重复 UID 或重复来源数据跳过。
- 返回导入报告。

这是产品级导入/导出的核心闭环。

### 阶段 D：管理员全站导出/导入

目标：

- 管理员可导出全部用户数据。
- 管理员导入时可选择：
  - 保留原用户归属。
  - 全部导入到当前管理员。
  - 按用户名/email 做用户映射。

复杂点：

- 用户名冲突。
- email 冲突。
- 用户 ID 映射。
- 权限和可见性迁移。
- instance settings 是否导入。

建议这一阶段晚一点做，不要塞进第一版。

## 7. 不建议第一版处理的内容

第一版先不要做：

- 自动跨系统灾备恢复。
- 导入 instance settings。
- 导入 AI key、SMTP 密码、S3 secret。
- 覆盖式导入。
- 删除目标端已有数据。
- 复杂用户映射 UI。

原因是这些功能风险更高，一旦做错可能造成数据覆盖、权限错乱或 secret 泄露。

## 8. 推荐下一步

短期继续完成灾备 MVP：

1. 确认附件已经能被打进备份 zip。
2. 手动脚本跑通。
3. 设置 Windows 任务计划。
4. 合并到 `dev`。

随后新开一条导入/导出功能线：

1. 先做“导出我的数据”。
2. 再做“导入我的数据”。
3. 最后做 admin 全站导入/导出。

这样路线最清楚：先保证生产数据每天能回到本机，再做更精细、更产品化的数据迁移能力。
