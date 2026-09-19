# 知图

知图是一款本地优先的桌面学习思维导图工具。它把大纲的结构编辑能力和画布的视觉整理能力放进同一个工作区，适合整理课程、章节、概念、例题和个人的知识框架。

## 当前能力

- 左侧大纲与中央画布共享同一份树数据，实时同步。
- 大纲支持拖拽调整层级、排序和折叠；画布使用 ELK 自动布局并允许手动微调。
- 节点支持标题、画布摘要、Markdown 笔记、行内/块级 LaTeX、本地图片、颜色、形状、字号和连线样式。
- 提供纸本浅色主题与暖黑深色主题。
- 工作区由普通目录组成，可整体复制、备份或迁移。
- 编辑停止 800ms 后原子保存；每 5 分钟以及删除前生成恢复快照。
- 支持从 Markdown 导入标题、列表和本地图片，导出 PNG、SVG、PDF；PNG/PDF 可选择标准、高清、超清三档画质。
- 支持内置与个人整图/子树模板，模板可携带图片，并可导入导出 `.ztemplate` 文件。
- 支持节点、子树和整图三级样式预设，内置纸本、苔绿、河蓝和墨黑四套样式。
- 支持工作区内全文搜索、最近工作区、外部文件冲突检测和系统回收站删除。
- 支持 OpenAI 兼容的 AI 制作：对话追问后生成大纲、编辑预览，并创建新导图或追加、替换、合并到现有节点。
- AI 新建导图时可推荐并套用模板骨架；固定节点保持结构，可扩充节点由 AI 补充摘要、详注和新增子节点。
- 工作区资料库支持 PDF、DOCX、PPTX、Markdown 和 TXT；可通过复选框多选资料，单次最多选择 10 份，选中的内容会按需解析并发送给用户配置的模型服务。
- PPTX 中的 WMF/EMF 公式与几何图会提取为原始附件和高清 PNG；配置支持 `image_url` 的视觉模型后，会批量转为 LaTeX/Markdown，并缓存识别结果。

## 开发

环境要求：Windows、Node.js 24+、npm。打包 WMF/EMF 渲染器还需要 Python 3.12+。

首次打包前安装冻结工具：

```powershell
python -m venv .venv-metafile
..venv-metafileScriptspython.exe -m pip install -r resources/metafile-renderer-requirements.txt
$env:ZHITU_PYTHON=(Resolve-Path '..venv-metafileScriptspython.exe').Path
```

如果使用系统 Python，直接执行 `python -m pip install -r resources/metafile-renderer-requirements.txt` 即可。`

```powershell
npm install
npm run dev
```

常用命令：

```powershell
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run build:metafile-renderer
npm run package:win
```

当前开发、验证和发布状态见 [PROJECT_STATUS.md](PROJECT_STATUS.md)。

`npm run package:win` 会生成：

- `release\知图 Setup 0.4.0.exe`：Windows x64 安装程序。
- `release\知图 0.4.0.exe`：免安装便携版。
- `release\win-unpacked`：解包后的应用目录。

如果 Electron 或 electron-builder 在受限网络下无法下载二进制，可使用国内镜像：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
npm run package:win
```

## 工作区结构

```text
学习工作区/
├─ workspace.json
├─ maps/
│  └─ <uuid>.mindmap.json
├─ assets/
│  └─ <sha256>.<ext>
├─ materials/
│  ├─ index.json
│  ├─ files/<sha256>.<ext>
│  └─ derived/<materialId>/
│     ├─ manifest.json
│     ├─ slide-XXX-object-XXX.wmf|emf
│     ├─ slide-XXX-object-XXX.png
│     └─ vision-cache.json
└─ .history/
   └─ <mapId>/<timestamp>.snapshot.json
```

`workspace.json` 保存工作区元数据和导图顺序；每张导图是独立 JSON 文件；图片以内容哈希命名，避免重复和覆盖。

个人模板保存在应用用户目录的 `templates/` 中，样式预设保存在 `style-presets.json`。模板不会自动写入工作区，但可以在模板管理中导出为 `.ztemplate` 后迁移或分享。

AI 会话保存在 `maps/<mapId>.ai-session.json`，不会写入导图正文或导出文件。

## AI 配置

在“AI 配置”中填写 OpenAI 兼容服务的 Base URL、模型名称和 API Key。Base URL 可以是服务根地址，也可以直接填写完整的 `/chat/completions` 地址；本地服务允许不填写 API Key。

API Key 使用 Electron `safeStorage` 加密保存在用户数据目录，不会暴露给渲染页面。只有勾选数据发送确认后，知图才会把所选资料文本、当前导图上下文、模板骨架、PPTX 视觉对象 PNG 和对话发送到用户填写的服务地址。AI 推荐模板时只发送内置模板及已授权个人模板的名称、说明和一级主题，不发送模板详注、图片或其余节点。识别 PPTX 视觉对象时，所选模型必须支持 OpenAI 兼容的 `image_url` 内容；不支持时保留 PNG 并降级为文字解析。

## 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 新建同级主题 | Enter |
| 新建子主题 | Tab |
| 提升主题 | Shift + Tab |
| 同级排序 | Alt + ↑ / ↓ |
| 折叠或展开 | Space |
| 重命名 | F2 |
| 删除主题及子树 | Delete |
| 撤销 / 重做 | Ctrl + Z / Ctrl + Y |
| 搜索 | Ctrl + F |
| 保存 | Ctrl + S |
| 适应画布 | Ctrl + 0 |

## 技术结构

- `src/main`：Electron 主进程、工作区文件操作、素材校验、快照和导出落盘。
- `src/preload`：受限 IPC 桥接，不向渲染进程暴露 Node.js。
- `src/shared`：数据 schema、树操作和 Markdown 导入等纯逻辑。
- `src/renderer`：React 界面、Zustand 状态、React Flow 画布、Tiptap 编辑器与主题样式。

## 首版边界

当前版本不包含账号、云同步、协作、本地图片 OCR、复习提醒、音视频附件、跨导图引用或 XMind/FreeMind 互导。PPTX 中的视觉对象依赖用户配置的多模态模型，并仅在勾选资料与数据发送确认后处理。
