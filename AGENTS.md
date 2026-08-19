# Brooks PA Atlas 项目维护手册

本文档面向后续 Codex 线程和人类维护者。开始修改代码前请先阅读本文件；当项目能力、接口、运行方式或安全规则发生变化时，请同步更新本文件。

执行生产部署或已有实例升级时，还必须阅读 `docs/DEPLOYMENT_PITFALLS.md`；其中记录了导航筛选性能版本的 migration、2 核 2GB 配置建议、接口检查和 2 秒验收方法。

## 1. 最高优先级安全规则

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

本项目有删除图片文件的业务代码，但必须保持“逐个明确路径删除”的实现方式。不要改成删除目录、通配符删除或递归删除。

<!-- BEGIN:nextjs-agent-rules -->
## Next.js 版本注意事项

This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## 2. 项目定位

Brooks PA Atlas 是一个本地 Web App，用于把 Brooks Encyclopedia of Chart Patterns 的本地图表图片库整理成价格行为学习系统。

当前版本重点：

- 大批量本地图片图库管理，目标支持单次 1000 张以上导入。
- 浏览器选择图片或文件夹，应用把图片复制到本地图库目录。
- 管理模式提供“导入资料”入口，第一版支持 PDF：把每页转换成图片，并按 PDF 内置书签目录挂载到索引树。
- 数据库只保存图片相对路径和元数据，不保存图片 blob。
- 用无限层级索引树组织图表图片。
- 导入后图片立刻入库并可浏览，OCR 是可选项；默认跳过 OCR，用户可在导入时开启自动 OCR，或之后对单张图片手动 OCR。
- 首页直接进入 Atlas 工作台，不做营销页。
- 第一版不做登录、云同步、AI 分类和 AI 分析。

## 3. 技术栈

- Next.js `16.2.4` App Router
- Node.js 建议 `22.13.0` 或更新版本，PDF 导入依赖 `pdfjs-dist` 的现代 Node.js 支持
- React `19.2.4`
- TypeScript 严格模式
- Tailwind CSS v4
- Prisma `7.8.0`
- SQLite
- `@prisma/adapter-better-sqlite3` + `better-sqlite3`
- `sharp` 读取图片尺寸，并压缩 PDF 页面转换后的图片
- `lucide-react` 提供图标
- `pdfjs-dist` 解析 PDF 页和内置书签目录
- `@napi-rs/canvas` 在 Node.js 中渲染 PDF 页面
- `yazl`、`yauzl` 用于跨平台 zip 备份和恢复
- `zod`、`xlsx`、`fuse.js` 已作为依赖存在，其中部分能力还不是核心路径

Prisma 7 运行时代码需要显式 driver adapter。本项目在 `src/lib/db.ts` 中用 `PrismaBetterSqlite3` 初始化 `PrismaClient`，Prisma Client 输出目录是 `src/generated/prisma`。

## 4. 常用命令

```powershell
npm run dev
npm run lint
npm run build
npm run test:navigator
npm run test:thumbnails
npm run prisma:generate
npm run db:migrate
npm run db:init
docker compose up -d --build
docker compose ps
docker compose logs -f atlas
docker compose down
```

说明：

- `npm run dev` 启动开发服务，默认访问 `http://localhost:3000`。
- `npm run dev:lan` 启动局域网开发服务，绑定 `0.0.0.0`，用于手机或同局域网设备访问。
- `npm run lint` 运行 ESLint。
- `npm run build` 运行生产构建和类型检查。
- `npm run test:navigator` 运行导航本地匹配数、跨分类 AND、目录搜索和自然排序单元测试。
- `npm run test:thumbnails` 运行缩略图路径、缓存、尺寸、并发合并和图片查询键测试。
- `npm run prisma:generate` 生成 Prisma Client 到 `src/generated/prisma`。
- `npm run db:migrate` 使用 `scripts/migrate-db.mjs` 对已有 SQLite 数据库应用项目内 SQL migrations。
- `npm run db:init` 使用 `scripts/init-db.mjs` 和初始 SQL migration 初始化本地 SQLite 数据库，并继续执行全部增量 migrations。
- `docker compose up -d --build` 构建生产镜像并启动服务，默认访问 `http://localhost:3000`；容器启动时会自动初始化或迁移数据库。
- Compose 使用命名卷 `brooks-pa-atlas-data` 持久化 SQLite 数据库和图库。`docker compose down` 不删除该卷；不要添加会删除 volume 的参数。

注意：

- 当前环境中 `npx prisma db push` 曾出现 schema engine 空报错；初始化空库优先使用 `npm run db:init`。
- Codex 桌面环境下，普通沙箱有时无法更新 `.next` 生成文件，`npm run build` 可能因 `.next/*` 权限失败；按权限规则提升后重跑构建即可。
- `next.config.ts` 默认用 `*.*.*.*` 允许任意 IPv4 地址访问 Next.js dev resource，避免局域网访问时 HMR 被阻止。必要时仍可用 `BROOKS_ALLOWED_DEV_ORIGINS` 追加手动允许的非 IPv4 主机名，多个地址用英文逗号分隔。

## 5. 目录导览

