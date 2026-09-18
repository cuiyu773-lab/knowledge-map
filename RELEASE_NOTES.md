# 知图 0.3.0 发布说明

> 发布日期：2026-09-18  
> 适用平台：Windows x64  
> 升级基线：v0.2.1

知图 0.3.0 是 PPTX 视觉资料增强版。本版补齐了 WMF/EMF 公式和几何图长期丢失的问题，在保留原始附件的同时生成高清 PNG，并可通过用户配置的视觉模型转为 LaTeX 或结构化 Markdown。

## 0.3.0 更新

### PPTX 视觉对象解析

- 解析幻灯片关系，提取实际的 WMF/EMF 公式和几何图，不再只读取文字。
- 使用独立 Python/Pillow 渲染器按 576 DPI 生成 PNG，并限制最大边长和像素面积。
- 每张幻灯片内按关系 ID 去重，同时保留来源关系、幻灯片顺序和内容哈希。
- 原始 WMF/EMF、高清 PNG、清单和识别缓存统一保存在 `materials/derived/<materialId>/`。
- 单个对象渲染失败时记录警告并继续，其他文字和视觉内容不会中断。

### 多模态识别与缓存

- 支持复用现有 OpenAI 兼容配置发送 `image_url` 图片内容。
- 每批最多提交 4 张图片，公式输出 LaTeX，几何图输出包含标签和关系的 Markdown。
- 识别结果按“PNG 哈希 + 模型名 + 提示词版本”缓存，重复生成不重复请求模型。
- 当前模型不支持视觉输入、网络失败或返回格式非法时，保留 PNG 和占位说明并降级继续。
- 修改模型或提示词版本后自动重新识别，不覆盖原始课程资料。

### 打包与界面

- PyInstaller 将 Python 渲染器和 Pillow 固化为独立 `metafile-renderer.exe`。
- Electron 安装包通过 `extraResources` 携带渲染器，最终用户无需安装 Python。
- 资料库和 AI 配置界面补充了视觉模型要求与图片发送说明。
- 新增渲染、视觉解析、缓存命中和多模态请求单元测试。

## 0.2.1 功能基线

- 课程资料库支持复选框多选，单次最多选择 10 份资料。
- 所选资料可靠传入 AI 生成流程，未选资料不会发送。
- 支持 PDF、DOCX、PPTX、Markdown 和 TXT 解析及工作区长期保存。
- 支持 AI 追问、生成预览、创建新导图、追加、合并和替换现有子树。
- API Key 使用 Electron `safeStorage` 保护，资料仅在确认后发送。

## 兼容性与升级

- 从 v0.2.1 可直接升级，无需迁移现有工作区。
- 导图数据结构、`workspace.json` 和 AI 会话结构版本保持 v1 兼容。
- 原有导图、资源、历史快照、导出文件和资料库继续可用。
- PPTX 视觉识别要求所选模型支持 OpenAI 兼容的 `image_url` 内容，无需新增独立视觉配置。
- WMF/EMF 渲染依赖 Windows GDI，当前发布平台为 Windows x64。

## 发布产物

- `release\知图 Setup 0.3.0.exe`：Windows x64 安装程序，约 151.1 MiB。
- `release\知图 0.3.0.exe`：Windows x64 免安装便携版，约 150.9 MiB。
- `release\win-unpacked\resources\metafile-renderer.exe`：内置 WMF/EMF 渲染器。

SHA-256：

```text
8C27B91CC89D462A024BD311C8D6AD4BCBAA9DD6EB22183DC4E0C15824B0EE08  知图 0.3.0.exe
CCC03A080009DD1B0E10ECD8436FFC5C1B9D64DE5AD3463CBEA3ABEB7D6B912B  知图 Setup 0.3.0.exe
```

## 验证记录

- `npm run typecheck`：通过。
- `npm test`：8 个测试文件、27 项测试全部通过。
- `npm run build`：通过。
- `npm run test:e2e`：2 项端到端测试全部通过。
- 真实课件包含 244 个 WMF/EMF 媒体文件；按幻灯片关系展开后共 258 个视觉引用，全部渲染成功且无警告。
- 已使用打包后的 `metafile-renderer.exe` 验证中文路径 PPTX、PNG 输出和清单生成。

## 已知边界

- 当前安装包未进行代码签名，Windows 可能显示 SmartScreen 或“未知发布者”提示。请先核对本说明中的 SHA-256。
- PPTX 视觉识别依赖支持 `image_url` 的多模态模型；纯文本模型会降级为 PNG 保留和文字解析。
- 模型识别结果可能存在误差，公式和几何关系应结合保留的原图复核。
- 不支持扫描版 PDF 的本地 OCR、音视频资料解析、账号、云同步、多人协作或 XMind/FreeMind 互导。
