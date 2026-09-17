import { DEFAULT_NODE_STYLE } from './schema'
import type {
  AiPreview,
  AiPreviewNode,
  AiPreviewStrategy,
  AiQuestion,
  AiSession,
  MindMapDocument,
  MindNode
} from './types'
import { getChildren, getNodePath } from './tree'

const MAX_PREVIEW_NODES = 100
const MAP_CONTEXT_LIMIT = 20_000

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
    included: raw.included !== false,
    children
  }
}

export function parseAiPreview(raw: unknown, targetNodeId?: string): AiPreview {
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
    detailMarkdown: '',
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
      summary: branch.summary || matched.summary
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
      summary: preview.summary
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
