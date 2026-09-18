import { toJpeg, toPng, toSvg } from 'html-to-image'
import { getViewportForBounds, type Rect, type Viewport } from '@xyflow/react'
import { jsPDF } from 'jspdf'
import {
  DEFAULT_EXPORT_QUALITY,
  type ExportFormat,
  type ExportQuality,
  type ExportRequest
} from '@shared/types'
import { EXPORT_PRESETS, fitExportCanvasSize } from './exportQuality'

const CONTENT_PADDING = 48
const MAX_SVG_SIDE = 8000

function dataUrlPayload(dataUrl: string): string {
  return dataUrl.includes(',') ? dataUrl : `data:application/octet-stream;base64,${dataUrl}`
}

function measureNodeContentBounds(
  viewportElement: HTMLElement,
  viewport: Viewport,
  fallback: Rect
): Rect {
  const nodeElements = viewportElement.querySelectorAll<HTMLElement>('.react-flow__node')
  if (!nodeElements.length || viewport.zoom <= 0) return fallback

  const viewportRect = viewportElement.getBoundingClientRect()
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const element of nodeElements) {
    const style = window.getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') continue

    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue

    // DOM 矩形处于屏幕坐标，先换算回 React Flow 内部坐标。
    const left = (rect.left - viewportRect.left) / viewport.zoom
    const top = (rect.top - viewportRect.top) / viewport.zoom
    const right = (rect.right - viewportRect.left) / viewport.zoom
    const bottom = (rect.bottom - viewportRect.top) / viewport.zoom

    minX = Math.min(minX, left)
    minY = Math.min(minY, top)
    maxX = Math.max(maxX, right)
    maxY = Math.max(maxY, bottom)
  }

  if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
    return fallback
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  }
}

async function renderGraph(
  viewportElement: HTMLElement,
  bounds: Rect,
  viewport: Viewport,
  backgroundColor: string,
  title: string,
  format: ExportFormat,
  quality: ExportQuality
): Promise<string> {
  const contentBounds = measureNodeContentBounds(viewportElement, viewport, bounds)
  const preset = EXPORT_PRESETS[quality]

  if (format === 'svg') {
    const { width, height } = fitExportCanvasSize(contentBounds, {
      pixelRatio: 1,
      maxSide: MAX_SVG_SIDE,
      maxPixels: Number.MAX_SAFE_INTEGER
    }, CONTENT_PADDING)
    const exportViewport = getViewportForBounds(contentBounds, width, height, 0.02, 2, '2px')
    const style = {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${exportViewport.x}px, ${exportViewport.y}px) scale(${exportViewport.zoom})`,
      transformOrigin: '0 0'
    }
    return toSvg(viewportElement, { backgroundColor, width, height, style })
  }

  if (format === 'png') {
    const { width, height } = fitExportCanvasSize(contentBounds, preset.png, CONTENT_PADDING)
    const exportViewport = getViewportForBounds(contentBounds, width, height, 0.02, 2, '2px')
    return toPng(viewportElement, {
      backgroundColor,
      width,
      height,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${exportViewport.x}px, ${exportViewport.y}px) scale(${exportViewport.zoom})`,
        transformOrigin: '0 0'
      },
      pixelRatio: preset.png.pixelRatio,
      cacheBust: true
    })
  }

  const { width, height } = fitExportCanvasSize(contentBounds, preset.pdf, CONTENT_PADDING)
  const exportViewport = getViewportForBounds(contentBounds, width, height, 0.02, 2, '2px')
  const jpeg = await toJpeg(viewportElement, {
    backgroundColor,
    width,
    height,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${exportViewport.x}px, ${exportViewport.y}px) scale(${exportViewport.zoom})`,
      transformOrigin: '0 0'
    },
    pixelRatio: preset.pdf.pixelRatio,
    quality: preset.pdf.jpegQuality,
    cacheBust: true
  })

  const pdf = new jsPDF({
    orientation: width >= height ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a3',
    compress: true
  })
  pdf.setProperties({ title })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 10
  const ratio = Math.min((pageWidth - margin * 2) / width, (pageHeight - margin * 2) / height)
  const imageWidth = width * ratio
  const imageHeight = height * ratio

  pdf.addImage(
    jpeg,
    'JPEG',
    (pageWidth - imageWidth) / 2,
    (pageHeight - imageHeight) / 2,
    imageWidth,
    imageHeight,
    undefined,
    'FAST'
  )
  return pdf.output('datauristring')
}

export async function createExportRequest(
  viewportElement: HTMLElement,
  bounds: Rect,
  currentViewport: Viewport,
  backgroundColor: string,
  title: string,
  format: ExportFormat,
  quality: ExportQuality = DEFAULT_EXPORT_QUALITY
): Promise<ExportRequest> {
  const data = await renderGraph(
    viewportElement,
    bounds,
    currentViewport,
    backgroundColor,
    title,
    format,
    quality
  )
  return { format, data: dataUrlPayload(data), defaultName: title }
}
