import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const userData = path.join(os.tmpdir(), 'zhitu-ai-vision-test')
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  dialog: {},
  net: {},
  safeStorage: {},
  shell: {}
}))

import { AiService } from '../src/main/ai'
import type { MaterialVisualDescriptor } from '../src/main/materialParser'

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xw0YAAAAAElFTkSuQmCC',
  'base64'
)

describe('AiService 视觉识别', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('以 image_url 批量发送 PNG，并缓存 LaTeX 结果', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'zhitu-vision-service-'))
    const pngPath = path.join(directory, 'slide-001-object-001.png')
    await writeFile(pngPath, tinyPng)
    const visual: MaterialVisualDescriptor = {
      id: 'slide-001-object-001',
      slideNumber: 1,
      relationshipId: 'rId2',
      sourceKind: 'wmf',
      sourcePath: path.join(directory, 'slide-001-object-001.wmf'),
      pngPath,
      sourceSha256: 'source',
      pngSha256: 'png',
      width: 1,
      height: 1
    }
    const service = new AiService({} as never)
    const callModel = vi.fn().mockResolvedValue(JSON.stringify({
      items: [{ id: visual.id, kind: 'formula', latex: 'a^2+b^2=c^2', markdown: '', confidence: 0.99 }]
    }))
    ;(service as unknown as { callModel: typeof callModel }).callModel = callModel

    const result = await (service as unknown as {
      recognizeVisuals: (...args: unknown[]) => Promise<string>
    }).recognizeVisuals(
      '前 [[VISUAL:slide-001-object-001]] 后',
      [visual],
      directory,
      { baseUrl: 'http://127.0.0.1/v1', model: 'vision-model', dataConsent: true },
      'key',
      new AbortController().signal,
      () => undefined,
      'progress'
    )

    expect(result).toContain('a^2+b^2=c^2')
    const messages = callModel.mock.calls[0]?.[0] as Array<{ content: Array<Record<string, unknown>> }>
    expect(messages[0]?.content[0]).toEqual(expect.objectContaining({ type: 'text' }))
    expect(messages[0]?.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: expect.stringMatching(/^data:image\/png;base64,/), detail: 'high' }
    })
    const cache = JSON.parse(await readFile(path.join(directory, 'vision-cache.json'), 'utf8'))
    expect(cache['png:vision-model:1']?.latex).toBe('a^2+b^2=c^2')
  })
})
