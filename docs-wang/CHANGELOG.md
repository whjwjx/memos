# memos 二开 CHANGELOG

这份日志记录个人二开版本的功能变化，不替代上游 `CHANGELOG.md`。本仓库以 `dev` 为主要集成分支，通常在新功能分支开发，完成后合并回 `dev`，再按部署 SOP 发布到个人 VPS。

## Unreleased

### In Progress

- memos 数据定时备份。

### Planned

- 数据导入功能：导入 flomo 数据到 memos。

## 已完成

### AI 与知识整理

- AI Tags：支持自动为 memo 打标签。
- AI Comment：支持 AI 对 memo 生成评论。
- 回顾功能。
- 翻译记录保存。
- 翻译内容可被 AI 读取。

### 任务与工作流

- 项目定时任务功能。

### 交互体验优化

- 评论默认隐藏，并支持手动切换显示。
- 手机端保存按钮优化。
- 手机端右滑侧边栏优化。
- pinned memo 操作后不再跳转。
- 超过 6 行的 memo 内容支持收起 / 展开。

### 个人自动化

- memos skill：支持编辑 memo、搜索 pinned memo、批量处理。

## 简历素材边界

- 可以写：基于开源 memos 二次开发、长期自用、AI Tags / AI Comment、翻译记录、回顾功能、项目定时任务、移动端体验优化、pinned memo 批处理、私有化部署。
- 谨慎写：数据定时备份，目前仍在推进中。
- 暂不写成已完成：flomo 数据导入，目前属于待办。
