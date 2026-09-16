import {
  SCHEMA_VERSION,
  type MindMapDocument,
  type MindNode,
  type NodeStyle,
  type WorkspaceMeta
} from './types'

export const DEFAULT_NODE_STYLE: NodeStyle = {
  color: 'oat',
  shape: 'rounded',
  fontScale: 1,
  lineStyle: 'solid'
}

export function createNode(
  id: string,
  parentId: string | null,
  order: number,
  title = '新主题'
): MindNode {
  return {
    id,
    parentId,
    order,
    title,
    summary: '',
    detailMarkdown: '',
    style: { ...DEFAULT_NODE_STYLE },
    collapsed: false,
    manualOffset: { x: 0, y: 0 }
  }
}

export function createMindMapDocument(
  id: string,
  rootId: string,
  title = '未命名导图',
  now = new Date().toISOString()
): MindMapDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    title,
    createdAt: now,
    updatedAt: now,
    rootId,
    nodes: {
      [rootId]: createNode(rootId, null, 0, title)
    },
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}

export function createWorkspaceMeta(
  id: string,
  name: string,
  now = new Date().toISOString()
): WorkspaceMeta {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    mapOrder: []
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNode(value: unknown): value is MindNode {
  if (!isRecord(value)) return false
  if (value.style !== undefined && !isRecord(value.style)) return false
  if (value.manualOffset !== undefined && !isRecord(value.manualOffset)) return false
  return (
    typeof value.id === 'string' &&
    (typeof value.parentId === 'string' || value.parentId === null) &&
    isFiniteNumber(value.order) &&
    typeof value.title === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.detailMarkdown === 'string' &&
    typeof value.collapsed === 'boolean' &&
    (value.manualOffset === undefined || (isFiniteNumber(value.manualOffset.x) && isFiniteNumber(value.manualOffset.y)))
  )
}

export function parseMindMapDocument(raw: unknown): MindMapDocument {
  if (!isRecord(raw)) throw new Error('导图文件不是有效的 JSON 对象')
  const version = raw.schemaVersion
  if (!isFiniteNumber(version)) throw new Error('导图文件缺少 schemaVersion')
  if (version > SCHEMA_VERSION) {
    throw new Error(`导图版本 ${version} 高于当前支持的版本 ${SCHEMA_VERSION}`)
  }
  if (!Array.isArray(Object.values(raw.nodes ?? {})) && !isRecord(raw.nodes)) {
    throw new Error('导图文件缺少节点表')
  }
  const doc = raw as unknown as MindMapDocument
  if (
    typeof doc.id !== 'string' ||
    typeof doc.title !== 'string' ||
    typeof doc.createdAt !== 'string' ||
    typeof doc.updatedAt !== 'string' ||
    typeof doc.rootId !== 'string' ||
    !isRecord(doc.nodes) ||
    !isRecord(doc.viewport)
  ) {
    throw new Error('导图文件字段不完整')
  }
  const nodes = Object.values(doc.nodes)
  if (!nodes.length || nodes.some((node) => !isNode(node))) throw new Error('导图节点数据无效')
  if (!doc.nodes[doc.rootId]) throw new Error('导图根节点不存在')

  const migrated: MindMapDocument = {
    ...doc,
    schemaVersion: SCHEMA_VERSION,
    nodes: Object.fromEntries(
      nodes.map((node) => [
        node.id,
        {
          ...node,
          style: { ...DEFAULT_NODE_STYLE, ...node.style },
          manualOffset: node.manualOffset ? { x: node.manualOffset.x, y: node.manualOffset.y } : { x: 0, y: 0 }
        }
      ])
    )
  }
  return migrated
}

export function parseWorkspaceMeta(raw: unknown): WorkspaceMeta {
  if (!isRecord(raw)) throw new Error('workspace.json 不是有效的对象')
  if (!isFiniteNumber(raw.schemaVersion) || raw.schemaVersion > SCHEMA_VERSION) {
    throw new Error('工作区版本不受支持')
  }
  if (
    typeof raw.id !== 'string' ||
    typeof raw.name !== 'string' ||
    typeof raw.createdAt !== 'string' ||
    typeof raw.updatedAt !== 'string' ||
    !Array.isArray(raw.mapOrder)
  ) {
    throw new Error('workspace.json 字段不完整')
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    id: raw.id,
    name: raw.name,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    mapOrder: raw.mapOrder.filter((id): id is string => typeof id === 'string')
  }
}

