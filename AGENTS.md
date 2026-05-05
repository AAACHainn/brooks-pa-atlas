# Brooks PA Atlas 项目说明

## 最高优先级规则

禁止批量删除文件或目录。

不要使用：

- `del /s`
- `rd /s`
- `rmdir /s`
- `Remove-Item -Recurse`
- `rm -rf`

需要删除文件时，只能一次删除一个明确路径的文件。

正确示例：

```powershell
Remove-Item "C:\path\to\file.txt"
```

如果需要批量删除文件，应停止操作，并请求用户手动删除。

<!-- BEGIN:nextjs-agent-rules -->
## Next.js 版本注意事项

This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## 项目目标

Brooks PA Atlas 是一个本地 Web App，用于把 Brooks Encyclopedia of Chart Patterns 的本地图表图片库做成价格行为学习系统。

第一版面向大批量本地图表图库：

- 用户可以通过浏览器批量选择图片或选择文件夹导入，单次目标规模为 1000 张以上。
- 图片文件保存到应用本地图库目录，数据库只保存路径和元数据，不保存图片 blob。
- 用户通过无限层级的百科式索引树组织图片，不再固定 Level1~Level5。
- 导入时按分组批量映射索引路径。
- OCR 不阻塞导入，图片先入库，后台并发队列补充 OCR 文本。
- 首页就是 Atlas 工作台，不做营销页。
- 第一版不做登录、不做云同步、不做 AI 分类或 AI 分析。

## 技术栈

- Next.js `16.2.4` App Router
- React `19.2.4`
- TypeScript
- Tailwind CSS v4
- Prisma `7.8.0`
- SQLite
- `@prisma/adapter-better-sqlite3` + `better-sqlite3`
- `sharp` 用于读取图片尺寸
- `lucide-react` 用于图标

Prisma 7 的运行时代码需要显式 driver adapter，本项目在 `src/lib/db.ts` 中用 `PrismaBetterSqlite3` 初始化 `PrismaClient`。

## 常用命令

```powershell
npm run dev
npm run lint
npm run build
npm run prisma:generate
npm run db:init
```

说明：

- `npm run dev` 启动本地开发服务，默认地址为 `http://localhost:3000`。
- `npm run lint` 运行 ESLint。
- `npm run build` 运行生产构建和类型检查。
- `npm run prisma:generate` 生成 Prisma Client，输出目录为 `src/generated/prisma`。
- `npm run db:init` 使用 `scripts/init-db.mjs` 和初始 SQL migration 初始化本地 SQLite 数据库。

当前环境中 `npx prisma db push` 曾出现 schema engine 空报错；如果再次遇到，可优先使用 `npm run db:init` 初始化空库。

## 重要目录和文件

- `docs/PRODUCT_SPEC.md`：产品说明文档，记录第一版功能范围和数据模型。
- `src/app/page.tsx`：首页入口，渲染 `AtlasWorkbench`。
- `src/app/atlas-workbench.tsx`：主工作台 UI，包含中英切换、索引树、搜索、批量导入、分组映射、图片网格、详情面板、OCR 状态和导入批次撤销。
- `src/app/api/atlas/route.ts`：工作台聚合查询接口，返回索引树、图片列表、导入批次和统计信息。
- `src/app/api/import/route.ts`：批量导入接口，接收分块上传的图片，保存文件，创建 `ImportBatch` / `ImportItem` / `ChartImage`，并触发 OCR 队列。
- `src/app/api/import/[id]/undo/route.ts`：撤销某个导入批次，只删除该批次新导入的图片和数据库记录。
- `src/app/api/index-nodes/route.ts`：索引节点查询、创建、重命名。
- `src/app/api/images/[id]/route.ts`：更新图片标题、备注和所属索引。
- `src/app/api/images/[id]/file/route.ts`：从本地图库目录读取图片文件并返回给浏览器。
- `src/app/api/ocr/retry/route.ts`：重试失败 OCR。
- `src/lib/storage.ts`：本地图片存储、hash、文件名清洗、尺寸读取和路径安全检查。
- `src/lib/index-tree.ts`：无限层级索引树创建、路径补全和树形查询。
- `src/lib/ocr-queue.ts`：本地 OCR 并发队列。
- `prisma/schema.prisma`：Prisma 数据模型。
- `prisma/migrations/20260505000000_init/migration.sql`：初始 SQLite schema。
- `scripts/init-db.mjs`：本地 SQLite 初始化脚本。