- `AGENTS.md`：本维护手册，后续线程优先阅读。
- `README.md`：面向使用者的启动和基础使用说明，已包含 Windows、Linux/macOS 的 OCR 配置示例。
- `CLAUDE.md`：只指向 `AGENTS.md`。
- `docs/PRODUCT_SPEC.md`：早期产品规格，描述第一版目标；部分 UI 已被当前实现扩展。
- `docs/DEPLOYMENT_PITFALLS.md`：部署、升级和启动问题记录；部署 AI 必须阅读其中“导航筛选性能优化部署说明”，按固定顺序应用 migration 并执行性能验收。
- `src/app/page.tsx`：首页入口，渲染 `AtlasWorkbench`。
- `src/app/layout.tsx`：根布局、字体和 metadata。
- `src/app/globals.css`：Tailwind v4 入口和全局 CSS。
- `src/app/atlas-workbench.tsx`：主工作台客户端组件，绝大多数前端交互在这里。
- `src/app/index-navigator-panel.tsx`：统一索引节点导航器和管理设置弹窗。
- `src/app/app-dialog.tsx`：全局统一的应用内提示、确认和文本输入弹窗，提供危险级别样式、焦点管理和键盘操作。
- `src/app/exam-mode.tsx`：考试模式客户端组件，包含试卷管理、制题、遮罩、考试和结果复盘。
- `src/app/api/atlas/route.ts`：工作台聚合查询接口。
- `src/app/api/exam/**/route.ts`：考试模式 API，负责试卷、题目、发布、考试记录和提交评分。
- `src/app/api/exam/papers/[id]/copy/route.ts`：拷贝试卷为新草稿，只复制试题，不复制考试记录。
- `src/app/api/exam/papers/[id]/export/route.ts`：导出已发布试卷为轻量 JSON，只保存图片 hash 等索引，不包含图片文件。
- `src/app/api/exam/papers/import/route.ts`：从轻量 JSON 导入试卷为草稿，按图片 hash 映射当前图库图片。
- `src/lib/exam-paper-transfer.ts`：试卷导出/导入 JSON manifest schema 和序列化逻辑。
- `src/app/api/backups/export/route.ts`：导出跨平台备份 zip。
- `src/app/api/backups/records/**/route.ts`：列出、流式下载和删除服务器上持久保存的备份记录。
- `src/app/api/backups/restore/route.ts`：导入备份 zip 并以合并覆盖模式恢复。
- `src/app/api/import/route.ts`：分块批量导入接口。
- `src/app/api/import/documents/route.ts`：通用资料导入同步接口，当前注册 PDF importer。
- `src/app/api/import/documents/jobs/route.ts`：启动资料导入后台任务。
- `src/app/api/import/documents/jobs/[id]/route.ts`：查询资料导入后台任务进度。
- `src/app/api/import/[id]/undo/route.ts`：撤销导入批次。
- `src/app/api/index-nodes/route.ts`：索引节点查询、创建、重命名、排序字段更新和删除。
- `src/app/api/index-nodes/[id]/clear-images/route.ts`：清空某个索引及其后代下的图片。
- `src/app/api/images/[id]/route.ts`：读取完整图片详情，更新或删除单张图片。
- `src/app/api/images/[id]/annotations/route.ts`：替换保存单张图片的浏览模式文字标注。
- `src/app/api/images/tags/route.ts`：批量给指定图片添加或移除标签。
- `src/app/api/images/selection-summary/route.ts`：读取跨页已选图片的标签摘要。
- `src/app/api/images/route.ts`：分页查询图库图片，供考试模式选择已有图片。
- `src/app/api/index-navigator/**/route.ts`：导航分类、选项、目录结果和节点关联接口。
- `src/app/api/images/[id]/file/route.ts`：读取图库内图片文件并返回给浏览器。
- `src/app/api/images/[id]/thumbnail/route.ts`：读取或按需生成版本化 WebP 缩略图。
- `src/app/api/maintenance/thumbnails/jobs/**/route.ts`：启动并查询持久化缩略图补齐任务。
- `src/app/api/ocr/images/[id]/route.ts`：把单张图片放入 OCR 队列。
- `src/app/api/ocr/retry/route.ts`：重试失败 OCR。
- `src/lib/db.ts`：Prisma Client + better-sqlite3 adapter。
- `src/lib/backup.ts`：备份 manifest、zip 导出、zip 校验和合并恢复逻辑。
- `src/lib/index-tree.ts`：索引树创建、路径补全、树形查询。
- `src/lib/index-navigator.ts`：导航基础数据查询、服务端目录匹配和图片子树范围 helper。
- `src/lib/index-navigator-client.ts`：浏览器端导航匹配数、置灰状态、目录搜索、自然排序和分页的纯计算 helper。
- `src/lib/atlas-images.ts`：工作台图片的全局自然排序和服务端分页 helper。
- `src/lib/import-images.ts`：把已得到的图片 buffer 保存为图库图片并创建 `ChartImage` / `ImportItem`。
- `src/lib/document-importers.ts`：资料导入 importer 的最小接口。
- `src/lib/document-import-jobs.ts`：资料导入后台任务状态，供前端轮询进度。
- `src/lib/pdf-importer.ts`：PDF 书签解析、逐页渲染和按目录挂载逻辑。
- `src/lib/storage.ts`：图片存储、hash、文件名清洗、尺寸读取、安全路径校验。
- `src/lib/thumbnails.ts`：版本化缩略图路径、生成、读取、缓存命中和单文件删除。
- `src/lib/thumbnail-jobs.ts`：缩略图补齐任务的持久化、重启中断识别和续跑。
- `src/lib/image-query-key.ts`：图片筛选请求的稳定查询键，防止旧结果继续渲染。
- `src/lib/image-annotations.ts`：图片文字标注的校验和序列化 helper。
- `src/lib/ocr-queue.ts`：本地 OCR 并发队列。
- `prisma/schema.prisma`：Prisma 数据模型。
- `prisma/migrations/20260505000000_init/migration.sql`：初始 SQLite schema。
- `scripts/init-db.mjs`：本地 SQLite 初始化脚本。
- `scripts/migrate-db.mjs`：本地 SQLite 增量迁移脚本。
- `public/*.svg`：create-next-app 默认静态图标，目前不是产品核心资源。
- `Dockerfile`：基于 Node.js 22 的 Next.js standalone 多阶段生产镜像，运行层包含 Tesseract 中英文 OCR。
- `compose.yaml`：本地容器编排、端口映射、健康检查和数据卷配置。
- `docker-entrypoint.sh`：容器启动入口，先初始化/迁移 SQLite，再启动 Next.js standalone server。
- `.dockerignore`：排除依赖、构建产物、本地数据库、图库和环境变量，避免进入镜像构建上下文。

## 6. 本地数据和生成物

以下文件或目录是本地生成、运行数据或生成代码，不应作为业务源码修改：

- `.next/`
- `node_modules/`
- `src/generated/prisma/`
- `dev.db`、`dev.db-*`
- `data/library/`
- `next-env.d.ts`
- 运行日志，例如 `.codex-dev-server.log`、`dev-server.log`、`dev-server.err.log`

Docker Compose 运行数据位于命名卷 `brooks-pa-atlas-data`，容器内统一挂载到 `/app/data`：数据库为 `/app/data/dev.db`，图库为 `/app/data/library/images`。重新构建容器不会清空该卷。

注意：

- `.env` 和 `.env*` 被 `.gitignore` 排除，不要提交环境变量或本地路径。
- 运行开发服务可能导致日志文件 modified。除非用户明确要求，不要把日志变更当成业务修改处理。
- 不要手动修改 `src/generated/prisma`，需要时运行 `npm run prisma:generate`。

## 7. 数据模型

主要模型：

