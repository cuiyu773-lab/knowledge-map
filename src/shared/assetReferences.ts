import type { MindMapDocument } from './types'

/**
 * 把详注中的图片地址归一化为工作区相对路径。
 * 仅接受工作区 assets 目录下的本地图片，其余（data/http/blob/file 等）返回 null。
 */
export function normalizeAssetReference(source: string): string | null {
  let value = source.trim().replace(/^zhitu-asset:\/\/workspace\//i, '')
  if (!value || /^(?:data:|https?:|blob:|file:)/i.test(value)) return null
  value = value.split('#')[0]!.split('?')[0]!.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
  if (!value.startsWith('assets/') || value.includes('\0') || value.split('/').includes('..')) return null
  return value
}

/**
 * 收集子树中出现的本地图片引用，返回 相对路径 -> 引用它的节点 id 列表。
 * 同时支持 Markdown 行内图片与手写的 <img src="..."> 标签。
 */
export function collectAssetReferences(document: MindMapDocument, rootNodeId: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  const visit = (nodeId: string) => {
    const node = document.nodes[nodeId]
    if (!node) return
    const matches = [
      ...node.detailMarkdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g),
      ...node.detailMarkdown.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)
    ]
    for (const match of matches) {
      const normalized = normalizeAssetReference(match[1] ?? '')
      if (!normalized) continue
      const targets = result.get(normalized) ?? []
      targets.push(nodeId)
      result.set(normalized, targets)
    }
    Object.values(document.nodes)
      .filter((child) => child.parentId === nodeId)
      .sort((a, b) => a.order - b.order)
      .forEach((child) => visit(child.id))
  }
  visit(rootNodeId)
  return result
}
