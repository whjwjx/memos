# 本机定时备份（MVP）

1. 先创建管理员 PAT（页面 -> 设置 -> API Token 相关设置）。
2. 保存在本机，给下面脚本运行：

```powershell
.\scripts\memos-backup-task.ps1 -ApiBase "http://localhost:5230" -PatToken "memos_pat_xxx"
```

脚本会默认落盘到：

```
E:\bak\Backups\memos_bak
```

3. 任务计划程序示例（按需改成你自己的路径）：

```powershell
schtasks /create /tn "memos-local-backup" /sc daily /st 02:00 /ru SYSTEM /rl HIGHEST /f ^
/tr "pwsh.exe -File C:\Path\To\scripts\memos-backup-task.ps1 -ApiBase http://localhost:5230 -PatToken memos_pat_xxx"
```

4. 重启后任务是否生效：
- 只要是任务计划程序里保存的任务，系统重启后仍会保留。
- 需要你在计划里设置“启动时”或“按日定时”，并保证系统/用户账号在开机后能执行该任务。
