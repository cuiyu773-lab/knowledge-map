import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractMaterialContent } from '../src/main/materialParser'
import { renderMetafiles } from '../src/main/metafileRenderer'

const sample = path.join(
  process.cwd(),
  'trial-runs',
  '_staging',
  '复变函数-1.1-1.2',
  '1.1 复数及其代数运算.pptx'
)
const canRun = process.platform === 'win32' && existsSync(sample)

describe.skipIf(!canRun)('WMF/EMF Python 渲染器', () => {
  it('可批量渲染真实课件并生成清单和 PNG', async () => {
    const buffer = await readFile(sample)
    const output = await mkdtemp(path.join(os.tmpdir(), 'zhitu-render-test-'))
    const sourceHash = createHash('sha256').update(buffer).digest('hex')
    const result = await renderMetafiles(buffer, output, { sourceHash })
    expect(result.objects.length).toBeGreaterThan(0)
    expect(result.warnings).toEqual([])
    expect(result.objects.every((item) => item.pngPath && existsSync(item.pngPath))).toBe(true)

    const extracted = await extractMaterialContent(buffer, path.basename(sample), {
      sourceHash,
      derivedDirectory: output,
      renderVisuals: true
    })
    expect(extracted.visuals).toHaveLength(result.objects.length)
    expect(extracted.text.match(/\[\[VISUAL:/g)?.length ?? 0).toBe(extracted.visuals.length)
  }, 30_000)
})