- `IndexNode`：无限层级索引节点，字段包括 `name`、`parentId`、`depth`、`path`、`sortOrder`。
- `IndexNavigatorCategory`：导航分类，保存名称、大小写无关规范化名称和排序。
- `IndexNavigatorOption`：分类下的导航选项，保存名称、规范化名称和排序。
- `IndexNodeNavigatorOption`：索引节点与导航选项的多对多关联。
- `ChartImage`：图片主表，保存图库路径、原始文件名、mime type、大小、尺寸、hash、标题、备注、OCR 文本、OCR 状态、所属索引、导入批次。
- `ImageAnnotation`：浏览模式图片文字标注，保存相对图片坐标、宽度、高度、文字、字号、颜色和排序；标注完成编辑后不渲染背景或边框，图片删除时级联删除标注。
- `Tag`：可复用自由标签，保存展示名和大小写无关的规范化名称。
- `ChartImageTag`：图片与标签的多对多关联；图片删除时级联删除关联，无图片使用的标签会自动清理。
- `ImportBatch`：一次批量导入任务，保存总数、成功数、失败数、重复数、OCR 进度、状态、开始和结束时间。
- `ImportItem`：导入批次中的单张图片记录，保存原始文件名、相对路径、保存路径、分组、状态、错误和映射索引。
- `AppSetting`：本地设置，目前用于 OCR 并发数等键值配置。
- `ExamPaper`：试卷，支持草稿和发布状态，保存标题、描述、默认选项模板和发布时间。
- `ExamQuestion`：试题，关联已有 `ChartImage`，保存题型、题干、选项、正确答案、解析和遮罩坐标 JSON。
- `ExamAttempt`：一次考试记录，保存开始/提交时间、耗时、正确数、总题数和正确率。
- `ExamAttemptAnswer`：单题作答记录，保存随机题序、用户答案和是否正确。

枚举：

- `ImportBatchStatus`：`DRAFT`、`IMPORTING`、`PROCESSING_OCR`、`COMPLETED`、`COMPLETED_WITH_ERRORS`、`FAILED`
- `ImportItemStatus`：`PENDING`、`IMPORTED`、`DUPLICATE`、`FAILED`
- `OcrStatus`：`PENDING`、`RUNNING`、`COMPLETED`、`FAILED`、`SKIPPED`
- `ExamPaperStatus`：`DRAFT`、`PUBLISHED`
- `ExamQuestionStatus`：`DRAFT`、`READY`
- `ExamQuestionType`：`SINGLE`、`MULTIPLE`
- `ExamAttemptStatus`：`IN_PROGRESS`、`SUBMITTED`

重要约束：

- `ChartImage.hash` 唯一，用 SHA-256 检测重复图片。
- `ChartImage.libraryPath` 唯一，数据库只保存应用图库内的相对路径。
- `ImageAnnotation.chartImageId` 删除级联到 `ChartImage`，标注不会阻止图片删除；但图片被考试题引用时仍禁止删除图片。
- `IndexNode` 在同一父节点下 `name` 唯一。
- 导航分类名称全局大小写无关唯一；导航选项名称在同一分类内大小写无关唯一；节点或选项删除时级联清理关联。
- `ImportItem.chartImageId` 唯一，一张已入库图片最多对应一个导入 item 记录。
- `ExamQuestion` 复用已有 `ChartImage`，不重复上传图片；图片被试题引用时禁止删除，避免发布试卷和历史记录断图。
- 发布后的 `ExamPaper` 内容锁定；修改应通过复制为新草稿等后续能力处理。

## 8. 工作台 UI 行为

`src/app/atlas-workbench.tsx` 是客户端组件，默认中文，支持中英文切换。为了避免 React hydration mismatch，首屏状态使用固定默认值，挂载后再异步读取 `localStorage` 恢复用户偏好。

当前有三种模式：

- 管理模式：导入、创建索引、编辑图片详情、编辑 OCR 文本、单图 OCR、OCR 重试、撤销批次、删除图片、索引右键管理。
- 浏览模式：图片浏览和学习标注，隐藏导入、新建索引、详情保存、OCR 编辑/重试、撤销、删除等管理写操作；允许编辑图片文字标注。
- 考试模式：创建试卷、从图库选图制题、多矩形遮罩、发布考试、随机顺序作答和结果复盘。

需要提示、确认或单行文本输入时统一使用 `src/app/app-dialog.tsx`，不要调用浏览器原生 `alert`、`confirm` 或 `prompt`。统一弹窗支持中英文按钮、`Esc` 取消、`Enter` 提交输入和 `Tab` 焦点循环。

主要布局：

- 左侧：索引树、全部图片入口、语言切换、刷新、侧栏折叠、浏览/管理模式切换。
- 桌面端左侧栏可拖动边缘调整宽度，宽度会写入 `localStorage`，刷新或折叠后重新展开时继续沿用。
- 中间：搜索栏、可折叠索引导航器、导入表格或图库浏览区域、概览、图片网格。
- 右侧：管理模式下的图片详情编辑面板；浏览模式下是大图查看体验。
- 工作台的纵向浏览统一使用浏览器最外侧的页面滚动条，中间内容区不能再建立独立的纵向滚动容器。大图查看器只在图片主动放大、需要查看局部时保留自身滚动。

浏览模式特性：

- 左侧目录 + 右侧图片浏览。
- 顶部搜索可与目录筛选、标签多选筛选组合；多个精确标签使用交集语义。
- 索引导航器可与关键词、标签和具体目录取交集；每个导航分类内单选，不同分类间按 AND。分类、选项和节点关联首次加载后，匹配数、目录结果和零结果置灰均在浏览器本地即时计算，不随每次点击重复请求服务器。
- 选中图片后显示大图查看器。
- 查看器固定高度并可拖动调整，缩放范围 `50%` 到 `220%`。
- 放大后在查看器内部滚动，不撑大整页。
- 图片文字标注可独立显示或隐藏；进入标注编辑后可点击图片添加文字、编辑文字、拖动位置、拖动文本框边框控制点调整宽高、调整字号和颜色、删除标注，修改会防抖自动保存。
- 标注编辑时显示类似 PPT 文本框的边框和缩放控制点；完成编辑后边框和控制点隐藏，只显示文字。
- 图片标注保存为相对图片坐标，不写入原图文件；随缩放、滚动和窗口尺寸变化贴在同一图上位置。
- 图片详情里的 `notes` 备注可在浏览模式大图下方、图片列表上方独立显示或隐藏，类似 PPT 演讲者备注，不覆盖在原图上。
- 鼠标悬停图片时显示左右箭头；箭头 tooltip 提示 `←` / `→` 快捷键。
- 键盘 `ArrowLeft` / `ArrowRight` 可切换上一张/下一张；焦点在输入框、选择框、滑杆等编辑控件时不会触发。
- 下方缩略图网格可隐藏或显示。
- 图片网格使用 420px WebP 缩略图；大图查看器仍读取原图。筛选、目录或分页变化时旧图片 DOM 立即卸载并显示骨架屏，不等待上一批图片下载完成。

