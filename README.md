# 知图

知图是一款本地优先的桌面学习思维导图工具。它把大纲的结构编辑能力和画布的视觉整理能力放进同一个工作区，适合整理课程、章节、概念、例题和个人的知识框架。

## 当前能力

- 左侧大纲与中央画布共享同一份树数据，实时同步。
- 大纲支持拖拽调整层级、排序和折叠；画布使用 ELK 自动布局并允许手动微调。
- 节点支持标题、画布摘要、Markdown 笔记、行内/块级 LaTeX、本地图片、颜色、形状、字号和连线样式。
- 提供纸本浅色主题与暖黑深色主题。
- 工作区由普通目录组成，可整体复制、备份或迁移。
- 编辑停止 800ms 后原子保存；每 5 分钟以及删除前生成恢复快照。
- 支持从 Markdown 导入标题、列表和本地图片，导出 PNG、SVG、PDF。
- 支持工作区内全文搜索、最近工作区、外部文件冲突检测和系统回收站删除。

## 开发

环境要求：Windows、Node.js 24+、npm。

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
npm run package:win
```

`npm run package:win` 会生成：

- `release\知图 Setup 0.1.0.exe`：Windows x64 安装程序。
- `release\知图 0.1.0.exe`：免安装便携版。
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
└─ .history/
   └─ <mapId>/<timestamp>.snapshot.json
```

`workspace.json` 保存工作区元数据和导图顺序；每张导图是独立 JSON 文件；图片以内容哈希命名，避免重复和覆盖。

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

当前版本不包含账号、云同步、协作、AI 整理、复习提醒、音视频附件、跨导图引用或 XMind/FreeMind 互导。
