# Brooks PA Atlas 项目维护说明

本文档是给后续 Codex 线程和人类维护者看的项目手册。开始修改代码前请先读本文件；当实现发生明显变化时，也请同步更新本文件。

## 最高优先级安全规则

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

## 项目定位

Brooks PA Atlas 是一个本地 Web App，用于把 Brooks Encyclopedia of Chart Patterns 的本地图表图片库整理成价格行为学习系统。

当前版本的核心目标是“大批量本地图表图库”：

- 浏览器批量选择图片或选择文件夹导入，目标规模为单次 1000 张以上。
- 图片复制到应用本地图库目录，数据库只保存相对路径和元数据，不保存 blob。
- 用户用无限层级的百科式索引树组织图片。
- 导入不被 OCR 阻塞：图片先入库并可浏览，后台 OCR 队列异步补充文本。
- 首页就是 Atlas 工作台，不做营销页。
- 第一版不做登录、云同步、AI 分类、AI 分析或多标签体系。

## 技术栈和版本

- Next.js `16.2.4` App Router
- React `19.2.4`
- TypeScript 严格模式
- Tailwind CSS v4
- Prisma `7.8.0`
- SQLite
- `@prisma/adapter-better-sqlite3` + `better-sqlite3`
- `sharp` 读取图片尺寸
- `lucide-react` 提供图标
- `zod`、`xlsx`、`fuse.js` 已作为依赖存在，其中部分能力尚未成为核心路径

Prisma 7 运行时代码需要显式 driver adapter。本项目在 `src/lib/db.ts` 中用 `PrismaBetterSqlite3` 初始化 `PrismaClient`，Prisma Client 输出目录是 `src/generated/prisma`。

## 常用命令

```powershell
npm run dev
npm run lint
npm run build
npm run prisma:generate
npm run db:init
```

说明：

- `npm run dev` 启动本地开发服务，默认地址是 `http://localhost:3000`。
- `npm run lint` 运行 ESLint。
- `npm run build` 运行生产构建和类型检查。
- `npm run prisma:generate` 生成 Prisma Client 到 `src/generated/prisma`。
- `npm run db:init` 用 `scripts/init-db.mjs` 和初始 SQL migration 初始化本地 SQLite 数据库。

当前环境里 `npx prisma db push` 曾出现 schema engine 空报错；如果再次遇到，优先用 `npm run db:init` 初始化空库。

在 Codex 桌面环境中，普通沙箱有时无法更新 `.next` 生成文件，`npm run build` 可能因 `.next/*` 权限失败；这种情况下按权限规则提升后重跑构建。

## 目录和文件导览

- `AGENTS.md`：本项目维护说明，后续线程优先读这里。
- `CLAUDE.md`：只指向 `AGENTS.md`。
- `README.md`：仍是 create-next-app 默认说明，不代表当前产品真实状态。
- `docs/PRODUCT_SPEC.md`：早期产品规格，描述第一版目标和数据模型；部分 UI 已被当前实现扩展。
- `src/app/page.tsx`：首页入口，渲染 `AtlasWorkbench`。
- `src/app/layout.tsx`：根布局、字体和 metadata。
- `src/app/globals.css`：Tailwind v4 入口和全局 CSS。
- `src/app/atlas-workbench.tsx`：主工作台 UI，绝大多数前端交互都在这里。
- `src/app/api/atlas/route.ts`：工作台聚合查询接口。
- `src/app/api/import/route.ts`：分块批量导入接口。
- `src/app/api/import/[id]/undo/route.ts`：撤销导入批次。
- `src/app/api/index-nodes/route.ts`：索引节点查询、创建、重命名、排序字段更新和删除。
- `src/app/api/index-nodes/[id]/clear-images/route.ts`：清空某个索引及其后代下的图片。
- `src/app/api/images/[id]/route.ts`：更新或删除单张图片。
- `src/app/api/images/[id]/file/route.ts`：读取图库内图片文件并返回给浏览器。
- `src/app/api/ocr/retry/route.ts`：重试失败 OCR。
- `src/lib/db.ts`：Prisma Client + better-sqlite3 adapter。
- `src/lib/index-tree.ts`：索引树创建、路径补全、树形查询。
- `src/lib/storage.ts`：图片存储、hash、文件名清洗、尺寸读取、安全路径校验。
- `src/lib/ocr-queue.ts`：本地 OCR 并发队列。
- `prisma/schema.prisma`：Prisma 数据模型。
- `prisma/migrations/20260505000000_init/migration.sql`：初始 SQLite schema。
- `scripts/init-db.mjs`：本地 SQLite 初始化脚本。
- `public/*.svg`：create-next-app 默认静态图标，目前不是产品核心资源。