管理模式特性：

- 可以选择图片或文件夹导入。
- 单击图片卡片仍只选择图片并显示右侧详情；双击图片或点击卡片、右侧预览上的放大按钮，可以进入中央大图工作区。
- 管理模式中央大图会暂时替换概览和缩略图网格，同时保留右侧详情编辑；支持缩放、调整查看器高度、左右切图和图片文字标注，返回网格时恢复原有筛选、分页、选中图片和滚动位置。
- 管理大图中切换图片前会自动保存尚未提交的标题、标签、索引、备注、OCR 文本和图片文字标注；保存失败时停留在当前图片并提示错误。
- 导入图片、文件夹或资料时可以选择是否在导入后 OCR；默认不 OCR，导入图片会标记为 `SKIPPED`。
- 可以通过“导入资料”导入 PDF；系统会按 PDF 文件名创建容器索引，按内置书签目录创建子索引，并把每页转换后的 PNG 图片挂到对应节点。
- 备份与下载分为两步：生成的 zip 会先持久保存到服务器备份列表，列表展示时间、大小和图片数，用户之后可以单独下载或逐条删除。
- 备份 zip 包含所有索引、图片文件、标题、备注、图片文字标注、OCR 文本和 OCR 状态等元数据。
- 可以导入备份 zip 进行恢复；恢复使用合并覆盖模式，相同 SHA-256 hash 的图片更新元数据和索引归属，不创建重复图片，也不删除当前系统里备份外的数据。
- 索引导航器仅管理模式可编辑；支持分类/选项增删改排序、树形批量配置节点，以及从索引树右键编辑单节点属性。批量配置勾选或取消父节点时会同步作用于全部后代，部分后代选中时父节点显示半选状态。
- 可以创建当前选中索引下的新子索引。
- 图片详情支持编辑标题、备注、所属索引。
- 图片详情支持动态添加和移除标签，点击保存后与其他详情一起落库。
- 图片网格支持复选框跨页选择；筛选条件或页面模式变化时清空选择，批量标签工具栏可以为选中图片添加或移除标签。
- 标签输入、顶部标签多选筛选器和批量移除标签选择器使用应用内自绘菜单，不依赖浏览器原生 `datalist` / `select`；支持已有标签过滤、方向键选择和回车确认，标签输入仍支持自由输入。
- 支持删除单张图片，删除前必须二次确认。
- OCR 文本可在图片详情面板手动编辑并保存；保存非空文本会把状态设为 `COMPLETED`，清空文本会把状态设为 `SKIPPED`。
- 单张图片可从详情面板手动执行 OCR；如果已有 OCR 文本，前端会先确认覆盖。OCR 失败可重试。
- 最近导入批次可撤销，撤销前必须二次确认。
- 概览区可折叠。
- 图片网格使用服务端分页，页面大小支持 `25 / 50 / 100 / 200`；管理大图可跨页连续切换，跨页勾选最多 1000 张。

考试模式特性：

- 用户可以创建试卷草稿，并从现有图库分页搜索图片加入试卷。
- 新建试卷按钮是下拉菜单，可选择创建新试卷或导入试卷 JSON。
- 试卷列表支持右键菜单拷贝试卷；拷贝结果是可继续编辑的草稿，只复制试题，不复制历史考试记录。
- 已发布试卷右键菜单支持导出试卷；导出的 JSON 不包含图片文件，只包含每题引用的图片 hash、原文件名和索引路径。导入时当前图库必须已有对应 hash 的图片。
- 每张图片对应一道选择题；题目可设为单选题或多选题，并保存题干、选项、正确答案、可选解析和遮罩坐标。
- 遮罩支持多个不透明矩形，保存为相对图片显示区域的 `0..1` 坐标和颜色 JSON，不生成新图片；默认颜色为黑色，已绘制矩形可选中、拖动和拉角缩放。
- 试卷级默认选项模板会用于新题；单题可以自定义选项。
- 发布前所有题目必须处于 `READY`；题干、选项、正确答案和遮罩必填，解析可不填；单选题需要 1 个正确答案，多选题需要至少 2 个正确答案；发布后试卷和题目内容锁定。
- 已就绪题目修改后保存，如果内容确有变动且保存成功，会弹出“修改成功”提示；保存后变成草稿时仍提示缺失字段。
- 开始考试时后端随机题目顺序，选项顺序固定。
- 考试和结果复盘使用紧凑的左右翻页单题视图，支持按钮和键盘 `ArrowLeft` / `ArrowRight` 切换题目；作答图片支持缩放，放大后可拖拽查看局部，底部把手可调整看图窗口高度。
- 提交后保存本次考试记录，包含每题答案、是否正确、作答耗时、正确数、总题数和正确率；多选题按选项顺序规范化后评分，点击顺序不影响判分。
- 已发布试卷详情会展示最近考试记录，点击记录可进入历史结果复盘。
- 结果页展示正确率、用户答案、正确答案、解析，并支持只看错题；考试提交后可隐藏/显示遮罩以查看原图。

## 9. 索引树管理

索引树支持无限层级。`IndexNode.path` 使用 ` / ` 拼接祖先名称，重命名节点时会同步更新后代路径。

左侧索引树行为：

- 默认全部展开。
- 有子节点的索引前方有箭头，点击箭头可展开或收起子索引。
- 点击索引名称区域会选中索引并筛选图片。
- 从关键词搜索结果选择有归属索引的图片时，会保留关键词，只用青色浅底定位图片所属索引、展开其祖先节点，并把该节点滚动到左侧可见区域，不把定位节点叠加为筛选条件；黑底节点仍表示实际索引筛选。搜索框内会出现“查看此栏目全部图片”操作，点击后才清空关键词并切换到该索引；未分类图片保持当前定位和筛选状态。
- 展开/收起状态会写入 `localStorage`，刷新页面后继续沿用上次折叠的节点。
- 左侧树上显示的数量是当前节点及其所有后代节点的图片汇总数；后端用直接图片数 groupBy 后在内存树上后序汇总，避免逐节点数据库查询。

管理模式下，索引树节点支持右键菜单：

- 重命名索引。
- 删除索引：只有当前索引及其后代下面没有图片时才能操作；后端也会重新校验。
- 清空当前索引及其后代下面的所有图片：确认弹窗要求用户输入 `确认删除` 后才会执行。

