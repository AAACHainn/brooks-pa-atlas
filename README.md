# Brooks PA Atlas

Brooks PA Atlas 是一个本地 Web App，用来管理 Brooks 价格行为图表图片库。它支持批量导入本地图片、按无限层级索引整理图片、查看和编辑图片信息，并在后台异步执行 OCR。

## 环境要求

- Node.js：建议使用当前项目依赖兼容的 LTS 版本。
- npm：随 Node.js 安装。
- SQLite：项目通过 Prisma + better-sqlite3 使用本地 SQLite 数据库。
- 可选 OCR：如果需要自动识别图片文字，请在本机安装 `tesseract`。

## 安装依赖

```powershell
npm install
```

## 初始化数据库

第一次运行，或本地没有 `dev.db` 时，执行：

```powershell
npm run db:init
```

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

如果电脑 IP 不是 `192.168.1.8`，可以在启动前指定允许的局域网地址：

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

页面左侧可以在“浏览”和“管理”之间切换。

- 浏览模式：只查看图片和索引，适合学习和检索。
- 管理模式：可以导入图片、创建索引、编辑图片信息、删除图片和管理索引。

### 2. 创建索引

在管理模式下，左侧输入索引名称后点击创建按钮。

- 未选中索引时，会创建根索引。
- 选中某个索引时，会在该索引下创建子索引。
- 索引支持多层级。

### 3. 导入图片

在管理模式下，可以使用顶部按钮导入：

- `选择图片`：一次选择多张图片。
- `选择文件夹`：选择整个文件夹，系统会识别其中的图片文件。

导入前可以在表格里为每张图片指定所属索引。表格支持分页，但点击导入时会提交全部已选择图片，不只提交当前页。

支持的常见图片格式包括：

- `.jpg`
- `.jpeg`
- `.png`
- `.webp`
- `.gif`
- `.bmp`
- `.tif`
- `.tiff`

### 4. 备份和恢复

在管理模式下，可以使用顶部按钮进行数据备份和恢复。

- `备份`：导出一个 zip 文件，包含全部树状索引、图片文件、标题、备注、OCR 文本和 OCR 状态等元数据。
- `恢复`：导入备份 zip。恢复采用合并覆盖模式，相同 SHA-256 hash 的图片会覆盖元数据和所属索引，不会重复生成一份，也不会删除当前系统中备份外的数据。

备份包只保存跨平台相对路径，不保存 Windows 或 Linux 的绝对路径。因此可以在 Windows 开发环境导出备份，再在 Linux 部署环境恢复。恢复时图片会写入当前系统的 `BROOKS_LIBRARY_ROOT`，未设置时写入默认图库目录。

如果备份时数据库记录指向的图片文件已经丢失，系统会返回错误并停止导出，避免生成不完整备份。

### 5. 浏览图片

导入完成后，图片会出现在中间的图片网格中。

- 点击左侧索引可以筛选图片。
- 顶部搜索框可以搜索标题、OCR 文本、备注和索引路径。
- 图片网格支持分页，避免图片过多时页面卡顿。
- 浏览模式下可以打开大图查看器，并使用左右箭头或键盘方向键切换图片。

### 6. 编辑图片信息

在管理模式下，点击图片后可在右侧详情面板编辑：

- 标题
- 所属索引
- 备注

编辑后点击“保存”生效。

### 7. OCR 和重试

图片导入后会进入后台 OCR 队列。OCR 不会阻塞图片入库和浏览。

如果某张图片 OCR 失败，可以在右侧详情面板点击重试按钮。默认 OCR 命令是：

```text
tesseract
```

Windows PowerShell 可以这样指定其他 OCR 命令：

```powershell
$env:BROOKS_OCR_COMMAND="tesseract"
```

Linux/macOS shell 可以这样指定：

```bash
export BROOKS_OCR_COMMAND=tesseract
```

如果希望只对本次启动生效，也可以在 Linux/macOS 下这样运行：

```bash
BROOKS_OCR_COMMAND=tesseract npm run dev
```

默认 OCR 调用参数相当于：

```text
tesseract <imagePath> stdout -l eng
```

因此默认识别语言是英文 `eng`。如果需要识别其他语言，需要先安装对应的 Tesseract language data，并在代码或配置中调整 OCR 参数。

### 8. 删除和撤销

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

如果命令不存在，需要先安装 Tesseract OCR，或者设置 `BROOKS_OCR_COMMAND` 指向可用命令。

常见 Linux 安装方式：

```bash
sudo apt update
sudo apt install tesseract-ocr
```

如果需要英文以外的语言包，也要安装对应语言数据。例如 Ubuntu/Debian 的简体中文语言包通常是：

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
