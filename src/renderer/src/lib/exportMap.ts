import { toPng, toSvg } from 'html-to-image'
import { getViewportForBounds, type Rect, type Viewport } from '@xyflow/react'
import { jsPDF } from 'jspdf'
import type { ExportRequest } from '@shared/types'

function dataUrlPayload(dataUrl: string): string {
  return dataUrl.includes(',') ? dataUrl : `data:application/octet-stream;base64,${dataUrl}`
}

async function renderGraph(
  viewportElement: HTMLElement,
  bounds: Rect,
  viewport: Viewport,
  backgroundColor: string,
  format: 'png' | 'svg' | 'pdf'
): Promise<string> {
  const width = Math.max(900, Math.min(8000, Math.ceil(bounds.width + 240)))
  const height = Math.max(640, Math.min(8000, Math.ceil(bounds.height + 220)))
  const exportViewport = getViewportForBounds(bounds, width, height, 0.2, 1.5, 2)
  const style = {
    width: `${width}px`,
    height: `${height}px`,
    transform: `translate(${exportViewport.x}px, ${exportViewport.y}px) scale(${exportViewport.zoom})`,
    transformOrigin: '0 0'
  }
  if (format === 'svg') {
    return toSvg(viewportElement, { backgroundColor, width, height, style })
  }
  const png = await toPng(viewportElement, {
    backgroundColor,
    width,
    height,
    style,
    pixelRatio: format === 'png' ? 2 : 1.5,
    cacheBust: true
  })
  if (format === 'png') return png

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 10
  const availableWidth = pageWidth - margin * 2
  const availableHeight = pageHeight - margin * 2
  const ratio = Math.min(availableWidth / width, availableHeight / height)
  const imageWidth = width * ratio
  const imageHeight = height * ratio
  pdf.addImage(png, 'PNG', (pageWidth - imageWidth) / 2, (pageHeight - imageHeight) / 2, imageWidth, imageHeight)
  return pdf.output('datauristring')
}

export async function createExportRequest(
  viewportElement: HTMLElement,
  bounds: Rect,
  currentViewport: Viewport,
  backgroundColor: string,
  title: string,
  format: 'png' | 'svg' | 'pdf'
): Promise<ExportRequest> {
  const data = await renderGraph(viewportElement, bounds, currentViewport, backgroundColor, format)
  return { format, data: dataUrlPayload(data), defaultName: title }
}
