# Brooks PA Atlas 部署避坑记录

本文记录一次在 Windows + Codex Desktop 环境中从空工作区编译并运行 Brooks PA Atlas 时遇到的实际问题。后续 Codex 线程或人工部署时，可先按本文检查环境，避免重复踩坑。

## 1. 基本结论

推荐使用 Node.js 22 LTS 运行本项目。

本次环境中的全局 Node.js 是 `v24.15.0`，会导致 `better-sqlite3` 安装时更容易走本地编译路径。如果机器没有 Visual Studio C++ 构建工具，安装会失败。改用 Node.js 22 后可以正常安装依赖、初始化数据库、生成 Prisma Client、构建并运行项目。

最终验证结果：

```powershell
npm run build
```

构建通过。

开发服务使用 3001 端口启动后，接口验证通过：

```text
http://localhost:3001/api/atlas
```

返回 `200 OK`。

## 2. 推荐部署顺序

在项目根目录执行：

```powershell
npm.cmd install
npm.cmd run db:init
npm.cmd run prisma:generate
npm.cmd run build
npm.cmd run dev -- -p 3001
```

说明：

- Windows PowerShell 中优先使用 `npm.cmd`，不要直接使用 `npm`。
- 如果本机全局 Node.js 不是 LTS，优先切换到 Node.js 22。
- 首次运行且没有 `dev.db` 时，先执行 `npm.cmd run db:init`。
- `src/generated/prisma` 是生成目录，不要手动编辑，缺失时运行 `npm.cmd run prisma:generate`。

## 3. Windows PowerShell 执行策略问题

现象：

```text
无法加载文件 C:\Program Files\nodejs\npm.ps1，因为在此系统上禁止运行脚本
```

原因：

PowerShell 执行策略阻止了 `npm.ps1`。

解决：

使用 `npm.cmd` 替代 `npm`：

```powershell
npm.cmd run db:init
npm.cmd run build
```

## 4. better-sqlite3 与 Node 版本问题

现象：

使用 Node.js 24 安装依赖时，`better-sqlite3` 可能无法使用预编译包，转而执行本地编译：

```text
prebuild-install || node-gyp rebuild --release
```

随后报错：

```text
Could not find any Visual Studio installation to use
```

原因：

当前机器没有 Visual Studio C++ 构建工具，而 Node.js 24 下 `better-sqlite3` 更容易触发源码编译。

解决：

切换到 Node.js 22 LTS 后重新安装依赖。

如果不能安装系统级 Node，可以下载便携版 Node.js 到项目本地目录，例如：

```text
local-tools/node-v22.22.2-win-x64
```

然后在当前 PowerShell 会话中临时调整 PATH：

```powershell
$nodeDir = Join-Path (Get-Location) "local-tools\node-v22.22.2-win-x64"
$env:PATH = "$nodeDir;$env:PATH"
npm.cmd install
```

注意：`local-tools/` 属于本地运行时目录，应加入 `.gitignore`。

## 5. npm 缓存权限问题

现象：

依赖安装时报错：

```text
EPERM: operation not permitted, open 'C:\Users\admin\AppData\Local\npm-cache\_cacache\tmp\...'
```

原因：

Codex 沙箱或系统权限限制了默认 npm cache 目录写入。

解决：

把 npm cache 指到项目内的本地目录：

```powershell
$cacheDir = Join-Path (Get-Location) "local-tools\npm-cache"
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
$env:npm_config_cache = $cacheDir
npm.cmd install
```

如果仍然因为沙箱无法访问系统缓存或网络下载失败，应按 Codex 权限规则提升后重跑安装命令。

## 6. 不完整 node_modules 的处理

现象：

第一次安装依赖失败后，`node_modules` 可能处于半损坏状态。再次安装时可能出现：

```text
Cannot find module './lib/_stream_readable.js'
```

原因：

安装中断导致 `node_modules` 里的依赖文件缺失，连安装脚本依赖也可能不完整。

解决：

不要批量删除目录。本项目安全规则禁止递归删除目录。

可以把损坏目录改名归档，然后重新安装：

```powershell
Move-Item -LiteralPath "node_modules" -Destination "node_modules.broken-YYYYMMDD-HHmmss"
npm.cmd install
```

注意：

- 不要使用 `Remove-Item -Recurse`、`rm -rf`、`rmdir /s` 等批量删除命令。
- `node_modules.broken-*/` 应加入 `.gitignore`，避免污染 git 状态。
- 如果确实需要清理归档目录，请由人工在确认后手动处理。

## 7. Next.js 16 Turbopack root 误判

现象：

构建时报错：

```text
Warning: Next.js inferred your workspace root, but it may not be correct.
Detected multiple lockfiles...
TurbopackInternalError: reading dir "C:\\Users\\admin"
拒绝访问。 (os error 5)
```

原因：

Next.js 16 Turbopack 会通过 lockfile 自动推断 workspace root。本次环境中上级目录 `C:\Users\admin` 也存在 `package-lock.json`，导致 Turbopack 错误地把 root 推到用户目录，并尝试扫描无权限目录。

解决：

在 `next.config.ts` 中默认固定 Turbopack root 为当前项目目录，同时允许通过 `BROOKS_TURBOPACK_ROOT` 在特殊场景中覆盖：

