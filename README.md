# Brooks PA Atlas

Brooks PA Atlas 是一个本地 Web App，用来管理 Brooks 价格行为图表图片库。它支持批量导入本地图片、将 PDF 资料逐页转换为图片、按无限层级索引整理图片、查看和编辑图片信息、制作遮罩选择题试卷，并在后台异步执行 OCR。

## 环境要求

- Node.js：建议使用 `22.13.0` 或更新版本；PDF 导入依赖 `pdfjs-dist`，需要较新的 Node.js 运行时。
- npm：随 Node.js 安装。
- SQLite：项目通过 Prisma + better-sqlite3 使用本地 SQLite 数据库。
- OCR：导入图片后会触发后台 OCR 队列，部署机器需要全局安装 `tesseract`，否则 OCR 会失败，并可能影响导入后的处理体验。

使用 Docker Compose 运行时，只需要 Docker Engine 和 Docker Compose v2。镜像已经包含 Node.js、Tesseract、简体中文和英文 OCR 语言包，不需要在宿主机另外安装这些依赖。

## 使用 Docker Compose 启动

在项目根目录执行：

```bash
docker compose up -d --build
```

启动完成后访问 `http://localhost:3000`。如果当前用户无权访问 Docker socket，请给命令加上 `sudo`。

常用管理命令：

```bash
docker compose ps
docker compose logs -f atlas
docker compose restart atlas
docker compose down
```

`docker compose down` 只停止并移除容器和 Compose 网络，不会删除命名卷。应用数据保存在名为 `brooks-pa-atlas-data` 的 Docker volume 中：

- SQLite 数据库：`/app/data/dev.db`
- 图片图库：`/app/data/library/images`

重新构建或替换容器时会继续使用同一个数据卷。不要使用会删除 volume 的 Compose 参数，否则数据库和图库数据可能丢失。

Compose 固定把宿主机 `3000` 端口映射到容器 `3000` 端口，以保证访问地址始终为 `http://localhost:3000`。

容器启动时会自动初始化空数据库，并对已有数据库执行全部增量 migrations。更新源码后的常规升级命令同样是 `docker compose up -d --build`。

## 本地运行时安装 OCR 依赖（Tesseract）

Brooks PA Atlas 默认调用命令行里的 `tesseract`：

```text
tesseract <imagePath> stdout -l chi_sim+eng
```

因此部署完成后必须能在终端直接运行：

```powershell
tesseract --version
```

Windows 推荐安装 UB Mannheim 提供的 Tesseract OCR 构建。优先使用 `winget`：

```powershell
winget install --id UB-Mannheim.TesseractOCR --exact
```

如果本机没有 `winget`，可从 UB Mannheim / Tesseract 的 Windows release 下载 `tesseract-ocr-w64-setup-*.exe` 安装器。安装目录建议保持默认：

```text
C:\Program Files\Tesseract-OCR
```

安装后请确认该目录已加入 PATH。PowerShell 可以这样添加到当前用户 PATH：

```powershell
$tessDir = "C:\Program Files\Tesseract-OCR"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($userPath -split ";") -notcontains $tessDir) {
  [Environment]::SetEnvironmentVariable("Path", ($userPath.TrimEnd(";") + ";" + $tessDir), "User")
}
```

修改 PATH 后，需要重新打开终端；如果开发服务已经在运行，也需要重启 `npm run dev`，否则服务进程可能仍然读不到新的 `tesseract` 命令。

Linux/macOS 常见安装方式：

```bash
sudo apt update
sudo apt install tesseract-ocr
```

默认 OCR 语言是简体中文加英文混合识别，因此还需要安装简体中文 language data。例如 Ubuntu/Debian 的简体中文语言包通常是：

```bash
sudo apt install tesseract-ocr-chi-sim
```

## 安装依赖

```powershell
npm install
```

## 初始化数据库

第一次运行，或本地没有 `dev.db` 时，执行：

```powershell
npm run db:init
```

该命令会初始化基础表，并继续应用项目内全部增量 migrations。已有数据库升级时也可以执行 `npm run db:migrate`。

如果修改过 Prisma schema，需要重新生成 Prisma Client：

```powershell
npm run prisma:generate
```

## 启动开发服务

```powershell
npm run dev
```

启动成功后，在浏览器打开：

```text
http://localhost:3000
```

如果 `3000` 端口已被占用，Next.js 可能会提示使用其他端口，请按终端输出的地址访问。

## 手机访问本机图库

手机访问时仍然使用电脑上的本地数据库和本地图片文件，不需要把图片上传到云端，也不要改动图库目录。

