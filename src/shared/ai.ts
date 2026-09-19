import { DEFAULT_NODE_STYLE } from './schema'
import type {
  AiPreview,
  AiPreviewNode,
  AiPreviewStrategy,
  AiQuestion,
  AiSession,
  MindMapDocument,
  MindMapTemplate,
  MindNode,
  NodeStyle
} from './types'
import { getChildren, getNodePath } from './tree'

const MAX_PREVIEW_NODES = 100
const MAP_CONTEXT_LIMIT = 20_000

export const MAX_AI_MATERIALS = 10

export function normalizeAiMaterialIds(value: unknown, max = MAX_AI_MATERIALS): string[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (!id || ids.has(id)) continue
    ids.add(id)
    if (ids.size >= max) break
  }
  return [...ids]
}

export function toggleAiMaterialId(value: unknown, id: string, max = MAX_AI_MATERIALS): string[] {
  const ids = normalizeAiMaterialIds(value, max)
  if (ids.includes(id)) return ids.filter((item) => item !== id)
  return [...ids, id].slice(0, max)
}

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createAiSession(mapId: string | null, draftId: string | null): AiSession {
  return {
    schemaVersion: 1,
    mapId,
    draftId,
    targetNodeId: null,
    mode: 'new',
    scale: 'standard',
    includeFullMap: false,
    materialIds: [],
    messages: [],
    pendingQuestions: [],
    clarificationRound: 0,
    pendingPreview: null,
    updatedAt: new Date().toISOString()
  }
}

export function parseModelJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON 对象')
  return JSON.parse(trimmed.slice(start, end + 1)) as unknown
}

export function parseAiQuestions(raw: unknown): AiQuestion[] {
  if (!isRecord(raw) || !Array.isArray(raw.questions)) return []
  return raw.questions
    .slice(0, 3)
    .map((item, index) => {
      if (!isRecord(item)) return null
      const question = cleanText(item.question, 240)
      if (!question) return null
      const options = Array.isArray(item.options)
        ? item.options.map((option) => cleanText(option, 80)).filter(Boolean).slice(0, 6)
        : undefined
      return {
        id: cleanText(item.id, 60) || `question-${index + 1}`,
        question,
        ...(options?.length ? { options } : {})
      }
    })
    .filter((item): item is AiQuestion => item !== null)
}

function previewNodeFromUnknown(raw: unknown, budget: { remaining: number }): AiPreviewNode | null {
  if (!isRecord(raw) || budget.remaining <= 0) return null
  const title = cleanText(raw.title, 80)
  if (!title) return null
  budget.remaining -= 1
  const children = Array.isArray(raw.children)
    ? raw.children
        .map((child) => previewNodeFromUnknown(child, budget))
        .filter((child): child is AiPreviewNode => child !== null)
    : []
  return {
    id: createId(),
    title,
    summary: cleanText(raw.summary, 240),
    detailMarkdown: cleanText(raw.detailMarkdown, 4_000),
    included: raw.included !== false,
    children
  }
}

function templateRawIndex(raw: unknown): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>()
  const visit = (value: unknown) => {
    if (!isRecord(value)) return
    const key = cleanText(value.templateKey ?? value.templateNodeKey ?? value.key, 160)
    if (key) result.set(key, value)
    if (Array.isArray(value.children)) value.children.forEach(visit)
  }
  visit(raw)
  return result
}

function createPreviewNode(raw: unknown, budget: { remaining: number }): AiPreviewNode | null {
  if (!isRecord(raw) || budget.remaining <= 0) return null
  const title = cleanText(raw.title, 80)
  if (!title) return null
  budget.remaining -= 1
  const children = Array.isArray(raw.children)
    ? raw.children.map((child) => createPreviewNode(child, budget)).filter((child): child is AiPreviewNode => child !== null)
    : []
  return {
    id: createId(),
    title,
    summary: cleanText(raw.summary, 240),
    detailMarkdown: cleanText(raw.detailMarkdown, 4_000),
    included: raw.included !== false,
    children
  }
}

