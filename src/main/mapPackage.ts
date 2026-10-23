import { app, dialog } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { strFromU8, strToU8, zipSync } from 'fflate'
import { collectAssetReferences, rewriteDocumentAssetReferences } from '@shared/assetReferences'
import {
  MAP_PACKAGE_VERSION,
  MAP_PACKAGE_LIMITS,
  MapPackageError,
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
import { validateImage } from './imageAsset'
import { readMapPackageArchive } from './mapPackageArchive'
import type { WorkspaceService } from './workspace'

function sha256(buffer: Buffer | Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function safeFileName(value: string): string {
  const normalized = value.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized.slice(0, 80) || '知图导图'
}

function toAppError(error: unknown, fallback: string): AppError {
  if (error instanceof AppError) return error
  if (error instanceof MapPackageError) return new AppError(error.code, error.message)
  return new AppError('MAP_PACKAGE_INVALID', fallback, String(error))
}

interface PendingImport {
  importId: string
  workspacePath: string
  document: MindMapDocument
  assets: Map<string, Buffer>
}

export class MapPackageService {
  private pending: PendingImport | null = null

  constructor(private readonly workspace: WorkspaceService) {}

  /** 导出渲染层当前导图，包括尚未保存的修改。 */
  async exportPackage(document: MindMapDocument): Promise<string | null> {
    const workspacePath = this.workspace.activePath
    if (!workspacePath) throw new AppError('NO_WORKSPACE', '请先打开工作区')
    let parsed: MindMapDocument
    try {
      parsed = parseMindMapDocument(document)
    } catch (error) {
      throw new AppError('MAP_PACKAGE_INVALID', '当前导图数据无效', String(error))
    }
    if (Buffer.byteLength(JSON.stringify(parsed), 'utf8') > MAP_PACKAGE_LIMITS.jsonBytes) {
      throw new AppError('MAP_PACKAGE_TOO_LARGE', '工程包导图 JSON 超过 10MB，无法导出')
    }
    const references = collectAssetReferences(parsed, parsed.rootId)
    if (references.size > MAP_PACKAGE_LIMITS.assets) {
      throw new AppError('MAP_PACKAGE_TOO_LARGE', '导图图片超过 200 张，无法打包')
    }
    const assets: Record<string, MapPackageAsset> = {}
    const files: Record<string, Uint8Array> = {}
    const replacements = new Map<string, string>()
    let unpackedBytes = 0
    for (const sourcePath of references.keys()) {
      if (this.workspace.activePath !== workspacePath) throw new AppError('MAP_PACKAGE_STALE', '工作区已变化')
      const buffer = await this.workspace.readWorkspaceAsset(sourcePath, MAP_PACKAGE_LIMITS.imageBytes).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') throw new AppError('MAP_PACKAGE_MISSING_ASSET', '导图引用的图片不存在：' + sourcePath)
        throw error
      })
      if (!buffer) throw new AppError('MAP_PACKAGE_MISSING_ASSET', '导图引用的图片不存在：' + sourcePath)
      const { extension, mime } = validateImage(buffer, sourcePath)
      const digest = sha256(buffer)
      const target = 'assets/' + digest + extension
      replacements.set(sourcePath, target)
      if (files[target]) continue
      unpackedBytes += buffer.length
      if (unpackedBytes > MAP_PACKAGE_LIMITS.unpackedBytes) throw new AppError('MAP_PACKAGE_TOO_LARGE', '工程包解压后超过 150MB，无法导出')
      assets[target] = { path: target, sha256: digest, mime, size: buffer.length }
      files[target] = buffer
    }
    const packagedDocument = rewriteDocumentAssetReferences(parsed, replacements)
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
    const manifestBytes = strToU8(JSON.stringify(manifest, null, 2))
    const mapBytes = strToU8(JSON.stringify(packagedDocument, null, 2) + '\n')
    if (manifestBytes.length > MAP_PACKAGE_LIMITS.jsonBytes || mapBytes.length > MAP_PACKAGE_LIMITS.jsonBytes ||
        unpackedBytes + manifestBytes.length + mapBytes.length > MAP_PACKAGE_LIMITS.unpackedBytes) {
      throw new AppError('MAP_PACKAGE_TOO_LARGE', '工程包解压后的数据超过大小限制，无法导出')
    }
    const selection = await dialog.showSaveDialog({
      title: '导出工程包',
      defaultPath: safeFileName(parsed.title) + '.zmap',
      filters: [{ name: '知图工程包', extensions: ['zmap'] }]
    })
    if (selection.canceled || !selection.filePath) return null
    const bytes = zipSync({ 'manifest.json': manifestBytes, 'map.json': mapBytes, ...files }, { level: 6 })
    if (bytes.length > MAP_PACKAGE_LIMITS.compressedBytes) throw new AppError('MAP_PACKAGE_TOO_LARGE', '工程包超过 100MB，无法导出')
    await fs.writeFile(selection.filePath, bytes)
    return selection.filePath
  }

  /** 按实际读取量限制文件大小，避免 stat 后文件增长绕过限制。 */
  private async readArchive(sourcePath: string): Promise<{ archive: Record<string, Uint8Array>; totalBytes: number }> {
    const file = await fs.open(sourcePath, 'r')
    try {
      const stat = await file.stat()
      if (!stat.isFile()) throw new AppError('MAP_PACKAGE_INVALID', '工程包不是普通文件')
      if (!stat.size || stat.size > MAP_PACKAGE_LIMITS.compressedBytes) throw new MapPackageError('MAP_PACKAGE_TOO_LARGE', '工程包为空或超过 100MB')
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of file.createReadStream({ highWaterMark: 65536, autoClose: false })) {
        const buffer = chunk as Buffer
        size += buffer.length
        if (size > MAP_PACKAGE_LIMITS.compressedBytes) throw new MapPackageError('MAP_PACKAGE_TOO_LARGE', '工程包超过 100MB')
        chunks.push(buffer)
      }
      return { archive: await readMapPackageArchive(Buffer.concat(chunks, size)), totalBytes: size }
    } finally {
      await file.close()
    }
  }

  /** 选择工程包并校验全部内容，预览阶段不写工作区。 */
  async prepareImport(): Promise<MapPackagePreview | null> {
    this.pending = null
    const workspacePath = this.workspace.activePath
    if (!workspacePath) throw new AppError('NO_WORKSPACE', '请先打开工作区')
    const selection = await dialog.showOpenDialog({
      title: '导入工程包',
      properties: ['openFile'],
      filters: [{ name: '知图工程包', extensions: ['zmap'] }]
    })
    if (selection.canceled || !selection.filePaths[0]) return null
    let archive: Record<string, Uint8Array>
    let totalBytes: number
    try {
      ({ archive, totalBytes } = await this.readArchive(selection.filePaths[0]))
    } catch (error) {
      throw toAppError(error, '工程包无法解压，文件可能已损坏')
    }
    const manifestBytes = archive['manifest.json']
    const mapBytes = archive['map.json']
    if (!manifestBytes || !mapBytes) throw new AppError('MAP_PACKAGE_INVALID', '工程包缺少 manifest.json 或 map.json')
    let manifest: MapPackageManifest
    let document: MindMapDocument
    try {
      manifest = parseMapPackageManifest(JSON.parse(strFromU8(manifestBytes)))
      document = parseMindMapDocument(JSON.parse(strFromU8(mapBytes)))
    } catch (error) {
      throw toAppError(error, '工程包清单或导图数据无效')
    }
    if (document.id !== manifest.map.id || Object.keys(document.nodes).length !== manifest.map.nodeCount) {
      throw new AppError('MAP_PACKAGE_INVALID', '工程包清单与导图标识或节点数量不一致')
    }
    const assets = new Map<string, Buffer>()
    const replacements = new Map<string, string>()
    for (const asset of Object.values(manifest.assets)) {
      const bytes = archive[asset.path]
      if (!bytes) throw new AppError('MAP_PACKAGE_ASSET_INVALID', '工程包缺少图片：' + asset.path)
      const buffer = Buffer.from(bytes)
      if (buffer.length !== asset.size || sha256(buffer) !== asset.sha256) throw new AppError('MAP_PACKAGE_ASSET_INVALID', '工程包图片已损坏：' + asset.path)
      let extension: string
      try {
        extension = validateImage(buffer, asset.path, asset.mime).extension
      } catch (error) {
        throw new AppError('MAP_PACKAGE_ASSET_INVALID', '工程包图片内容或格式无效：' + asset.path, String(error))
      }
      const target = 'assets/' + asset.sha256 + extension
      replacements.set(asset.path, target)
      assets.set(target, buffer)
    }
    for (const reference of collectAssetReferences(document, document.rootId).keys()) {
      if (!replacements.has(reference)) throw new AppError('MAP_PACKAGE_MISSING_ASSET', '工程包缺少导图引用的图片：' + reference)
    }
    for (const entry of Object.keys(archive)) {
      if (entry.startsWith('assets/') && !Object.hasOwn(manifest.assets, entry)) {
        throw new AppError('MAP_PACKAGE_ASSET_INVALID', '工程包含有未在清单声明的资源：' + entry)
      }
    }
    document = rewriteDocumentAssetReferences(document, replacements)
    if (this.workspace.activePath !== workspacePath) throw new AppError('MAP_PACKAGE_STALE', '工作区已变化，请重新导入')
    const importId = randomUUID()
    const existingTitle = await this.existingMapTitle(document.id)
    this.pending = { importId, workspacePath, document, assets }
    return {
      importId,
      title: document.title,
      nodeCount: Object.keys(document.nodes).length,
      assetCount: assets.size,
      totalBytes,
      exportedAt: manifest.exportedAt,
      conflict: existingTitle === null ? null : { mapId: document.id, title: existingTitle }
    }
  }

  /** 按确认策略以事务方式提交，拒绝重复或跨工作区提交。 */
  async commitImport(importId: string, strategy: MapImportStrategy): Promise<MapPackageImportResult> {
    const pending = this.pending
    if (!pending || pending.importId !== importId || pending.workspacePath !== this.workspace.activePath) {
      throw new AppError('MAP_PACKAGE_STALE', '导入已失效，请重新选择工程包')
    }
    if (strategy !== 'overwrite' && strategy !== 'rename') throw new AppError('MAP_PACKAGE_INVALID', '不支持的导入方式')
    this.pending = null
    let document = pending.document
    if (strategy === 'rename') {
      const existingTitles = (await this.workspace.listMaps()).map((item) => item.title)
      document = { ...remapNodeIds(document), title: uniqueImportedTitle(document.title, existingTitles) }
    }
    return this.workspace.importMapPackage(document, pending.assets, strategy === 'overwrite', pending.workspacePath)
  }

  private async existingMapTitle(mapId: string): Promise<string | null> {
    if ((await this.workspace.mapHash(mapId)) === null) return null
    const listed = (await this.workspace.listMaps()).find((item) => item.id === mapId)
    return listed?.title ?? mapId
  }
}
