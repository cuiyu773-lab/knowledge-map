import type { MindMapDocument, MindNode, NodeStyle } from './types'

export interface CreateNodeResult {
  document: MindMapDocument
  nodeId: string
}

function touched(document: MindMapDocument, nodes: Record<string, MindNode>, now = new Date()): MindMapDocument {
  return { ...document, nodes, updatedAt: now.toISOString() }
}

export function getChildren(document: MindMapDocument, parentId: string | null): MindNode[] {
  return Object.values(document.nodes)
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.order - b.order)
}

export function getDescendantIds(document: MindMapDocument, nodeId: string): string[] {
  const children = getChildren(document, nodeId)
  return children.flatMap((child) => [child.id, ...getDescendantIds(document, child.id)])
}

export function isDescendant(document: MindMapDocument, ancestorId: string, candidateId: string): boolean {
  let current = document.nodes[candidateId]
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true
    current = document.nodes[current.parentId]
  }
  return false
}

export function getNodePath(document: MindMapDocument, nodeId: string): string[] {
  const path: string[] = []
  let current = document.nodes[nodeId]
  while (current) {
    path.unshift(current.id)
    current = current.parentId ? document.nodes[current.parentId] : undefined!
  }
  return path
}

export function getVisibleNodeIds(document: MindMapDocument): string[] {
  const result: string[] = []
  const visit = (nodeId: string) => {
    const node = document.nodes[nodeId]
    if (!node) return
    result.push(nodeId)
    if (!node.collapsed) getChildren(document, nodeId).forEach((child) => visit(child.id))
  }
  visit(document.rootId)
  return result
}

export function updateNode(
  document: MindMapDocument,
  nodeId: string,
  patch: Partial<Omit<MindNode, 'id' | 'parentId' | 'order'>>
): MindMapDocument {
  const node = document.nodes[nodeId]
  if (!node) return document
  const nextStyle: NodeStyle | undefined = patch.style ? { ...node.style, ...patch.style } : undefined
  const nextOffset = patch.manualOffset
    ? { ...node.manualOffset, ...patch.manualOffset }
    : undefined
  return touched(document, {
    ...document.nodes,
    [nodeId]: {
      ...node,
      ...patch,
      ...(nextStyle ? { style: nextStyle } : {}),
      ...(nextOffset ? { manualOffset: nextOffset } : {})
    }
  })
}

function normalizeSiblings(
  nodes: Record<string, MindNode>,
  parentId: string | null
): Record<string, MindNode> {
  const sorted = Object.values(nodes)
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.order - b.order)
  const next = { ...nodes }
  sorted.forEach((node, index) => {
    next[node.id] = { ...node, order: index }
  })
  return next
}

export function insertChild(
  document: MindMapDocument,
  parentId: string,
  title = '新主题',
  nodeId: string = crypto.randomUUID()
): CreateNodeResult {
  if (!document.nodes[parentId]) return { document, nodeId: document.rootId }
  const children = getChildren(document, parentId)
  const node = createChildNode(nodeId, parentId, children.length, title)
  const nodes = { ...document.nodes, [nodeId]: node }
  return { document: touched(document, nodes), nodeId }
}

function createChildNode(id: string, parentId: string, order: number, title: string): MindNode {
  return {
    id,
    parentId,
    order,
    title,
    summary: '',
    detailMarkdown: '',
    style: { color: 'oat', shape: 'rounded', fontScale: 1, lineStyle: 'solid' },
    collapsed: false,
    manualOffset: { x: 0, y: 0 }
  }
}

export function insertSibling(
  document: MindMapDocument,
  siblingId: string,
  title = '新主题',
  nodeId: string = crypto.randomUUID()
): CreateNodeResult {
  const sibling = document.nodes[siblingId]
  if (!sibling || !sibling.parentId) return insertChild(document, siblingId, title, nodeId)
  const ordered = getChildren(document, sibling.parentId)
  const index = ordered.findIndex((node) => node.id === siblingId)
  ordered.splice(index + 1, 0, createChildNode(nodeId, sibling.parentId, index + 1, title))
  const nodes = { ...document.nodes }
  ordered.forEach((node, order) => {
    nodes[node.id] = { ...node, order }
  })
  return { document: touched(document, nodes), nodeId }
}