function mergeTemplatePreview(
  raw: unknown,
  template: MindMapTemplate,
  targetNodeId?: string
): AiPreview {
  if (!isRecord(raw)) throw new Error('模型返回的大纲格式无效')
  const rawIndex = templateRawIndex(raw)
  const corrections = { restored: 0, replaced: 0, ignored: 0 }
  const budget = { remaining: MAX_PREVIEW_NODES }

  const childrenOf = (value: Record<string, unknown> | undefined): unknown[] =>
    value && Array.isArray(value.children) ? value.children : []

  const buildNewNode = (rawNode: unknown): AiPreviewNode | null => {
    const node = createPreviewNode(rawNode, budget)
    if (!node) {
      if (rawNode) corrections.ignored += 1
      return null
    }
    return node
  }

  const buildTemplateNode = (key: string): AiPreviewNode | null => {
    const templateNode = template.nodes[key]
    if (!templateNode || budget.remaining <= 0) return null
    const rawNode = rawIndex.get(key)
    if (!rawNode && templateNode.aiBehavior === 'optional') return null
    if (!rawNode) corrections.restored += 1
    if (rawNode?.included === false && templateNode.aiBehavior === 'optional') return null
    const changedTitle = Boolean(rawNode && cleanText(rawNode.title, 80) && cleanText(rawNode.title, 80) !== templateNode.title)
    const changedProtectedSummary = Boolean(rawNode && templateNode.summary && cleanText(rawNode.summary, 240) !== templateNode.summary)
    const changedProtectedDetail = Boolean(rawNode && templateNode.detailMarkdown && cleanText(rawNode.detailMarkdown, 4_000) !== templateNode.detailMarkdown)
    if (changedTitle || changedProtectedSummary || changedProtectedDetail) {
      corrections.replaced += 1
    }
    budget.remaining -= 1
    const canFill = templateNode.aiBehavior !== 'fixed'
    const summary = templateNode.summary || (canFill ? cleanText(rawNode?.summary, 240) : '')
    const detailMarkdown = templateNode.detailMarkdown || (canFill ? cleanText(rawNode?.detailMarkdown, 4_000) : '')
    const templateChildren = Object.values(template.nodes)
      .filter((item) => item.parentKey === key)
      .sort((a, b) => a.order - b.order)
      .map((item) => buildTemplateNode(item.key))
      .filter((item): item is AiPreviewNode => item !== null)
    const extraChildren: AiPreviewNode[] = []
    if (canFill) {
      for (const childRaw of childrenOf(rawNode)) {
        if (!isRecord(childRaw)) continue
        if (cleanText(childRaw.templateKey ?? childRaw.templateNodeKey ?? childRaw.key, 160)) continue
        const child = buildNewNode(childRaw)
        if (child) extraChildren.push(child)
      }
    } else {
      corrections.ignored += childrenOf(rawNode).filter((child) =>
        isRecord(child) && !cleanText(child.templateKey ?? child.templateNodeKey ?? child.key, 160)
      ).length
    }
    return {
      id: createId(),
      title: templateNode.title,
      summary,
      detailMarkdown,
      included: true,
      locked: templateNode.aiBehavior === 'fixed',
      templateNodeKey: key,
      aiBehavior: templateNode.aiBehavior,
      children: [...templateChildren, ...extraChildren]
    }
  }

  const root = buildTemplateNode(template.rootKey)
  if (!root) throw new Error('模板根节点无效')
  return {
    title: root.title,
    summary: root.summary,
    children: root.children,
    ...(targetNodeId ? { targetNodeId } : {}),
    corrections,
    createdAt: new Date().toISOString()
  }
}

export function parseAiPreview(raw: unknown, targetNodeId?: string, template?: MindMapTemplate): AiPreview {
  if (template) return mergeTemplatePreview(raw, template, targetNodeId)
  if (!isRecord(raw)) throw new Error('模型返回的大纲格式无效')
  const budget = { remaining: MAX_PREVIEW_NODES }
  const children = Array.isArray(raw.children)
    ? raw.children
        .map((child) => previewNodeFromUnknown(child, budget))
        .filter((child): child is AiPreviewNode => child !== null)
    : []
  const title = cleanText(raw.title, 80) || 'AI 生成导图'
  if (!children.length && !cleanText(raw.summary, 240)) {
    throw new Error('模型没有生成可用的主题节点')
  }
  return {
    title,
    summary: cleanText(raw.summary, 240),
    children,
    ...(targetNodeId ? { targetNodeId } : {}),
    createdAt: new Date().toISOString()
  }
}

export function normalizeComparableTitle(title: string): string {
  return title
    .trim()
    .toLocaleLowerCase('zh-CN')
    .replace(/\s+/g, '')
    .replace(/[。；;，,：:、!！?？]+$/g, '')
}

function createBranch(
  node: AiPreviewNode,
  parentId: string,
  order: number,
  nodes: Record<string, MindNode>
): void {
  if (!node.included) return
  const id = createId()
  nodes[id] = {
    id,
    parentId,
    order,
    title: node.title,
    summary: node.summary,
    detailMarkdown: node.detailMarkdown ?? '',
    style: { ...DEFAULT_NODE_STYLE },
    collapsed: false,
    manualOffset: { x: 0, y: 0 }
  }
  node.children.forEach((child, index) => createBranch(child, id, index, nodes))
}

function descendantIds(document: MindMapDocument, parentId: string): string[] {
  return getChildren(document, parentId).flatMap((child) => [
    child.id,
    ...descendantIds(document, child.id)
  ])
}

function mergeBranches(
  document: MindMapDocument,
  parentId: string,
  branches: AiPreviewNode[],
  nodes: Record<string, MindNode>
): void {
  const existing = getChildren({ ...document, nodes }, parentId)
  let nextOrder = existing.length
  for (const branch of branches) {
    if (!branch.included) continue
    const comparable = normalizeComparableTitle(branch.title)
    const matched = existing.find((node) => normalizeComparableTitle(node.title) === comparable)
    if (!matched) {
      createBranch(branch, parentId, nextOrder, nodes)
      nextOrder += 1
      continue
    }
    nodes[matched.id] = {
      ...matched,
      summary: branch.summary || matched.summary,
      detailMarkdown: (branch.detailMarkdown ?? '') || matched.detailMarkdown
    }
    mergeBranches({ ...document, nodes }, matched.id, branch.children, nodes)
  }
}

