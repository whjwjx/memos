# Memos 私有部署 SOP（2026-08 实测）

> 本文档记录 memos 私有部署（vps 115.191.10.0:45623，deployer 用户）的完整流程，基于 2026-08-23 两次实战部署整理。下次部署照此执行即可。

## 1. 部署架构

```
本地 Windows (dev 分支)                服务器 (CentOS Stream 9)
┌─────────────────────────┐           ┌──────────────────────────────┐
│ pnpm release ──→ dist    │           │ ~/projects/memos/deploy/     │
│   (embed 源)             │   scp     │   ├─ memos-linux   (新二进制)│
│ go build ──→ memos-linux ├──────────→│   ├─ dist          (可不传)  │
└─────────────────────────┘           │   └─ Dockerfile.runtime      │
                                      │          │ docker build      │
                                      │          ▼                   │
                                      │   memos-ai:local 镜像        │
                                      │          │ docker compose up │
                                      │          ▼                   │
                                      │   memos 容器 (proxy-net)     │
                                      │   数据卷 /root/.memos         │
                                      │          ▲                   │
                                      │   vps-gateway (nginx 反代)   │
                                      └──────────┼───────────────────┘
                                                 ▼
                                        https://memos.huajiang.wang
```

### 关键机制（必须理解）

- **前端是编译时嵌入二进制的**：`server/router/frontend/frontend.go` 里有 `//go:embed dist/*`，memos 启动时从二进制内嵌的前端服务页面，**完全忽略磁盘上的 dist 目录**。
- 因此**构建顺序必须是 `pnpm release` 在前、`go build` 在后**。顺序反了会嵌入旧前端 → 页面看不到新功能（本次踩过的坑）。
- 因为 embed 存在，`Dockerfile.runtime` 里 `COPY dist ...` 是冗余的（无害，可留可删）。

## 2. 前置准备

- 本地在 `dev` 分支，代码已 merge 最新功能（calendar-schedule、feature/ai-tags 等）。
- 本地有 Go 1.27 + pnpm（Node 24 / pnpm 11.7.0）。
- 服务器 SSH：`deployer@115.191.10.0:45623`。

## 3. 部署步骤

### 3.1 本地构建（顺序不可颠倒）

```powershell
# ① 先构建前端到 embed 源目录（输出到 server/router/frontend/dist）
cd web
pnpm release

# ② 再交叉编译 linux 二进制（嵌入最新前端）
cd ..
$env:GOOS = 'linux'
$env:GOARCH = 'amd64'
$env:CGO_ENABLED = '0'
go build -o memos-linux ./cmd/memos

# 验证 embed 源是最新资产
Select-String -Path server\router\frontend\dist\index.html -Pattern 'assets/index-[^"]+' -AllMatches
```

> 提示：`dist` 无需单独上传（已嵌入二进制）。本地 `web/dist` 和 `server/router/frontend/dist` 都是构建产物。

### 3.2 上传

```powershell
scp -P 45623 d:\personal_items\memos\memos-linux deployer@115.191.10.0:~/projects/memos/deploy/
```

### 3.3 服务器：备份数据

```bash
sudo bash -c 'mkdir -p /home/deployer/backups/memos_data_$(date +%Y%m%d_%H%M) && cp /root/.memos/memos_prod.db* /home/deployer/backups/memos_data_$(date +%Y%m%d_%H%M)/ && ls -la /home/deployer/backups/memos_data_$(date +%Y%m%d_%H%M)'
```

> **注意**：必须用 `sudo bash -c` 包住，否则 deployer 无 `/root/` 权限且通配符展开失败。

### 3.4 服务器：重建镜像并升级

```bash
cd ~/projects/memos/deploy
docker build -q -t memos-ai:local -f Dockerfile.runtime .
docker compose up -d --force-recreate
```

### 3.5 部署后必验

```bash
# ① 容器内与公网前端资产名必须一致（不一致 = 嵌入了旧前端）
docker exec memos sh -c 'wget -qO- http://localhost:5230/ | grep -o assets/index-[a-zA-Z0-9]*.js'
curl -s https://memos.huajiang.wang/ | grep -o assets/index-[a-zA-Z0-9]*.js

# ② 核心 API 正常
curl -s 'https://memos.huajiang.wang/api/v1/memos?limit=1'

# ③ 日志无异常
docker logs memos --tail 10
```

- 用户在浏览器 **Ctrl+Shift+R 强刷**，确认新功能（Calendar 入口、设置→Admin→AI→AI Tags）。
- 前端 JS 是否含功能代码可抽查：`curl -s https://memos.huajiang.wang/assets/index-*.js | grep -o -E 'taggers|Calendar' | sort -u`。

