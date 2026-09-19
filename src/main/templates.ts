import { app, dialog, shell } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { BUILTIN_STYLE_PRESETS, BUILTIN_TEMPLATES } from '@shared/builtinTemplates'
import { createMapFromAiTemplatePreview } from '@shared/ai'
import {
  computeTemplateRevision,
  createTemplateSnapshot,
  instantiateTemplate as buildDocumentFromTemplate,
  parseMindMapTemplate,
  templateSummary
} from '@shared/templates'
import type {
  MapSummary,
  MindMapDocument,
  MindMapTemplate,
  NodeStyle,
  SaveStylePresetInput,
  SaveTemplateInput,
  StylePreset,
  TemplateAsset,
  TemplateDetail,
  TemplateNodeBehavior,
  TemplateSummary,
  UpdateTemplateInput
} from '@shared/types'
import { AppError } from './errors'
import type { WorkspaceService } from './workspace'

const IMAGE_MIME = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif']
])
const MAX_TEMPLATE_PACKAGE_BYTES = 100 * 1024 * 1024
const MAX_TEMPLATE_UNPACKED_BYTES = 150 * 1024 * 1024
const MAX_TEMPLATE_ASSETS = 200

async function atomicWrite(filePath: string, content: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temporary, content)
  await fs.rename(temporary, filePath)
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T
}

function sha256(buffer: Buffer | string): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function safeId(value: string): string {
  if (!/^[a-zA-Z0-9-]{1,120}$/.test(value)) throw new AppError('INVALID_TEMPLATE_ID', '模板标识无效')
  return value
}

function safePresetId(value: string): string {
  if (!/^[a-zA-Z0-9-]{1,120}$/.test(value)) throw new AppError('INVALID_PRESET_ID', '预设标识无效')
  return value
}

function normalizeAssetReference(source: string): string | null {
  let value = source.trim().replace(/^zhitu-asset:\/\/workspace\//i, '')
  if (!value || /^(?:data:|https?:|blob:|file:)/i.test(value)) return null
  value = value.split('#')[0]!.split('?')[0]!.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
  if (!value.startsWith('assets/') || value.includes('\0') || value.split('/').includes('..')) return null
  return value
}

function collectAssetReferences(document: MindMapDocument, rootNodeId: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  const visit = (nodeId: string) => {
    const node = document.nodes[nodeId]
    if (!node) return
    const matches = [
      ...node.detailMarkdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g),
      ...node.detailMarkdown.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)
    ]
    for (const match of matches) {
      const normalized = normalizeAssetReference(match[1] ?? '')
      if (!normalized) continue
      const targets = result.get(normalized) ?? []
      targets.push(nodeId)
      result.set(normalized, targets)
    }
    Object.values(document.nodes)
      .filter((child) => child.parentId === nodeId)
      .sort((a, b) => a.order - b.order)
      .forEach((child) => visit(child.id))
  }
  visit(rootNodeId)
  return result
}

function rewriteAssetReferences(
  document: MindMapDocument,
  rootNodeId: string,
  replacements: Map<string, string>
): MindMapDocument {
  const clone = structuredClone(document)
  const visit = (nodeId: string) => {
    const node = clone.nodes[nodeId]
    if (!node) return
    let markdown = node.detailMarkdown
    replacements.forEach((target, source) => { markdown = markdown.replaceAll(source, target) })
    node.detailMarkdown = markdown
    Object.values(clone.nodes)
      .filter((child) => child.parentId === nodeId)
      .forEach((child) => visit(child.id))
  }
  visit(rootNodeId)
  return clone
}

function normalizeStyle(value: unknown): NodeStyle {
  const style = value && typeof value === 'object' ? value as Partial<NodeStyle> : {}
  return {
    color: ['oat', 'moss', 'clay', 'terracotta', 'river', 'plum', 'ink'].includes(String(style.color))
      ? style.color as NodeStyle['color']
      : 'oat',
    shape: ['rounded', 'pill', 'rect', 'underline'].includes(String(style.shape))
      ? style.shape as NodeStyle['shape']
      : 'rounded',
    fontScale: typeof style.fontScale === 'number' && Number.isFinite(style.fontScale)
      ? Math.max(0.7, Math.min(1.5, style.fontScale))
      : 1,
    lineStyle: ['solid', 'dashed', 'dotted'].includes(String(style.lineStyle))
      ? style.lineStyle as NodeStyle['lineStyle']
      : 'solid'
  }
}