1. 在电脑上启动局域网服务：

```powershell
npm run dev:lan
```

如果服务已经在运行，修改访问方式或配置后请先停止旧服务，再重新执行上面的命令。

生产构建后也可以使用：

```powershell
npm run start:lan
```

2. 让手机和电脑连接到同一个局域网。
3. 在手机浏览器打开电脑的局域网地址，例如：

```text
http://192.168.1.23:3000
```

不要在手机上打开 `http://localhost:3000`。手机里的 `localhost` 指的是手机自己，不是运行 Brooks PA Atlas 的电脑。

如果页面能打开但索引和图片都是空的，先在手机浏览器访问：

```text
http://电脑局域网IP:3000/api/atlas
```

确认返回内容里的 `stats.imageCount` 是否大于 `0`。本机已有数据时，这个接口应该和电脑浏览器访问同一地址返回一致。

开发服务默认允许任意 IPv4 地址访问 Next.js dev resource，便于在不同局域网地址之间切换。如果仍然遇到浏览器控制台提示某个非 IPv4 主机名被 Next.js 阻止，可以在启动前手动追加允许的地址：

```powershell
$env:BROOKS_ALLOWED_DEV_ORIGINS="192.168.1.23"
npm run dev:lan
```

## 构建和检查

```powershell
npm run lint
npm run build
```

说明：

- `npm run lint` 运行 ESLint。
- `npm run build` 运行生产构建和类型检查。

## 基本使用

### 1. 选择模式

页面左侧可以在“浏览”、“管理”和“考试”之间切换。

- 浏览模式：只查看图片和索引，适合学习和检索。
- 管理模式：可以导入图片、创建索引、编辑图片信息、删除图片和管理索引。
- 考试模式：可以用图库里的图片制作试卷、发布考试、作答并复盘历史记录。

### 2. 创建索引

在管理模式下，左侧输入索引名称后点击创建按钮。

- 未选中索引时，会创建根索引。
- 选中某个索引时，会在该索引下创建子索引。
- 索引支持多层级。

### 3. 导入图片

在管理模式下，可以使用顶部按钮导入：

- `选择图片`：一次选择多张图片。
- `选择文件夹`：选择整个文件夹，系统会识别其中的图片文件。
- `导入资料`：第一版支持 PDF。系统会读取 PDF 内置书签目录，将每一页转换为图片，并按目录层级挂到索引树上；导入时会显示页级进度。

导入前可以在表格里为每张图片指定所属索引。表格支持分页，但点击导入时会提交全部已选择图片，不只提交当前页。

PDF 导入规则：

- 未选中索引时，会在根节点创建以 PDF 文件名命名的容器索引。
- 选中某个索引时，会在该索引子树下创建 PDF 文件名容器索引。
- PDF 有内置书签目录时，页图片会挂到对应书签章节下；没有书签时，所有页图片挂到 PDF 容器索引下。
- PDF 页面默认以 1.8 倍渲染，压缩为 JPEG，最长边限制为 1920px，初始质量为 84，并默认把单页图片控制在 500KB 以内；转换后的图片会进入同一套图库、SHA-256 去重、导入批次、OCR、备份和撤销流程。
- PDF 页面导入默认使用 2 路并发，避免大文档长时间卡在单个同步请求里。

PDF 转图片参数可以用环境变量调整：

```powershell
$env:BROOKS_PDF_RENDER_SCALE="1.8"
$env:BROOKS_PDF_MAX_IMAGE_EDGE="1920"
$env:BROOKS_PDF_JPEG_QUALITY="84"
$env:BROOKS_PDF_MAX_IMAGE_BYTES="512000"
$env:BROOKS_PDF_IMPORT_CONCURRENCY="2"
```

支持的常见图片格式包括：

- `.jpg`
- `.jpeg`
- `.png`
- `.webp`
- `.gif`
- `.bmp`
- `.tif`
- `.tiff`

### 4. 索引导航器

搜索栏下方提供可折叠的“索引导航器”，浏览和管理模式均可使用，考试模式自动隐藏。导航器初始为空，不从 Excel、标签或索引名自动生成数据。

- 管理模式可通过齿轮创建分类和选项、调整排序，并在可展开的树形列表中批量配置节点；勾选或取消父节点会同步作用于全部后代，索引树右键菜单也可编辑单个节点。
- 同一分类内多选按“或”匹配，不同分类之间按“且”匹配。属性只检查节点自身，不从父节点继承；命中节点后会包含该节点全部后代图片。
- 目录关键词、图片关键词、标签和具体目录会继续与导航条件取交集。点击匹配目录会定位左侧树，也可返回全部匹配目录的图片合集。

