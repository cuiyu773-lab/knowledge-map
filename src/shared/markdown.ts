import { marked } from 'marked'
import type { MindMapDocument } from './types'
import { appendMarkdownToNode, insertChild } from './tree'
import { createMindMapDocument } from './schema'

interface MarkdownToken {
  type: string
  depth?: number
  text?: string
  raw?: string
  tokens?: MarkdownToken[]
  items?: MarkdownListItem[]
}

interface MarkdownListItem {
  text?: string
  raw?: string
  tokens?: MarkdownToken[]
}

export interface MarkdownImportResult {
  document: MindMapDocument
  warnings: string[]
}

export interface MarkdownImportOptions {
  fileName: string
  markdown: string
  rewriteImage?: (source: string) => Promise<string>
  idFactory?: () => string
}

function plainText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`>#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstLine(value: string): string {
  return plainText(value.split(/\r?\n/).find((line) => line.trim()) ?? '')
}

async function rewriteImages(
  markdown: string,
  rewriteImage: MarkdownImportOptions['rewriteImage'],
  warnings: string[]
): Promise<string> {
  if (!rewriteImage) return markdown
  const matches = [...markdown.matchAll(/!\[([^\]]*)\]\((?!https?:|data:|zhitu-asset:)([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)]
  let result = markdown
  for (const match of matches) {
    const source = match[2]
    if (!source) continue
    try {
      const rewritten = await rewriteImage(source)
      result = result.replace(match[0], match[0].replace(source, rewritten))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push(`图片「${source}」未能复制：${message}`)
    }
  }
  return result
}

function codeBlock(token: MarkdownToken): string {
  return token.raw?.trim() ?? ''
}

export async function importMarkdownToMindMap(options: MarkdownImportOptions): Promise<MarkdownImportResult> {
  const idFactory = options.idFactory ?? (() => crypto.randomUUID())
  const tokens = marked.lexer(options.markdown) as unknown as MarkdownToken[]
  const headings = tokens.filter((token) => token.type === 'heading' && token.depth === 1)
  const firstContentIndex = tokens.findIndex((token) => token.type !== 'space')
  const rootIsH1 = headings.length === 1 && firstContentIndex >= 0 && tokens[firstContentIndex]?.type === 'heading'
  const fallbackTitle = options.fileName.replace(/\.md(?:own)?$/i, '') || '导入的导图'
  const rootTitle = rootIsH1 ? plainText(headings[0]?.text ?? fallbackTitle) : fallbackTitle
  const rootId = idFactory()
  let document = createMindMapDocument(idFactory(), rootId, rootTitle || fallbackTitle)
  const warnings: string[] = []
  const headingStack: Array<{ depth: number; nodeId: string }> = [{ depth: 0, nodeId: rootId }]

  const addTextToNode = async (nodeId: string, text: string) => {
    if (!text.trim()) return
    const rewritten = await rewriteImages(text, options.rewriteImage, warnings)
    document = appendMarkdownToNode(document, nodeId, rewritten)
  }

  const processList = async (items: MarkdownListItem[] | undefined, parentId: string) => {
    for (const item of items ?? []) {
      const title = firstLine(item.text ?? item.raw ?? '新主题') || '新主题'
      const inserted = insertChild(document, parentId, title, idFactory())
      document = inserted.document
      const nodeId = inserted.nodeId
      const nestedTokens: MarkdownToken[] = []
      for (const childToken of item.tokens ?? []) {
        if (childToken.type === 'list') nestedTokens.push(childToken)
        else if (childToken.type === 'paragraph' || childToken.type === 'text') {
          await addTextToNode(nodeId, childToken.text ?? childToken.raw ?? '')
        } else if (childToken.type === 'code' || childToken.type === 'blockquote' || childToken.type === 'table') {
          await addTextToNode(nodeId, childToken.raw ?? '')
        }
      }
      for (const nested of nestedTokens) {
        await processList(nested.items, nodeId)
      }
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token) continue
    if (token.type === 'heading') {
      if (rootIsH1 && index === firstContentIndex) continue
      const depth = Math.max(1, Math.min(6, token.depth ?? 1))
      while (headingStack.length > 1 && (headingStack.at(-1)?.depth ?? 0) >= depth) headingStack.pop()
      const parentId = headingStack.at(-1)?.nodeId ?? rootId
      const inserted = insertChild(document, parentId, plainText(token.text ?? '新标题') || '新标题', idFactory())
      document = inserted.document
      headingStack.push({ depth, nodeId: inserted.nodeId })
      continue
    }
    const activeNodeId = headingStack.at(-1)?.nodeId ?? rootId
    if (token.type === 'paragraph' || token.type === 'text' || token.type === 'blockquote' || token.type === 'table') {
      await addTextToNode(activeNodeId, token.raw ?? token.text ?? '')
    } else if (token.type === 'code') {
      await addTextToNode(activeNodeId, codeBlock(token))
    } else if (token.type === 'list') {
      await processList(token.items, activeNodeId)
    }
  }

  return { document, warnings }
}

