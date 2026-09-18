import { app, dialog, shell } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { importMarkdownToMindMap } from '@shared/markdown'
import {
  createMindMapDocument,
  createWorkspaceMeta,
  parseMindMapDocument,
  parseWorkspaceMeta
} from '@shared/schema'
import type {
  ApiResult,
  AppSettings,
  ExportRequest,
  MapReadResult,
  MapSummary,
  MindMapDocument,
  RecentWorkspace,
  SnapshotSummary,
  WorkspaceDescriptor,
  WorkspaceMeta
} from '@shared/types'
import { AppError } from './errors'
import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from '@shared/settings'

export { AppError } from './errors'

const IMAGE_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif']
])

function nowIso(): string {
  return new Date().toISOString()
}

function safeName(value: string): string {
  const normalized = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized.slice(0, 80) || '学习工作区'
}

function sha256(buffer: Buffer | string): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function extensionOf(filePath: string): string {
  return path.extname(filePath).toLowerCase()
}

function assertSafeRelative(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('\0') || normalized.split('/').includes('..')) {
    throw new AppError('INVALID_PATH', '素材路径无效')
  }
  return normalized
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temporary, content, 'utf8')
  await fs.rename(temporary, filePath)
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T
}

export class WorkspaceService {
  private workspacePath: string | null = null
  private meta: WorkspaceMeta | null = null
  private readonly settingsPath = path.join(app.getPath('userData'), 'settings.json')
  private readonly recentsPath = path.join(app.getPath('userData'), 'recent-workspaces.json')

  get activePath(): string | null {
    return this.workspacePath
  }