删除说明：

- 删除索引只删除数据库索引节点，不删除文件。
- 清空图片会逐张删除图库文件和数据库记录。
- 任何文件删除都必须保持逐个明确路径删除，不能批量删除目录。

## 10. 导入流程

前端入口：

- `选择图片`：普通多选文件，`accept="image/*"`。
- `选择文件夹`：使用 `webkitdirectory`/`directory`。文件夹导入不能只依赖 MIME 类型，因为部分浏览器或系统会给空 MIME；前端和后端都会按扩展名识别图片。

支持图片扩展名：

- `.jpg`
- `.jpeg`
- `.png`
- `.webp`
- `.gif`
- `.bmp`
- `.tif`
- `.tiff`

前端导入表格：

- 选中文件后生成 `SelectedFile`，包含 `id`、`file`、`relativePath`、`groupKey`、`previewUrl`。
- 表格列为显示名称、所属索引、缩略图。
- 所属索引来自全部索引；默认值是左侧当前选中索引路径，未选索引时默认未分类。
- 缩略图可点击打开大图预览弹窗。
- 表格分页支持每页 `10 / 25 / 50 / 100`。
- 表格高度可拖动调整并写入 `localStorage`。
- 导入时提交全部已选图片，不只提交当前页。

上传规则：

- 前端每批上传 `80` 张，避免单次请求过大。
- 每张图片提交 `files`、`relativePaths`、`groupKeys`、`indexPaths`。
- `indexPaths` 是逐文件索引路径，JSON 数组格式，例如 `["1", "2", "2131"]`。
- `ocrEnabled` 是导入批次级开关，字符串 `"true"` 表示新图片入 OCR 队列；缺省或 `"false"` 表示新图片标记为 `SKIPPED`。
- 后端仍兼容旧的 `assignments: Record<string, string[]>` 作为 group fallback。

后端导入：

- `POST /api/import` 接收 `multipart/form-data`。
- `isSupportedImage()` 同时支持 MIME 类型和扩展名判断。
- `ensureIndexPath()` 会自动创建不存在的索引路径。
- 用 SHA-256 hash 检测重复图片；重复项记录为 `DUPLICATE`，默认不新增 `ChartImage`。
- 新图片保存到图库目录并创建 `ChartImage` 与 `ImportItem`。
- 每个 chunk 完成后更新 `ImportBatch`；只有 `ocrEnabled` 为 `"true"` 时才触发 `scheduleOcrPump()`。

资料导入：

- `POST /api/import/documents` 接收 `multipart/form-data`，字段 `file` 为资料文件，`baseIndexPath` 为 JSON 字符串数组，`ocrEnabled` 为可选 OCR 开关；这是兼容用同步接口。
- 前端默认使用 `POST /api/import/documents/jobs` 启动后台导入任务，并轮询 `GET /api/import/documents/jobs/[id]` 显示页级进度。
- 当前只注册 PDF importer；后续支持 PPT 等类型时应新增 importer，不要把入口改回某个具体格式名称。
- PDF importer 使用 PDF 内置 outline/bookmarks 作为目录来源，不做正文目录页 OCR 识别。
- 未选中索引时在根节点创建 PDF 文件名容器；选中索引时在该索引子树下创建 PDF 文件名容器。
- 有书签时按书签层级创建子索引；没有书签或页面未命中书签时，页图片挂到 PDF 容器节点。
- 每页默认最多以 1.8 倍渲染，最长边限制为 1920px，并用 JPEG 初始质量 84 输出；编码会先降质量、必要时再缩放，默认以 500KB 作为单页图片上限，常规页面保持长边约 1080px 以上，极复杂页面会继续压缩以满足体积上限。之后复用 `importImageBuffer()` 入库，继续使用同一套图库保存、SHA-256 去重、`ImportBatch`、`ImportItem`、可选 OCR、备份和撤销逻辑。
- PDF 转图片和导入并发参数可通过环境变量调整：`BROOKS_PDF_RENDER_SCALE`、`BROOKS_PDF_MAX_IMAGE_EDGE`、`BROOKS_PDF_JPEG_QUALITY`、`BROOKS_PDF_MAX_IMAGE_BYTES`、`BROOKS_PDF_IMPORT_CONCURRENCY`。并发默认 `2`，范围 `1-4`。
- 单页渲染失败只创建该页 `FAILED` 导入项，其他页继续处理。

## 11. 图片列表、分页和排序

`GET /api/atlas` 使用服务端分页。为保持 `1.jpg`、`2.jpg`、`10.jpg` 的全库自然数字顺序，服务端先查询匹配图片的轻量字段，使用 `Intl.Collator` 全局排序并截取当前页，再查询该页完整详情。

考试模式选图使用 `GET /api/images?q=&indexId=&page=&pageSize=`，支持分页查询，不受 `/api/atlas` 200 张返回上限影响；关键词搜索也会匹配标签名称。

工作台图片网格分页：

- 默认每页 `50` 张。
- 可选每页 `25 / 50 / 100 / 200`。
- 切换搜索、索引、模式或每页数量时回到第一页。
- 管理模式可跨页勾选图片，最多 `1000` 张；图片大图查看器在当前页首尾可自动加载相邻服务端页。

## 12. 图片存储规则

- 默认图库根目录是 `data/library/images`。
- 环境变量 `BROOKS_LIBRARY_ROOT` 可以覆盖图库根目录。
- 新图片保存到 `data/library/images/YYYY-MM/`。
- 缩略图默认保存到 `data/library/thumbnails/v1/<hash前2位>/<hash>.webp`，可用 `BROOKS_THUMBNAIL_ROOT` 覆盖缩略图根目录。
- 当前缩略图规格为最长边 420px、WebP quality 72、自动旋转且不放大小图。缩略图是可重建缓存，不写数据库、不进入备份；算法变化时升级版本目录和前端 `v` 参数。
- 保存文件名格式是 `清洗后的原名-hash前16位.ext`，例如 `1-a1b2c3d4e5f6a7b8.jpg`。hash 放在原名后面，避免破坏按原始名称排序。
- 浏览器原始硬盘路径不能直接入库，只能保存上传后的应用内相对路径。
- `absoluteImagePath()` 会校验图片路径必须在图库根目录内，避免任意文件读取。

## 13. OCR 规则

