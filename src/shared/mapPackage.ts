import type { MapPackageAsset, MapPackageManifest, MindMapDocument } from './types'

export const MAP_PACKAGE_VERSION = 1
export const MAP_PACKAGE_KIND = 'map'
export const MAP_PACKAGE_EXTENSION = 'zmap'

export const MAP_PACKAGE_LIMITS = {
  compressedBytes: 100 * 1024 * 1024,
  unpackedBytes: 150 * 1024 * 1024,
  imageBytes: 25 * 1024 * 1024,
  jsonBytes: 10 * 1024 * 1024,
  assets: 200,
  entries: 202
} as const

const PACKAGE_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const MAP_ID_PATTERN = /^[a-zA-Z0-9-]{1,120}$/

export type MapPackageErrorCode =
  | 'MAP_PACKAGE_TOO_LARGE'
  | 'MAP_PACKAGE_INVALID'
  | 'MAP_PACKAGE_VERSION'
  | 'MAP_PACKAGE_PATH_INVALID'
  | 'MAP_PACKAGE_MISSING_ASSET'
  | 'MAP_PACKAGE_ASSET_UNSUPPORTED'
  | 'MAP_PACKAGE_ASSET_INVALID'
  | 'MAP_PACKAGE_STALE'

/** 工程包解析阶段的可携带错误码异常，主进程再转换为 AppError。 */
export class MapPackageError extends Error {
  constructor(readonly code: MapPackageErrorCode, message: string) {
    super(message)
    this.name = 'MapPackageError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

/** 归一化包内条目路径，拒绝绝对路径、盘符与上跳路径；非法时返回 null。 */
export function normalizePackageEntryPath(value: string): string | null {
  if (!value || value.length > 300 || /[\\<>:"|?*\u0000-\u001f]/.test(value) || value.startsWith('/')) return null
  const parts = value.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) return null
  return value
}

/** 工程包只允许 manifest.json、map.json 与 assets/ 目录下的文件。 */
export function isAllowedPackageEntry(value: string): boolean {
  const normalized = normalizePackageEntryPath(value)
  if (!normalized) return false
  if (normalized === 'manifest.json' || normalized === 'map.json') return true
  return normalized.startsWith('assets/') && normalized.length > 'assets/'.length
}

export function parseMapPackageManifest(raw: unknown): MapPackageManifest {
  if (!isRecord(raw)) throw new MapPackageError('MAP_PACKAGE_INVALID', '工程包缺少有效的 manifest.json')
  if (raw.packageVersion !== MAP_PACKAGE_VERSION) {
    throw new MapPackageError('MAP_PACKAGE_VERSION', `工程包版本 ${String(raw.packageVersion ?? '未知')} 不受支持`)
  }
  if (raw.kind !== MAP_PACKAGE_KIND) throw new MapPackageError('MAP_PACKAGE_INVALID', '这不是知图导图工程包')

  const mapInfo = raw.map
  if (!isRecord(mapInfo)) throw new MapPackageError('MAP_PACKAGE_INVALID', '工程包缺少导图信息')
  const mapId = cleanText(mapInfo.id, 120)
  if (!MAP_ID_PATTERN.test(mapId)) throw new MapPackageError('MAP_PACKAGE_PATH_INVALID', '工程包中的导图标识无效')
  const title = cleanText(mapInfo.title, 200) || '未命名导图'
  const createdAt = cleanText(mapInfo.createdAt, 80) || new Date().toISOString()
  const updatedAt = cleanText(mapInfo.updatedAt, 80) || createdAt
  const nodeCount = isFiniteNumber(mapInfo.nodeCount) && mapInfo.nodeCount >= 0 ? Math.floor(mapInfo.nodeCount) : 0

  const assetsRaw = raw.assets ?? {}
  if (!isRecord(assetsRaw)) throw new MapPackageError('MAP_PACKAGE_INVALID', '工程包资源清单无效')
  if (Object.keys(assetsRaw).length > MAP_PACKAGE_LIMITS.assets) throw new MapPackageError('MAP_PACKAGE_TOO_LARGE', '工程包图片数量过多')
  const assets: Record<string, MapPackageAsset> = {}
  const assetNames = new Set<string>()
  for (const [key, value] of Object.entries(assetsRaw)) {
    if (!isRecord(value)) throw new MapPackageError('MAP_PACKAGE_ASSET_INVALID', `工程包资源条目无效：${key}`)
    const assetPath = typeof value.path === 'string' ? value.path : ''
    if (key !== assetPath || !assetPath.startsWith('assets/') || !isAllowedPackageEntry(assetPath)) {
      throw new MapPackageError('MAP_PACKAGE_PATH_INVALID', `工程包资源路径无效：${assetPath || key}`)
    }
    if (assetNames.has(assetPath.toLowerCase())) throw new MapPackageError('MAP_PACKAGE_PATH_INVALID', '工程包资源路径冲突')
    assetNames.add(assetPath.toLowerCase())
    if (typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)) {
      throw new MapPackageError('MAP_PACKAGE_ASSET_INVALID', `工程包资源校验值无效：${assetPath}`)
    }
    if (typeof value.mime !== 'string' || !PACKAGE_IMAGE_MIME.has(value.mime)) {
      throw new MapPackageError('MAP_PACKAGE_ASSET_UNSUPPORTED', `工程包图片格式不受支持：${assetPath}`)
    }
    if (!isFiniteNumber(value.size) || !Number.isSafeInteger(value.size) || value.size <= 0 || value.size > MAP_PACKAGE_LIMITS.imageBytes) {
      throw new MapPackageError('MAP_PACKAGE_ASSET_INVALID', `工程包资源大小无效：${assetPath}`)
    }
    assets[assetPath] = { path: assetPath, sha256: value.sha256, mime: value.mime, size: Math.floor(value.size) }
  }

  return {
    packageVersion: MAP_PACKAGE_VERSION,
    kind: MAP_PACKAGE_KIND,
    appVersion: cleanText(raw.appVersion, 40),
    exportedAt: cleanText(raw.exportedAt, 80) || createdAt,
    map: { id: mapId, title, nodeCount, createdAt, updatedAt },
    assets
  }
}

/**
 * 重建导图内全部节点 id 与根节点引用，用于「保留两者」式导入。
 * 树结构与节点顺序不变，仅 id 与 parentId 改写。
 */
export function remapNodeIds(
  document: MindMapDocument,
  idFactory: () => string = () => crypto.randomUUID()
): MindMapDocument {
  const currentRoot = document.nodes[document.rootId]
  if (!currentRoot) throw new MapPackageError('MAP_PACKAGE_INVALID', '工程包中的导图缺少根节点')
  const ids = new Map<string, string>()
  for (const nodeId of Object.keys(document.nodes)) ids.set(nodeId, idFactory())
  const nodes = Object.fromEntries(
    Object.values(document.nodes).map((node) => {
      const id = ids.get(node.id)!
      return [id, {
        ...node,
        id,
        parentId: node.parentId ? ids.get(node.parentId) ?? null : null,
        style: { ...node.style },
        manualOffset: { ...node.manualOffset }
      }]
    })
  ) as MindMapDocument['nodes']
  return { ...document, rootId: ids.get(document.rootId)!, nodes }
}

/** 生成不与现有导图重名的导入标题：原标题（导入）、原标题（导入 2）…… */
export function uniqueImportedTitle(title: string, existingTitles: Iterable<string>): string {
  const base = title.trim().slice(0, 180) || '未命名导图'
  const taken = new Set(Array.from(existingTitles, (item) => item.trim()))
  const first = `${base}（导入）`
  if (!taken.has(first)) return first
  let index = 2
  while (taken.has(`${base}（导入 ${index}）`)) index += 1
  return `${base}（导入 ${index}）`
}