## 4. 数据卷要点

`~/projects/memos/deploy/docker-compose.yml` 关键配置：

```yaml
volumes:
  - /root/.memos:/var/opt/memos   # 必须绝对路径
command: ["--port", "5230", "--data", "/var/opt/memos"]   # 覆盖镜像默认匿名卷
```

- **`~` 会按 compose 执行用户展开**：deployer 跑 → `/home/deployer/.memos`，root 跑 → `/root/.memos`。曾因用 deployer 跑 compose 导致数据写错目录（新库误初始化），务必用绝对路径。
- memos 数据目录由 `--data` 决定，镜像默认 `VOLUME ["/.memos"]` 匿名卷，必须用 `command` 覆盖到挂载目录。
- 迁移库时如用 `docker cp`/手动备份，注意旧匿名卷（如 `f020...`）空挂无害，可留可删。

## 5. 常见问题排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 页面看不到新功能 | 二进制嵌入了旧前端（构建顺序反了） | 重新 `pnpm release` → `go build` → 重新部署 |
| API 报 `failed to list reactions` | 服务器库 reaction 表还是 `content_id` 旧结构（历史遗留：schemaVersion 高估导致 0.31/02 迁移被跳过） | 停容器 → 备份 → 手动应用 0.31/02 迁移（见下） |
| 容器起来但数据是空的 | 挂载路径错误（`~` 展开问题） | 改绝对路径 `/root/.memos`，把正确数据目录挂载回来 |

### 5.1 手动修复 reaction 表结构（0.31/02 迁移）

```sql
CREATE TABLE reaction_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  creator_id INTEGER NOT NULL,
  memo_id INTEGER NOT NULL,
  reaction_type TEXT NOT NULL,
  UNIQUE(creator_id, memo_id, reaction_type)
);

INSERT INTO reaction_new (id, created_ts, creator_id, memo_id, reaction_type)
SELECT reaction.id, reaction.created_ts, reaction.creator_id, memo.id, reaction.reaction_type
FROM reaction
JOIN memo ON reaction.content_id = 'memos/' || memo.uid;

DROP TABLE reaction;
ALTER TABLE reaction_new RENAME TO reaction;
```

用 python3 在服务器执行（容器停止后）：

```bash
sudo python3 - <<'PY'
import sqlite3
conn = sqlite3.connect('/root/.memos/memos_prod.db')
conn.executescript("""...上面 SQL...""")
conn.commit()
print(conn.execute('PRAGMA integrity_check').fetchone())
conn.close()
PY
```

## 6. nginx 安全加固（vps-gateway，2026-08-23 补充）

> 所有域名的反代统一由 `vps-gateway`（nginx:alpine）容器承担，配置源在宿主机 `/home/deployer/vps-infra/nginx/conf.d/`（bind mount 只读进容器 `/etc/nginx/conf.d`）。改配置 → `nginx -t` → `nginx -s reload` 即可，无需重启容器。

### 6.1 memos 站点配置要点（memos.huajiang.wang.conf）

```nginx
# ① 拒绝 IP 直连 / 伪造 Host（连接直接丢弃）
if ($host != "memos.huajiang.wang") {
    return 444;
}

# ② 认证接口限流（防暴力破解；zone=login 定义于 nginx.conf，5r/m per IP）
location ~ ^/api/v1/auth/ {
    limit_req zone=login burst=10 nodelay;
    ...
}

# ③ 完整安全头
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
```

- `server_tokens off` 隐藏版本号；`client_max_body_size 50m` 限制上传。
- TLS 仅启用 TLSv1.2/1.3 + GCM 系强 cipher，禁弱协议弱套件。

### 6.2 全站兜底拒绝（default.conf）

```nginx
server { listen 80 default_server; listen [::]:80 default_server; server_name _; return 444; }
server { listen 443 ssl default_server; ... return 444; }
```

- **必须要有**：若缺失，IP 直连/未匹配域名会被第一个 listen 的 server 块（常是 huajiang 的 www 重定向块）兜底返回 301，而非拒绝。
- 443 default_server 需配任意有效证书（握手即 444，证书内容无关紧要）。

### 6.3 变更流程与验证