- OCR 默认不随导入自动执行；导入开关开启时，新图片以 `PENDING` 状态入库并通过 `scheduleOcrPump()` 异步触发。
- 导入开关关闭时，新图片以 `SKIPPED` 状态入库，不进入 OCR 队列。
- 默认 OCR 命令是 `tesseract`。
- 可用环境变量 `BROOKS_OCR_COMMAND` 指定 OCR 命令。
- 当前调用参数：`<command> <imagePath> stdout -l <language>`。
- 默认识别语言是简体中文加英文 `chi_sim+eng`。
- 可用环境变量 `BROOKS_OCR_LANG` 指定 Tesseract 语言组合，例如 `eng`、`chi_sim+eng` 或其他已安装语言包。
- 可用环境变量 `BROOKS_TESSDATA_DIR` 指定 Tesseract language data 目录；适合 Windows 上不写入 `Program Files`、改用项目本地 `data/tessdata` 的部署方式。
- 默认并发数为 CPU 核心数一半，限制在 `2` 到 `4`。
- `AppSetting` 的 `ocr.concurrency` 可覆盖并发数，最大 `8`。
- 单张 OCR 超时为 `120_000ms`，stdout buffer 上限为 `8MB`。
- OCR 失败时图片进入 `FAILED`，错误写入 `ocrError`，前端可重试。
- 用户可以在图片详情面板编辑 OCR 文本；非空保存会将状态设为 `COMPLETED`，清空保存会将状态设为 `SKIPPED`。
- `queueImageOcr(imageId)` 可把单张图片重新设为 `PENDING` 并调度 OCR，适用于 `SKIPPED`、`FAILED` 或已有结果的图片。
- `retryFailedOcr(imageIds?)` 会把失败图片重置为 `PENDING` 并重新调度。

README 已补充 Windows、Linux/macOS 下的 OCR 命令和安装示例。

## 14. API 行为

`GET /api/atlas`

- 参数：`scope`、`q`、`indexId`、`tagId`、`navigatorOptionId`、`page`、`pageSize`；`tagId` 和 `navigatorOptionId` 可重复传递。
- `scope=images` 只执行筛选并返回当前页图片和分页；筛选、翻页的前端热路径必须使用此 scope，不能重复返回索引树。
- `scope=metadata` 只返回索引树、标签、最近导入批次和统计，不执行图片筛选；默认 `scope=all` 保持完整响应兼容。
- 客户端声明接受 gzip 时，路由会直接压缩 JSON 并设置 `Content-Encoding: gzip` 和 `Vary: Accept-Encoding`，不依赖反向代理是否为 Route Handler 开启压缩。
- 响应包含 `Server-Timing`，分别记录导航节点解析、图片分页、元数据和总耗时，供云端性能诊断。
- 索引筛选包含所选节点及其后代路径。
- 搜索覆盖 `originalName`、`title`、`notes`、`ocrText`、图片文字标注、`indexNode.path` 和标签名称。
- 参数 `tagId` 可叠加精确标签筛选条件；重复传递多个 `tagId` 时按 AND 组合，只返回同时包含全部所选标签的图片。
- 导航选项每个分类内单选、不同分类间按 AND；动态匹配目录数和零结果禁用由前端基础数据本地计算。`scope=images` 只使用已选导航条件筛选图片；目录匹配只检查节点直接关联，匹配节点的全部后代图片会纳入结果并去重。
- OCR 文本和错误会截断返回，避免接口太大。

`GET /api/index-navigator`

- 返回分类、选项、关联节点数量，以及扁平的 `{ indexNodeId, optionId }` 节点关联；不接收筛选条件，也不在服务器计算动态匹配数或目录分页。
- 前端只在首次加载、导航配置变更或完整刷新后读取该接口；选项匹配数、跨分类 AND、目录搜索、自然排序和分页由 `src/lib/index-navigator-client.ts` 本地计算。
- 分类、选项 CRUD 和排序使用 `/api/index-navigator/categories`、`/api/index-navigator/options`。
- `GET/POST /api/index-navigator/assignments` 读取节点关联，`PATCH` 批量修改关联；单次最多 `1000` 个节点。前端选择超过 1000 个节点的子树时会自动分批读取和提交。

`GET /api/images/[id]/thumbnail?v=1`

- 优先返回已有 WebP 缓存，缺失时从原图按需生成；同一 Node.js 进程内相同 hash 的并发生成会合并。
- 返回版本化 `ETag`、支持 `If-None-Match` / `304`，并设置一年 `private, immutable` 缓存。大图和标注仍使用 `/api/images/[id]/file` 原图接口。

`POST /api/maintenance/thumbnails/jobs`

- 启动已有图库的缺失缩略图补齐任务；同时只运行一个任务，已有任务运行时返回 `reused: true`。
- 任务按 200 张分页读取、默认并发 1，`BROOKS_THUMBNAIL_CONCURRENCY` 可设为 `1` 或 `2`。每 25 张或最多每秒把状态原子写入 `data/library/thumbnail-jobs/`。
- `GET /api/maintenance/thumbnails/jobs` 返回最近任务；`GET /api/maintenance/thumbnails/jobs/[id]` 返回指定任务。重启后的运行中任务会标记为 `interrupted`，再次 POST 会新建续跑任务并通过跳过已有文件继续。
- 维护接口没有应用层鉴权。公网部署必须通过反向代理、内网监听或安全组限制访问，不要直接暴露给不可信客户端。

`GET /api/backups/export`

- 导出 `brooks-pa-atlas-backup-YYYYMMDD-HHmmssZ.zip`。
- 备份图片、导航关联和分类使用固定大小分页查询；按索引子树导出时通过索引关系和路径前缀筛选，避免大型图库触发 SQLite 查询参数上限。
- zip 顶层包含 `manifest.json` 和 `images/<hash>.<ext>` 图片文件。
- manifest 格式为 `brooks-pa-atlas.backup` v5，保存索引树、导航分类/选项/节点关联、图片元数据、标签、图片文字标注、试卷、题目、考试记录和 zip 内相对图片路径；恢复仍兼容 v1–v4。
- 不保存 Windows 或 Linux 绝对路径，便于跨部署环境恢复。
- 导出前会校验数据库中每张图片的图库文件存在；如果缺失则返回错误，不生成不完整备份。
- 后台导出任务的百分比在图片校验阶段保持为 `0%`，进入 zip 打包后按实际已读取图片字节数递增，完成后才到 `100%`；前端打包阶段同步显示“已处理字节 / 总字节”，不再把图片校验数量误当成整体备份进度。
- 后台导出把 zip 流和小型 JSON 元数据文件写入 `data/library/backups/`，不把完整备份保存在 Node.js 内存；完成后的文件不会随后台任务过期而删除，会一直保留到用户在备份列表中明确删除。
- `GET /api/backups/records` 返回持久备份列表；`GET/HEAD /api/backups/records/[id]` 从磁盘流式下载并支持 HTTP Range；`DELETE /api/backups/records/[id]` 逐个明确路径删除该记录的 zip 和 JSON 元数据文件。旧的任务下载路由继续兼容。
- 全量备份包含考试和全部导航数据；按索引子树导出时只导出该子树索引、图片、节点导航关联及实际引用的分类/选项，不导出试卷。

