import { marked, type Token, type Tokens } from 'marked'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import type { MindMapDocument } from './types'

type HtmlNode = DefaultTreeAdapterMap['node']

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** 与图片协议一致，先去除查询部分，再解码 URL 路径。 */
export function normalizeAssetReference(source: string): string | null {
  let value = source.trim().replace(/^zhitu-asset:\/\/workspace\//i, '')
  if (!value || /^(?:data:|https?:|blob:|file:)/i.test(value)) return null
  try {
    value = decodeURIComponent(value.split('#')[0]!.split('?')[0]!)
  } catch {
    return null
  }
  value = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
  if (!value.startsWith('assets/') || value.includes('\0') || value.split('/').includes('..')) return null
  return value
}

/** 使用 HTML 解析器取得真实 src，同时保留原始属性的位置以供安全改写。 */
function htmlImages(html: string): Array<{ source: string; start: number; end: number }> {
  const result: Array<{ source: string; start: number; end: number }> = []
  const visit = (node: HtmlNode) => {
    if ('tagName' in node && node.tagName === 'img') {
      const source = node.attrs.find((attr) => attr.name === 'src')?.value
      const location = node.sourceCodeLocation?.attrs?.src
      if (source !== undefined && location) result.push({ source, start: location.startOffset, end: location.endOffset })
    }
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(parseFragment(html, { sourceCodeLocationInfo: true }))
  return result
}

function markdownImageSource(token: Tokens.Image): string {
  return htmlImages('<img src="' + token.href.replace(/"/g, '&quot;') + '">')[0]?.source ?? token.href
}

function imageTokens(markdown: string): { images: Tokens.Image[]; html: Tokens.HTML[]; code: string[] } {
  const images: Tokens.Image[] = []
  const html: Tokens.HTML[] = []
  const code: string[] = []
  const tokens = marked.lexer(markdown, { gfm: true, breaks: true })
  marked.walkTokens(tokens, (token: Token) => {
    if (token.type === 'image') images.push(token as Tokens.Image)
    if (token.type === 'html') html.push(token as Tokens.HTML)
    if (token.type === 'code' || token.type === 'codespan') code.push(token.raw)
  })
  return { images, html, code }
}

/** 按 marked 实际识别的图片打包，支持引用式图片和 HTML 属性语法。 */
export function collectAssetReferences(document: MindMapDocument, rootNodeId: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  const children = new Map<string, string[]>()
  for (const node of Object.values(document.nodes)) {
    if (node.parentId === null) continue
    const siblings = children.get(node.parentId) ?? []
    siblings.push(node.id)
    children.set(node.parentId, siblings)
  }
  const queue = [rootNodeId]
  const visited = new Set<string>()
  while (queue.length) {
    const id = queue.pop()!
    if (visited.has(id)) throw new Error('导图存在循环引用')
    visited.add(id)
    const node = document.nodes[id]
    if (!node) throw new Error('导图节点不存在')
    const tokens = imageTokens(node.detailMarkdown)
    const sources = [
      ...tokens.images.map(markdownImageSource),
      ...tokens.html.flatMap((token) => htmlImages(token.raw).map((image) => image.source))
    ]
    for (const source of sources) {
      const normalized = normalizeAssetReference(source)
      if (!normalized) continue
      const targets = result.get(normalized) ?? []
      targets.push(id)
      result.set(normalized, targets)
    }
    queue.push(...(children.get(id) ?? []))
  }
  return result
}

/** 仅改写真正的图片语法，代码块、行内代码和普通文字保持原样。 */
export function rewriteDocumentAssetReferences(document: MindMapDocument, replacements: Map<string, string>): MindMapDocument {
  const rewrite = (markdown: string): string => {
    const tokens = imageTokens(markdown)
    let prefix = 'ZMAPCODE'
    while (markdown.includes(prefix)) prefix += 'X'
    const protectedCode: string[] = []
    let result = markdown
    for (const code of tokens.code.sort((a, b) => b.length - a.length)) {
      const marker = prefix + protectedCode.length + 'END'
      if (result.includes(code)) {
        protectedCode.push(code)
        result = result.replaceAll(code, marker)
      }
    }
    const edits = new Map<string, string>()
    for (const token of tokens.images) {
      const target = replacements.get(normalizeAssetReference(markdownImageSource(token)) ?? '')
      if (!target) continue
      const alt = token.text.replace(/\\/g, '\\\\').replace(/[[\]]/g, '\\$&').replace(/\r?\n/g, ' ')
      const title = token.title ? ' "' + token.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : ''
      edits.set(token.raw, '![' + alt + '](<' + target + '>' + title + ')')
    }
    for (const token of tokens.html) {
      let html = token.raw
      for (const image of htmlImages(html).sort((a, b) => b.start - a.start)) {
        const target = replacements.get(normalizeAssetReference(image.source) ?? '')
        if (target) html = html.slice(0, image.start) + 'src="' + escapeAttribute(target) + '"' + html.slice(image.end)
      }
      if (html !== token.raw) edits.set(token.raw, html)
    }
    for (const [before, after] of [...edits].sort((a, b) => b[0].length - a[0].length)) result = result.replaceAll(before, after)
    protectedCode.forEach((code, index) => { result = result.replaceAll(prefix + index + 'END', code) })
    return result
  }
  return {
    ...document,
    nodes: Object.fromEntries(Object.entries(document.nodes).map(([id, node]) => [id, { ...node, detailMarkdown: rewrite(node.detailMarkdown) }]))
  }
}
