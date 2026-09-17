import { strToU8, zipSync } from 'fflate'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractMaterialContent, extractMaterialText } from '../src/main/materialParser'

describe('课程资料解析', () => {
  it('读取 Markdown 和 UTF-16 文本', async () => {
    await expect(extractMaterialText(Buffer.from('# 第一章\n\n算法概览'), 'notes.md')).resolves.toContain('算法概览')
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('中文课程笔记', 'utf16le')])
    await expect(extractMaterialText(utf16, 'notes.txt')).resolves.toBe('中文课程笔记')
  })

  it('读取 DOCX 段落', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>复杂度分析</w:t></w:r></w:p></w:body></w:document>`
    const docx = Buffer.from(zipSync({ 'word/document.xml': strToU8(xml) }))
    await expect(extractMaterialText(docx, 'chapter.docx')).resolves.toContain('复杂度分析')
  })

  it('读取 PDF 页面文字', async () => {
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      '<< /Length 42 >>\nstream\nBT /F1 12 Tf 72 720 Td (Algorithm) Tj ET\nendstream',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ]
    let pdf = '%PDF-1.4\n'
    const offsets: number[] = []
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(pdf))
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
    })
    const xref = Buffer.byteLength(pdf)
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
    await expect(extractMaterialText(Buffer.from(pdf), 'lesson.pdf')).resolves.toContain('Algorithm')
  })

  it('按幻灯片顺序读取 PPTX 文字', async () => {
    const slide = (text: string) => strToU8(`<p:sld xmlns:p="p" xmlns:a="a"><a:t>${text}</a:t></p:sld>`)
    const pptx = Buffer.from(zipSync({
      'ppt/slides/slide2.xml': slide('动态规划'),
      'ppt/slides/slide1.xml': slide('分治法')
    }))
    const text = await extractMaterialText(pptx, 'lesson.pptx')
    expect(text.indexOf('分治法')).toBeLessThan(text.indexOf('动态规划'))
  })

  it('拒绝不支持的格式', async () => {
    await expect(extractMaterialText(Buffer.from('x'), 'data.xlsx')).rejects.toThrow('暂不支持')
  })
})

  it('为 PPTX 中的 WMF/EMF 插入视觉槽位并保持顺序', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'zhitu-material-'))
    const derived = path.join(root, 'derived')
    await mkdir(derived, { recursive: true })
    await writeFile(
      path.join(derived, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        helperVersion: '1.0.0',
        sourceHash: 'source-hash',
        requestedDpi: 576,
        maxSide: 4096,
        maxPixels: 16_000_000,
        warnings: [],
        objects: [
          {
            id: 'slide-001-object-001',
            slideNumber: 1,
            relationshipId: 'rId2',
            sourceMediaPath: 'ppt/media/image1.wmf',
            sourceKind: 'wmf',
            sourceFile: 'slide-001-object-001.wmf',
            pngFile: 'slide-001-object-001.png',
            sourceSha256: 'source-image-hash',
            pngSha256: 'png-hash',
            width: 800,
            height: 300
          }
        ]
      }),
      'utf8'
    )
    const slide = strToU8(
      '<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>公式前</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic><p:sp><p:txBody><a:p><a:r><a:t>公式后</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
    )
    const rels = strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.wmf"/></Relationships>'
    )
    const pptx = Buffer.from(zipSync({
      'ppt/slides/slide1.xml': slide,
      'ppt/slides/_rels/slide1.xml.rels': rels
    }))

    const result = await extractMaterialContent(pptx, 'lesson.pptx', {
      sourceHash: 'source-hash',
      derivedDirectory: derived,
      renderVisuals: true
    })
    expect(result.text).toContain('公式前')
    expect(result.text).toContain('[[VISUAL:slide-001-object-001]]')
    expect(result.text).toContain('公式后')
    expect(result.text.indexOf('公式前')).toBeLessThan(result.text.indexOf('[[VISUAL:'))
    expect(result.text.indexOf('[[VISUAL:')).toBeLessThan(result.text.indexOf('公式后'))
    expect(result.visuals).toHaveLength(1)
  })
