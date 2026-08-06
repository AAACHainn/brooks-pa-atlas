# 部署采坑记录

本文记录本项目在本地部署、升级和启动时实际遇到的问题。新增部署问题时，请补充现象、原因和处理方式。

## 导航筛选性能优化部署说明（2026-08-05）

这一节是部署 AI 在升级现有实例时的必读内容。目标环境为 `2 核 CPU / 2GB 内存`，导航器加载完成后要求分类置灰即时完成、图片筛选结果在 `2 秒` 内返回。

### 本次更新做了什么

- 导航分类、选项和 `{ indexNodeId, optionId }` 关联只在首次加载或配置变化后读取；选项匹配数、零结果置灰、目录搜索、自然排序和分页改为浏览器本地计算。
- `/api/atlas?scope=images` 只返回当前页图片和分页，筛选热路径不再重复返回完整索引树。
- `/api/atlas?scope=metadata` 只返回索引树、标签、最近导入批次和统计；不传 `scope` 时仍保留原完整响应，兼容旧调用。
- 快速连续切换筛选条件时，前端会取消旧图片请求，并用请求序号阻止旧响应覆盖新结果。
- Atlas 响应增加 `Server-Timing`；客户端声明接受 gzip 时，Route Handler 会直接返回 gzip JSON，不依赖 Nginx 是否启用压缩。
- `IndexNodeNavigatorOption` 增加 `(optionId, indexNodeId)` 复合索引，对应 migration：`20260805000000_navigator_composite_index`。

主要实现文件：

- `src/lib/index-navigator-client.ts`
- `src/app/index-navigator-panel.tsx`
- `src/app/atlas-workbench.tsx`
- `src/app/api/atlas/route.ts`
- `src/app/api/index-navigator/route.ts`
- `prisma/migrations/20260805000000_navigator_composite_index/migration.sql`

### 升级已有部署的固定顺序

升级前先通过应用内备份管理生成一次完整备份，并确认数据库文件和 `data/library/` 使用持久化本机磁盘。不要用新空库覆盖已有数据库，也不要清空图库目录。

拉取新代码并安装依赖后执行：

```bash
npm run db:migrate
npm run prisma:generate
npm run test:navigator
npm run lint
npm run build
```

Windows PowerShell 被执行策略拦截时，将 `npm` 换成 `npm.cmd`。已有数据库只能运行 `db:migrate`；`db:init` 仅用于确实不存在数据库的全新部署。

构建成功后重启当前 Node.js 服务。2 核 2GB 机器建议只运行一个 Next.js 应用进程，避免多个进程重复占用内存并争用同一个 SQLite 文件。SQLite 必须位于云主机本地磁盘或本地 Docker volume，不要放到 NFS、SMB、对象存储挂载目录或其他网络文件系统。

迁移成功时应出现以下之一：

```text
Applied migration 20260805000000_navigator_composite_index
SQLite schema is up to date
```

旧代码回滚时可以保留新增复合索引，不需要删除索引或回滚数据库；它不改变业务数据和 API 数据结构。

### 部署后接口检查

先确认新旧接口没有被 CDN、容器镜像或多实例混合部署缓存。以下命令以 Linux 为例：

```bash
curl -sS -D - -o /tmp/atlas-images.json \
  "http://127.0.0.1:3000/api/atlas?scope=images&page=1&pageSize=50"

curl -sS -D - -o /dev/null -H "Accept-Encoding: gzip" \
  "http://127.0.0.1:3000/api/atlas?scope=metadata"

curl -sS "http://127.0.0.1:3000/api/index-navigator" \
  -o /tmp/index-navigator.json
```

必须满足：

- `scope=images` JSON 顶层只有 `images` 和 `pagination`，不能出现 `tree`、`tags`、`batches` 或 `stats`。
- `scope=metadata` 响应头包含 `Content-Encoding: gzip`、`Vary: Accept-Encoding` 和 `Server-Timing`。
- `/api/index-navigator` JSON 顶层只有 `categories` 和 `assignments`，不再返回服务端计算的目录分页。
- 浏览器每次点击导航选项时只新增 `scope=images` 图片请求，不应再次请求完整 Atlas 数据或远程计算导航置灰。

当前开发库规模为 13,817 张图片、5,823 个索引节点、470 条导航关联。实现完成时的参考结果：

- 浏览器端导航计算 100 次基准：P95 `0.85ms`，最大 `5.9ms`。
- `scope=images` 20 次本地基准：P95 `46ms`，50 张分页响应约 `37 KiB`（未压缩）。
- metadata 约从 `1,292 KiB` 压缩到 `152 KiB`。

云端验收应在页面和导航基础数据完成首次加载后，连续执行至少 20 次代表性筛选：点击到置灰完成 P95 不超过 `100ms`，点击到图片列表完成 P95 不超过 `2,000ms`。

### 超过 2 秒时如何定位

浏览器 Network 面板或 `curl -D -` 可以看到类似响应头：

```text
Server-Timing: navigator;dur=2.0, images;dur=80.0, total;dur=85.0
```

按下面顺序判断：

1. `Server-Timing total` 明显低于 2 秒，但浏览器总耗时超过 2 秒：检查公网带宽、反向代理缓冲、TLS、CDN 和客户端到服务器的网络；同时确认 `Content-Encoding: gzip` 没有被代理移除。
2. `images` 本身超过约 `1,200ms`：确认 SQLite 在本地 SSD、复合索引 migration 已应用、机器没有同时运行 OCR/PDF 导入或多个 Node.js 实例，并检查 CPU steal、磁盘 I/O wait 和剩余内存。
3. `navigator` 很慢：检查 `IndexNodeNavigatorOption_optionId_indexNodeId_idx` 是否存在，以及导航关联数量是否远高于当前 470 条基准。
4. `scope=images` 响应仍超过 1 MiB 或包含 `tree`：说明前后端版本不一致、旧容器仍在提供流量，或请求没有带 `scope=images`。
5. 置灰慢但图片接口很快：确认浏览器已经加载新版 `index-navigator-client` 前端 chunk，并清理 CDN/浏览器中的旧静态资源缓存；不要把置灰逻辑改回逐点击请求服务器。

