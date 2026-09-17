import { strFromU8, unzipSync } from 'fflate'
import { XMLParser } from 'fast-xml-parser'
import mammoth from 'mammoth'
import path from 'node:path'
import { AppError } from './errors'
import { renderMetafiles, type RenderedMetafile } from './metafileRenderer'

const MAX_EXPANDED_BYTES = 200 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 2_000

export const MATERIAL_EXTENSIONS = new Set(['.pdf', '.docx', '.pptx', '.md', '.markdown', '.txt'])
export const MATERIAL_MAX_BYTES = 50 * 1024 * 1024
export const MATERIAL_MAX_TEXT_CHARS = 800_000

export type MaterialVisualDescriptor = RenderedMetafile

export interface MaterialExtractionOptions {
  sourceHash?: string
  sourcePath?: string
  derivedDirectory?: string
  signal?: AbortSignal
  renderVisuals?: boolean
}

export interface MaterialExtractionResult {
  text: string
  warnings: string[]
  visuals: MaterialVisualDescriptor[]
  derivedDirectory?: string
}

interface PptxExtraction {
  text: string
  warnings: string[]
  visuals: MaterialVisualDescriptor[]
}

function decodeText(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le')
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2))
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  return buffer.toString('utf8').replace(/^\uFEFF/, '')
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false
  })
  const document = await task.promise
  const pages: string[] = []
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter(Boolean)
        .join(' ')
      pages.push(`【第 ${pageNumber} 页】\n${text}`)
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
  return pages.join('\n\n')
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

function assertSafeArchive(entries: Record<string, Uint8Array>): void {
  const files = Object.values(entries)
  if (files.length > MAX_ARCHIVE_ENTRIES) throw new AppError('MATERIAL_TOO_COMPLEX', '压缩包条目过多，已停止解析')
  const expanded = files.reduce((total, file) => total + file.byteLength, 0)
  if (expanded > MAX_EXPANDED_BYTES) throw new AppError('MATERIAL_TOO_LARGE', '压缩后的资料体积过大，已停止解析')
}

function slideNumber(slideName: string): number {
  return Number(slideName.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
}

function relationshipName(slideName: string): string {
  return `${path.posix.dirname(slideName)}/_rels/${path.posix.basename(slideName)}.rels`
}

function readRelationshipMap(entries: Record<string, Uint8Array>, slideName: string): Map<string, string> {
  const relName = relationshipName(slideName)
  const relEntry = entries[relName]
  if (!relEntry) return new Map()
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' })
  const parsed = parser.parse(strFromU8(relEntry)) as Record<string, unknown>
  const relationshipsNode = (parsed.Relationships as Record<string, unknown> | undefined)?.Relationship
  const relationships = Array.isArray(relationshipsNode) ? relationshipsNode : relationshipsNode ? [relationshipsNode] : []
  const result = new Map<string, string>()
  for (const item of relationships) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = record['@_Id']
    const target = record['@_Target']
    if (typeof id !== 'string' || typeof target !== 'string' || record['@_TargetMode'] === 'External') continue
    const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(slideName), target))
    if (!/\.(?:wmf|emf)$/i.test(normalized)) continue
    result.set(id, normalized)
  }
  return result
}

function textFromNode(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textFromNode).join('')
  if (!value || typeof value !== 'object') return ''
  return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key === '#text')
    .map(([, child]) => textFromNode(child))
    .join('')
}

function orderedSlideParts(xml: string, visualIdsByRelationship: Map<string, string>): string[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    preserveOrder: true
  })
  const parsed = parser.parse(xml) as unknown
  const parts: string[] = []

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!value || typeof value !== 'object') return

    const wrapper = value as Record<string, unknown>
    for (const [tag, child] of Object.entries(wrapper)) {
      if (tag === ':@' || tag === '#text') continue
      if (tag === 'a:t') {
        const text = textFromNode(child).replace(/\s+/g, ' ').trim()
        if (text) parts.push(text)
        continue
      }
      if (tag === 'a:blip') {
        const attributes = wrapper[':@']
        const relationshipId =
          attributes && typeof attributes === 'object'
            ? (attributes as Record<string, unknown>)['@_r:embed']
            : undefined
        const visualId = typeof relationshipId === 'string' ? visualIdsByRelationship.get(relationshipId) : undefined
        if (visualId) parts.push(`[[VISUAL:${visualId}]]`)
        continue
      }
      visit(child)
    }
  }

  visit(parsed)
  return parts
}

