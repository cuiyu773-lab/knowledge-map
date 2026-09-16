import ELK from 'elkjs/lib/elk.bundled.js'
import type { MindMapDocument } from '@shared/types'
import { getChildren, getVisibleNodeIds } from '@shared/tree'

export interface LayoutNode {
  x: number
  y: number
  width: number
  height: number
}

const elk = new ELK()

function nodeSize(title: string, summary: string): { width: number; height: number } {
  const titleWeight = [...title].reduce((sum, character) => sum + (character.charCodeAt(0) > 255 ? 1.7 : 1), 0)
  const width = Math.max(196, Math.min(300, 116 + titleWeight * 5.4))
  return { width, height: summary.trim() ? 104 : 78 }
}

export async function calculateLayout(document: MindMapDocument): Promise<Record<string, LayoutNode>> {
  const visibleIds = getVisibleNodeIds(document)
  const visible = new Set(visibleIds)
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '38',
      'elk.layered.spacing.nodeNodeBetweenLayers': '96',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.padding': '[top=64,left=48,bottom=64,right=48]'
    },
    children: visibleIds.map((id) => {
      const node = document.nodes[id]
      const size = nodeSize(node?.title ?? '', node?.summary ?? '')
      return { id, width: size.width, height: size.height }
    }),
    edges: visibleIds.flatMap((id) => {
      const node = document.nodes[id]
      return node?.parentId && visible.has(node.parentId)
        ? [{ id: `${node.parentId}-${id}`, sources: [node.parentId], targets: [id] }]
        : []
    })
  }

  try {
    const result = await elk.layout(graph)
    const positions: Record<string, LayoutNode> = {}
    for (const child of result.children ?? []) {
      const size = nodeSize(document.nodes[child.id]?.title ?? '', document.nodes[child.id]?.summary ?? '')
      positions[child.id] = {
        x: child.x ?? 0,
        y: child.y ?? 0,
        width: child.width ?? size.width,
        height: child.height ?? size.height
      }
    }
    return positions
  } catch {
    return fallbackLayout(document)
  }
}

function fallbackLayout(document: MindMapDocument): Record<string, LayoutNode> {
  const positions: Record<string, LayoutNode> = {}
  let cursorY = 0
  const visit = (id: string, depth: number) => {
    const node = document.nodes[id]
    if (!node) return
    const size = nodeSize(node.title, node.summary)
    positions[id] = { x: depth * 320, y: cursorY, ...size }
    cursorY += size.height + 28
    if (!node.collapsed) getChildren(document, id).forEach((child) => visit(child.id, depth + 1))
  }
  visit(document.rootId, 0)
  return positions
}