## 数据模型概览

- `IndexNode`：无限层级索引节点，保存 `name`、`parentId`、`depth`、`path`、`sortOrder`。
- `ChartImage`：图片主表，保存图库路径、原始文件名、mime type、尺寸、hash、标题、备注、OCR 文本、OCR 状态、所属索引和导入批次。
- `ImportBatch`：一次批量导入任务，保存总数、成功数、失败数、重复数、OCR 进度和状态。
- `ImportItem`：导入批次中的单张图片记录，保存原始文件名、相对路径、保存路径、分组、状态和错误。
- `AppSetting`：应用设置，目前用于 OCR 并发数等键值配置。

枚举：

- `ImportBatchStatus`：`DRAFT`、`IMPORTING`、`PROCESSING_OCR`、`COMPLETED`、`COMPLETED_WITH_ERRORS`、`FAILED`
- `ImportItemStatus`：`PENDING`、`IMPORTED`、`DUPLICATE`、`FAILED`
- `OcrStatus`：`PENDING`、`RUNNING`、`COMPLETED`、`FAILED`、`SKIPPED`

## 导入和存储规则

- 前端支持两个入口：`选择图片` 和 `选择文件夹`。
- 前端每批上传 `80` 张图片，避免单次请求过大。
- 导入前会显示分组映射区，用户可以取消选择或开始导入。
- 分组默认来自上传目录第一层；没有目录时，会尝试使用文件名前缀。
- 分组映射值用 `/` 分隔索引路径，后端会通过 `ensureIndexPath` 自动创建不存在的索引节点。
- 图片保存到 `data/library/images/YYYY-MM/` 下。
- 默认图库根目录来自 `src/lib/storage.ts`；可用环境变量 `BROOKS_LIBRARY_ROOT` 覆盖。
- 数据库保存相对路径、元数据和 hash，不保存图片 blob。
- 重复图片通过 SHA-256 hash 检测，默认跳过并记录为 `DUPLICATE`。

## OCR 规则

- OCR 队列在导入后通过 `scheduleOcrPump()` 触发。
- 默认 OCR 命令为 `tesseract`。
- 可用环境变量 `BROOKS_OCR_COMMAND` 指定 OCR 命令。
- OCR 当前调用参数为：`<command> <imagePath> stdout -l eng`。
- 默认并发数为 CPU 核心数的一半，限制在 `2` 到 `4` 之间；`AppSetting` 的 `ocr.concurrency` 可覆盖，最大限制为 `8`。
- 如果本机未安装 OCR 命令，任务会进入 `FAILED`，前端可重试。

## UI 和语言

- 工作台默认中文。
- 左上角有 `EN` / `中` 切换按钮。
- 语言选择保存在 `localStorage` 的 `brooks-pa-atlas.locale`。
- 主布局为三栏：左侧索引树，中间搜索/导入/网格，右侧图片详情。
- 空状态、OCR 状态、导入批次状态和详情面板文案都支持中英切换。

## 安全和实现注意事项

- 不要把图片 blob 写入数据库。
- 不要直接引用浏览器用户硬盘原始路径；浏览器上传后应复制到应用图库目录。
- 路由处理本地文件时必须保持 `runtime = "nodejs"`。
- `absoluteImagePath()` 会校验图片路径必须在图库根目录内，避免任意文件读取。
- 撤销导入批次时，只能删除明确的单个图片路径。当前实现使用 `unlink` 逐个删除文件，符合本文件顶部的禁批量删除规则。
- `src/generated/prisma` 是生成目录，已被 `.gitignore` 忽略，不要手改。
- `dev.db`、`dev.db-*`、`data/library`、`.next`、`node_modules` 都是本地生成或运行数据，不应提交。
- 如果修改 Next.js App Router、Route Handler、Server Actions、缓存或图片相关能力，先阅读 `node_modules/next/dist/docs/` 里的对应文档。

## 当前已知限制

- 搜索目前由数据库 `contains` 条件完成，并限制返回最近 `200` 张图片；大量图库下后续可考虑更强索引或分页。
- OCR 当前默认英文 `eng`，如需中文或多语言 OCR，需要调整 `ocr-queue.ts` 中的命令参数或做成设置项。
- 索引节点支持创建和重命名，尚未实现拖拽移动、删除和复杂排序 UI。
- 图片详情支持标题、备注、索引归类编辑，尚未支持批量编辑已导入图片。