export function deleteSubtree(
  document: MindMapDocument,
  nodeId: string,
  fallbackId?: string
): { document: MindMapDocument; nextSelectedId: string } {
  const node = document.nodes[nodeId]
  if (!node || node.id === document.rootId) {
    return { document, nextSelectedId: nodeId }
  }
  const removed = new Set([nodeId, ...getDescendantIds(document, nodeId)])
  if (removed.size >= Object.keys(document.nodes).length) {
    return { document, nextSelectedId: document.rootId }
  }
  const nodes = Object.fromEntries(Object.entries(document.nodes).filter(([id]) => !removed.has(id)))
  const normalized = normalizeSiblings(nodes, node.parentId)
  const siblings = getChildren({ ...document, nodes: normalized }, node.parentId)
  const nextSelectedId =
    fallbackId && normalized[fallbackId]
      ? fallbackId
      : siblings[Math.min(node.order, Math.max(0, siblings.length - 1))]?.id ?? node.parentId ?? document.rootId
  return { document: touched(document, normalized), nextSelectedId }
}

export function promoteNode(document: MindMapDocument, nodeId: string): MindMapDocument {
  const node = document.nodes[nodeId]
  if (!node?.parentId) return document
  const parent = document.nodes[node.parentId]
  if (!parent?.parentId) return document
  const grandParentId = parent.parentId
  const siblings = getChildren(document, grandParentId)
  const parentIndex = siblings.findIndex((item) => item.id === parent.id)
  const nextNode = { ...node, parentId: grandParentId }
  const nodes = { ...document.nodes, [nodeId]: nextNode }
  siblings.splice(parentIndex + 1, 0, nextNode)
  siblings.forEach((item, index) => {
    const current = nodes[item.id]
    if (current) nodes[item.id] = { ...current, order: index }
  })
  return touched(document, normalizeSiblings(nodes, parent.id))
}

export function reorderNode(document: MindMapDocument, nodeId: string, delta: -1 | 1): MindMapDocument {
  const node = document.nodes[nodeId]
  if (!node?.parentId) return document
  const siblings = getChildren(document, node.parentId)
  const index = siblings.findIndex((item) => item.id === nodeId)
  const target = index + delta
  if (target < 0 || target >= siblings.length) return document
  const reordered = [...siblings]
  const [moved] = reordered.splice(index, 1)
  if (!moved) return document
  reordered.splice(target, 0, moved)
  const nodes = { ...document.nodes }
  reordered.forEach((item, order) => {
    nodes[item.id] = { ...item, order }
  })
  return touched(document, nodes)
}

export type MoveMode = 'before' | 'inside' | 'after'

export function moveNode(
  document: MindMapDocument,
  activeId: string,
  targetId: string,
  mode: MoveMode
): MindMapDocument {
  const active = document.nodes[activeId]
  const target = document.nodes[targetId]
  if (!active || !target || active.id === target.id || active.id === document.rootId) return document
  if (active.parentId === target.id || isDescendant(document, active.id, target.id)) return document

  const nextParentId = mode === 'inside' ? target.id : target.parentId
  if (!nextParentId) return document
  if (nextParentId === active.id || isDescendant(document, active.id, nextParentId)) return document

  const withoutActive = { ...document.nodes }
  delete withoutActive[activeId]
  const targetSiblings = getChildren({ ...document, nodes: withoutActive }, nextParentId)
  let insertIndex = targetSiblings.length
  if (mode !== 'inside') {
    const targetIndex = targetSiblings.findIndex((item) => item.id === target.id)
    insertIndex = targetIndex < 0 ? targetSiblings.length : targetIndex + (mode === 'after' ? 1 : 0)
  }
  targetSiblings.splice(insertIndex, 0, { ...active, parentId: nextParentId })
  const nodes = { ...withoutActive }
  targetSiblings.forEach((item, index) => {
    nodes[item.id] = { ...item, order: index }
  })
  return touched(document, normalizeSiblings(nodes, nextParentId))
}

export function appendMarkdownToNode(
  document: MindMapDocument,
  nodeId: string,
  markdown: string
): MindMapDocument {
  const node = document.nodes[nodeId]
  if (!node || !markdown.trim()) return document
  const current = node.detailMarkdown.trim()
  return updateNode(document, nodeId, {
    detailMarkdown: current ? `${current}\n\n${markdown.trim()}` : markdown.trim()
  })
}


