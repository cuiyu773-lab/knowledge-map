import { app, dialog } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { collectAssetReferences } from '@shared/assetReferences'
import {
  MAP_PACKAGE_VERSION,
  MapPackageError,
  isAllowedPackageEntry,
  parseMapPackageManifest,
  remapNodeIds,
  uniqueImportedTitle
} from '@shared/mapPackage'
import { parseMindMapDocument } from '@shared/schema'
import type {
  MapImportStrategy,
  MapPackageAsset,
  MapPackageImportResult,
  MapPackageManifest,
  MapPackagePreview,
  MindMapDocument
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
const MAX_MAP_PACKAGE_BYTES = 100 * 1024 * 1024
const MAX_MAP_UNPACKED_BYTES = 150 * 1024 * 1024
const MAX_MAP_ASSETS = 200

function sha256(buffer: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function safeFileName(value: string): string {
  const normalized = value.replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized.slice(0, 80) || '知图导图'
}

function normalizedExtension(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase()
  return extension === '.jpeg' ? '.jpg' : extension
}

function toAppError(error: unknown, fallback: string): AppError {
  if (error instanceof MapPackageError) return new AppError(error.code, error.message)
  return new AppError('MAP_PACKAGE_INVALID', error instanceof Error ? error.message : fallback)
}

interface PendingImport {
  importId: string
  workspacePath: string
  sourcePath: string
  document: MindMapDocument
  assets: Map<string, Buffer>
}

export class MapPackageService {
  private pending: PendingImport | null = null

  constructor(private readonly workspace: WorkspaceService) {}

  /**
   * 导出单张导图为 .zmap 工程包。
   * 传入的是渲染层当前内存中的导图，包含尚未落盘的改动。
   */
  async exportPackage(document: MindMapDocument): Promise<string | null> {
    const workspacePath = this.workspace.activePath
    if (!workspacePath) throw new AppError('NO_WORKSPACE', '请先打开工作区')

    let parsed: MindMapDocument
    try {
      parsed = parseMindMapDocument(document)
    } catch (error) {
      throw new AppError('MAP_PACKAGE_INVALID', '当前导图数据无效', error instanceof Error ? error.message : String(error))
    }

    const references = collectAssetReferences(parsed, parsed.rootId)
    if (references.size > MAX_MAP_ASSETS) {
      throw new AppError('MAP_PACKAGE_TOO_LARGE', `导图包含的图片超过 ${MAX_MAP_ASSETS} 张，无法打包`)
    }

    const assets: Record<string, MapPackageAsset> = {}
    const files: Record<string, Uint8Array> = {}
    for (const sourcePath of references.keys()) {
      const extension = normalizedExtension(sourcePath)
      const mime = IMAGE_MIME.get(extension)
      if (!mime) throw new AppError('MAP_PACKAGE_ASSET_UNSUPPORTED', `导图图片格式不受支持：${sourcePath}`)
      const buffer = await this.workspace.readWorkspaceAsset(sourcePath).catch(() => null)
      if (!buffer) throw new AppError('MAP_PACKAGE_MISSING_ASSET', `导图引用的图片不存在：${sourcePath}`)
      assets[sourcePath] = { path: sourcePath, sha256: sha256(buffer), mime, size: buffer.length }
      files[sourcePath] = new Uint8Array(buffer)
    }

    const selection = await dialog.showSaveDialog({
      title: '导出工程包',
      defaultPath: `${safeFileName(parsed.title)}.zmap`,
      filters: [{ name: '知图工程包', extensions: ['zmap'] }]
    })
    if (selection.canceled || !selection.filePath) return null

    const manifest: MapPackageManifest = {
      packageVersion: MAP_PACKAGE_VERSION,
      kind: 'map',
      appVersion: app.getVersion(),
      exportedAt: new Date().toISOString(),
      map: {
        id: parsed.id,
        title: parsed.title,
        nodeCount: Object.keys(parsed.nodes).length,
        createdAt: parsed.createdAt,
        updatedAt: parsed.updatedAt
      },
      assets
    }

    const archive: Record<string, Uint8Array> = {
      'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
      'map.json': strToU8(`${JSON.stringify(parsed, null, 2)}\n`),
      ...files
    }
    const bytes = zipSync(archive, { level: 6 })
    if (bytes.length > MAX_MAP_PACKAGE_BYTES) {
      throw new AppError('MAP_PACKAGE_TOO_LARGE', '工程包超过 100MB，无法导出')
    }
    await fs.writeFile(selection.filePath, bytes)
    return selection.filePath
  }

  /** 选择工程包并完成全部校验，返回给用户确认的预览信息。 */
  async prepareImport(): Promise<MapPackagePreview | null> {
    const workspacePath = this.workspace.activePath
    if (!workspacePath) throw new AppError('NO_WORKSPACE', '请先打开工作区')

    const selection = await dialog.showOpenDialog({
      title: '导入工程包',
      properties: ['openFile'],
      filters: [{ name: '知图工程包', extensions: ['zmap'] }]
    })
    if (selection.canceled || !selection.filePaths[0]) return null
    const sourcePath = selection.filePaths[0]

    const stat = await fs.stat(sourcePath).catch(() => null)
    if (!stat || !stat.isFile()) throw new AppError('MAP_PACKAGE_INVALID', '工程包文件不存在')
    if (stat.size <= 0 || stat.size > MAX_MAP_PACKAGE_BYTES) {
      throw new AppError('MAP_PACKAGE_TOO_LARGE', '工程包为空或超过 100MB')
    }

    let archive: Record<string, Uint8Array>
    try {
      archive = unzipSync(new Uint8Array(await fs.readFile(sourcePath)))
    } catch {
      throw new AppError('MAP_PACKAGE_INVALID', '工程包无法解压，文件可能已损坏')
    }

    const entries = Object.entries(archive)
    if (entries.length > MAX_MAP_ASSETS + 2) throw new AppError('MAP_PACKAGE_TOO_LARGE', '工程包文件数量过多')
    const totalSize = entries.reduce((sum, [, value]) => sum + value.length, 0)
    if (totalSize > MAX_MAP_UNPACKED_BYTES) {
      throw new AppError('MAP_PACKAGE_TOO_LARGE', '工程包解压后超过 150MB')
    }
    for (const [entryPath] of entries) {
      if (!isAllowedPackageEntry(entryPath)) {
        throw new AppError('MAP_PACKAGE_PATH_INVALID', `工程包含有非法路径：${entryPath}`)
      }
    }

    const manifestBytes = archive['manifest.json']
    if (!manifestBytes) throw new AppError('MAP_PACKAGE_INVALID', '工程包缺少 manifest.json')
    const mapBytes = archive['map.json']
    if (!mapBytes) throw new AppError('MAP_PACKAGE_INVALID', '工程包缺少 map.json')

    let manifest: MapPackageManifest
    try {
      manifest = parseMapPackageManifest(JSON.parse(strFromU8(manifestBytes)))
    } catch (error) {
      throw toAppError(error, '工程包清单无效')
    }

    let document: MindMapDocument
    try {
      document = parseMindMapDocument(JSON.parse(strFromU8(mapBytes)))
    } catch (error) {
      throw new AppError(
        'MAP_PACKAGE_INVALID',
        '工程包中的导图数据无效',
        error instanceof Error ? error.message : String(error)
      )
    }
    if (document.id !== manifest.map.id) throw new AppError('MAP_PACKAGE_INVALID', '工程包清单与导图标识不一致')

    const assets = new Map<string, Buffer>()
    for (const asset of Object.values(manifest.assets)) {
      const bytes = archive[asset.path]
      if (!bytes) throw new AppError('MAP_PACKAGE_ASSET_INVALID', `工程包缺少图片：${asset.path}`)
      const buffer = Buffer.from(bytes)
      if (buffer.length !== asset.size || sha256(buffer) !== asset.sha256) {
        throw new AppError('MAP_PACKAGE_ASSET_INVALID', `工程包图片已损坏：${asset.path}`)
      }
      assets.set(asset.path, buffer)
    }

    for (const reference of collectAssetReferences(document, document.rootId).keys()) {
      if (!assets.has(reference)) {
        throw new AppError('MAP_PACKAGE_MISSING_ASSET', `工程包缺少导图引用的图片：${reference}`)
      }
    }

    const importId = randomUUID()
    const existingTitle = await this.existingMapTitle(document.id)
    this.pending = { importId, workspacePath, sourcePath, document, assets }
    return {
      importId,
      title: document.title,
      nodeCount: Object.keys(document.nodes).length,
      assetCount: assets.size,
      totalBytes: stat.size,
      exportedAt: manifest.exportedAt,
      conflict: existingTitle === null ? null : { mapId: document.id, title: existingTitle }
    }
  }

  /** 按用户确认的方式写入工程包内容。 */
  async commitImport(importId: string, strategy: MapImportStrategy): Promise<MapPackageImportResult> {
    const pending = this.pending
    if (!pending || pending.importId !== importId || pending.workspacePath !== this.workspace.activePath) {
      throw new AppError('MAP_PACKAGE_STALE', '导入已失效，请重新选择工程包')
    }
    if (strategy !== 'overwrite' && strategy !== 'rename') {
      throw new AppError('MAP_PACKAGE_INVALID', '不支持的导入方式')
    }
    // 提交即作废，避免同一份预览被重复导入。
    this.pending = null

    for (const [relativePath, buffer] of pending.assets) {
      await this.workspace.copyWorkspaceAsset(relativePath, buffer)
    }

    if (strategy === 'overwrite') {
      const exists = (await this.workspace.mapHash(pending.document.id)) !== null
      if (exists) await this.workspace.createSnapshot(pending.document.id)
      const result = await this.workspace.createMapFromDocument(pending.document)
      return { ...result, overwritten: exists }
    }

    const existingTitles = (await this.workspace.listMaps()).map((item) => item.title)
    const document = {
      ...remapNodeIds(pending.document),
      title: uniqueImportedTitle(pending.document.title, existingTitles)
    }
    const result = await this.workspace.commitNewMap(document)
    return { ...result, overwritten: false }
  }

  /** 返回工作区中同 id 导图的标题，不存在时返回 null。 */
  private async existingMapTitle(mapId: string): Promise<string | null> {
    if ((await this.workspace.mapHash(mapId)) === null) return null
    const listed = (await this.workspace.listMaps()).find((item) => item.id === mapId)
    return listed?.title ?? mapId
  }
}