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
- 当前不做登录或云同步；AI 能力包括 OCR 精校、图片阅读伴侣和独立资料 RAG 知识库（字幕及 TXT/Markdown）。

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
- `next.config.ts` 通过 `outputFileTracingIncludes` 把 `pdf.worker.mjs` 纳入两个 PDF 导入路由的 standalone 产物；不要移除此配置，否则 Docker 精简运行镜像会在运行时解析 worker 失败。
- `@napi-rs/canvas` 在 Node.js 中渲染 PDF 页面
- `yazl`、`yauzl` 用于跨平台 zip 备份和恢复
- `zod`、`xlsx`、`fuse.js` 已作为依赖存在，其中部分能力还不是核心路径

Prisma 7 运行时代码需要显式 driver adapter。本项目在 `src/lib/db.ts` 中用 `PrismaBetterSqlite3` 初始化 `PrismaClient`，Prisma Client 输出目录是 `src/generated/prisma`。

## 4. 常用命令

```powershell
npm run dev
npm run lint
npm run build
npm run test:annotations
npm run test:navigator
npm run test:search
npm run test:thumbnails
npm run test:ocr
npm run test:ai
npm run test:ai-robot
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
- `npm run test:annotations` 运行图片文字标注草稿焦点、空文本保存和颜色面板规则测试。
- `npm run test:navigator` 运行导航本地匹配数、跨分类 AND、目录搜索和自然排序单元测试。
- `npm run test:search` 运行图片关键词搜索的字面量匹配测试，确保 `%`、`_` 和反斜杠不会被当作通配符。
- `npm run test:thumbnails` 运行缩略图路径、缓存、尺寸、并发合并和图片查询键测试。
- `npm run test:ocr` 运行索引子树批量 OCR 的文本判断、终态和进度计算测试。
- `npm run test:ai` 运行 AI 配置、密钥脱敏、端点 URL、模型发现、流式响应、多模态 Chat Completions，以及伴读快速/深度模式、预算装载、接口保存和取消测试；也覆盖窗口按帧合并、流式草稿合并/清理和输入法回车保护；接口测试使用隔离数据库、图库和模拟端点。此命令还包含 `test:ai-tools` 和 `test:ai-robot`。
- `npm run test:ai-robot` 运行独立机器人会话、真实只读工具、历史分页、配置兼容、取消/禁用/清空/删除保护和流式窗口 helper 测试；使用隔离数据库、模拟模型及 `react-server` 条件。
- `npm run test:ai-tools` 单独运行结构化模型响应、工具流式参数组装、只读注册/授权、多轮执行、取消/预算/超时、能力探测及真实系统工具的隔离测试；使用 `react-server` 条件加载 `server-only` 模块，仅机器人专用入口显式开放白名单工具。
- `npm run test:knowledge` 运行字幕格式/时间码解析、AI cue 覆盖、顺序、长度比例、窗口、片段时间范围、深度候选召回与章节分页读取测试。
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
- `src/app/app-settings-dialog.tsx`：可扩展的全局设置弹窗，当前提供 AI 端点和内置技能配置。
- `src/app/ai-robot.tsx` / `src/app/ai-robot-floating.tsx`：工作台全部模式共用的独立 AI 机器人、可拖动入口与窗口、多会话和工具状态展示。
- `src/app/ai-robot-icon.tsx`：机器人入口与窗口共用的圆润机器人 SVG 标识；悬浮入口采用青蓝半透明渐变背景，图标保持实色。
- `src/lib/ai-robot-service.ts` / `src/lib/ai-robot-runs.ts` / `src/lib/ai-robot-types.ts` / `src/lib/ai-robot-ui.ts`：机器人专用服务、运行互斥/取消、DTO、NDJSON 和窗口 helper。
- `src/app/ai-reading-companion.tsx`：浏览模式 AI 阅读伴侣悬浮窗，负责全局多会话、流式消息、拖动和收起交互。
- `src/lib/reading-companion-ui.ts`：伴侣窗口按帧合并、流式文字合并和输入法回车保护 helper。
- `src/app/knowledge-manager-dialog.tsx`：资料知识库导入、类型确认、节点映射、人工审核、版本管理、维护和检索测试弹窗。
- `src/app/index-tree-selector.tsx`：工作台详情与资料知识库共用的树形索引选择器，支持层级展开、路径搜索和键盘选择；不要再用平铺的原生下拉框复制索引选择逻辑。
- `src/app/knowledge-import-progress.tsx`：字幕导入的文件级、AI 窗口级和 Embedding 批次级进度展示，包含耗时、预计剩余时间、慢响应和疑似停滞提示。
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
- `src/app/api/ocr/index-nodes/[id]/batch/route.ts`：读取索引子树 OCR 统计并启动持久化批量 OCR 任务。
- `src/app/api/ocr/jobs/**/route.ts`：恢复和查询批量 OCR 任务进度。
- `src/app/api/settings/ai/**/route.ts`：读取/保存脱敏 AI 设置、拉取模型和测试兼容端点。
- `src/app/api/ai/ocr-refine/route.ts`：读取原图并调用 AI 精校当前 OCR 草稿，不直接保存结果。
- `src/app/api/ai/reading-companion/**/route.ts`：阅读伴侣会话、分页消息、清空、删除和 NDJSON 流式对话接口。
- `src/app/api/knowledge/**/route.ts`：字幕映射预览、持久化导入任务、审核、文档版本、维护与混合检索接口。
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
- `src/lib/ocr-batch-jobs.ts`：索引子树批量 OCR 的任务快照、确认校验、恢复和进度统计。
- `src/lib/ai-config.ts`：版本化 AI 配置 schema、默认技能、密钥合并/脱敏和端点 URL 解析。
- `src/lib/ai-client.ts`：OpenAI-compatible 模型发现、非流式与 SSE 流式 Chat Completions 客户端。
- `src/lib/ai-model-types.ts`：与供应商协议分离的结构化消息、调用、单轮结果与流式事件类型；`ai-client.ts` 负责协议序列化和解析，原文本接口保持兼容。
- `src/lib/ai-tool-registry.ts` / `src/lib/ai-tool-runtime.ts`：仅服务端的 Zod 工具注册、白名单/资源范围、串行多轮执行、预算/取消/超时及结构化记录；不提供公开执行 API。
- `src/lib/ai-system-tools.ts` / `src/lib/ai-tool-probe.ts`：正式内部图片资料/索引只读工具及仅显式调用的无副作用能力探测，已通过独立 AI 机器人显式接入；伴读、OCR 和资料流程不启用工具。
- `docs/AI_TOOL_ARCHITECTURE.md`：工具基础设施接口、注册、资源授权、运行限制、记录扩展及兼容约束。
- `src/lib/ai-ocr-refinement.ts`：精校图片压缩、多模态消息构造和 OCR 精校调用。
- `src/lib/ai-reading-companion.ts` / `src/lib/ai-reading-context.ts`：阅读伴侣上下文窗口、图片资料快照、多模态消息和服务端图片上下文查询。
- `src/lib/ai-deep-reading.ts`：伴读深度流程编排、保守 Token 估算、调用预算、范围定位、覆盖约束、排序、分批阅读笔记和引用校验。
- `src/lib/knowledge-deep-search.ts`：启用且绑定有效的资料目录、深度多通道候选召回和有序章节分页读取；知识库检索测试入口仍使用 `knowledge-search.ts` 的快速检索。
- `src/lib/knowledge-*.ts` / `src/lib/subtitle-parser.ts`：独立知识库连接、字幕解析、AI 硬校验、导入任务、Embedding、混合检索、管理和逻辑备份恢复。
- `src/lib/background-task-coordinator.ts`：单进程重任务互斥租约，避免批量 OCR、PDF、缩略图、知识导入、向量重建和伴读深度思考在 2C2G 实例上并行争抢资源。
- `knowledge/migrations/`：独立 `knowledge.db` SQL migrations；由 `db:init` / `db:migrate` 与主库 migrations 分别提交。
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
- `dev.db`、`dev.db-*`、`knowledge.db`、`knowledge.db-*`
- `data/library/`
- `next-env.d.ts`
- 运行日志，例如 `.codex-dev-server.log`、`dev-server.log`、`dev-server.err.log`

Docker Compose 运行数据位于命名卷 `brooks-pa-atlas-data`，容器内统一挂载到 `/app/data`：主库为 `/app/data/dev.db`，知识库为 `/app/data/knowledge.db`，图库为 `/app/data/library/images`，字幕源文件为 `/app/data/library/knowledge/sources`。重新构建容器不会清空该卷。

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
- `AppSetting`：本地设置，用于 OCR 并发数及版本化 `ai.config.v4` AI 配置等键值；读取时兼容迁移 `ai.config.v1` / `ai.config.v2` / `ai.config.v3`。AI API Key 明文保存在本地 SQLite，但任何客户端 DTO 都不能返回完整密钥。
- `OcrBatchJob` / `OcrBatchJobItem`：持久化索引子树批量 OCR 任务及启动时的图片清单，进度只统计该任务自己的图片。
- `AiReadingConversation` / `AiReadingMessage`：全局 AI 阅读伴侣会话与消息；消息保存发送时的图片引用、资料快照、知识引用快照、兼容端点返回的可见思考内容和耗时，图片或字幕后来删除后仍保留文字历史。
- `AiRobotConversation` / `AiRobotMessage`：独立全局机器人会话、文字历史、发送选择快照及完成运行的脱敏摘要，无图片外键，不进入备份。
- `ExamPaper`：试卷，支持草稿和发布状态，保存标题、描述、默认选项模板和发布时间。
- `ExamQuestion`：试题，关联已有 `ChartImage`，保存题型、题干、选项、正确答案、解析和遮罩坐标 JSON。
- `ExamAttempt`：一次考试记录，保存开始/提交时间、耗时、正确数、总题数和正确率。
- `ExamAttemptAnswer`：单题作答记录，保存随机题序、用户答案和是否正确。

枚举：

- `ImportBatchStatus`：`DRAFT`、`IMPORTING`、`PROCESSING_OCR`、`COMPLETED`、`COMPLETED_WITH_ERRORS`、`FAILED`
- `ImportItemStatus`：`PENDING`、`IMPORTED`、`DUPLICATE`、`FAILED`
- `OcrStatus`：`PENDING`、`RUNNING`、`COMPLETED`、`FAILED`、`SKIPPED`
- `AiReadingMessageRole`：`USER`、`ASSISTANT`
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

### UI 风格基线

新增或修改工作台弹窗、表单和卡片时，以 `src/app/app-settings-dialog.tsx` 的视觉语言为基线，并遵守以下规则：

- 弹窗遮罩统一使用 `bg-zinc-950/50`；主面板使用白底、`rounded-lg`、`border border-zinc-200` 和 `shadow-2xl`，页头、页脚及内容分隔线使用 `border-zinc-200`。
- 一级页签使用青色下划线选中态：选中为 `border-cyan-700 text-cyan-800`，未选中为透明下划线和 `text-zinc-500`；不要使用整块黑底表示普通页签选中。
- 内容卡片使用 `rounded-lg border border-zinc-200 bg-white shadow-sm`；嵌套行优先使用 `border-zinc-100 bg-zinc-50`，避免粗重深色描边。
- Tailwind 的 `border`、`border-t`、`border-b`、`border-l`、`border-r` 必须同时指定明确的边框颜色或状态色，例如 `border-zinc-200`、`border-cyan-200`、`border-rose-200`；禁止依赖默认 `currentColor`，以免出现黑边。
- 表单控件默认使用 `border-zinc-200`，焦点态使用 `focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100`，禁用态使用浅灰底并降低不透明度。
- 主操作按钮使用青色实底；次要操作使用白底、浅灰边框；危险操作使用浅玫红底和玫红边框。按钮、图标按钮均应提供一致的 hover、disabled 和 focus 状态。
- 优先复用现有弹窗、树选择器、提示框和按钮模式，不为同类交互重复开发一套视觉组件。

主要布局：

- 左侧：索引树、全部图片入口、语言切换、刷新、侧栏折叠、浏览/管理模式切换。
- 桌面端左侧栏可拖动边缘调整宽度，宽度会写入 `localStorage`，刷新或折叠后重新展开时继续沿用。
- 桌面端左侧栏固定在视口高度内；最外侧页面滚动条只推进右侧主内容，左侧索引树保留自身滚动，不随整页滚出视口。
- 中间：搜索栏、可折叠索引导航器、导入表格或图库浏览区域、概览、图片网格。
- 右侧：管理模式下的图片详情编辑面板；浏览模式下是大图查看体验。
- 工作台的纵向浏览统一使用浏览器最外侧的页面滚动条，中间内容区不能再建立独立的纵向滚动容器。大图查看器只在图片主动放大、需要查看局部时保留自身滚动。

全局机器人：默认在全部模式的页面右侧显示可拖动按钮，点击打开独立聊天窗口；支持拖动/缩放/收起/关闭、持久化多会话、Markdown、思考和工具状态。管理设置“技能 → AI 机器人”可禁用或配置模型及提示词。首版只查询索引与图片文字资料，全面搜索、整理图库和日志分析尚未提供。

浏览模式特性：

- 左侧目录 + 右侧图片浏览。
- 中央大图右键菜单提供“AI 伴读”；悬浮窗默认位于右侧，可拖动、从四边或四角调整宽高、收起、关闭并记住位置、尺寸、收起状态和收起前的消息阅读位置，打开后自动跟随当前大图；AI 回复按 Markdown 渲染，兼容端点返回的可见思考过程和耗时以可折叠面板实时展示并持久化。
- 伴侣输入状态保留在独立输入组件，关闭后重开仍恢复草稿；组词中的回车只确认输入法候选字。历史消息及 Markdown 使用稳定组件和缓存，输入、拖动、缩放或计时不会重复解析未变化的回答。拖动通过 `requestAnimationFrame` 合并并更新 `transform`，缩放按帧更新尺寸，松手提交最终位置和尺寸。流式草稿每 50ms 合并刷新，结束、失败或取消时清理待刷新内容；思考计时只更新思考面板。
- 阅读伴侣支持全局多会话、新建、切换、重命名、清空和删除；会话保存在 SQLite 但不进入备份 zip。每条用户消息记录发送时的参考图，模型可读取图片、标签、备注、OCR、文字标注、索引和导航属性。
- 普通伴读问题默认只向模型附带发送时的当前原图和最新资料快照；历史聊天文字及图片身份仍保留，但历史 OCR、备注、标注不会混入当前图的资料。明确要求对比或回看历史图片时，按近期范围附带最多 4 张不同原图及各自快照，并区分“当前参考图”和“历史参考图”。快速与深度模式共用此规则，跨索引或跨主题切图无需新建会话；检索仍以本次请求的当前图片索引定位。
- 伴读输入框上方提供“快速回答 / 深度思考”，默认快速，发送期间锁定模式；深度显示拆解、检索、排序、阅读和综合阶段。停止或关闭窗口会取消上游请求，未完成草稿不能保存为成功答案；收起窗口继续运行。阶段进度与原模型思考面板保持独立。
- 深度消息可展开查看证据覆盖、各资料读取数量、估算 Token、调用次数及降级提示；来源可展开原始片段，并显示版本与字幕时间或文本行号/标题路径。历史来源使用保存的快照。
- 顶部搜索可与目录筛选、标签多选筛选组合；多个精确标签使用交集语义。
- 顶部搜索按字面量匹配原始文件名、标题、备注、OCR、索引路径、标签和图片文字标注；`%`、`_`、反斜杠等字符不作为数据库通配符。
- 索引导航器可与关键词、标签和具体目录取交集；每个导航分类内单选，不同分类间按 AND。分类、选项和节点关联首次加载后，匹配数、目录结果和零结果置灰均在浏览器本地即时计算，不随每次点击重复请求服务器。
- 选中图片后显示大图查看器。
- 查看器固定高度并可拖动调整，缩放范围 `50%` 到 `220%`。
- 放大后在查看器内部滚动，不撑大整页。
- 图片文字标注可独立显示或隐藏；进入标注编辑后可点击图片添加文字、编辑文字、拖动位置、拖动文本框边框控制点调整宽高、调整字号和颜色、删除标注，修改会防抖自动保存。
- 标注文本框聚焦时允许暂时为空，防抖保存不会移除正在输入的空文本框；文本框失焦后，仍为空的标注才会自动清理。
- 标注文字颜色使用 PPT 风格颜色面板，可选择当前图片标注使用过的颜色和基础色；“更多颜色”继续调用系统自定义颜色选择器。
- 标注编辑时显示类似 PPT 文本框的边框和缩放控制点；完成编辑后边框和控制点隐藏，只显示文字。
- 图片标注保存为相对图片坐标，不写入原图文件；随缩放、滚动和窗口尺寸变化贴在同一图上位置。
- 图片详情里的 `notes` 备注可在浏览模式大图下方、图片列表上方独立显示或隐藏，类似 PPT 演讲者备注，不覆盖在原图上。
- 鼠标悬停图片时显示左右箭头；箭头 tooltip 提示 `←` / `→` 快捷键。
- 键盘 `ArrowLeft` / `ArrowRight` 可切换上一张/下一张；焦点在输入框、选择框、滑杆等编辑控件时不会触发。
- 下方缩略图网格可隐藏或显示。
- 图片网格使用 420px WebP 缩略图；大图查看器仍读取原图。筛选、目录或分页变化时旧图片 DOM 立即卸载并显示骨架屏，不等待上一批图片下载完成。
- 浏览模式下右键索引节点会显示与管理模式共用的索引菜单组件，提供导出索引、收缩叶子节点、编辑导航属性、重命名索引和删除空索引五项操作。

管理模式特性：

- 顶部使用统一的“导入图库”菜单，提供“选择图片”“选择文件夹”“导入 PDF”三个入口；旁边的提示图标说明三种方式都进入图库。选中文件后，“导入后 OCR”才显示在对应的待导入区域，与“开始导入”放在一起；每次新选择默认关闭 OCR，图片/文件夹与 PDF 的开关分别作用于各自待导入批次。
- 单击图片卡片仍只选择图片并显示右侧详情；双击图片或点击卡片、右侧预览上的放大按钮，可以进入中央大图工作区。
- 管理模式中央大图会暂时替换概览和缩略图网格，同时保留右侧详情编辑；支持缩放、调整查看器高度、左右切图和图片文字标注，返回网格时恢复原有筛选、分页、选中图片和滚动位置。
- 管理大图中切换图片前会自动保存尚未提交的标题、标签、索引、备注、OCR 文本和图片文字标注；保存失败时停留在当前图片并提示错误。
- 导入图片、文件夹或资料时可以选择是否在导入后 OCR；默认不 OCR，导入图片会标记为 `SKIPPED`。
- 可以通过“导入 PDF”把 PDF 导入图库；系统会按 PDF 文件名创建容器索引，按内置书签目录创建子索引，并把每页转换后的 JPEG 图片挂到对应节点。
- 备份与下载分为两步：生成的 zip 会先持久保存到服务器备份列表，列表展示时间、大小和图片数，用户之后可以单独下载或逐条删除。
- 备份 zip 包含所有索引、图片文件、标题、备注、图片文字标注、OCR 文本和 OCR 状态等元数据。
- 可以导入备份 zip 进行恢复；恢复使用合并覆盖模式，相同 SHA-256 hash 的图片更新元数据和索引归属，不创建重复图片，也不删除当前系统里备份外的数据。
- 索引导航器仅管理模式可编辑；支持分类/选项增删改排序、树形批量配置节点，以及从索引树右键编辑单节点属性。批量配置勾选或取消父节点时会同步作用于全部后代，部分后代选中时父节点显示半选状态。
- 导航属性批量配置会用背景色标识所选节点已有的属性：全部所选节点都有时显示浅青色，只有部分节点有时显示浅琥珀色；深青色仍表示当前准备批量添加或移除的操作选项。
- 可以创建当前选中索引下的新子索引。
- 图片详情支持编辑标题、备注、所属索引。
- 图片详情支持动态添加和移除标签，点击保存后与其他详情一起落库。
- 图片网格支持复选框跨页选择；筛选条件或页面模式变化时清空选择，批量标签工具栏可以为选中图片添加或移除标签。
- 标签输入、顶部标签多选筛选器和批量移除标签选择器使用应用内自绘菜单，不依赖浏览器原生 `datalist` / `select`；支持已有标签过滤、方向键选择和回车确认，标签输入仍支持自由输入。
- 支持删除单张图片，删除前必须二次确认。
- 索引右键菜单支持批量 OCR 当前节点及全部后代图片；存在非空 OCR 文本时必须输入 `确认重新OCR`，任务使用右下角后台进度卡且全局同时只运行一个批量任务。
- OCR 文本可在图片详情面板手动编辑校准；OCR 卡片内会提示未保存修改，并提供独立的“保存 OCR 文本”按钮。保存非空文本会把状态设为 `COMPLETED`，清空文本会把状态设为 `SKIPPED`。
- 管理顶部设置弹窗可配置多个 OpenAI-compatible AI 端点、唯一启用端点以及“AI 精校 OCR”和“AI 阅读伴侣”技能；两个技能可分别覆盖模型和提示词。OCR 精校结果只进入未保存草稿，用户仍需手动保存。
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

- 浏览模式与管理模式共用同一个索引右键菜单组件；菜单打开时会检测视口边界，点击位置下方空间不足时向上翻转，并限制在视口左右边界内，避免被页面边缘裁切。管理模式额外提供清空索引图片。

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
- 选择图片或文件夹后，在表格顶部设置“导入后 OCR”，再点击“开始导入”；取消系统文件选择不会清空已有待导入列表。
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

- 选择 PDF 后先显示文件名、目标索引路径和默认关闭的“导入后 OCR”开关；点击“开始导入”才上传并启动任务，取消选择不会上传。目标索引使用选择 PDF 时的当前索引路径。
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

### AI 与资料知识库规则

- AI 工具基础设施通过服务端 `runAiToolTask` 显式启用，固定已有设置的启用端点、默认模型或既有技能的模型覆盖及提示词。独立全局机器人显式启用工具；现有快速/深度伴读、OCR 精校、字幕整理和知识检索不启用工具，界面、HTTP 接口及原流式事件保持不变。
- 工具模块使用 `server-only` 边界，不创建 Server Action、通用 HTTP 执行接口或 MCP。注册工具使用同一 strict Zod schema 导出 JSON Schema 并校验参数；运行要求显式工具白名单和全库/精确图片与索引 ID 集合授权，首版只允许 read 工具，模型不能扩大范围。机器人专用接口固定白名单为 `get_image_context`、`list_index_nodes` 和全库只读范围，不接受浏览器工具定义、权限或密钥；没有通用执行 API。当前图片/索引 ID 在提交时固定，并提供给模型。
- 工具响应允许正文为空；SSE 按调用 index 组装交错参数，完整结束后才执行。截断、取消、无效/重复 ID 不执行半成品。完整 assistant 调用消息与供应商思考字段先进入上下文，工具串行执行，通过匹配的 `tool_call_id` 回传结果；结果是不可信参考数据。
- 新执行器默认最多 6 次模型请求、12 次工具调用；模型/工具/运行超时为 120 秒/30 秒/5 分钟。单次输入 16000 Token（保留 10% 余量）、累计输入 100000 Token、输出 4096 Token，估算包括工具定义、参数与结果；单工具结果最多 32KiB，超限明确报错，不静默裁剪。未知工具、无效参数、越权和读取失败可回传给模型修正；请求错误、取消、超时及预算耗尽返回失败终态和空最终答案。
- 首批正式只读工具 `get_image_context` 复用现有服务读取最新资料，不返回路径或图片字节；`list_index_nodes` 对授权索引做字面量搜索和分页，默认 20 项、最多 50 项，不隐式授权后代。
- 执行器自身只在运行内返回记录，可通过 `AiToolTraceSink` 扩展存储；机器人调用方把完成运行的脱敏摘要保存到独立消息，不保存工具参数或结果正文。记录只包含运行/调用/资源 ID、端点/模型标识、状态、耗时、Token 和结果数量/大小摘要；不保存密钥、原始响应、参数正文、完整资料或思考正文。sink 失败记录警告，取消后的最终记录仍在返回结果中，可由调用方补存。
- `probeAiToolSupport` 通过临时无副作用工具验证调用、回传和最终回答，返回 supported/unsupported/unconfirmed/failed；可能产生费用，必须显式触发，不在启动或既有连接测试时运行。不支持工具的模型仍可使用原有 AI 功能，不把普通文本或 JSON 当作工具指令执行。
- AI 配置保存在 `AppSetting` 的 `ai.config.v4`，读取时兼容迁移 `ai.config.v1` / `ai.config.v2` / `ai.config.v3`；配置是当前实例本地设置，不进入备份 zip，恢复也不覆盖。
- 全局 AI 机器人使用 `skills.globalRobot` 的启用开关、提示词和模型覆盖，仍保存 v4；旧配置默认启用，旧 PUT 缺少机器人技能时保留现值。禁用会取消单进程全部活动机器人运行并拒绝新发送，不删除会话。仅用户发送时调用模型，不自动探测工具能力。
- 机器人使用独立 `AiRobotConversation` / `AiRobotMessage` 表，migration 为 `20261006100000_ai_robot`；历史不进入备份 zip。每会话只允许一个运行，清空/删除期间也持有互斥；取消/超时/失败只保留用户消息，不保存助手草稿。当前图片和目录在发送时校验并保存参考快照，图片删除后仍显示历史参考；考试模式不传浏览模式遗留图片。
- 已有本地数据库使用机器人前必须应用 `20261006100000_ai_robot` 并生成 Prisma Client、重启服务。机器人专用接口通过 `ai-robot-api.ts` 返回脱敏 JSON 错误；缺表/字段返回 HTTP 503 与 `storage_upgrade_required`，前端按界面语言提示并允许重新加载会话，不在请求中自动迁移数据库。
- 机器人最多装载最近四组成功问答，当前问题完整保留，预算超限明确失败；显示分页每次 40 条。轮次正文和思考、工具状态独立展示，仅执行器最终答案作为成功回复。拖动按帧变换，输入框和历史消息分离；收起继续，停止/关闭取消。
- 大模型与 Embedding 使用两个独立页签和两组端点，各自保存供应商、Base URL、API Key、模型列表与唯一启用端点。大模型 Base URL 追加 `/chat/completions`、`/models`；Embedding Base URL 追加 `/embeddings`、`/models`；高级模式可分别指定完整 URL，只接受 HTTP/HTTPS。
- API Key 可为空；非空时只在服务端以 Bearer header 发送。设置 GET 仅返回 `hasApiKey`，空白保存保留旧密钥，只有显式清除才删除；日志和外部错误不能包含密钥或原始响应正文。
- 内置技能 `ocrRefinement`、`readingCompanion`、`subtitleKnowledge`、`globalRobot` 保存可编辑提示词和可选模型覆盖；字幕知识技能还保存可选失败重试模型和单窗口输出 Token 配置上限，未覆盖时使用启用聊天端点的默认模型。字幕 AI 导入必须固定关闭 thinking/reasoning，配置读取和保存都要强制为关闭，界面不得提供重新开启入口。
- 聊天技能统一通过 `resolveAiModelSelection` 选择实际模型。启用端点已有模型列表时，若旧覆盖只存在于其他端点的已知模型列表而当前端点未列出，则本次继承当前端点默认模型；不删除保存的覆盖，切回原端点后仍可使用。当前端点明确列出的覆盖、跨端点共享模型 ID 及所有端点均未知的手动模型仍有效。字幕旧重试覆盖不适用当前端点时沿用首次模型。设置技能卡显示实际模型与旧覆盖提示，调用前的 ready 判断使用相同规则，不调用上游探测或自动重试其他模型。
- 伴读两种回答模式共用 `readingCompanion` 的模型和提示词，不增加独立模型配置。技能增加 `deepInputTokenBudget=16000`、`deepTotalInputTokenBudget=100000`、`deepMaxOutputTokens=4096`；旧 JSON 缺失字段补默认值，仍使用 v4，无数据库 migration。三个字段为正整数，累计输入预算不得低于单次预算；设置分别限制为单次 1,000,000、累计 10,000,000、输出 131,072，不能提高上游模型容量。
- 每个深度问题启动时固定已保存配置快照。输入按 UTF-8 字节/2 保守估算，包含提示词、问题、历史、图片和证据，图片额外预留 4096 Token，并保留单次输入预算的 10% 安全余量；累计预算统计全部聊天调用的估算输入，失败尝试同样计入。最终输出上限按供应商兼容格式传给上游。
- 深度最多 10 次聊天模型调用、6 个阅读批次是固定常量；非最终调用必须同时为最终综合保留调用和输入预算。预算不够时停止扩展证据，不能静默截断当前问题；若当前问题、图片与提示词本身超过单次输入预算，直接提示调整预算或问题。
- 深度拆解最多 6 个子问题，根据当前图片、课号、资料标题、索引路径和文本标题路径定位范围，目标 ID 和章节路径必须由服务端按真实目录校验；无法唯一定位时回复澄清问题。目录与章节标题可按问题相关性在拆解上下文内装载，不得捏造未展示的目标。
- 每个深度子问题的 FTS、关键词、向量通道分别最多 50 个候选，在目标资料/当前范围/全库间分配名额。问题向量批量生成，SQLite 查询串行执行并定期让出事件循环以响应取消；向量不可用降级。按 ID 和同版本相同正文去重，按目标资料、子问题和资料轮转分配候选。
- 深度对最多 60 个候选摘要调用伴读模型二次排序，只接受候选中已有且不重复的 ID，失败使用 RRF 和覆盖规则并提示。整章总结通过标题路径分页读取有序原文，不能由排序直接排除章节正文。超过单次输入预算时先分批读成带原始编号的笔记，再流式综合；笔记不得引用批次外编号。
- 深度资料目录、片段与笔记始终是不可信参考数据，所有调用均保留相应规则。只使用知识库中已启用、活动版本且绑定有效的资料；未读或读取失败的片段不得列作回答依据。没有知识证据、目标资料未召回或预算/批次不足时保存并显示实际覆盖及降级说明，最终回答不得声称完整阅读。书籍通过现有 TXT/Markdown 进入知识库，不新增 PDF/EPUB 全文解析。
- 深度使用 `ai-deep-reading` 重任务租约；停止、断开和失败必须取消上游并在 `finally` 释放。流式上游未返回完成标记或 `finish_reason` 的中断回答不得保存成功消息。
- 精校把原图在内存中转换为最长边不超过 1920px、quality 85 的 JPEG，并与当前 OCR 草稿一并发送；不写入衍生图片文件。
- 外部请求超时为 120 秒。精校 API 不更新 `ChartImage`；只有用户点击现有“保存 OCR 文本”后才写数据库。
- 所选精校模型必须支持 Chat Completions 图片输入；连接测试只验证最小文本请求，不代表图片能力可用。
- 当前项目没有登录，AI 配置和付费调用接口只适用于可信本机或可信局域网部署。
- 资料知识使用独立 `knowledge.db`（`better-sqlite3` + `sqlite-vec`），启用 WAL、外键、5 秒 busy timeout 和受限页缓存；主库与知识库禁止用 `ATTACH` 做跨库事务。
- 资料导入支持 `.srt/.vtt/.ass/.txt/.md/.markdown`，单文件 10MiB、单批 200 个文件和 100MiB 总量。字幕格式强制为 `SUBTITLE`；TXT/Markdown 必须逐文件确认资料类型并支持批量设置。节点映射始终在导入前确认；人工预览每次默认关闭且不记忆。处理方式每次默认选择“快速导入”，不得记忆成 AI 模式。
- 字幕节点自动匹配先识别文件名中的完整课号词（如 `19D`、`40A`），再使用保守的描述名称包含匹配；只能自动选择唯一最高分节点，多个同分节点必须人工确认。课号必须按完整词匹配，禁止把 `19D` 误匹配为 `19`、`119D` 或 `19D-0`。
- 快速导入不得调用聊天模型：程序完成完全重复与滚动累积字幕去重、基础规范化、按时间/长度确定性分段，然后直接生成 Embedding 和 FTS。AI 深度整理是可选模式，只允许模型返回 `cueStart`、`cueEnd`、主题和关键词；字幕正文必须由程序按 cue 合并，禁止接受模型返回的正文或时间码。
- 普通 TXT 按空行识别段落；Markdown 识别 ATX/Setext 标题并忽略代码围栏中的伪标题。通用文本按标题边界优先、约 1000 字符目标和 1600 字符硬上限确定性切片，保留正文顺序、标题路径和源文件行号，不调用聊天模型。混合批次只能使用快速导入。
- AI 字幕窗口固定使用 `temperature: 0`、JSON 模式并关闭 thinking/reasoning；DeepSeek 请求显式发送 `thinking.type=disabled`。MiMo 按实际 Chat Completions URL 的主机名 `api.xiaomimimo.com` 识别，同样发送 `thinking.type=disabled`，兼容“自定义”和“OpenAI”端点类型以及高级完整 URL，识别优先于通用供应商分支；无需更换已保存的端点类型。其他供应商发送其兼容的关闭参数，使用明确的推理模型但端点无法可靠关闭推理时应拒绝执行。请求前的有效最大输出 Token 必须取“技能配置上限、3000、预估输入 Token 两倍”三者最小值；供应商返回 `finish_reason=length`、仍返回推理内容/Token，或最终输出 Token 超过实际输入 Token 两倍时立即熔断整份文档，不得重试该窗口、继续后续窗口或自动回退程序分段。
- AI 输出必须通过范围有效、顺序不变、无重叠和 cue 全覆盖校验，禁止先排序来掩盖倒序。仅当输出片段已覆盖某个短字幕合并组的一部分，且扩展不会与相邻片段重叠时，允许将截断的首尾恢复到该组边界；不能吸收整组遗漏。普通遗漏仍以 `max(3, ceil(cue 数 × 5%))` 为上限；存在组内边界修复时，全部补齐数量共享 `max(5, ceil(cue 数 × 5%))` 的总上限，普通缺口仍受原上限约束。正文和时间范围只能由源 cue 生成。
- 严重遗漏、重叠、倒序或无法修复的 JSON 仍只完整重试一次，第二次优先使用技能中配置的便宜重试模型。重试请求的系统消息追加程序生成的校验反馈：遗漏时列出原始遗漏区间（最多 12 个）及当前窗口首尾，其他校验失败反馈对应范围或 JSON 格式问题；不得把任意模型正文提升为系统指令。每次请求的 Token 预算包含反馈，输出超限、截断和推理输出的熔断规则保持不变。AI 缓存提示词 hash 包含校验规则版本，避免复用旧校验策略的片段；不改用户已保存的技能提示词。
- 相同字幕按 `sourceHash + processingMode + processingRuleVersion + processorModel + processorPromptHash` 复用已有片段；匹配当前启用 Embedding profile 的向量也一并复用。失败 AI 窗口必须持久化输入、截断后的输出预览、输入/输出 Token 和重试次数，供进度卡排查。
- 知识导入与知识维护任务的进程内运行表必须挂在 `globalThis`，避免 Next.js 开发热更新重新加载模块后重复恢复同一任务；远程 Embedding 返回后写入前必须校验 profile 与片段仍存在，并在成功或等待审核时清除 item 的旧错误字段。
- 每份资料最多绑定一个索引节点，每个节点最多绑定一份资料。重新导入同类型资料创建版本；同节点不同类型必须返回 `409`。解除绑定保留资料和源文件但停止参与检索。片段、关键词、FTS 与向量全部完成后才在单个知识库事务中替换启用版本。人工模式只允许整份批准或拒绝。
- 知识文档管理使用左右分栏：左侧按资料绑定节点的直属父节点分组并显示数量，右侧显示当前分组文档并支持标题、课号、类型、路径和源文件搜索；两栏各自滚动，避免数百份文档堆叠成长页面。未绑定或孤立资料统一进入“未关联”分组。
- 版本行分别显示知识片段数和 Embedding 记录数；片段数是可点击入口，打开后按序查看原字幕、知识文本、时间范围、主题和关键词。`processorModel` 非空表示该版本的分段边界来自字幕整理 AI，界面必须显示“AI 分段”标签。
- “重建全文索引”和“重建全部向量”属于高级维护工具，默认折叠，不作为日常主操作展示；两个按钮旁必须提供可悬浮/聚焦的说明图标。全文索引重建需要普通确认，向量重建必须展示端点、模型、启用片段数和费用警告并二次确认；达到 1000 个片段时必须输入确认短语。
- 已停用、失败或已拒绝的历史版本允许整版删除，即使向量数为 0 也必须提供删除入口；删除范围包括版本记录、资料片段、关键词、FTS 和全部 Embedding，当前启用版本禁止删除。删除后如果文档不再有任何版本，应同时清理空文档；源文件仅在没有其他版本引用时逐个删除。
- 字幕 AI 整理按持久化窗口逐个处理，进度必须记录完成窗口数、当前窗口/尝试次数和最后更新时间；窗口每次运行先清零重试次数，失败时保留 `onAttempt` 记录的实际次数，不能将单次熔断误记为已重试。Embedding 按最多 20 条一批调用并记录批次进度，避免超过 OpenAI-compatible 供应商的批量限制。
- 上游 AI 的结构化错误只保留经过截断和密钥脱敏的错误码/消息；不要把任意 HTML 或纯文本响应原样展示给客户端。
- 快速混合检索使用当前范围/全库的 FTS5、短关键词和向量结果，以 RRF 合并，最多 8 个片段；当前范围结果充足时至少 4 个，回答仅调用一次聊天模型。当前范围累计包含当前节点资料，以及从父节点到根节点所有启用且 `appliesToDescendants=true` 的祖先资料，不得在最近祖先命中后停止。Embedding 失败必须降级而不能中断原图片伴读。
- 8 个片段是上限，不是必须填满的数量。快速/深度向量召回在 RRF 前过滤余弦距离大于 `0.35` 的候选（固定保守门槛，并非模型相关性概率）；全文和关键词查询去除通用任务用语。全库检索只能使用问题中的明确主题，不拼入图片 OCR、标题和备注；“翻译当前图片”等无明确主题的问题只能在已关联资料内利用图片上下文检索，无关联时返回空证据。空结果保存 `warning=no_relevant_evidence` 并提示资料不足，禁止虚构引用。“参考资料”展示提供给模型的片段，正文引用表示采用的依据；旧历史保留原快照，不按新规则重新检索。门槛不能保证所有 Embedding 模型的准确率，换模型时应验证相关与无关问题的召回。
- 阅读伴侣的助手消息把原始资料正文、引用、版本、`sourceType/sourceFormat/locator` 写入 `knowledgeContextJson`；深度额外保存 `answerMode`、预算快照、覆盖、调用/Token 统计与降级提示，旧消息缺失模式时按快速显示。历史不得重新查询当前版本替换旧引用。最终编号校验只允许已读取快照中的引用，未知编号标记为“未验证引用”，不能沿用模型提供的错误链接。
- 删除资料文档或源文件时只能逐个明确路径删除；不得删除知识目录、使用通配符或递归删除。

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

AI 设置与调用 API：

- `GET /api/settings/ai`：返回脱敏后的端点、技能和 `ready` 状态，只返回 `hasApiKey`，绝不能返回完整密钥。
- `PUT /api/settings/ai`：整体保存端点、唯一启用端点和内置技能；同 id 端点未传新密钥时保留旧值，`clearApiKey` 才显式清除。
- `POST /api/settings/ai/models`：使用端点草稿或已保存密钥请求 Models URL，返回去重排序后的模型 id。
- `POST /api/settings/ai/test`：使用指定模型执行最小非流式文本请求，只验证 Chat Completions 连接。
- `POST /api/settings/ai/test-embedding`：请求一个测试向量并返回维度，只验证 Embeddings 连接。
- `POST /api/ai/ocr-refine`：接收 `imageId` 和最多 100,000 字符的非空 `ocrText`，把压缩原图和当前草稿发送给 `ocrRefinement` 技能，成功只返回 `{ refinedText }`，不更新图片记录。
- `POST /api/ai/reading-companion/conversations/[id]/messages`：接收 `imageId`、最多 20,000 字符的 `content` 和可选 `answerMode: "quick" | "deep"`（缺省快速）。NDJSON 保留 `start/thinking_start/reasoning_delta/thinking_done/delta/done/error`，增加 `{ type: "progress", phase, completed?, total? }` 与心跳 `ping`；phase 为 `planning/retrieving/ranking/reading/synthesizing`。深度租约冲突返回 409；错误或取消只保留已发送的用户问题，不保存未完成助手草稿。
- AI 上游超时返回 `504`，配置不完整返回 `409`，上游或响应错误返回 `502`；错误响应只保留清理后的状态信息，不透传上游正文。
- `/api/knowledge/**` 提供映射预览、导入任务、逐文档审核、文档/版本管理、非当前历史版本删除、FTS/向量维护和检索测试；知识导入任务全局同时只运行一个并持久化窗口结果。
- `GET /api/knowledge/maintenance` 返回当前 Embedding 配置、活动 profile、启用片段数、已有/缺失向量数，供维护操作在执行前展示影响范围。

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
- zip 顶层包含 `manifest.json`、`images/<hash>.<ext>`、`knowledge/sources/*` 和 `knowledge/embeddings/*`。
- manifest 格式为 `brooks-pa-atlas.backup` v7，除 v6 数据外保存资料类型、启用状态、单个可空绑定、版本源格式和片段 locator；不直接复制运行中的 `knowledge.db`，恢复仍兼容 v1–v6。
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
- v2–v7 恢复会通过图片 SHA-256 hash 重新映射试题图片；缺失图片时拒绝恢复对应考试数据，避免断开的题目引用。
- v3–v7 恢复会覆盖备份内图片的标签；恢复旧版 v1 / v2 备份时保留当前系统中已有图片的标签。
- v4–v7 恢复会覆盖备份内图片的文字标注；恢复旧版 v1–v3 备份时保留当前系统中已有图片的文字标注。
- v5 导航恢复在事务内按规范化名称合并分类和选项，并以备份内容覆盖备份内节点的关联；备份外数据不删除。恢复 v1–v4 时保留目标系统现有导航数据。
- v6 恢复自动补齐 `SUBTITLE`、单绑定、源格式和字幕 locator；v7 按索引路径恢复资料绑定。目标节点同类型资料按 source hash 合并版本，不同类型明确报冲突；无法映射的绑定标记为 `ORPHANED`。恢复版本、源文件与向量 BLOB 后重建 FTS5，不恢复导入/维护任务记录，也不删除目标实例额外知识数据。

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

机器人 API：`GET/POST /api/ai/robot/conversations` 列表/新建；`GET/PATCH/DELETE /api/ai/robot/conversations/[id]` 分页/重命名/删除；`POST/DELETE /api/ai/robot/conversations/[id]/messages` NDJSON 流式发送/清空。发送请求 strict 校验 `content`、`locale` 和可选 `imageId/indexNodeId`，只接受服务端白名单与权限策略；运行期间固定配置和当前选择。

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

- `brooks-pa-atlas.aiRobot.launcher` / `.window` / `.conversation` / `.scroll.<会话ID>`：独立机器人入口和窗口位置/尺寸、最近会话及阅读位置；不保存密钥或聊天正文。

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
