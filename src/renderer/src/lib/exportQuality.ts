import type { ExportQuality } from '@shared/types'

export interface ExportPixelPreset {
  pixelRatio: number
  maxSide: number
  maxPixels: number
}

export interface ExportPdfPreset extends ExportPixelPreset {
  jpegQuality: number
}

export interface ExportPreset {
  png: ExportPixelPreset
  pdf: ExportPdfPreset
}

export const EXPORT_PRESETS: Record<ExportQuality, ExportPreset> = {
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
}

export function fitExportCanvasSize(
  bounds: { width: number; height: number },
  preset: ExportPixelPreset,
  contentPadding: number
): { width: number; height: number } {
  const contentWidth = Math.max(1, Math.ceil(bounds.width + contentPadding * 2))
  const contentHeight = Math.max(1, Math.ceil(bounds.height + contentPadding * 2))
  const outputWidth = contentWidth * preset.pixelRatio
  const outputHeight = contentHeight * preset.pixelRatio
  const scale = Math.min(
    1,
    preset.maxSide / outputWidth,
    preset.maxSide / outputHeight,
    Math.sqrt(preset.maxPixels / (outputWidth * outputHeight))
  )

  return {
    width: Math.max(1, Math.floor(contentWidth * scale)),
    height: Math.max(1, Math.floor(contentHeight * scale))
  }
}
