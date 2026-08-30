# Memos 英汉词典信息方案

## 背景

Translation 页面已经支持英翻中、中翻英、历史记录、保存历史到 memo，以及 Web Speech API 发音。

下一步希望在用户输入单个英文单词时，在左侧输入区域下方显示类似网易有道翻译的单词信息；输入句子时不触发。

目标效果：

- 输入 `right` 这类单词时，展示音标、词性释义、变形、标签等信息。
- 输入 `you are right` 这类句子时，只走原有翻译，不显示单词信息。
- 数据尽量本地化，不依赖外部词典服务。

## 数据来源

推荐使用 ECDICT 作为第一版数据源。

ECDICT 原始数据通常是 CSV，可预处理成独立 SQLite 文件：

```text
ecdict.db
```

这个库不进入 Memos 主业务数据库，也不需要 SQLite/MySQL/PostgreSQL 三套迁移。

## 存放位置

推荐放在 Memos 数据目录下：

```text
{data}/dictionaries/ecdict.db
```

Windows 开发环境：

```text
C:\ProgramData\memos\dictionaries\ecdict.db
```

Linux 生产环境：

```text
/root/.memos/dictionaries/ecdict.db
```

容器内对应：

```text
/var/opt/memos/dictionaries/ecdict.db
```

原因：

- 当前生产部署已经将 `/root/.memos` 挂载到容器内 `/var/opt/memos`。
- 重新部署镜像不会丢词典文件。
- 不污染 `memos_prod.db` 用户数据。
- 不需要新增数据库服务。
- 后端只读打开这个 SQLite 文件查询即可。

## 对当前部署方式的影响

当前部署方式是本地 `pnpm release` 后 `go build` 出 `memos-linux`，上传服务器，再用 `Dockerfile.runtime` 构建运行时镜像。

词典文件不建议打进镜像，建议作为数据目录下的静态资源单独放置。

首次启用词典功能时，服务器需要额外执行一次：

```bash
sudo mkdir -p /root/.memos/dictionaries
sudo cp ecdict.db /root/.memos/dictionaries/ecdict.db
```

后续正常重新部署不需要重复上传，除非要更新词典版本。

当前 SOP 中的数据库备份命令只备份 `memos_prod.db*`，不会备份 `dictionaries/ecdict.db`。这可以接受，因为词典是可再获取的静态资源，不是用户数据。

## 技术可行性

项目已经依赖 `modernc.org/sqlite`，并且生产构建使用 `CGO_ENABLED=0`。因此后端可以在不引入 C 运行库的情况下读取独立 SQLite 词典文件。

建议实现方式：

1. 新增内部词典包，例如：

```text
internal/dictionary/
```

2. 启动时或首次查询时打开：

```text
profile.Data + "/dictionaries/ecdict.db"
```

3. 使用只读 DSN 查询，避免误写词典库。

4. 提供后端查询接口，例如：

```http
GET /api/v1/dictionary/entries/{word}
```

5. 前端 Translation 页面输入变化后判断是否为单词：

- 是单词：debounce 后查词典。
- 是句子：不查词典，只保留现有翻译行为。

## MVP 范围

第一版建议只做英文单词查英汉信息：

- word
- phonetic
- definition
- translation
- exchange
- tag
- source

暂不做：

- 中文查词。
- 模糊联想。
- 例句。
- 在线词典 fallback。
- AI 补充解释。
- 词典管理后台。

## 当前实现记录

MVP 实现采用登录后可用的后端查询接口：

```http
GET /api/v1/dictionary/entries/{word}
```

响应形态：

```json
{
  "configured": true,
  "entry": {
    "word": "right",
    "phonetic": "rait",
    "definition": "correct; proper",
    "translation": "正确; 右边",
    "pos": "n/v/adj/adv",
    "tag": "zk gk cet4 cet6",
    "exchange": "p:rights/d:righted/i:righting",
    "source": "ECDICT"
  }
}
```

如果 `{data}/dictionaries/ecdict.db` 不存在，接口返回：

```json
{
  "configured": false
}
```

前端只在输入为单个英文 token 时触发查询；句子、URL、中文、数字不会触发。词典未配置、未命中或输入不是单词时，下方词典信息区隐藏。

## 本机安装词典

项目内已提供安装脚本：

```powershell
.\scripts\install-ecdict.ps1 -DataDir "C:\ProgramData\memos"
```

脚本会：

1. 下载 ECDICT CSV 到临时目录。
2. 生成只读查询用的 SQLite 数据库。
3. 写入：

```text
C:\ProgramData\memos\dictionaries\ecdict.db
```

当前本机已生成成功，记录数：

```text
770611
```

如果以后重新换电脑或清空数据目录，只需要重新执行同一个脚本即可。

## 风险与注意点

- ECDICT 字段需要预处理，不能每次运行时直接读大 CSV。
- 词典文件不存在时，接口应返回清晰的未配置状态，前端直接隐藏单词信息区。
- 查询必须限制为单个英文 token，避免被句子、路径、URL、超长输入触发。
- 不建议把 ECDICT 导入主业务库，否则会引入三数据库迁移和用户备份污染问题。
- 如果后续要做词典更新，可单独提供脚本替换 `ecdict.db`。