```ts
import type { NextConfig } from "next";
import path from "node:path";

const projectRoot = path.resolve(__dirname);
const configuredTurbopackRoot = process.env.BROOKS_TURBOPACK_ROOT?.trim();
const turbopackRoot = configuredTurbopackRoot
  ? path.resolve(projectRoot, configuredTurbopackRoot)
  : projectRoot;

const nextConfig: NextConfig = {
  turbopack: {
    root: turbopackRoot,
  },
};

export default nextConfig;
```

一般部署不要设置 `BROOKS_TURBOPACK_ROOT`。只有当项目通过 `npm link`、`yarn link` 或 monorepo 共享源码依赖，并且这些依赖确实位于项目目录外时，才需要把它设置为项目和外部依赖的共同父目录。

本项修改前应遵守 `AGENTS.md` 要求，先阅读本地 Next.js 文档中关于 `turbopack.root` 的说明：

```text
node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/turbopack.md
```

## 8. Prisma Client 缺失

现象：

构建时报错：

```text
Module not found: Can't resolve '@/generated/prisma/client'
```

原因：

`src/generated/prisma` 是生成目录，首次安装或新工作区中可能不存在。

解决：

运行：

```powershell
npm.cmd run prisma:generate
```

然后重新构建：

```powershell
npm.cmd run build
```

## 9. dev.db 缺失

现象：

首次启动接口可能因数据库不存在而失败。

解决：

项目当前不推荐优先使用 `npx prisma db push` 初始化空库。按 `AGENTS.md` 说明，优先使用：

```powershell
npm.cmd run db:init
```

成功后会创建：

```text
dev.db
```

`dev.db` 是本地运行数据，不要提交。

## 10. 后台启动服务的注意事项

本次目标端口是 3001，可用：

```powershell
npm.cmd run dev -- -p 3001
```

在 Codex Desktop 沙箱内，普通后台启动进程可能会短暂响应后被作业回收。现象是刚启动时 `/api/atlas` 返回 `200 OK`，几秒后进程消失。

如果需要服务持续运行，需在沙箱外启动 dev server。Codex 中应按权限规则请求提升后运行。

直接用 Node 调 Next CLI 的启动方式更稳定：

```powershell
$root = (Get-Location).Path
$nodeDir = Join-Path $root "local-tools\node-v22.22.2-win-x64"
$nodeExe = Join-Path $nodeDir "node.exe"
$nextBin = Join-Path $root "node_modules\next\dist\bin\next"

$env:Path = "$nodeDir;$env:Path"
& $nodeExe $nextBin dev -p 3001
```

验证：

```powershell
Invoke-WebRequest -UseBasicParsing "http://localhost:3001/api/atlas"
```

正常返回：

```text
StatusCode: 200
```

## 11. Start-Process 与 Path/PATH 冲突

现象：

使用 `Start-Process` 时可能报错：

```text
已添加项。字典中的关键字:“Path”所添加的关键字:“PATH”
```

原因：

当前进程环境变量里同时存在大小写不同的 `Path` 和 `PATH`，Windows 环境变量字典不区分大小写，导致构造子进程环境时冲突。

解决：

在当前 PowerShell 会话中规整后再启动：

```powershell
$pathValue = [Environment]::GetEnvironmentVariable("Path", "Process")
if (-not $pathValue) {
  $pathValue = [Environment]::GetEnvironmentVariable("PATH", "Process")
}

Remove-Item Env:PATH -ErrorAction SilentlyContinue
Set-Item Env:Path "$nodeDir;$pathValue"
```

## 12. 日志和生成物

部署过程中可能产生：

```text
.next/
dev.db
dev-server.log
dev-server.err.log
local-tools/
node_modules.broken-*/
src/generated/prisma/
```

这些都不是业务源码。

建议 `.gitignore` 覆盖：

```text
/local-tools/
/node_modules.broken-*/
/src/generated/prisma
/dev.db
/dev.db-*
/dev-server.log
/dev-server.err.log
/.next/
/node_modules
```

## 13. 本次实际有效命令摘要

以下命令在本次环境中验证可行。假设已经准备好 Node.js 22，并把它加入当前会话 PATH。

```powershell
$nodeDir = Join-Path (Get-Location) "local-tools\node-v22.22.2-win-x64"
$cacheDir = Join-Path (Get-Location) "local-tools\npm-cache"

$env:PATH = "$nodeDir;$env:PATH"
$env:npm_config_cache = $cacheDir

npm.cmd install
npm.cmd run db:init
npm.cmd run prisma:generate
npm.cmd run build
npm.cmd run dev -- -p 3001
```

验证：

```powershell
Invoke-WebRequest -UseBasicParsing "http://localhost:3001/api/atlas"
```

## 14. 部署检查清单

- 已阅读 `README.md` 和 `AGENTS.md`。
- 使用 Node.js 22 LTS，而不是 Node.js 24。
- Windows PowerShell 中使用 `npm.cmd`。
- npm cache 如遇权限问题，切到项目本地 cache。
- 没有 `dev.db` 时运行 `npm.cmd run db:init`。
- 缺少 `src/generated/prisma` 时运行 `npm.cmd run prisma:generate`。
- 构建前确认 `next.config.ts` 中已固定 `turbopack.root`。
- 不使用任何递归删除或批量删除命令清理目录。
- 服务启动后用 `/api/atlas` 验证 `200 OK`。
- 如需 Codex 中长期运行 dev server，使用沙箱外启动。
