import { describe, expect, it } from 'vitest'
import { DEFAULT_EXPORT_QUALITY } from '@shared/types'
import { EXPORT_PRESETS, fitExportCanvasSize } from '../src/renderer/src/lib/exportQuality'

describe('导出画质预设', () => {
  it('默认使用高清档位并定义三档参数', () => {
    expect(DEFAULT_EXPORT_QUALITY).toBe('high')
    expect(EXPORT_PRESETS).toEqual({
      standard: {
        png: { pixelRatio: 2, maxSide: 4096, maxPixels: 16_000_000 },
        pdf: { pixelRatio: 1.5, maxSide: 3000, maxPixels: 9_000_000, jpegQuality: 0.82 }
      },
      high: {
        png: { pixelRatio: 2.5, maxSide: 6144, maxPixels: 36_000_000 },
        pdf: { pixelRatio: 1.75, maxSide: 4096, maxPixels: 18_000_000, jpegQuality: 0.88 }
      },
      ultra: {
        png: { pixelRatio: 3, maxSide: 8192, maxPixels: 48_000_000 },
        pdf: { pixelRatio: 2, maxSide: 5000, maxPixels: 25_000_000, jpegQuality: 0.9 }
      }
    })
  })

  it('小尺寸导图使用相同画布尺寸并按像素倍率输出', () => {
    const bounds = { width: 488, height: 78 }
    expect(fitExportCanvasSize(bounds, EXPORT_PRESETS.standard.png, 48)).toEqual({ width: 584, height: 174 })
    expect(fitExportCanvasSize(bounds, EXPORT_PRESETS.high.png, 48)).toEqual({ width: 584, height: 174 })
    expect(fitExportCanvasSize(bounds, EXPORT_PRESETS.ultra.png, 48)).toEqual({ width: 584, height: 174 })
  })

  it('超大导图同时遵守边长和像素上限', () => {
    const preset = EXPORT_PRESETS.ultra.png
    const size = fitExportCanvasSize({ width: 20_000, height: 20_000 }, preset, 48)
    expect(size.width * preset.pixelRatio).toBeLessThanOrEqual(preset.maxSide)
    expect(size.height * preset.pixelRatio).toBeLessThanOrEqual(preset.maxSide)
    expect(size.width * size.height * preset.pixelRatio ** 2).toBeLessThanOrEqual(preset.maxPixels + 1)
  })
})