## 本地数据和生成物

这些文件或目录是本地生成或运行数据，不应作为业务源代码修改：

- `.next/`
- `node_modules/`
- `src/generated/prisma/`
- `dev.db`、`dev.db-*`
- `data/library/`
- `next-env.d.ts`
- 运行日志，例如 `.codex-dev-server.log`、`dev-server.log`、`dev-server.err.log`

注意：运行开发服务可能导致运行日志变成 modified。除非用户明确要求，不要把日志变更当成业务修改处理。

## 数据模型

主要模型：

- `IndexNode`：无限层级索引节点，字段包括 `name`、`parentId`、`depth`、`path`、`sortOrder`。
- `ChartImage`：图片主表，保存图库路径、原始文件名、mime type、大小、尺寸、hash、标题、备注、OCR 文本、OCR 状态、所属索引、导入批次。
- `ImportBatch`：一次批量导入任务，保存总数、成功数、失败数、重复数、OCR 进度、状态、开始和结束时间。
- `ImportItem`：导入批次中的单张图片记录，保存原始文件名、相对路径、保存路径、分组、状态、错误和映射索引。
- `AppSetting`：本地设置，目前用于 OCR 并发数等键值配置。

枚举：

- `ImportBatchStatus`：`DRAFT`、`IMPORTING`、`PROCESSING_OCR`、`COMPLETED`、`COMPLETED_WITH_ERRORS`、`FAILED`
- `ImportItemStatus`：`PENDING`、`IMPORTED`、`DUPLICATE`、`FAILED`
- `OcrStatus`：`PENDING`、`RUNNING`、`COMPLETED`、`FAILED`、`SKIPPED`

重要约束：

- `ChartImage.hash` 唯一，用 SHA-256 检测重复图片。
- `ChartImage.libraryPath` 唯一，数据库只保存应用图库内的相对路径。
- `IndexNode` 在同一父节点下 `name` 唯一。
- `ImportItem.chartImageId` 唯一，一张已入库图片最多对应一个导入 item 记录。

## 工作台 UI

`src/app/atlas-workbench.tsx` 是客户端组件，默认中文，支持中英文切换。偏好通过 `localStorage` 保存。

当前工作台有两种模式：

- 管理模式：导入、创建索引、编辑图片详情、OCR 重试、撤销批次、删除图片、索引右键管理。
- 浏览模式：只读，隐藏导入、新建索引、保存、OCR 重试、撤销、删除等写操作。

主要布局：

- 左侧：索引树、全部图片入口、语言切换、刷新、侧栏折叠、浏览/管理模式切换。
- 中间：搜索栏、导入表格或图库浏览区域、概览、图片网格。
- 右侧：管理模式下的图片详情编辑面板；浏览模式下是大图查看体验。

浏览模式特性：

- 左侧目录 + 右侧图片浏览。
- 顶部搜索可与目录筛选组合。
- 选中图片后显示大图查看器。
- 查看器固定高度并可拖动调整，缩放范围 `50%` 到 `220%`。
- 放大后在查看器内部滚动，不撑大整页。
- 鼠标悬停图片时显示左右箭头；箭头 tooltip 提示 `←` / `→` 快捷键。
- 键盘 `ArrowLeft` / `ArrowRight` 可切换上一张/下一张；焦点在输入框、选择框、滑杆等编辑控件时不会触发。
- 下方缩略图网格可隐藏或显示。

管理模式特性：

- 可以选择图片或文件夹导入。
- 可以创建当前选中索引下的新子索引。
- 图片详情支持编辑标题、备注、所属索引。
- 支持删除单张图片，删除前必须二次确认。
- OCR 失败可重试。
- 最近导入批次可撤销，撤销前必须二次确认。
- 概览区可折叠。
- 图片网格有客户端分页，避免一次渲染过多图片导致打开缓慢。

## 索引树管理

索引树支持无限层级。`IndexNode.path` 使用 ` / ` 拼接祖先名称，重命名节点时会同步更新后代路径。

管理模式下，索引树节点支持右键菜单：

- 重命名索引。
- 删除索引：只有当前索引及其后代下面没有图片时才能操作；后端也会重新校验。
- 清空当前索引及其后代下面的所有图片：这是高风险操作，确认弹窗要求用户输入 `确认删除` 后才会执行。

注意：

