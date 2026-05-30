# 部署采坑记录

本文记录本项目在本地部署、升级和启动时实际遇到的问题。新增部署问题时，请补充现象、原因和处理方式。

## Windows PowerShell 执行 `npm` 被策略拦截

现象：

```text
npm : 无法加载文件 C:\Program Files\nodejs\npm.ps1，因为在此系统上禁止运行脚本。
```

原因：

PowerShell 会优先命中 `npm.ps1`，当前系统执行策略禁止运行 `.ps1` 脚本。

处理：

在 PowerShell 中改用 `npm.cmd` 执行项目脚本，例如：

```powershell
npm.cmd run db:migrate
npm.cmd run prisma:generate
npm.cmd run lint
npm.cmd run build
npm.cmd run dev
```

也可以在系统层面调整 PowerShell execution policy，但本项目部署不依赖该修改。

## Windows 环境变量同时存在 `PATH` 和 `Path`

现象：

某些 PowerShell 命令会报错：

```text
已添加项。字典中的关键字:“Path”所添加的关键字:“PATH”
```

影响：

`Start-Process`、`Get-ChildItem Env:` 等命令可能失败，导致无法按常规方式后台启动开发服务。

处理：

在当前 PowerShell 进程内临时规整环境变量，再启动子进程：

```powershell
$pathValue = cmd.exe /c echo %PATH%
[Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
[Environment]::SetEnvironmentVariable('Path', $pathValue, 'Process')
```

这只影响当前 PowerShell 进程，不修改系统环境变量。

## Codex 沙箱内后台进程会被清理

现象：

前台执行 `next dev` 可以正常出现 `Ready`，但用普通沙箱命令启动后台进程后，下一条命令检查不到 `localhost:3000` 监听。

原因：

Codex 普通命令沙箱会在命令结束后清理后台子进程。

处理：

需要让开发服务持续运行时，应在允许的情况下把启动命令放到沙箱外执行。也可以直接在用户自己的终端运行：

```powershell
npm.cmd run dev
```

## 数据库结构落后于代码

现象：

已有 `dev.db` 时，代码更新后数据库可能缺少新表或新字段。

处理：

不要优先使用 `npx prisma db push`。按项目脚本执行：

```powershell
npm.cmd run db:migrate
npm.cmd run prisma:generate
```

本次启动前，`npm.cmd run db:migrate` 对 `dev.db` 应用了以下迁移：

- `20260515000000_exam_mode`
- `20260517000000_exam_multi_select`

如果本地没有 `dev.db`，先执行：

```powershell
npm.cmd run db:init
```

## Turbopack 动态本地路径构建警告

现象：

`npm.cmd run build` 可以成功，但 Turbopack 可能提示 `src/lib/storage.ts` 或 `src/lib/backup.ts` 中动态 `path.join(...)` 的文件模式过宽。

影响：

当前只是构建警告，不阻塞启动或生产构建。警告来源是本项目需要读写本地图库文件，路径由运行时数据决定。

处理：

如果后续构建时间明显变长，优先检查本地图库目录规模和相关 API route 的本地文件访问实现，不要通过删除 `data/library/` 或批量清理图片来规避警告。

## Next.js 慢文件系统提示

现象：

开发服务启动时可能提示：

```text
Slow filesystem detected
```

影响：

这不阻塞启动，但会影响 `next dev` 的冷启动和热更新速度。

处理：

优先确认项目目录和 `.next/dev` 是否位于本机磁盘。当前项目仍可正常访问 `http://localhost:3000`。