### 5. 备份和恢复

在管理模式下，可以使用顶部按钮进行数据备份和恢复。

- `备份管理`：先在服务器上生成 v5 zip，再从备份列表单独下载。列表会显示生成时间、文件大小、图片数和备份范围，也可以删除不再需要的备份。备份包含全部树状索引、导航分类/选项/节点关联、图片文件、标题、备注、标签、文字标注、OCR 状态，以及完整考试数据。
- `恢复`：导入备份 zip。恢复采用合并覆盖模式，相同 SHA-256 hash 的图片会覆盖元数据、标签和所属索引，不会重复生成一份，也不会删除当前系统中备份外的数据；导航关联通过备份内标识重建，试卷题目按图片 hash 映射。恢复 v1–v4 旧备份时保留目标系统现有导航数据。

备份生成、下载和恢复都使用磁盘文件与流式 I/O，不会把完整 zip 放入 Node.js 或浏览器内存；恢复时图片也会逐张流式校验和写入。服务器仍需预留足够磁盘空间：生成备份时需要容纳备份 zip，恢复上传时需要临时容纳上传的 zip。

备份包只保存跨平台相对路径，不保存 Windows 或 Linux 的绝对路径。因此可以在 Windows 开发环境导出备份，再在 Linux 部署环境恢复。恢复时图片会写入当前系统的 `BROOKS_LIBRARY_ROOT`，未设置时写入默认图库目录。

如果备份时数据库记录指向的图片文件已经丢失，系统会返回错误并停止导出，避免生成不完整备份。

### 6. 浏览图片

导入完成后，图片会出现在中间的图片网格中。

- 点击左侧索引可以筛选图片。
- 顶部搜索框可以搜索标题、OCR 文本、备注、索引路径和标签；旁边的标签筛选菜单支持多选，多个标签按交集筛选。
- 浏览模式标题栏和图片卡片会显示标签；点击标签可以切换对应的精确标签筛选。
- 图片网格使用服务端分页，支持每页 25、50、100 或 200 张，并保持全库自然数字排序。
- 浏览模式下可以打开大图查看器，并使用左右箭头或键盘方向键切换图片。

### 7. 编辑图片信息

在管理模式下，点击图片后可在右侧详情面板编辑：

- 标题
- 所属索引
- 备注
- 标签

编辑后点击“保存”生效。

图片卡片左上角的复选框可以跨页选择多张图片。选中后，批量标签工具栏可以统一添加或移除标签；切换搜索、索引、标签筛选或页面模式时会清空选择，避免误改隐藏图片。

### 8. 考试模式

考试模式用于把图库图片制作成遮罩选择题，并记录每次作答结果。

#### 创建和编辑试卷

进入考试模式后，可以通过试卷区域的 `+` 按钮创建新试卷，也可以从下拉菜单导入试卷。

- 新建试卷会先进入草稿状态。
- 草稿试卷可以从现有图库分页搜索并添加图片，每张图片会生成一道题。
- 题目支持单选题和多选题。
- 每道题可以设置题干、选项、正确答案、解析和图片遮罩。
- 遮罩支持多个矩形，只保存相对坐标，不会生成新图片。

题目保存后，如果内容满足发布要求，会进入已就绪状态。发布要求包括：

- 题干不能为空。
- 至少有 2 个有效选项。
- 单选题只能有 1 个正确答案。
- 多选题至少需要 2 个正确答案。
- 至少绘制 1 个遮罩矩形。

已就绪题目再次修改并保存时，如果内容有变化，页面会提示修改成功。

#### 发布和作答

试卷发布前，所有题目都必须处于已就绪状态。发布后试卷内容会锁定，避免历史考试记录和题目内容不一致。

开始考试后：

- 后端会随机题目顺序。
- 选项顺序保持试卷内的原始顺序。
- 作答页使用单题视图，可以用按钮或键盘方向键切换上一题/下一题。
- 图片支持缩放和拖拽查看局部。
- 看图窗口底部把手可以调整高度，最高可调整到 2000px。
- 切换题目时会保留当前缩放比例；该比例只记录在前端，不写入数据库。

提交答案后，系统会保存考试记录，包括用时、正确数、总题数、正确率和每题答案。结果页支持查看解析、显示或隐藏遮罩，以及只看错题。

#### 拷贝、导出和导入试卷

试卷列表支持右键菜单：