- 左侧树上显示的数量是当前节点直接图片数，不是整棵子树汇总数。
- 删除索引只删除数据库索引节点，不删除文件；清空图片会逐张删除图库文件和数据库记录。
- 任何文件删除都必须保持逐个明确路径删除，不能批量删除目录。

## 导入流程

前端入口：

- `选择图片`：普通多选文件，`accept="image/*"`。
- `选择文件夹`：使用 `webkitdirectory`/`directory`。文件夹导入不能依赖 MIME 类型，因为部分浏览器或系统会给空 MIME；前端会同时按扩展名识别图片。

支持的图片扩展名包括：

- `.jpg`
- `.jpeg`
- `.png`
- `.webp`
- `.gif`
- `.bmp`
- `.tif`
- `.tiff`

前端导入表格：

- 选中文件后会生成 `SelectedFile`，包含 `id`、`file`、`relativePath`、`groupKey`、`previewUrl`。
- 表格列为显示名称、所属索引、缩略图。
- 所属索引是下拉框，选项来自已创建的全部索引；默认值是左侧当前选中的索引路径，未选索引时默认未分类。
- 缩略图在最后一列，点击可打开大图预览弹窗。
- 表格支持分页，显示总数、当前范围、页码，支持每页 `10 / 25 / 50 / 100`。
- 表格高度可拖动调整，保存到 `localStorage`。
- 导入时提交全部已选图片，不只提交当前页。

上传规则：

- 前端每批上传 `80` 张，避免单次请求过大。
- 每张图片会提交 `files`、`relativePaths`、`groupKeys`、`indexPaths`。
- `indexPaths` 是逐文件索引路径，JSON 数组格式，例如 `["1", "2", "2131"]`。
- 后端仍兼容旧的 `assignments: Record<string, string[]>` 作为 group fallback。

后端导入：

- `src/app/api/import/route.ts` 接收 `multipart/form-data`。
- 使用 `isSupportedImage()` 过滤类型，支持 MIME 类型和扩展名双重判断。
- 用 `ensureIndexPath()` 自动创建不存在的索引路径。
- 用 SHA-256 hash 检测重复图片；重复项记录为 `DUPLICATE`，默认不新增 `ChartImage`。
- 新图片保存到图库目录并创建 `ChartImage` 与 `ImportItem`。
- 每个 chunk 完成后更新 `ImportBatch` 并触发 `scheduleOcrPump()`。

## 图片列表和排序

`GET /api/atlas` 当前仍限制返回最近或匹配的 `200` 张图片，但服务端查询和前端展示已按原始文件名做自然排序，避免 `1.jpg`、`2.jpg`、`10.jpg` 这类名称出现字典序错乱。

前端图片网格有客户端分页：

- 默认每页 `50` 张。
- 可选每页 `25 / 50 / 100 / 200`。
- 切换搜索、索引、模式或每页数量时会回到第一页。

注意：这还不是完整的后端分页。大图库下如果需要浏览超过 `/api/atlas` 返回上限的完整结果，后续应改造 API 参数和数据库分页。

## 图片存储规则

- 默认图库根目录是 `data/library/images`。
- 环境变量 `BROOKS_LIBRARY_ROOT` 可以覆盖图库根目录。
- 新图片保存到 `data/library/images/YYYY-MM/`。
- 保存文件名格式是 `清洗后的原名-hash前16位.ext`，例如 `1-a1b2c3d4e5f6a7b8.jpg`。hash 放在原名后面，避免破坏按原始名称排序。
- 浏览器原始硬盘路径不能直接入库，只能保存上传后的应用内相对路径。
- `absoluteImagePath()` 会校验图片路径必须在图库根目录内，避免任意文件读取。

## OCR 规则

- OCR 队列在导入后通过 `scheduleOcrPump()` 异步触发。
- 默认 OCR 命令是 `tesseract`。
- 可用环境变量 `BROOKS_OCR_COMMAND` 指定 OCR 命令。
- 当前调用参数：`<command> <imagePath> stdout -l eng`。
- 默认并发数为 CPU 核心数一半，限制在 `2` 到 `4`；`AppSetting` 的 `ocr.concurrency` 可覆盖，最大 `8`。
- 失败时图片进入 `FAILED`，错误写入 `ocrError`，前端可重试。
- `retryFailedOcr(imageIds?)` 会把失败图片重置为 `PENDING` 并重新调度。

## API 行为

`GET /api/atlas`

- 参数：`q`、`indexId`。
- 返回：索引树、图片列表、最近导入批次、统计信息。
- 索引筛选会包含所选节点及其后代路径。
- 搜索覆盖 `originalName`、`title`、`notes`、`ocrText`、`indexNode.path`。
- 图片列表当前 `take: 200`。
- 图片按 `originalName` 自然排序，名称相同时按 `createdAt` 排序。
- OCR 文本和错误会截断返回，避免接口太大。