async function extractPptx(buffer: Buffer, options: MaterialExtractionOptions): Promise<PptxExtraction> {
  const entries = unzipSync(new Uint8Array(buffer))
  assertSafeArchive(entries)
  const slideNames = Object.keys(entries)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b))
  if (!slideNames.length) throw new AppError('MATERIAL_PARSE_FAILED', 'PPTX 中没有找到幻灯片内容')

  let visuals: MaterialVisualDescriptor[] = []
  const warnings: string[] = []
  if (options.renderVisuals && options.derivedDirectory) {
    try {
      const rendered = await renderMetafiles(buffer, options.derivedDirectory, {
        sourceHash: options.sourceHash,
        sourcePath: options.sourcePath,
        signal: options.signal
      })
      visuals = rendered.objects
      warnings.push(...rendered.warnings)
    } catch (error) {
      if (options.signal?.aborted) throw error
      warnings.push(error instanceof Error ? error.message : 'WMF/EMF 渲染失败')
    }
  }

  const pages = slideNames.map((name) => {
    const number = slideNumber(name)
    const visualMap = new Map<string, string>()
    for (const visual of visuals) {
      if (visual.slideNumber === number) visualMap.set(visual.relationshipId, visual.id)
    }
    const parts = orderedSlideParts(strFromU8(entries[name]!), visualMap)
    const text = parts.join(' ').replace(/\s+/g, ' ').trim()
    const hasVisuals = visuals.some((visual) => visual.slideNumber === number)
    return `【第 ${number} 张幻灯片】\n${text || (hasVisuals ? '【本页主要内容为视觉对象，原图已提取】' : '')}`
  })

  return { text: pages.join('\n\n'), warnings, visuals }
}

export async function extractMaterialContent(
  buffer: Buffer,
  fileName: string,
  options: MaterialExtractionOptions = {}
): Promise<MaterialExtractionResult> {
  const extension = path.extname(fileName).toLowerCase()
  if (!MATERIAL_EXTENSIONS.has(extension)) throw new AppError('UNSUPPORTED_MATERIAL', '暂不支持该资料格式')
  if (buffer.length > MATERIAL_MAX_BYTES) throw new AppError('MATERIAL_TOO_LARGE', '单个资料不能超过 50MB')

  let text = ''
  let warnings: string[] = []
  let visuals: MaterialVisualDescriptor[] = []
  if (extension === '.pdf') text = await extractPdf(buffer)
  else if (extension === '.docx') text = await extractDocx(buffer)
  else if (extension === '.pptx') {
    const extracted = await extractPptx(buffer, options)
    text = extracted.text
    warnings = extracted.warnings
    visuals = extracted.visuals
  } else text = decodeText(buffer)

  text = text.replace(/\r\n/g, '\n').replace(/[\t\u00a0]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (!text && visuals.length) text = '【检测到 WMF/EMF 视觉对象，原图已提取，等待视觉识别】'
  if (!text) {
    throw new AppError(
      'MATERIAL_EMPTY_TEXT',
      extension === '.pdf' ? 'PDF 未提取到文字，扫描版资料暂不支持 OCR' : '资料中没有可提取的文字'
    )
  }
  if (text.length > MATERIAL_MAX_TEXT_CHARS) {
    throw new AppError('MATERIAL_TEXT_TOO_LARGE', '资料文字超过 80 万字符，请拆分后再导入')
  }
  return { text, warnings, visuals, derivedDirectory: options.derivedDirectory }
}

export async function extractMaterialText(buffer: Buffer, fileName: string): Promise<string> {
  return (await extractMaterialContent(buffer, fileName)).text
}