- 拷贝试卷：把现有试卷复制成新的可编辑草稿，只复制题目内容，不复制考试记录。
- 导出试卷：已发布试卷可以导出为轻量 JSON 文件；导出内容不包含图片文件，只包含图片索引信息和题目数据。

导入试卷在原 `+` 添加试卷入口的下拉菜单中。导入文件不会携带图片文件，系统会按图片 hash 在当前图库里重新匹配题目图片；因此导入前需要先确保相关图片已经存在于当前图库。

### 9. OCR 和重试

图片导入后会进入后台 OCR 队列。OCR 不会阻塞图片入库和浏览。

如果某张图片 OCR 失败，可以在右侧详情面板点击重试按钮。请先确认部署机器已经全局安装 Tesseract，并且运行服务的终端可以直接执行 `tesseract --version`。默认 OCR 命令是：

```text
tesseract
```

Windows PowerShell 可以这样指定其他 OCR 命令：

```powershell
$env:BROOKS_OCR_COMMAND="tesseract"
```

也可以指定 Tesseract 语言组合：

```powershell
$env:BROOKS_OCR_LANG="chi_sim+eng"
```

如果语言包不在 Tesseract 默认安装目录，可以指定 tessdata 目录：

```powershell
$env:BROOKS_TESSDATA_DIR="D:\path\to\tessdata"
```

Linux/macOS shell 可以这样指定：

```bash
export BROOKS_OCR_COMMAND=tesseract
```

也可以指定 Tesseract 语言组合：

```bash
export BROOKS_OCR_LANG=chi_sim+eng
```

如果语言包不在 Tesseract 默认安装目录，可以指定 tessdata 目录：

```bash
export BROOKS_TESSDATA_DIR=/path/to/tessdata
```

如果希望只对本次启动生效，也可以在 Linux/macOS 下这样运行：

```bash
BROOKS_OCR_COMMAND=tesseract BROOKS_OCR_LANG=chi_sim+eng BROOKS_TESSDATA_DIR=/path/to/tessdata npm run dev
```

默认 OCR 调用参数相当于：

```text
tesseract <imagePath> stdout -l chi_sim+eng
```

因此默认会同时识别简体中文和英文。如果需要识别其他语言，需要先安装对应的 Tesseract language data，并通过 `BROOKS_OCR_LANG` 调整语言组合。

### 10. 删除和撤销

管理模式支持以下高风险操作：

- 删除单张图片：需要弹窗确认。
- 撤销某个导入批次：需要弹窗确认。
- 删除索引：只有该索引及其子索引下没有图片时才能删除。
- 清空某个索引下的图片：需要在确认弹窗中输入 `确认删除`。

这些操作会影响本地数据库和图库文件，请谨慎执行。

## 本地数据位置

默认情况下：

- 数据库文件：`dev.db`
- 图片图库目录：`data/library/images`

Windows PowerShell 可以通过环境变量覆盖图库根目录：

```powershell
$env:BROOKS_LIBRARY_ROOT="D:\your-library-root"
```

Linux/macOS shell 可以这样设置：

```bash
export BROOKS_LIBRARY_ROOT=/home/you/brooks-library
```

数据库只保存图片路径和元数据，不保存图片 blob。

## 常见问题

### 文件夹导入后没有图片

请确认文件夹中包含支持的图片格式。部分系统会让浏览器提供空 MIME 类型，本项目会同时按扩展名识别图片。

### OCR 一直失败

请先确认本机可以直接运行 Tesseract。

Windows PowerShell：

```powershell
tesseract --version
```

Linux/macOS shell：

```bash
tesseract --version
```

如果命令不存在，需要先安装 Tesseract OCR，或者设置 `BROOKS_OCR_COMMAND` 指向可用命令。安装或修改 PATH 后，请重启终端和开发服务。

如果错误提示缺少 `chi_sim.traineddata`，请安装简体中文语言包，或临时把 `BROOKS_OCR_LANG` 改成当前机器已安装的语言组合。

常见 Linux 安装方式：

```bash
sudo apt update
sudo apt install tesseract-ocr
```

默认语言组合包含简体中文，因此需要安装对应语言数据。例如 Ubuntu/Debian 的简体中文语言包通常是：

```bash
sudo apt install tesseract-ocr-chi-sim
```

### 页面没有更新

可以点击左侧刷新按钮，或重新打开 `http://localhost:3000`。

### 本地数据可以直接删除吗

不建议直接删除运行数据。特别是 `data/library/` 和 `dev.db` 之间有关联，手动删除可能导致数据库记录和图片文件不一致。

## 更多维护说明

面向开发者和后续维护线程的详细说明见：

```text
AGENTS.md
```