  resolveAsset(relativePath: string): string {
    if (!this.workspacePath) throw new AppError('NO_WORKSPACE', '尚未打开工作区')
    const normalized = assertSafeRelative(relativePath)
    const base = path.resolve(this.workspacePath, 'assets')
    const resolved = path.resolve(base, normalized.replace(/^assets\//, ''))
    if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
      throw new AppError('INVALID_PATH', '素材路径越界')
    }
    return resolved
  }

  async readSettings(): Promise<AppSettings> {
    try {
      return normalizeAppSettings(await readJson<unknown>(this.settingsPath))
    } catch {
      return normalizeAppSettings(DEFAULT_APP_SETTINGS)
    }
  }

  async writeSettings(settings: AppSettings): Promise<AppSettings> {
    const normalized = normalizeAppSettings(settings)
    await atomicWrite(this.settingsPath, JSON.stringify(normalized, null, 2))
    return normalized
  }

  private async readRecents(): Promise<RecentWorkspace[]> {
    try {
      const values = await readJson<RecentWorkspace[]>(this.recentsPath)
      return Array.isArray(values) ? values : []
    } catch {
      return []
    }
  }

  private async rememberWorkspace(descriptor: WorkspaceDescriptor): Promise<void> {
    const recents = await this.readRecents()
    const next = [
      { path: descriptor.path, name: descriptor.meta.name, lastOpenedAt: nowIso() },
      ...recents.filter((item) => path.resolve(item.path) !== path.resolve(descriptor.path))
    ].slice(0, 8)
    await atomicWrite(this.recentsPath, JSON.stringify(next, null, 2))
  }

  async getRecentWorkspaces(): Promise<RecentWorkspace[]> {
    return this.readRecents()
  }

  async createWorkspace(name: string): Promise<ApiResult<WorkspaceDescriptor>> {
    const selection = await dialog.showOpenDialog({
      title: '选择工作区保存位置',
      properties: ['openDirectory', 'createDirectory']
    })
    if (selection.canceled || !selection.filePaths[0]) {
      return { ok: false, error: { code: 'CANCELED', message: '已取消新建工作区' } }
    }
    const workspacePath = path.join(selection.filePaths[0], safeName(name))
    try {
      await fs.mkdir(workspacePath, { recursive: false })
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'WORKSPACE_EXISTS',
          message: '目标目录已存在，请换一个名称或位置',
          detail: error instanceof Error ? error.message : String(error)
        }
      }
    }
    await Promise.all([
      fs.mkdir(path.join(workspacePath, 'maps'), { recursive: true }),
      fs.mkdir(path.join(workspacePath, 'assets'), { recursive: true }),
      fs.mkdir(path.join(workspacePath, '.history'), { recursive: true })
    ])
    const meta = createWorkspaceMeta(randomUUID(), name.trim() || path.basename(workspacePath))
    await atomicWrite(path.join(workspacePath, 'workspace.json'), JSON.stringify(meta, null, 2))
    const descriptor = await this.openWorkspacePath(workspacePath)
    return { ok: true, value: descriptor }
  }

  async chooseWorkspace(): Promise<ApiResult<WorkspaceDescriptor>> {
    const selection = await dialog.showOpenDialog({
      title: '打开知图工作区',
      properties: ['openDirectory']
    })
    if (selection.canceled || !selection.filePaths[0]) {
      return { ok: false, error: { code: 'CANCELED', message: '已取消打开工作区' } }
    }
    try {
      return { ok: true, value: await this.openWorkspacePath(selection.filePaths[0]) }
    } catch (error) {
      return { ok: false, error: this.errorFrom(error) }
    }
  }

  async openWorkspacePath(workspacePath: string): Promise<WorkspaceDescriptor> {
    const absolute = path.resolve(workspacePath)
    const rawMeta = await readJson<unknown>(path.join(absolute, 'workspace.json'))
    const meta = parseWorkspaceMeta(rawMeta)
    await Promise.all([
      fs.mkdir(path.join(absolute, 'maps'), { recursive: true }),
      fs.mkdir(path.join(absolute, 'assets'), { recursive: true }),
      fs.mkdir(path.join(absolute, '.history'), { recursive: true })
    ])
    this.workspacePath = absolute
    this.meta = meta
    const descriptor = { path: absolute, meta, maps: await this.listMaps() }
    await this.rememberWorkspace(descriptor)
    return descriptor
  }

  async closeWorkspace(): Promise<void> {
    this.workspacePath = null
    this.meta = null
  }

  private assertOpen(): string {
    if (!this.workspacePath) throw new AppError('NO_WORKSPACE', '尚未打开工作区')
    return this.workspacePath
  }

  private mapPath(mapId: string): string {
    if (!/^[a-zA-Z0-9-]+$/.test(mapId)) throw new AppError('INVALID_ID', '导图 ID 无效')
    return path.join(this.assertOpen(), 'maps', `${mapId}.mindmap.json`)
  }

  async listMaps(): Promise<MapSummary[]> {
    const workspacePath = this.assertOpen()
    const mapDir = path.join(workspacePath, 'maps')
    const entries = await fs.readdir(mapDir, { withFileTypes: true })
    const summaries = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.mindmap.json'))
        .map(async (entry): Promise<MapSummary | null> => {
          try {
            const fileName = entry.name
            const raw = await readJson<unknown>(path.join(mapDir, fileName))
            const document = parseMindMapDocument(raw)
            return {
              id: document.id,
              title: document.title,
              createdAt: document.createdAt,
              updatedAt: document.updatedAt,
              fileName,
              nodeCount: Object.keys(document.nodes).length
            }
          } catch {
            return null
          }
        })
    )
    const valid = summaries.filter((item): item is MapSummary => item !== null)
    const order = this.meta?.mapOrder ?? []
    return valid.sort((a, b) => {
      const ai = order.indexOf(a.id)
      const bi = order.indexOf(b.id)
      if (ai >= 0 || bi >= 0) return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi)
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  }

  async createMap(title = '未命名导图'): Promise<{ summary: MapSummary; document: MindMapDocument }> {
    const id = randomUUID()
    const document = createMindMapDocument(id, randomUUID(), title)
    await this.writeMapFile(document)
    const summary = await this.summaryFor(document)
    await this.syncMapOrder()
    return { summary, document }
  }

  private async writeMapFile(document: MindMapDocument): Promise<string> {
    const content = `${JSON.stringify(document, null, 2)}\n`
    await atomicWrite(this.mapPath(document.id), content)
    return sha256(content)
  }

  private async summaryFor(document: MindMapDocument): Promise<MapSummary> {
    return {
      id: document.id,
      title: document.title,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      fileName: `${document.id}.mindmap.json`,
      nodeCount: Object.keys(document.nodes).length
    }
  }

  private async syncMapOrder(): Promise<void> {
    if (!this.workspacePath || !this.meta) return
    const summaries = await this.listMaps()
    this.meta = { ...this.meta, mapOrder: summaries.map((item) => item.id), updatedAt: nowIso() }
    await atomicWrite(path.join(this.workspacePath, 'workspace.json'), JSON.stringify(this.meta, null, 2))
  }

  async readMap(mapId: string): Promise<MapReadResult> {
    const filePath = this.mapPath(mapId)
    const content = await fs.readFile(filePath, 'utf8')
    let document: MindMapDocument
    try {
      document = parseMindMapDocument(JSON.parse(content))
    } catch (error) {
      throw new AppError(
        'CORRUPT_MAP',
        '导图文件损坏或版本过高，已阻止写入',
        error instanceof Error ? error.message : String(error)
      )
    }
    return { document, hash: sha256(content), readOnly: false }
  }

  async mapHash(mapId: string): Promise<string | null> {
    try {
      return sha256(await fs.readFile(this.mapPath(mapId)))
    } catch {
      return null
    }
  }

  async saveMap(
    document: MindMapDocument,
    expectedHash?: string,
    force = false
  ): Promise<{ hash: string }> {
    if (!force && expectedHash) {
      const current = await this.mapHash(document.id)
      if (current && current !== expectedHash) {
        throw new AppError('FILE_CONFLICT', '文件已在其他位置被修改', current)
      }
    }
    const content = `${JSON.stringify(document, null, 2)}\n`
    await atomicWrite(this.mapPath(document.id), content)
    await this.syncMapOrder()
    return { hash: sha256(content) }
  }

  async saveMapCopy(document: MindMapDocument): Promise<string | null> {
    const selection = await dialog.showSaveDialog({
      title: '另存导图副本',
      defaultPath: `${safeName(document.title)}.mindmap.json`,
      filters: [{ name: '知图工程', extensions: ['json'] }]
    })
    if (selection.canceled || !selection.filePath) return null
    await fs.writeFile(selection.filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    return selection.filePath
  }

  async trashMap(mapId: string): Promise<void> {
    await this.createSnapshot(mapId)
    await shell.trashItem(this.mapPath(mapId))
    const sessionPath = path.join(this.assertOpen(), 'maps', `${mapId}.ai-session.json`)
    await shell.trashItem(sessionPath).catch(() => undefined)
    await this.syncMapOrder()
  }

  async createSnapshot(mapId: string): Promise<SnapshotSummary> {
    const read = await this.readMap(mapId)
    const directory = path.join(this.assertOpen(), '.history', mapId)
    await fs.mkdir(directory, { recursive: true })
    const fileName = `${Date.now()}.snapshot.json`
    const content = `${JSON.stringify(read.document, null, 2)}\n`
    await atomicWrite(path.join(directory, fileName), content)
    await this.pruneSnapshots(mapId)
    return { fileName, createdAt: read.document.updatedAt, size: Buffer.byteLength(content) }
  }

  private async pruneSnapshots(mapId: string): Promise<void> {
    const directory = path.join(this.assertOpen(), '.history', mapId)
    const entries = await fs.readdir(directory).catch(() => [])
    const snapshots = entries
      .filter((entry) => entry.endsWith('.snapshot.json'))
      .sort((a, b) => b.localeCompare(a))
    await Promise.all(snapshots.slice(20).map((entry) => fs.unlink(path.join(directory, entry))))
  }

  async listSnapshots(mapId: string): Promise<SnapshotSummary[]> {
    const directory = path.join(this.assertOpen(), '.history', mapId)
    const entries = await fs.readdir(directory).catch(() => [])
    return Promise.all(
      entries
        .filter((entry) => entry.endsWith('.snapshot.json'))
        .sort((a, b) => b.localeCompare(a))
        .map(async (fileName) => {
          const stat = await fs.stat(path.join(directory, fileName))
          const raw = await readJson<MindMapDocument>(path.join(directory, fileName))
          return { fileName, createdAt: raw.updatedAt, size: stat.size }
        })
    )
  }

  async restoreSnapshot(mapId: string, fileName: string): Promise<MindMapDocument> {
    if (!/^\d+\.snapshot\.json$/.test(fileName)) throw new AppError('INVALID_PATH', '快照文件名无效')
    const filePath = path.join(this.assertOpen(), '.history', mapId, fileName)
    await this.createSnapshot(mapId).catch(() => undefined)
    return parseMindMapDocument(await readJson<unknown>(filePath))
  }

  private async importAssetBuffer(buffer: Buffer, originalName: string): Promise<string> {
    const extension = extensionOf(originalName)
    if (!IMAGE_TYPES.has(extension)) {
      throw new AppError('UNSUPPORTED_IMAGE', '仅支持 PNG、JPEG、WebP 和 GIF 图片')
    }
    if (buffer.length > 25 * 1024 * 1024) throw new AppError('IMAGE_TOO_LARGE', '单张图片不能超过 25MB')
    const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const isJpeg = buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    const isGif = ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))
    const isWebp = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    if (
      (extension === '.png' && !isPng) ||
      ((extension === '.jpg' || extension === '.jpeg') && !isJpeg) ||
      (extension === '.gif' && !isGif) ||
      (extension === '.webp' && !isWebp)
    ) {
      throw new AppError('INVALID_IMAGE', '图片内容与扩展名不匹配')
    }
    const hash = sha256(buffer).slice(0, 32)
    const relativePath = `assets/${hash}${extension === '.jpeg' ? '.jpg' : extension}`
    const target = this.resolveAsset(relativePath)
    await fs.writeFile(target, buffer, { flag: 'wx' }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    return relativePath
  }

  async importAssetDialog(): Promise<string | null> {
    const selection = await dialog.showOpenDialog({
      title: '插入图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    })
    if (selection.canceled || !selection.filePaths[0]) return null
    const source = selection.filePaths[0]
    return this.importAssetBuffer(await fs.readFile(source), source)
  }

  async importAssetBytes(bytes: number[], name: string): Promise<string> {
    return this.importAssetBuffer(Buffer.from(bytes), name)
  }

  async importMarkdown(): Promise<{
    document: MindMapDocument
    summary: MapSummary
    warnings: string[]
  } | null> {
    const selection = await dialog.showOpenDialog({
      title: '导入 Markdown',
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    })
    if (selection.canceled || !selection.filePaths[0]) return null
    const sourcePath = selection.filePaths[0]
    const sourceDirectory = path.dirname(sourcePath)
    const markdown = await fs.readFile(sourcePath, 'utf8')
    const result = await importMarkdownToMindMap({
      fileName: path.basename(sourcePath),
      markdown,
      rewriteImage: async (source) => {
        if (/^[a-z]+:\/\//i.test(source)) return source
        const decoded = decodeURIComponent(source.split('#')[0]?.split('?')[0] ?? source)
        const absolute = path.resolve(sourceDirectory, decoded)
        const buffer = await fs.readFile(absolute)
        return this.importAssetBuffer(buffer, absolute)
      }
    })
    await this.writeMapFile(result.document)
    const summary = await this.summaryFor(result.document)
    await this.syncMapOrder()
    return { document: result.document, summary, warnings: result.warnings }
  }

  async saveExport(request: ExportRequest): Promise<string | null> {
    const extensions = { png: 'png', svg: 'svg', pdf: 'pdf' } as const
    const selection = await dialog.showSaveDialog({
      title: '导出导图',
      defaultPath: `${safeName(request.defaultName)}.${extensions[request.format]}`,
      filters: [{ name: request.format.toUpperCase(), extensions: [extensions[request.format]] }]
    })
    if (selection.canceled || !selection.filePath) return null
    const commaIndex = request.data.indexOf(',')
    const base64 = commaIndex >= 0 ? request.data.slice(commaIndex + 1) : request.data
    await fs.writeFile(selection.filePath, Buffer.from(base64, 'base64'))
    return selection.filePath
  }

  private errorFrom(error: unknown) {
    if (error instanceof AppError) {
      return { code: error.code, message: error.message, detail: error.detail }
    }
    return {
      code: 'UNEXPECTED',
      message: error instanceof Error ? error.message : '发生未知错误'
    }
  }
}