`POST /api/backups/restore?mode=merge`

- 大文件恢复接收以 zip 文件作为原始 request body 的请求；前端和后台任务接口不使用 `request.formData()` / `arrayBuffer()`。`multipart/form-data` 会返回 `415`，避免整份 zip 被框架解析到内存。
- 目前只支持 `merge` 合并覆盖模式。
- 上传内容先流式写入单个临时 zip，恢复结束后再按明确路径删除；zip 内图片逐条流式解压、计算 SHA-256 和写入临时文件，不按图片或整包创建大 Buffer。manifest 单独读取并限制为 64MB，因此主要内存占用不随 zip 文件总大小增长。
- 恢复前校验 zip entry，拒绝绝对路径、反斜杠、`.`、`..` 和 manifest 未声明的文件。
- 按 manifest 深度恢复索引；已存在同父节点同名索引时复用并更新路径、深度和排序。
- 按 SHA-256 hash 恢复图片；相同 hash 更新元数据和索引归属，不创建重复图片。
- 如果相同 hash 的数据库记录存在但图库文件丢失，会从备份重新写入当前环境图库目录并更新 `libraryPath`。
- 不删除当前系统中备份外的索引、图片或文件；不恢复旧 `ImportBatch` / `ImportItem` 历史。
- v2–v5 恢复会通过图片 SHA-256 hash 重新映射试题图片；缺失图片时拒绝恢复对应考试数据，避免断开的题目引用。
- v3–v5 恢复会覆盖备份内图片的标签；恢复旧版 v1 / v2 备份时保留当前系统中已有图片的标签。
- v4–v5 恢复会覆盖备份内图片的文字标注；恢复旧版 v1–v3 备份时保留当前系统中已有图片的文字标注。
- v5 导航恢复在事务内按规范化名称合并分类和选项，并以备份内容覆盖备份内节点的关联；备份外数据不删除。恢复 v1–v4 时保留目标系统现有导航数据。

考试 API：

- `GET /api/exam/papers`：列出试卷。
- `POST /api/exam/papers`：创建试卷草稿。
- `POST /api/exam/papers/import`：从导出的轻量 JSON 创建草稿试卷；只按图片 hash 复用当前图库图片，不导入图片文件。
- `GET /api/exam/papers/[id]`：读取试卷详情和题目。
- `PATCH /api/exam/papers/[id]`：更新草稿试卷。
- `DELETE /api/exam/papers/[id]`：删除草稿或已发布试卷；已发布试卷会一并删除相关考试记录和答案。
- `POST /api/exam/papers/[id]/copy`：把试卷拷贝为新草稿，复制题目、题型、选项、正确答案、解析和遮罩，不复制考试记录。
- `GET /api/exam/papers/[id]/export`：导出已发布试卷 JSON；只保存图片索引，不包含图片文件或考试记录。
- `POST /api/exam/papers/[id]/questions`：把现有图片加入草稿试卷。
- `GET /api/exam/papers/[id]/attempts`：列出该试卷最近考试记录。
- `PATCH /api/exam/questions/[id]`：保存题目草稿、题型、选项、答案、可选解析和遮罩；`questionType` 支持 `SINGLE` 和 `MULTIPLE`。
- `DELETE /api/exam/questions/[id]`：从草稿试卷移除题目。
- `POST /api/exam/papers/[id]/publish`：发布全部题目已就绪的试卷。
- `POST /api/exam/attempts`：为已发布试卷创建一次考试，后端随机题序。
- `GET /api/exam/attempts/[id]`：读取考试或结果。
- `POST /api/exam/attempts/[id]/submit`：提交答案并保存评分；多选答案可传字符串数组，后端会按选项顺序规范化后比较。

`POST /api/import`

- 创建或复用 `ImportBatch`。
- 支持逐文件 `indexPaths` 和旧式 `assignments`。
- 支持 `ocrEnabled` 表单字段；`"true"` 时新图片自动进入 OCR 队列，缺省或 `"false"` 时新图片状态为 `SKIPPED`。
- 写入图库文件、`ChartImage`、`ImportItem`。
- 更新批次计数；只有开启 OCR 时才调度 OCR。

`POST /api/import/documents`

- 通用资料导入接口，当前支持 PDF。
- 接收 `multipart/form-data`：`file` 为资料文件，`baseIndexPath` 为选中索引路径数组，`ocrEnabled` 为导入后是否自动 OCR。
- PDF 会先创建 PDF 文件名容器索引，再按内置书签目录创建子索引。
- 每页转换为 JPEG 图片后按普通图库图片入库；只有开启 OCR 时才调度 OCR。
- 相同 SHA-256 hash 的页图片记录为 `DUPLICATE`，不创建重复 `ChartImage`。

`POST /api/import/documents/jobs`

- 启动资料导入后台任务，接收字段与同步资料导入接口一致，包括 `ocrEnabled`。
- 返回 `{ job }`，job 包含 `id`、`status`、`processedPages`、`totalPages`、`imported`、`failed`、`duplicate`、`batchId` 和 `error`。
- 任务状态保存在当前 Node.js 进程内存中，TTL 为 30 分钟；开发服务器重启后未完成任务状态会丢失。

`GET /api/import/documents/jobs/[id]`

- 查询资料导入后台任务进度。
- 前端每 600ms 轮询一次，完成后刷新工作台数据。

`POST /api/import/[id]/undo`

- 撤销某个导入批次。
- 逐个 `unlink` 删除该批次新增图片文件，忽略 `ENOENT`。
- 然后删除对应 `ImportItem`、`ChartImage`、`ImportBatch`。
- 前端调用前必须弹窗确认。

`GET /api/index-nodes`

- 返回索引树。

`POST /api/index-nodes`

- 创建索引节点；`parentId` 为空时创建根节点。

`PATCH /api/index-nodes`

- 更新节点名称和 `sortOrder`。
- 重命名会同步更新后代 `path`。

`DELETE /api/index-nodes`

- 请求体传 `id`。
- 删除某个索引节点及其后代节点。
- 只有该节点及其后代下没有图片时才能删除。
- 后端会校验图片数量，前端禁用按钮只是体验层保护。