`POST /api/import`

- 创建或复用 `ImportBatch`。
- 支持逐文件 `indexPaths` 和旧式 `assignments`。
- 写入图库文件、`ChartImage`、`ImportItem`。
- 更新批次计数并调度 OCR。

`POST /api/import/[id]/undo`

- 撤销某个导入批次。
- 逐个 `unlink` 删除该批次新增图片文件。
- 然后删除对应 `ImportItem`、`ChartImage`、`ImportBatch`。
- 只允许逐个明确路径删除文件，符合最高优先级安全规则。
- 前端调用前必须弹窗确认。

`GET /api/index-nodes`

- 返回索引树。

`POST /api/index-nodes`

- 创建索引节点；`parentId` 为空时创建根节点。

`PATCH /api/index-nodes`

- 更新节点名称和 `sortOrder`。
- 重命名会同步更新后代 `path`。

`DELETE /api/index-nodes?id=...`

- 删除某个索引节点及其后代节点。
- 只有该节点及其后代下没有图片时才能删除。
- 后端会校验图片数量，前端禁用按钮只是体验层保护。

`POST /api/index-nodes/[id]/clear-images`

- 清空某个索引节点及其后代下的所有图片。
- 请求体必须包含 `confirmation: "确认删除"`。
- 后端会逐张删除图库文件，再删除对应数据库记录。

`PATCH /api/images/[id]`

- 更新标题、备注、所属索引。

`DELETE /api/images/[id]`

- 删除单张图片。
- 后端会逐个明确路径删除对应图库文件，然后删除数据库记录。
- 前端调用前必须弹窗确认。

`GET /api/images/[id]/file`

- 读取本地图库文件并返回图片响应。
- 必须保持 `runtime = "nodejs"`。

`POST /api/ocr/retry`

- 重试失败 OCR；传 `imageIds` 时只重试指定图片，不传则重试所有失败图片。

## 本地偏好键

工作台使用以下 `localStorage` key：

- `brooks-pa-atlas.locale`：语言，`zh` 或 `en`。
- `brooks-pa-atlas.sidebar`：侧栏折叠状态。
- `brooks-pa-atlas.overview`：概览折叠状态。
- `brooks-pa-atlas.viewMode`：`browse` 或 `manage`。
- `brooks-pa-atlas.imageGridPageSize`：管理模式图片网格每页数量。
- `brooks-pa-atlas.viewerHeight`：浏览模式大图查看器高度。
- `brooks-pa-atlas.browseThumbnails`：浏览模式缩略图显隐。
- `brooks-pa-atlas.importTableHeight`：导入表格高度。

## 安全和实现注意事项

- 不要把图片 blob 写入数据库。
- 不要直接引用浏览器用户硬盘原始路径。
- 文件读取路由必须保持 `runtime = "nodejs"`。
- 涉及本地文件路径时优先使用 `absoluteImagePath()`。
- 任何删除文件的代码都必须逐个明确路径删除，不能批量删除目录。
- 高风险写操作需要二次确认；清空索引图片必须要求用户输入 `确认删除`。
- `src/generated/prisma` 是生成目录，不要手改。
- `dev.db`、`data/library`、`.next`、`node_modules` 和运行日志不应作为功能代码修改。
- 修改 Next.js App Router、Route Handler、缓存、图片处理等能力前，先读 `node_modules/next/dist/docs/` 中相关文档。
- UI 里已有浏览/管理模式边界：浏览模式必须保持只读，不要把导入、保存、OCR 重试、撤销、删除等写操作暴露进去。

## 当前已知限制和后续方向

- `/api/atlas` 图片列表仍限制 `take: 200`；当前分页是前端分页，后续大图库应做真正的后端分页。
- 搜索由数据库 `contains` 完成，后续可考虑全文索引或更强搜索。
- OCR 默认英文 `eng`；如需中文或多语言，需要调整 `ocr-queue.ts` 或做成设置项。
- 索引节点支持创建、重命名、删除空索引、清空图片和 `sortOrder` 字段更新，但尚未实现拖拽移动和完整排序 UI。
- 图片详情支持单张编辑和删除，尚未支持已导入图片的批量编辑。
- 导入表格支持逐文件索引选择，但尚未支持批量套用某一索引到当前页或全部选中项。
- README 仍是默认模板，真实项目说明以本文件和 `docs/PRODUCT_SPEC.md` 为准。