export function applyAiPreview(
  document: MindMapDocument,
  targetNodeId: string,
  preview: AiPreview,
  strategy: AiPreviewStrategy
): MindMapDocument {
  const target = document.nodes[targetNodeId]
  if (!target) return document
  const nodes = { ...document.nodes }
  if (strategy === 'replace') {
    const removed = new Set(descendantIds(document, targetNodeId))
    for (const id of removed) delete nodes[id]
  }
  if (strategy === 'merge') {
    mergeBranches(document, targetNodeId, preview.children, nodes)
  } else {
    const existingCount = getChildren({ ...document, nodes }, targetNodeId).length
    preview.children.forEach((child, index) => createBranch(child, targetNodeId, existingCount + index, nodes))
  }
  return { ...document, nodes, updatedAt: new Date().toISOString() }
}

export function createRootFromAiPreview(
  document: MindMapDocument,
  preview: AiPreview
): MindMapDocument {
  const root = document.nodes[document.rootId]
  if (!root) return document
  const nodes = {
    ...document.nodes,
    [root.id]: {
      ...root,
      title: preview.title,
      summary: preview.summary,
      detailMarkdown: ''
    }
  }
  preview.children.forEach((child, index) => createBranch(child, root.id, index, nodes))
  return {
    ...document,
    title: preview.title,
    nodes,
    updatedAt: new Date().toISOString()
  }
}

export function createMapFromAiTemplatePreview(
  template: MindMapTemplate,
  preview: AiPreview,
  title = template.name,
  now = new Date().toISOString(),
  idFactory: () => string = createId
): MindMapDocument {
  const nodes: Record<string, MindNode> = {}
  const createNode = (
    previewNode: AiPreviewNode,
    parentId: string | null,
    order: number,
    inheritedStyle?: NodeStyle
  ): string | null => {
    if (!previewNode.included) return null
    const id = idFactory()
    const templateNode = previewNode.templateNodeKey ? template.nodes[previewNode.templateNodeKey] : undefined
    const style = templateNode?.style ?? inheritedStyle ?? DEFAULT_NODE_STYLE
    nodes[id] = {
      id,
      parentId,
      order,
      title: previewNode.title,
      summary: previewNode.summary,
      detailMarkdown: previewNode.detailMarkdown ?? '',
      style: { ...style },
      collapsed: templateNode?.collapsed ?? false,
      manualOffset: templateNode ? { ...templateNode.manualOffset } : { x: 0, y: 0 }
    }
    let childOrder = 0
    previewNode.children.forEach((child) => {
      if (createNode(child, id, childOrder, style)) childOrder += 1
    })
    return id
  }
  const rootId = createNode({
    id: createId(),
    title: preview.title,
    summary: preview.summary,
    detailMarkdown: template.nodes[template.rootKey]?.detailMarkdown ?? '',
    included: true,
    templateNodeKey: template.rootKey,
    aiBehavior: 'fixed',
    locked: true,
    children: preview.children
  }, null, 0)
  if (!rootId) throw new Error('AI 预览没有可创建的节点')
  return {
    schemaVersion: 1,
    id: idFactory(),
    title: title.trim().slice(0, 200) || template.name,
    createdAt: now,
    updatedAt: now,
    rootId,
    nodes,
    viewport: { ...template.viewport }
  }
}

function serializeNode(document: MindMapDocument, nodeId: string, depth: number): string {
  const node = document.nodes[nodeId]
  if (!node) return ''
  const indent = '  '.repeat(depth)
  const summary = node.summary ? `｜摘要：${node.summary}` : ''
  const detail = node.detailMarkdown ? `｜详注：${node.detailMarkdown.replace(/\s+/g, ' ')}` : ''
  const current = `${indent}- ${node.title}${summary}${detail}`
  const children = getChildren(document, nodeId).map((child) => serializeNode(document, child.id, depth + 1))
  return [current, ...children].filter(Boolean).join('\n')
}

export function collectAiMapContext(
  document: MindMapDocument,
  targetNodeId: string,
  includeFullMap: boolean,
  maxLength = MAP_CONTEXT_LIMIT
): string {
  if (includeFullMap) {
    return serializeNode(document, document.rootId, 0).slice(0, maxLength)
  }
  const target = document.nodes[targetNodeId]
  if (!target) return ''
  const path = getNodePath(document, targetNodeId)
    .map((id) => document.nodes[id]?.title)
    .filter(Boolean)
    .join(' / ')
  const subtree = serializeNode(document, targetNodeId, 0)
  return `当前路径：${path}\n\n选中节点上下文：\n${subtree}`.slice(0, maxLength)
}