`POST /api/index-nodes/[id]/clear-images`

- 清空某个索引节点及其后代下的所有图片。
- 请求体必须包含 `confirmation: "确认删除"`。
- 后端逐张删除图库文件，再删除对应数据库记录。

`GET /api/images/[id]`

- 返回单张图片完整详情，包含完整 `ocrText` 和图片文字标注，供详情面板和浏览模式标注使用。
- `/api/atlas` 为了控制响应体大小仍只返回 OCR 摘要。

`PATCH /api/images/[id]`

- 更新标题、备注、所属索引、标签和 OCR 文本。
- 传入 `ocrText` 时，非空文本会把图片状态设为 `COMPLETED`，清空文本会把图片状态设为 `SKIPPED`，并清空 `ocrError`。

`PUT /api/images/[id]/annotations`

- 替换保存单张图片的文字标注数组。
- 标注字段包括 `text`、相对图片坐标 `x/y`、相对尺寸 `width/height`、`fontSize`、`color` 和 `sortOrder`；背景色会被保存逻辑清空，前端仅在编辑时渲染文本框边框。
- 后端限制单图最多 100 条标注、单条文字最长 500 字，并校验坐标、字号和十六进制颜色。

`PATCH /api/images/tags`

- 批量给指定图片添加或移除标签。
- 添加使用并集语义，移除只删除指定标签关联，不覆盖图片上的其他标签。

`DELETE /api/images/[id]`

- 删除单张图片。
- 后端逐个明确路径删除对应图库文件，忽略 `ENOENT`，然后删除数据库记录。
- 前端调用前必须弹窗确认。

`GET /api/images/[id]/file`

- 读取本地图库文件并返回图片响应。
- 必须保持 `runtime = "nodejs"`。
- 返回 `Content-Type`、`Content-Length`、`Cache-Control: private, max-age=3600`。

`POST /api/ocr/retry`

- 重试失败 OCR；传 `imageIds` 时只重试指定图片，不传则重试所有失败图片。

`POST /api/ocr/images/[id]`

- 将单张图片放回 OCR 队列，可用于跳过、失败或已有 OCR 文本的图片。
- 如果图片已有 OCR 文本，前端必须先确认覆盖；OCR 完成后会用新识别结果覆盖 `ocrText`。

## 15. 本地偏好键

工作台使用以下 `localStorage` key：

- `brooks-pa-atlas.locale`：语言，`zh` 或 `en`。
- `brooks-pa-atlas.sidebar`：侧栏折叠状态。
- `brooks-pa-atlas.overview`：概览折叠状态。
- `brooks-pa-atlas.viewMode`：`browse`、`manage` 或 `exam`。
- `brooks-pa-atlas.collapsedIndexes`：左侧索引树已折叠节点 id 列表。
- `brooks-pa-atlas.imageGridPageSize`：管理模式图片网格每页数量。
- `brooks-pa-atlas.viewerHeight`：浏览模式大图查看器高度。
- `brooks-pa-atlas.examViewerHeight`：考试模式作答/结果看图窗口高度。
- `brooks-pa-atlas.browseThumbnails`：浏览模式缩略图显隐。
- `brooks-pa-atlas.browseAnnotations`：浏览模式图片文字标注显隐。
- `brooks-pa-atlas.browseNotes`：浏览模式图片备注区域显隐。
- `brooks-pa-atlas.importTableHeight`：导入表格高度。

## 16. 实现注意事项

- 不要把图片 blob 写入数据库。
- 不要直接引用浏览器用户硬盘原始路径。
- 备份 manifest 只能保存 zip 内相对路径和业务元数据，不要写入 Windows/Linux 绝对路径。
- 恢复备份时必须使用当前环境的图库根目录写入图片，不能复用备份来源系统的本地路径。
- 恢复备份必须保持合并覆盖语义，不要为了“完全一致”而批量删除现有数据。
- zip 恢复必须保持 zip-slip 防护，拒绝绝对路径、反斜杠路径、`.`、`..` 和 manifest 未声明文件。
- 文件读取和本地文件操作路由必须保持 `runtime = "nodejs"`。
- 涉及本地图片路径时优先使用 `absoluteImagePath()`。
- 任何删除文件的代码都必须逐个明确路径删除，不能批量删除目录。
- 删除图片、撤销导入批次或清空索引图片前，后端必须校验图片是否被 `ExamQuestion` 引用；被引用时应拒绝删除。
- 高风险写操作需要二次确认；清空索引图片必须要求用户输入 `确认删除`。
- 浏览模式除图片文字标注自动保存外，不要暴露导入、详情保存、OCR 编辑/重试、撤销、删除等管理写操作。
- 读取 `localStorage` 的用户偏好不要放进 `useState` lazy initializer，否则可能再次造成 hydration mismatch；应在挂载后恢复偏好。
- `src/generated/prisma` 是生成目录，不要手改。
- `dev.db`、`data/library`、`.next`、`node_modules` 和运行日志不应作为功能代码修改。
- 修改 Next.js App Router、Route Handler、缓存、图片处理等能力前，先读 `node_modules/next/dist/docs/` 中相关文档。

## 17. Git 和分支状态

仓库远程：

```text
https://github.com/AAACHainn/brooks-pa-atlas.git
```

当前已使用的主要分支：

- `main`：主干分支。
- `V1-release`：第一个正式版本分支。

最近维护中曾将 `main` 同步到 `V1-release`，两个远程分支在当时保持一致。继续工作前仍应以 `git status --short --branch` 和 `git log --oneline --decorate -5` 确认当前状态。

## 18. 已知限制和后续方向

- `/api/atlas` 已使用服务端分页，但为保持全库自然数字排序，每次仍会读取全部匹配图片的轻量排序字段；极大图库可后续考虑持久化自然排序键。
- 搜索由数据库 `contains` 完成，后续可考虑全文索引或更强搜索。
- OCR 默认使用 `chi_sim+eng` 中英混合识别；部署机器需要安装对应 Tesseract 语言包，或用 `BROOKS_OCR_LANG` 改成已安装语言组合。
- 索引节点支持创建、重命名、删除空索引、清空图片、展开/收起和 `sortOrder` 字段更新，但尚未实现拖拽移动和完整排序 UI。
- 图片详情支持单张编辑和删除，尚未支持已导入图片的批量编辑。
- 导入表格支持逐文件索引选择，但尚未支持批量套用某一索引到当前页或全部选中项。
- README 已更新为真实启动和基础使用说明，但更细的开发维护说明仍以本文件为准。
