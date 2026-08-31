# Memos fork 与独立项目策略

记录时间：2026-08-31

## 背景

当前仓库是 `usememos/memos` 的 fork，但 `dev` 分支已经承载了很多个人产品方向的功能，不再只是给上游提交几个小补丁。

当前 `dev` 的主要方向包括：

- AI Chat / AI Agents / AI 工具调用；
- AI 自动标签、共享记忆、批量 memo 操作；
- 翻译、词典、语音播放；
- 日历、日程、Review；
- Flomo 导入、结构化导入导出、本地备份；
- 个人部署脚本、部署记录和设计文档。

这些功能更像一个独立产品路线，而不是上游项目一定会接受的通用改动。

## 决策

采用“双仓库”策略：

- 新建一个非 fork 的独立开源仓库，作为后续主开发仓库；
- 保留当前 fork，用来同步上游和提交小而通用的 PR。

## 新项目仓库

新项目仓库是主战场。

- 从当前 fork 的 `dev` 分支初始化新仓库的 `main` 分支；
- 后续 AI、翻译、日程、导入导出、备份等大功能都在新项目继续开发；
- README、Roadmap、Issues、Releases、贡献入口都集中在新项目；
- 因为它不是 fork 仓库，默认分支上的提交更容易正常计入 GitHub 贡献图。

建议迁移方式：

```bash
git checkout dev
git remote add new-origin https://github.com/<your-name>/<new-project>.git
git push new-origin dev:main
```

迁移前需要先检查：

- 是否有个人域名、服务器路径、密钥、token、私有部署信息；
- `docs-wang/` 中哪些内容适合公开，哪些应保留在个人记录；
- `deploy/`、脚本、配置文件是否带有个人环境假设；
- README 是否已经说明项目定位、上游来源和主要差异。

## 原 fork 仓库

原 fork 不再作为长期主开发仓库。

它的职责变为：

- 跟随 `upstream/main`；
- 给 `usememos/memos` 提小而通用的 PR；
- 保留当前 `dev` 一段时间作为迁移备份，但不再继续把大功能堆到这个分支上。

推荐工作流：

```bash
git checkout main
git fetch upstream
git merge upstream/main
git checkout -b fix/small-bug
```

PR 原则：

- 一个 PR 只解决一个问题；
- 优先提交 bugfix、测试修复、文档修复、兼容性修复；
- 避免把个人产品方向的大功能直接塞给上游；
- 大功能如果要回馈上游，先开 issue 讨论方向，再拆成独立、可维护的小 PR。

## 分支职责

建议后续分工：

| 位置 | 分支 | 职责 |
| --- | --- | --- |
| 新项目仓库 | `main` | 独立产品主线，承载当前 `dev` 的功能 |
| 新项目仓库 | `feature/*` | 后续大功能开发 |
| 原 fork | `main` | 紧跟 `upstream/main` |
| 原 fork | `fix/*` / `docs/*` | 给上游提交小 PR |
| 原 fork | `dev` | 暂时保留为迁移备份，不再作为主开发线 |

## 项目定位建议

新项目不要只描述为 “memos fork”，而要明确自己的方向。

可以定位为：

> 基于 Memos 的个人知识管理增强版，重点增强 AI 助手、自动标签、翻译词典、日程回顾、导入导出和本地备份能力。

README 中建议说明：

- 项目基于 `usememos/memos`；
- 当前版本和上游的主要差异；
- 已实现能力；
- 近期 Roadmap；
- 如何部署和参与贡献；
- 如何向上游项目致谢。

## 后续待办

- [ ] 给新项目确定名称；
- [ ] 审计公开发布前的个人信息和部署信息；
- [ ] 整理 README；
- [ ] 整理 Roadmap；
- [ ] 新建非 fork GitHub 仓库；
- [ ] 将当前 `dev` 推送为新仓库 `main`；
- [ ] 保留原 fork 并调整默认开发习惯；
- [ ] 把适合回馈上游的小改动拆成 PR 候选。

