import { strFromU8, unzipSync } from 'fflate'
import { XMLParser } from 'fast-xml-parser'
import mammoth from 'mammoth'
import path from 'node:path'
import { AppError } from './errors'

const MAX_EXPANDED_BYTES = 200 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 2_000

export const MATERIAL_EXTENSIONS = new Set(['.pdf', '.docx', '.pptx', '.md', '.markdown', '.txt'])
export const MATERIAL_MAX_BYTES = 50 * 1024 * 1024
export const MATERIAL_MAX_TEXT_CHARS = 800_000

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

function textFromSlide(xml: string): string {
  const parser = new XMLParser({ ignoreAttributes: true, textNodeName: '#text' })
  const parsed = parser.parse(xml) as unknown
  const values: string[] = []
  const visit = (value: unknown): void => {
    if (typeof value === 'string' || typeof value === 'number') {
      values.push(String(value))
      return
    }
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'a:t' || key === '#text') visit(child)
      else if (key !== 'a:rPr' && key !== 'a:pPr') visit(child)
    }
  }
  visit(parsed)
  return values.join(' ').replace(/\s+/g, ' ').trim()
}

function extractPptx(buffer: Buffer): string {
  const entries = unzipSync(new Uint8Array(buffer))
  assertSafeArchive(entries)
  const slideNames = Object.keys(entries)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const left = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
      const right = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
      return left - right
    })
  if (!slideNames.length) throw new AppError('MATERIAL_PARSE_FAILED', 'PPTX 中没有找到幻灯片内容')
  return slideNames
    .map((name, index) => {
      const xml = strFromU8(entries[name]!)
      return `【第 ${index + 1} 张幻灯片】\n${textFromSlide(xml)}`
    })
    .join('\n\n')
}

export async function extractMaterialText(buffer: Buffer, fileName: string): Promise<string> {
  const extension = path.extname(fileName).toLowerCase()
  if (!MATERIAL_EXTENSIONS.has(extension)) throw new AppError('UNSUPPORTED_MATERIAL', '暂不支持该资料格式')
  if (buffer.length > MATERIAL_MAX_BYTES) throw new AppError('MATERIAL_TOO_LARGE', '单个资料不能超过 50MB')

  let text = ''
  if (extension === '.pdf') text = await extractPdf(buffer)
  else if (extension === '.docx') text = await extractDocx(buffer)
  else if (extension === '.pptx') text = extractPptx(buffer)
  else text = decodeText(buffer)

  text = text.replace(/\r\n/g, '\n').replace(/[\t\u00a0]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) {
    throw new AppError(
      'MATERIAL_EMPTY_TEXT',
      extension === '.pdf' ? 'PDF 未提取到文字，扫描版资料暂不支持 OCR' : '资料中没有可提取的文字'
    )
  }
  if (text.length > MATERIAL_MAX_TEXT_CHARS) {
    throw new AppError('MATERIAL_TEXT_TOO_LARGE', '资料文字超过 80 万字符，请拆分后再导入')
  }
  return text
}