不要通过删除图片、清空 `data/library/`、重建空数据库或降低分页正确性来规避性能问题。当前全库自然数字排序仍会读取全部匹配图片的轻量排序字段；若未来图库规模增长到当前数倍并且 `images` 查询持续超过阈值，再考虑持久化自然排序键，而不是先扩大服务器配置。

## 缩略图补齐与 3Mbps 即时切换部署说明（2026-08-06）

本版本把工作台网格和考试选图列表从原图切换到版本化 WebP 缩略图。筛选条件、目录或分页发生变化后，浏览器会立即卸载旧图片 DOM 并显示骨架屏，旧下载不再占住连接等待新筛选结果。大图查看器、标注编辑和考试看图仍读取原图。

当前缩略图规格固定为 `v1 / 420px / WebP quality 72`，默认目录：

```text
data/library/thumbnails/v1/<hash前2位>/<hash>.webp
```

可通过 `BROOKS_THUMBNAIL_ROOT` 覆盖 `thumbnails` 根目录；2 核服务器的后台生成并发默认是 `1`，只在磁盘和 CPU 余量充足时设置 `BROOKS_THUMBNAIL_CONCURRENCY=2`。缩略图是可重建缓存，不进入 SQLite，也不包含在备份 zip 中。恢复备份后需要再次执行补齐任务。

### 升级和启动后台补齐

升级代码后运行：

```bash
npm run test:thumbnails
npm run lint
npm run build
```

重启应用后先检查磁盘空间和缩略图当前占用：

```bash
df -h data/library
du -sh data/library/thumbnails 2>/dev/null || true
```

启动任务（接口无请求体）：

```bash
curl -sS -X POST http://127.0.0.1:3000/api/maintenance/thumbnails/jobs
```

新任务返回 HTTP `202`；如果已有任务正在运行，返回 HTTP `200` 且 `reused` 为 `true`。保存响应中的 `job.id`。丢失 ID 时可读取最近任务：

```bash
curl -sS http://127.0.0.1:3000/api/maintenance/thumbnails/jobs
```

按 ID 查询：

```bash
curl -sS http://127.0.0.1:3000/api/maintenance/thumbnails/jobs/JOB_ID
```

部署 AI 可以用下面的 Linux 示例每 2 秒轮询；需已安装 `jq`：

```bash
JOB_ID="$(curl -sS -X POST http://127.0.0.1:3000/api/maintenance/thumbnails/jobs | jq -r '.job.id')"
while true; do
  JOB="$(curl -sS "http://127.0.0.1:3000/api/maintenance/thumbnails/jobs/$JOB_ID")"
  echo "$JOB" | jq '{status: .job.status, phase: .job.phase, progressPercent: .job.progressPercent, processedImages: .job.processedImages, totalImages: .job.totalImages, generatedImages: .job.generatedImages, skippedImages: .job.skippedImages, failedImages: .job.failedImages}'
  STATUS="$(echo "$JOB" | jq -r '.job.status')"
  case "$STATUS" in
    completed|completed_with_errors|failed|interrupted) break ;;
  esac
  sleep 2
done
```

任务状态文件保存在 `data/library/thumbnail-jobs/`。应用进程在任务中途重启时，旧任务会在下次查询时变成 `interrupted`；重新执行同一个 POST 即可创建续跑任务，新任务的 `resumedFrom` 指向旧任务。续跑不会覆盖已有的非空 v1 文件，只会把它们计入 `skippedImages`。

完成时必须核对：

```text
processedImages = generatedImages + skippedImages + failedImages
progressPercent = 100
status = completed 或 completed_with_errors
```

`completed_with_errors` 表示部分原图无法读取或转换。查看 `recentErrors`，修复原图或权限后重新 POST；已成功的文件仍会跳过。`failed` 表示数据库分页或状态持久化等任务级错误，应先检查应用日志、SQLite、本机磁盘空间和 `data/library/thumbnail-jobs/` 写权限。

### 接口与浏览器验收

任选一张图片验证缩略图响应；第二次请求把上一响应的 `ETag` 作为 `If-None-Match` 时应返回 `304`：

```bash
curl -sS -D - -o /tmp/thumbnail.webp \
  "http://127.0.0.1:3000/api/images/IMAGE_ID/thumbnail?v=1"
```

首次正常响应应包含：

```text
Content-Type: image/webp
Cache-Control: private, max-age=31536000, immutable
ETag: "thumbnail-v1-..."
```

在限制为 3Mbps 的浏览器 Network 面板验收：

1. 当前网格仍有图片下载时点击其他目录或导航筛选，旧卡片应在 100ms 内消失并出现骨架屏。
2. 旧缩略图或原图请求应显示为 cancelled，新 `/api/atlas?scope=images...` 请求立即开始。
3. 新网格只请求 `/thumbnail?v=1`，不能批量请求 `/file`；选中大图时才允许请求 `/file`。
4. 首批新缩略图目标在 1–2 秒内出现，连续快速点击后只能展示最后一次筛选结果。

维护接口按当前产品决策不加应用鉴权。不要把 `/api/maintenance/thumbnails/` 直接暴露到公网；应通过 Nginx/Caddy location 规则、仅监听内网或云安全组限制到运维来源。应用自身的单任务复用只能避免重复生成，不能替代访问控制。

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