```bash
# ① 备份当前配置
cp /home/deployer/vps-infra/nginx/conf.d/memos.huajiang.wang.conf{,.bak.$(date +%Y%m%d)}

# ② 校验 + 热重载（无需重启容器）
sudo docker exec vps-gateway nginx -t
sudo docker exec vps-gateway nginx -s reload

# ③ 验证（预期结果见下）
curl -skI https://memos.huajiang.wang/ | grep -iE 'strict-transport|x-frame|x-content|referrer|permissions'
curl -s -o /dev/null -w '%{http_code}' http://115.191.10.0/          # 000 = 连接被丢弃
curl -sk -o /dev/null -w '%{http_code}' https://115.191.10.0/         # 000
curl -sk -o /dev/null -w '%{http_code}' https://115.191.10.0/ -H 'Host: evil.com'  # 000
# 限流验证：连续 POST /api/v1/auth/signin，前 10 次 400（或 200），之后 429
```

### 6.4 注意

- 项目目录里的 `~/projects/memos/deploy/memos.huajiang.wang.conf`（旧版 697B）**已改名 `.disabled`**——它不生效，实际配置以 vps-infra 为准，勿再编辑。
- 限流只作用于 `/api/v1/auth/`，不影响正常阅读/评论接口。
- `huajiang.conf`（主站）同样受 default_server 兜底保护，无需逐个站点加 Host 校验。

## 7. 回滚

- **二进制回滚**：保留上一个 `memos-linux`（部署前从 `deploy/` 备份一份），重传后重建镜像重启即可。
- **数据回滚**：备份在 `/home/deployer/backups/memos_data_*`，停容器后拷回 `/root/.memos/` 再启动。

## 8. 本次部署记录（2026-08-23）

- 备份：`/home/deployer/backups/memos_data_20260823/`（原始）、`memos_data_20260823_fix/`（reaction 修复前）、`memos_data_20260823_newfeat/`（重部署前）。
- 镜像：`memos-ai:local`（哈希 `261e655f`），容器 `memos`（proxy-net，`/root/.memos:/var/opt/memos`）。
- 数据：110 条 memo 完整；前端资产 `index-CId8fZWs.js` 与公网一致。
- nginx 加固（vps-gateway）：memos 配置加 Host 校验/认证限流/完整安全头；新增 `default.conf` 兜底拒绝 IP 直连与伪造 Host。原配置备份 `memos.huajiang.wang.conf.bak.20260823`。

### 8.1 部署记录（2026-08-25）

> 情况 A：8-23 部署已含 AI tags 功能本体（`672b2e3f` 19:25 早于容器构建 21:04），本次仅纳入修复 `a2dbb7a9`（手动重打，8-25 20:39）+ `.gitattributes`（`6297416c`）。

- 代码：`dev` HEAD = `6297416c`，含 `a2dbb7a9` fix(ai-tags) 手动重打修复（force 重臂 DONE/FAILED 任务）。
- 构建：`pnpm release`（资产 `index-D8KyneXI.js`）→ `go build`（linux/amd64，101MB，嵌入新前端）→ scp 上传。
- 备份：`/home/deployer/backups/memos_data_20260825/`（memos_prod.db + -shm + -wal）。
- 镜像：`memos-ai:local`（哈希 `423384ad`），容器 recreate 时间 `2026-08-25T13:53:10Z`（北京时间 21:53）。
- 校验：容器内 / 公网 / 构建输出三方前端资产均为 `index-D8KyneXI.js`；API `/api/v1/memos?limit=1` 正常；日志无异常。
- 生效前提（部署后确认）：Admin 设置需已配 AI Provider（API key 非空）且 Tagger 已启用并绑定 Provider、候选集覆盖期望标签，否则任务静默 FAILED（`memo_tag_worker.go:127`）。浏览器 Ctrl+Shift+R 强刷后手动触发 AutoTagMemo，日志应见 `Applied AI tags`。

### 8.2 部署记录（2026-08-27）

> 完整重新部署：纳入 AI chat 引擎（`feat/ai-chat-engine`）。功能本体为 `b611532f`/`fd5da1af`/`614141c4`，merge `af711b94` 进 dev。

- 代码：`dev` HEAD = `af711b94`（merge feat/ai-chat-engine）。
- 构建：`pnpm release`（资产 `index-DC0FxSOc.js`，5113 modules）→ `go build`（linux/amd64，101.5MB）→ scp 上传。
- 备份：`/home/deployer/backups/memos_data_20260827/`（memos_prod.db + -shm + -wal）。
- 镜像：`memos-ai:local`（哈希 `e25fcb25`），容器 recreate 时间 `2026-08-26T23:13:38Z`（北京时间 8-27 07:13）。
- 校验：容器内 / 公网 / 构建输出三方前端资产均为 `index-DC0FxSOc.js`；API `/api/v1/memos?limit=1` 正常；日志无异常。
- AI chat 功能同样依赖 Admin 设置里已配置的 AI Provider（API key），与 AI tags 共用配置。

