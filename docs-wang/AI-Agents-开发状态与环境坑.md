# Memos 项目 AI Agents 开发状态与环境坑

## 项目概况

- 路径：`d:/personal_items/memos`
- 当前在 `dev` 分支。
- `dev` 已从 `feat/ai-agents` 合入，并陆续 merge 了 `feat/ai-shared-memory`、`feat/ai-chat-tools-query` 等后续 AI 分支。
- 后续 AI 分支新增内容包括 shared memory、AI chat 工具、`chat_agents` 等。
- AI Agents 功能已开发并通过实测：管理员可配置多个人格化 agent，并让 agent 以评论形式回复 memo。

## 环境/工具坑

- Windows symlink 测试 `store/deployment_config_test.go:207` 仍使用 `runtime.GOOS == "windows" { t.Skipf(...) }` 修复。
- `go.mod` 当前为 `go 1.27.0`；原记忆里的 `1.26.2` 已过时。
- Windows PowerShell 下运行 `go mod tidy -go=1.27.0` 可能需要给版本号加引号，避免点号被拆词；版本号是否正确仍需复核。
- Windows 上 `go run ./cmd/memos` 每次弹防火墙弹窗：因为 `go run` 临时 exe 路径随机变化，防火墙按路径匹配所以每次询问。
- 可改用 `go build -o memos.exe` 生成固定 exe 后运行来规避防火墙反复询问；本地 localhost 访问点取消通常也不影响。
- `buf format -d/-w` 依赖 `diff` 不可用，仅影响显示问题，不影响生成。
- Biome 全仓存在 CRLF 警告，这是预先存在的问题，通常忽略。

## 项目约定

- `docs-wang/` 是私人需求/设计文档目录，不提交 git。
- 目前包括 `AI-Agents-需求.md` 等 6 个私人文档。
