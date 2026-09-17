import { describe, expect, it } from 'vitest'
import type { MaterialVisualDescriptor } from '../src/main/materialParser'
import { applyVisualCaptions, buildVisionPrompt, parseVisionResponse, visionCacheKey } from '../src/main/vision'

const visual: MaterialVisualDescriptor = {
  id: 'slide-001-object-001',
  slideNumber: 1,
  relationshipId: 'rId2',
  sourceKind: 'wmf',
  sourcePath: 'D:/workspace/image.wmf',
  pngPath: 'D:/workspace/image.png',
  sourceSha256: 'source',
  pngSha256: 'png',
  width: 800,
  height: 300
}

describe('视觉识别辅助逻辑', () => {
  it('生成包含对象顺序的提示词', () => {
    expect(buildVisionPrompt([visual])).toContain(visual.id)
    expect(buildVisionPrompt([visual])).toContain('只输出 JSON')
  })

  it('解析模型 JSON 并校验类型和置信度', () => {
    const result = parseVisionResponse(
      { items: [{ id: 'slide-001-object-001', kind: 'formula', latex: 'x^2+y^2=1', markdown: '圆', confidence: 1.4 }] },
      [visual]
    )
    expect(result[visual.id]).toEqual({
      kind: 'formula',
      latex: 'x^2+y^2=1',
      markdown: '圆',
      confidence: 1
    })
  })

  it('回填公式、几何图和失败占位', () => {
    const output = applyVisualCaptions(
      '前 [[VISUAL:slide-001-object-001]] 后 [[VISUAL:missing]]',
      [visual],
      {
        [visual.id]: {
          kind: 'diagram', latex: '', markdown: '圆心为 O。', confidence: 0.8
        }
      }
    )
    expect(output).toContain('圆心为 O。')
    expect(output).toContain('[[VISUAL:missing]]')
  })

  it('缓存键包含图片、模型和提示词版本', () => {
    expect(visionCacheKey('abc', 'vision-model')).toBe('abc:vision-model:1')
  })
})
