import { DEFAULT_NODE_STYLE, createNode } from './schema'
import { getChildren } from './tree'
import type {
  MindMapDocument,
  MindMapTemplate,
  NodeStyle,
  TemplateApplyScope,
  TemplateAsset,
  TemplateCategory,
  TemplateNode,
  TemplateNodeBehavior,
  TemplateSource,
  TemplateSummary
} from './types'

export const TEMPLATE_SCHEMA_VERSION = 1
export const TEMPLATE_CATEGORIES: Array<{ value: TemplateCategory; label: string }> = [
  { value: 'course', label: '课程' },
  { value: 'reading', label: '阅读' },
  { value: 'review', label: '复习' },
  { value: 'research', label: '研究' },
  { value: 'analysis', label: '问题分析' },
  { value: 'other', label: '其他' }
]

const TEMPLATE_CATEGORY_VALUES = new Set<TemplateCategory>(TEMPLATE_CATEGORIES.map((item) => item.value))
const TEMPLATE_BEHAVIOR_VALUES = new Set<TemplateNodeBehavior>(['fixed', 'expandable', 'optional'])

export interface CreateTemplateSnapshotInput {
  id: string
  name: string
  description: string
  category: TemplateCategory
  source: TemplateSource
  document: MindMapDocument
  rootNodeId: string
  behaviors: Record<string, TemplateNodeBehavior>
  assets: Record<string, TemplateAsset>
  aiRecommendationEnabled: boolean
  now?: string
  previous?: MindMapTemplate
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function hashText(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function normalizeTemplateCategory(value: unknown): TemplateCategory {
  return typeof value === 'string' && TEMPLATE_CATEGORY_VALUES.has(value as TemplateCategory)
    ? value as TemplateCategory
    : 'other'
}

export function normalizeTemplateBehavior(value: unknown): TemplateNodeBehavior {
  return typeof value === 'string' && TEMPLATE_BEHAVIOR_VALUES.has(value as TemplateNodeBehavior)
    ? value as TemplateNodeBehavior
    : 'expandable'
}

function normalizeStyle(value: unknown): NodeStyle {
  if (!isRecord(value)) return { ...DEFAULT_NODE_STYLE }
  return {
    color: ['oat', 'moss', 'clay', 'terracotta', 'river', 'plum', 'ink'].includes(String(value.color))
      ? value.color as NodeStyle['color']
      : DEFAULT_NODE_STYLE.color,
    shape: ['rounded', 'pill', 'rect', 'underline'].includes(String(value.shape))
      ? value.shape as NodeStyle['shape']
      : DEFAULT_NODE_STYLE.shape,
    fontScale: isFiniteNumber(value.fontScale)
      ? Math.max(0.7, Math.min(1.5, value.fontScale))
      : DEFAULT_NODE_STYLE.fontScale,
    lineStyle: ['solid', 'dashed', 'dotted'].includes(String(value.lineStyle))
      ? value.lineStyle as NodeStyle['lineStyle']
      : DEFAULT_NODE_STYLE.lineStyle
  }
}

function templateNodeFromDocument(
  document: MindMapDocument,
  nodeId: string,
  behaviors: Record<string, TemplateNodeBehavior>,
  rootNodeId: string,
  manualOffsetBase?: { x: number; y: number }
): TemplateNode | null {
  const node = document.nodes[nodeId]
  if (!node) return null
  return {
    key: node.id,
    parentKey: node.id === rootNodeId ? null : node.parentId,
    order: node.order,
    title: node.title,
    summary: node.summary,
    detailMarkdown: node.detailMarkdown,
    style: { ...node.style },
    collapsed: node.collapsed,
    manualOffset: {
      x: node.manualOffset.x - (manualOffsetBase?.x ?? 0),
      y: node.manualOffset.y - (manualOffsetBase?.y ?? 0)
    },
    aiBehavior: node.id === rootNodeId ? 'fixed' : normalizeTemplateBehavior(behaviors[node.id])
  }
}

export function computeTemplateRevision(template: Omit<MindMapTemplate, 'revision'>): string {
  const value = JSON.stringify({
    name: template.name,
    description: template.description,
    category: template.category,
    kind: template.kind,
    title: template.title,
    rootKey: template.rootKey,
    nodes: template.nodes,
    assets: template.assets,
    variables: template.variables,
    aiRecommendationEnabled: template.aiRecommendationEnabled
  })
  return hashText(value)
}

export function createTemplateSnapshot(input: CreateTemplateSnapshotInput): MindMapTemplate {
  const root = input.document.nodes[input.rootNodeId]
  if (!root) throw new Error('模板根节点不存在')
  const nodes: Record<string, TemplateNode> = {}
  const visit = (nodeId: string) => {
    const templateNode = templateNodeFromDocument(
      input.document,
      nodeId,
      input.behaviors,
      input.rootNodeId,
      input.rootNodeId === input.document.rootId ? undefined : root.manualOffset
    )
    if (!templateNode) return
    nodes[nodeId] = templateNode
    getChildren(input.document, nodeId).forEach((child) => visit(child.id))
  }
  visit(input.rootNodeId)
  const now = input.now ?? new Date().toISOString()
  const base: Omit<MindMapTemplate, 'revision'> = {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    id: input.id,
    name: cleanText(input.name, 80) || '未命名模板',
    description: cleanText(input.description, 240),
    category: normalizeTemplateCategory(input.category),
    kind: input.rootNodeId === input.document.rootId ? 'map' : 'subtree',
    source: input.source,
    createdAt: input.previous?.createdAt ?? now,
    updatedAt: now,
    title: root.title,
    rootKey: root.id,
    nodes,
    assets: input.assets,
    viewport: input.rootNodeId === input.document.rootId
      ? { ...input.document.viewport }
      : { x: 0, y: 0, zoom: 1 },
    variables: input.previous?.variables ?? [],
    aiRecommendationEnabled: input.source === 'builtin' ? true : input.aiRecommendationEnabled
  }
  return { ...base, revision: computeTemplateRevision(base) }
}
function parseNode(value: unknown): TemplateNode | null {
  if (!isRecord(value)) return null
  const key = cleanText(value.key, 160)
  const parentKey = value.parentKey === null ? null : cleanText(value.parentKey, 160)
  if (!key || (parentKey !== null && !parentKey) || typeof value.title !== 'string') return null
  if (!isFiniteNumber(value.order) || typeof value.summary !== 'string' || typeof value.detailMarkdown !== 'string') return null
  const offset = isRecord(value.manualOffset) ? value.manualOffset : {}
  return {
    key,
    parentKey,
    order: value.order,
    title: value.title.slice(0, 200),
    summary: value.summary.slice(0, 280),
    detailMarkdown: value.detailMarkdown,
    style: normalizeStyle(value.style),
    collapsed: value.collapsed === true,
    manualOffset: {
      x: isFiniteNumber(offset.x) ? offset.x : 0,
      y: isFiniteNumber(offset.y) ? offset.y : 0
    },
    aiBehavior: normalizeTemplateBehavior(value.aiBehavior)
  }
}

function parseAsset(value: unknown): TemplateAsset | null {
  if (!isRecord(value)) return null
  const assetPath = cleanText(value.path, 240)
  const sha256 = cleanText(value.sha256, 64)
  const mime = cleanText(value.mime, 80)
  const size = value.size
  if (!assetPath || !/^assets\/[a-f0-9]+\.[a-z0-9]+$/i.test(assetPath) || !/^[a-f0-9]{64}$/i.test(sha256)) return null
  if (!isFiniteNumber(size) || size < 0) return null
  return { path: assetPath, sha256: sha256.toLowerCase(), mime, size }
}

export function parseMindMapTemplate(raw: unknown): MindMapTemplate {
  if (!isRecord(raw)) throw new Error('模板文件不是有效的 JSON 对象')
  if (raw.schemaVersion !== TEMPLATE_SCHEMA_VERSION) throw new Error('模板版本不受支持')
  const id = cleanText(raw.id, 120)
  const source = raw.source === 'builtin' ? 'builtin' : 'user'
  const kind = raw.kind === 'subtree' ? 'subtree' : 'map'
  const rootKey = cleanText(raw.rootKey, 160)
  if (!id || !rootKey || !isRecord(raw.nodes) || !isRecord(raw.assets)) throw new Error('模板字段不完整')
  const nodes = Object.fromEntries(
    Object.values(raw.nodes).map((item) => {
      const node = parseNode(item)
      return node ? [node.key, node] : null
    }).filter((item): item is [string, TemplateNode] => item !== null)
  )
  if (!Object.keys(nodes).length || !nodes[rootKey]) throw new Error('模板节点数据无效')
  for (const node of Object.values(nodes)) {
    if (node.parentKey && !nodes[node.parentKey]) throw new Error('模板父子关系无效')
  }
  nodes[rootKey] = { ...nodes[rootKey]!, parentKey: null, aiBehavior: 'fixed' }
  const assets = Object.fromEntries(
    Object.values(raw.assets).map((item) => {
      const asset = parseAsset(item)
      return asset ? [asset.path, asset] : null
    }).filter((item): item is [string, TemplateAsset] => item !== null)
  )
  const viewport = isRecord(raw.viewport) ? raw.viewport : {}
  const variables = Array.isArray(raw.variables)
    ? raw.variables.flatMap((item) => {
        if (!isRecord(item)) return []
        const key = cleanText(item.key, 80)
        const label = cleanText(item.label, 80)
        if (!key || !label) return []
        return [{ key, label, ...(typeof item.defaultValue === 'string' ? { defaultValue: item.defaultValue.slice(0, 200) } : {}) }]
      })
    : []
  const now = new Date().toISOString()
  const base: Omit<MindMapTemplate, 'revision'> = {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    id,
    name: cleanText(raw.name, 80) || '未命名模板',
    description: cleanText(raw.description, 240),
    category: normalizeTemplateCategory(raw.category),
    kind,
    source,
    createdAt: cleanText(raw.createdAt, 80) || now,
    updatedAt: cleanText(raw.updatedAt, 80) || now,
    title: cleanText(raw.title, 200) || nodes[rootKey]!.title,
    rootKey,
    nodes,
    assets,
    viewport: {
      x: isFiniteNumber(viewport.x) ? viewport.x : 0,
      y: isFiniteNumber(viewport.y) ? viewport.y : 0,
      zoom: isFiniteNumber(viewport.zoom) ? Math.max(0.2, Math.min(3, viewport.zoom)) : 1
    },
    variables,
    aiRecommendationEnabled: source === 'builtin' || raw.aiRecommendationEnabled === true
  }
  return { ...base, revision: computeTemplateRevision(base) }
}

export function templateSummary(template: MindMapTemplate): TemplateSummary {
  const rootChildren = Object.values(template.nodes)
    .filter((node) => node.parentKey === template.rootKey)
    .sort((a, b) => a.order - b.order)
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    kind: template.kind,
    source: template.source,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    revision: template.revision,
    nodeCount: Object.keys(template.nodes).length,
    assetCount: Object.keys(template.assets).length,
    topLevelTitles: rootChildren.map((node) => node.title).slice(0, 8),
    aiRecommendationEnabled: template.aiRecommendationEnabled
  }
}

export function instantiateTemplate(
  template: MindMapTemplate,
  title = template.name,
  now = new Date().toISOString(),
  idFactory: () => string = () => crypto.randomUUID()
): MindMapDocument {
  const ids = Object.fromEntries(Object.keys(template.nodes).map((key) => [key, idFactory()])) as Record<string, string>
  const nodes = Object.fromEntries(
    Object.values(template.nodes).map((templateNode) => {
      const id = ids[templateNode.key]!
      return [id, {
        id,
        parentId: templateNode.parentKey ? ids[templateNode.parentKey]! : null,
        order: templateNode.order,
        title: templateNode.title,
        summary: templateNode.summary,
        detailMarkdown: templateNode.detailMarkdown,
        style: { ...templateNode.style },
        collapsed: templateNode.collapsed,
        manualOffset: { ...templateNode.manualOffset }
      }]
    })
  ) as MindMapDocument['nodes']
  const rootId = ids[template.rootKey]!
  nodes[rootId] = { ...nodes[rootId]!, parentId: null }
  return {
    schemaVersion: 1,
    id: idFactory(),
    title: cleanText(title, 200) || template.name,
    createdAt: now,
    updatedAt: now,
    rootId,
    nodes,
    viewport: template.kind === 'map' ? { ...template.viewport } : { x: 0, y: 0, zoom: 1 }
  }
}

export function applyStylePreset(
  document: MindMapDocument,
  nodeId: string,
  scope: TemplateApplyScope,
  style: NodeStyle,
  now = new Date().toISOString()
): MindMapDocument {
  if (!document.nodes[nodeId]) return document
  const targetIds = scope === 'map'
    ? Object.keys(document.nodes)
    : scope === 'node'
      ? [nodeId]
      : [nodeId, ...descendantIds(document, nodeId)]
  const nodes = { ...document.nodes }
  for (const id of targetIds) {
    const node = nodes[id]
    if (node) nodes[id] = { ...node, style: { ...style } }
  }
  return { ...document, nodes, updatedAt: now }
}

function descendantIds(document: MindMapDocument, nodeId: string): string[] {
  return getChildren(document, nodeId).flatMap((child) => [child.id, ...descendantIds(document, child.id)])
}

export function templateSkeletonForAi(template: MindMapTemplate): string {
  const serialize = (key: string, depth: number): string => {
    const node = template.nodes[key]
    if (!node) return ''
    const behavior = node.key === template.rootKey ? 'fixed' : node.aiBehavior
    const summary = node.summary ? `｜${node.summary}` : ''
    const current = `${'  '.repeat(depth)}- [${node.key}] (${behavior}) ${node.title}${summary}`
    const children = Object.values(template.nodes)
      .filter((item) => item.parentKey === key)
      .sort((a, b) => a.order - b.order)
      .map((child) => serialize(child.key, depth + 1))
    return [current, ...children].filter(Boolean).join('\n')
  }
  return serialize(template.rootKey, 0).slice(0, 20_000)
}

export function defaultTemplateId(): string {
  return crypto.randomUUID()
}