### 8.3 冗余清理（2026-08-27）

- 本地：删除 `memos-test`（98MB）、`memos.exe`（98MB）、`deploy/memos-linux`（96MB 旧二进制）、`deploy/dist`；保留根目录 `memos-linux`（当前版本，作回滚备份）。
- 服务器 `~/projects/memos/deploy/`：删除 `dist`（11MB，前端已 embed，COPY dist 冗余）。
- 保留：`memos.huajiang.wang.conf.disabled`（旧配置留档）、`/home/deployer/backups/memos_data_*`（数据回滚点）。
- 踩坑：`go build` 若报 `link.exe: not enough space on the disk`，先 `go clean -cache` 释放 C 盘（本次 C 盘仅剩 0.17GB，清理后 6.8GB 恢复构建）。

### 8.4 部署记录（2026-08-28）

> 完整重新部署：纳入 AI translation page（`codex/translation-mvp`）、daily review（`codex/add-daily-review`）、AI memo operation tools。merge `53fe1453` 进 dev。

- 代码：`dev` HEAD = `53fe1453`（merge codex/translation-mvp，其前含 `f15902ee` daily review、`96e5bfc8` AI memo tools）。
- 构建：`pnpm release`（资产 `index-C90aBcPR.js`，5117 modules）→ `go build`（linux/amd64，102MB）→ scp 上传。
- 备份：`/home/deployer/backups/memos_data_20260828/`（memos_prod.db + -shm + -wal）。
- 镜像：`memos-ai:local`（哈希 `eb3d7124`），容器 recreate 时间 `2026-08-27T23:41:16Z`（北京时间 8-28 07:41）。
- 校验：容器内 / 公网 / 构建输出三方前端资产均为 `index-C90aBcPR.js`；API `/api/v1/memos?limit=1` 正常；日志无异常。
- **构建踩坑修复**：本次 `docker build` 首报 `/dist not found`，根因是 8.3 清理删了服务器 `deploy/dist`，而 `Dockerfile.runtime` 还留 `COPY dist` 冗余行（SOP 1 已注明前端已 embed，该 COPY 无效）。已**从 `deploy/Dockerfile.runtime` 删除该行**（本地 + 服务器同步），根治后再构建成功。今后清理 `dist` 不再影响部署，该 Dockerfile 改动需提交进仓库。

### 8.5 部署记录（2026-08-28 第二次）

> 完整重新部署：纳入 pinned tags / review polish（`fa8e15e7`）、recurring schedule（`e4622ced` merge codex/recurring-schedule-mvp）。Dockerfile 冗余 `COPY dist` 已在 8.4 修复，本次构建一次成功。

- 代码：`dev` HEAD = `fa8e15e7`（merge pinned tags review polish，含 `e4622ced` recurring schedule）。
- 构建：`pnpm release`（资产 `index-xHeTUHvp.js`，5118 modules）→ `go build`（linux/amd64，102MB）→ scp 上传。
- 备份：`/home/deployer/backups/memos_data_20260828b/`（memos_prod.db + -shm + -wal）。
- 镜像：`memos-ai:local`（哈希 `d62f3508`），容器 recreate 时间 `2026-08-28T11:52:50Z`（北京时间 8-28 19:52）。
- 校验：容器内 / 公网 / 构建输出三方前端资产均为 `index-xHeTUHvp.js`；API `/api/v1/memos?limit=1` 正常；日志无异常。

### 8.6 部署记录（2026-08-29）

> 完整重新部署：纳入 structured import/export（`58f7376a` merge）、backup export mvp（`89a54d8d` merge）、personal fork notes（`01abe23c` docs）。

- 代码：`dev` HEAD = `58f7376a`（merge structured import export，含 `89a54d8d` backup export、`01abe23c` fork notes）。
- 构建：`pnpm release`（资产 `index-tZGYqm1N.js`，5120 modules）→ `go build`（linux/amd64，102MB）→ scp 上传。
- 备份：`/home/deployer/backups/memos_data_20260829/`（memos_prod.db + -shm + -wal）。
- 镜像：`memos-ai:local`（哈希 `3390505a`），容器 recreate 时间 `2026-08-29T15:14:02Z`（北京时间 8-29 23:14）。
- 校验：容器内 / 公网 / 构建输出三方前端资产均为 `index-tZGYqm1N.js`；API `/api/v1/memos?limit=1` 正常；日志无异常。
- 备注：本次 C 盘 52GB 充足，无需 `go clean -cache`；Dockerfile 已无 `COPY dist`，构建一次成功。