function parsePreset(value: unknown): StylePreset | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<StylePreset>
  if (raw.schemaVersion !== 1 || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    id: safePresetId(raw.id),
    name: raw.name.trim().slice(0, 80) || '未命名预设',
    source: raw.source === 'builtin' ? 'builtin' : 'user',
    style: normalizeStyle(raw.style),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now
  }
}

export class TemplateService {
  private readonly root = path.join(app.getPath('userData'), 'templates')
  private readonly presetsPath = path.join(app.getPath('userData'), 'style-presets.json')

  constructor(private readonly workspace: WorkspaceService) {}

  async listTemplates(): Promise<TemplateSummary[]> {
    const builtins = BUILTIN_TEMPLATES.map(templateSummary)
    const user = (await this.readUserTemplates()).map(templateSummary)
    return [...builtins, ...user.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))]
  }

  async getTemplate(id: string): Promise<TemplateDetail> {
    return { template: await this.readTemplate(safeId(id)) }
  }

  async getTemplateModel(id: string): Promise<MindMapTemplate> {
    return this.readTemplate(safeId(id))
  }

  async listAiRecommendationTemplates(): Promise<TemplateSummary[]> {
    return (await this.listTemplates()).filter((item) => item.aiRecommendationEnabled)
  }

  private templateDirectory(id: string): string {
    return path.join(this.root, safeId(id))
  }

  private templatePath(id: string): string {
    return path.join(this.templateDirectory(id), 'template.json')
  }

  private async readUserTemplates(): Promise<MindMapTemplate[]> {
    await fs.mkdir(this.root, { recursive: true })
    const entries = await fs.readdir(this.root, { withFileTypes: true })
    const values: MindMapTemplate[] = []
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      try {
        const template = await readJson<unknown>(this.templatePath(entry.name))
        const parsed = parseMindMapTemplate(template)
        values.push({ ...parsed, id: entry.name, source: 'user' })
      } catch {
        return
      }
    }))
    return values
  }

  private async readTemplate(id: string): Promise<MindMapTemplate> {
    const builtin = BUILTIN_TEMPLATES.find((item) => item.id === id)
    if (builtin) return builtin
    try {
      const parsed = parseMindMapTemplate(await readJson<unknown>(this.templatePath(id)))
      return { ...parsed, id, source: 'user' }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AppError('TEMPLATE_NOT_FOUND', '模板不存在')
      throw new AppError('TEMPLATE_INVALID', '模板文件损坏', error instanceof Error ? error.message : String(error))
    }
  }

  async saveTemplate(input: SaveTemplateInput): Promise<TemplateDetail> {
    const id = randomUUID()
    const { template, files } = await this.buildTemplate(input, id)
    const directory = this.templateDirectory(id)
    await fs.mkdir(directory, { recursive: true })
    for (const [relativePath, buffer] of files) {
      const target = path.join(directory, relativePath)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, buffer, { flag: 'wx' })
    }
    await atomicWrite(this.templatePath(id), JSON.stringify(template, null, 2))
    return { template }
  }

  async updateTemplate(input: UpdateTemplateInput): Promise<TemplateDetail> {
    const current = await this.readTemplate(safeId(input.id))
    if (current.source === 'builtin') throw new AppError('BUILTIN_READONLY', '内置模板不能覆盖')
    const { template, files } = await this.buildTemplate(input, current.id, current)
    const directory = this.templateDirectory(current.id)
    await fs.mkdir(directory, { recursive: true })
    for (const [relativePath, buffer] of files) {
      const target = path.join(directory, relativePath)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, buffer, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      })
    }
    await atomicWrite(this.templatePath(current.id), JSON.stringify(template, null, 2))
    const validAssets = new Set(Object.keys(template.assets))
    for (const entry of await fs.readdir(path.join(directory, 'assets'), { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile()) continue
      const relativePath = `assets/${entry.name}`
      if (!validAssets.has(relativePath)) await fs.unlink(path.join(directory, relativePath)).catch(() => undefined)
    }
    return { template }
  }

  private async buildTemplate(
    input: SaveTemplateInput,
    id: string,
    previous?: MindMapTemplate
  ): Promise<{ template: MindMapTemplate; files: Map<string, Buffer> }> {
    if (!this.workspace.activePath) throw new AppError('NO_WORKSPACE', '请先打开工作区')
    const references = collectAssetReferences(input.document, input.rootNodeId)
    const assets: Record<string, TemplateAsset> = {}
    const files = new Map<string, Buffer>()
    const replacements = new Map<string, string>()
    for (const [sourcePath] of references) {
      const buffer = await this.workspace.readWorkspaceAsset(sourcePath).catch(() => null)
      if (!buffer) throw new AppError('TEMPLATE_ASSET_MISSING', `模板图片不存在：${sourcePath}`)
      const extension = path.extname(sourcePath).toLowerCase()
      const mime = IMAGE_MIME.get(extension)
      if (!mime) throw new AppError('TEMPLATE_ASSET_UNSUPPORTED', `模板图片格式不受支持：${sourcePath}`)
      const digest = sha256(buffer)
      const targetPath = `assets/${digest}${extension === '.jpeg' ? '.jpg' : extension}`
      assets[targetPath] = { path: targetPath, sha256: digest, mime, size: buffer.length }
      files.set(targetPath, buffer)
      replacements.set(sourcePath, targetPath)
    }
    const rewritten = rewriteAssetReferences(input.document, input.rootNodeId, replacements)
    const template = createTemplateSnapshot({
      id,
      name: input.name,
      description: input.description,
      category: input.category,
      source: 'user',
      document: rewritten,
      rootNodeId: input.rootNodeId,
      behaviors: input.behaviors,
      assets,
      aiRecommendationEnabled: previous?.aiRecommendationEnabled ?? false,
      previous
    })
    return { template, files }
  }

  async instantiate(id: string, title?: string): Promise<{ summary: MapSummary; document: MindMapDocument }> {
    const template = await this.readTemplate(safeId(id))
    for (const asset of Object.values(template.assets)) {
      const source = path.join(this.templateDirectory(template.id), asset.path)
      const buffer = await fs.readFile(source).catch(() => null)
      if (!buffer || sha256(buffer) !== asset.sha256) {
        throw new AppError('TEMPLATE_ASSET_INVALID', `模板图片损坏：${asset.path}`)
      }
      await this.workspace.copyWorkspaceAsset(asset.path, buffer)
    }
    const document = buildDocumentFromTemplate(template, title)
    return this.workspace.commitNewMap(document)
  }

  async instantiateAi(id: string, preview: import('@shared/types').AiPreview, title?: string): Promise<{ summary: MapSummary; document: MindMapDocument }> {
    const template = await this.readTemplate(safeId(id))
    for (const asset of Object.values(template.assets)) {
      const source = path.join(this.templateDirectory(template.id), asset.path)
      const buffer = await fs.readFile(source).catch(() => null)
      if (!buffer || sha256(buffer) !== asset.sha256) {
        throw new AppError('TEMPLATE_ASSET_INVALID', `模板图片损坏：${asset.path}`)
      }
      await this.workspace.copyWorkspaceAsset(asset.path, buffer)
    }
    return this.workspace.commitNewMap(createMapFromAiTemplatePreview(template, preview, title))
  }

  async renameTemplate(id: string, name: string): Promise<TemplateDetail> {
    const current = await this.readTemplate(safeId(id))
    if (current.source === 'builtin') throw new AppError('BUILTIN_READONLY', '内置模板不能重命名')
    const base = { ...current, name: name.trim().slice(0, 80) || current.name, updatedAt: new Date().toISOString() }
    const { revision: _revision, ...withoutRevision } = base
    const template: MindMapTemplate = { ...base, revision: computeTemplateRevision(withoutRevision) }
    await atomicWrite(this.templatePath(current.id), JSON.stringify(template, null, 2))
    return { template }
  }

  async setAiRecommendation(id: string, enabled: boolean): Promise<TemplateDetail> {
    const current = await this.readTemplate(safeId(id))
    if (current.source === 'builtin') throw new AppError('BUILTIN_READONLY', '内置模板始终允许 AI 推荐')
    const base = { ...current, aiRecommendationEnabled: Boolean(enabled), updatedAt: new Date().toISOString() }
    const { revision: _revision, ...withoutRevision } = base
    const template: MindMapTemplate = { ...base, revision: computeTemplateRevision(withoutRevision) }
    await atomicWrite(this.templatePath(current.id), JSON.stringify(template, null, 2))
    return { template }
  }

  async setBehaviors(id: string, behaviors: Record<string, TemplateNodeBehavior>): Promise<TemplateDetail> {
    const current = await this.readTemplate(safeId(id))
    if (current.source === 'builtin') throw new AppError('BUILTIN_READONLY', '内置模板行为标记只读')
    const allowed = new Set<TemplateNodeBehavior>(['fixed', 'expandable', 'optional'])
    const nodes = Object.fromEntries(Object.entries(current.nodes).map(([key, node]) => [key, {
      ...node,
      aiBehavior: key === current.rootKey ? 'fixed' : allowed.has(behaviors[key] as TemplateNodeBehavior) ? behaviors[key]! : node.aiBehavior
    }])) as MindMapTemplate['nodes']
    const base = { ...current, nodes, updatedAt: new Date().toISOString() }
    const { revision: _revision, ...withoutRevision } = base
    const template: MindMapTemplate = { ...base, revision: computeTemplateRevision(withoutRevision) }
    await atomicWrite(this.templatePath(current.id), JSON.stringify(template, null, 2))
    return { template }
  }

  async removeTemplate(id: string): Promise<void> {
    const current = await this.readTemplate(safeId(id))
    if (current.source === 'builtin') throw new AppError('BUILTIN_READONLY', '内置模板不能删除')
    await shell.trashItem(this.templateDirectory(current.id))
  }

  private async readPresets(): Promise<StylePreset[]> {
    try {
      const raw = await readJson<unknown>(this.presetsPath)
      if (!Array.isArray(raw)) return []
      return raw.map(parsePreset).filter((item): item is StylePreset => item !== null && item.source === 'user')
    } catch {
      return []
    }
  }

  async listPresets(): Promise<StylePreset[]> {
    return [...BUILTIN_STYLE_PRESETS, ...(await this.readPresets()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))]
  }

  async savePreset(input: SaveStylePresetInput): Promise<StylePreset> {
    const now = new Date().toISOString()
    const preset: StylePreset = {
      schemaVersion: 1,
      id: randomUUID(),
      name: input.name.trim().slice(0, 80) || '未命名预设',
      source: 'user',
      style: normalizeStyle(input.style),
      createdAt: now,
      updatedAt: now
    }
    const presets = await this.readPresets()
    await atomicWrite(this.presetsPath, JSON.stringify([preset, ...presets], null, 2))
    return preset
  }

  async renamePreset(id: string, name: string): Promise<StylePreset> {
    const preset = (await this.readPresets()).find((item) => item.id === safePresetId(id))
    if (!preset) throw new AppError('PRESET_NOT_FOUND', '预设不存在')
    const next: StylePreset = { ...preset, name: name.trim().slice(0, 80) || preset.name, updatedAt: new Date().toISOString() }
    const presets = (await this.readPresets()).map((item) => item.id === preset.id ? next : item)
    await atomicWrite(this.presetsPath, JSON.stringify(presets, null, 2))
    return next
  }

  async removePreset(id: string): Promise<void> {
    const presetId = safePresetId(id)
    if (BUILTIN_STYLE_PRESETS.some((item) => item.id === presetId)) {
      throw new AppError('BUILTIN_READONLY', '内置预设不能删除')
    }
    const presets = await this.readPresets()
    if (!presets.some((item) => item.id === presetId)) throw new AppError('PRESET_NOT_FOUND', '预设不存在')
    await atomicWrite(this.presetsPath, JSON.stringify(presets.filter((item) => item.id !== presetId), null, 2))
  }

  async exportTemplate(id: string): Promise<string | null> {
    const template = await this.readTemplate(safeId(id))
    const selection = await dialog.showSaveDialog({
      title: '导出模板',
      defaultPath: `${template.name.replace(/[<>:"/\\|?*]+/g, ' ').trim() || '知图模板'}.ztemplate`,
      filters: [{ name: '知图模板', extensions: ['ztemplate'] }]
    })
    if (selection.canceled || !selection.filePath) return null
    const files: Record<string, Uint8Array> = {
      'manifest.json': strToU8(JSON.stringify({ packageVersion: 1, template }, null, 2))
    }
    for (const asset of Object.values(template.assets)) {
      const source = path.join(this.templateDirectory(template.id), asset.path)
      const buffer = await fs.readFile(source)
      if (sha256(buffer) !== asset.sha256) throw new AppError('TEMPLATE_ASSET_INVALID', `模板图片损坏：${asset.path}`)
      files[asset.path] = new Uint8Array(buffer)
    }
    await fs.writeFile(selection.filePath, zipSync(files, { level: 6 }))
    return selection.filePath
  }

  async importTemplate(): Promise<TemplateDetail | null> {
    const selection = await dialog.showOpenDialog({
      title: '导入知图模板',
      properties: ['openFile'],
      filters: [{ name: '知图模板', extensions: ['ztemplate'] }]
    })
    if (selection.canceled || !selection.filePaths[0]) return null
    const source = selection.filePaths[0]
    const stat = await fs.stat(source)
    if (!stat.isFile() || stat.size > MAX_TEMPLATE_PACKAGE_BYTES) {
      throw new AppError('TEMPLATE_PACKAGE_TOO_LARGE', '模板包为空或超过 100MB')
    }
    const archive = unzipSync(new Uint8Array(await fs.readFile(source)))
    const entries = Object.entries(archive)
    if (entries.length > MAX_TEMPLATE_ASSETS + 1) throw new AppError('TEMPLATE_PACKAGE_INVALID', '模板包文件数量过多')
    const totalSize = entries.reduce((sum, [, value]) => sum + value.length, 0)
    if (totalSize > MAX_TEMPLATE_UNPACKED_BYTES) throw new AppError('TEMPLATE_PACKAGE_INVALID', '模板包解压后超过 150MB')
    const manifestBytes = archive['manifest.json']
    if (!manifestBytes) throw new AppError('TEMPLATE_PACKAGE_INVALID', '模板包缺少 manifest.json')
    const manifest = JSON.parse(strFromU8(manifestBytes)) as { packageVersion?: unknown; template?: unknown }
    if (manifest.packageVersion !== 1) throw new AppError('TEMPLATE_PACKAGE_VERSION', '模板包版本不受支持')
    const parsed = parseMindMapTemplate(manifest.template)
    const id = randomUUID()
    const now = new Date().toISOString()
    const assets: Record<string, TemplateAsset> = {}
    const files = new Map<string, Buffer>()
    for (const asset of Object.values(parsed.assets)) {
      const bytes = archive[asset.path]
      if (!bytes || sha256(Buffer.from(bytes)) !== asset.sha256) {
        throw new AppError('TEMPLATE_ASSET_INVALID', `模板图片损坏：${asset.path}`)
      }
      const buffer = Buffer.from(bytes)
      assets[asset.path] = { ...asset, size: buffer.length }
      files.set(asset.path, buffer)
    }
    const base = {
      ...parsed,
      id,
      source: 'user' as const,
      createdAt: now,
      updatedAt: now,
      assets,
      aiRecommendationEnabled: false
    }
    const { revision: _revision, ...withoutRevision } = base
    const template: MindMapTemplate = { ...base, revision: computeTemplateRevision(withoutRevision) }
    const directory = this.templateDirectory(id)
    await fs.mkdir(directory, { recursive: true })
    for (const [relativePath, buffer] of files) {
      const target = path.join(directory, relativePath)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, buffer, { flag: 'wx' })
    }
    await atomicWrite(this.templatePath(id), JSON.stringify(template, null, 2))
    return { template }
  }
}
