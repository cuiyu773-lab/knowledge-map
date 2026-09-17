import { parseModelJson } from '@shared/ai'
import { basename } from 'node:path'
import type { MaterialVisualDescriptor } from './materialParser'

export const VISION_PROMPT_VERSION = 1

export type VisionKind = 'formula' | 'diagram' | 'unknown'

export interface VisionCaption {
  kind: VisionKind
  latex: string
  markdown: string
  confidence: number
}

export type VisionCaptionMap = Record<string, VisionCaption>

export function visionCacheKey(pngSha256: string, model: string): string {
  return `${pngSha256}:${model}:${VISION_PROMPT_VERSION}`
}

export function buildVisionPrompt(visuals: MaterialVisualDescriptor[]): string {
  const ids = visuals.map((visual) => visual.id).join(', ')
  return [
    '你是课程资料视觉识别器。请逐个识别用户随消息发送的图片，图片顺序与 id 顺序一致。',
    `id 顺序：${ids}`,
    '公式：准确转为 LaTeX，保留上下标、分式、矩阵、向量和符号；不确定处不要猜测，降低 confidence。',
    '几何图或示意图：转为简洁 Markdown，说明图形关系、标签、坐标、箭头、交点和关键条件。',
    '无法可靠识别：kind 使用 unknown，markdown 说明原因。',
    '只输出 JSON，不要代码块或解释。格式：',
    '{"items":[{"id":"slide-001-object-001","kind":"formula|diagram|unknown","latex":"","markdown":"","confidence":0.0}]}'
  ].join('\n')
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

export function parseVisionResponse(
  raw: unknown,
  visuals: MaterialVisualDescriptor[]
): VisionCaptionMap {
  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = parseModelJson(raw)
    } catch {
      return {}
    }
  }
  const root = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  const items = Array.isArray(root.items) ? root.items : []
  const expected = new Set(visuals.map((visual) => visual.id))
  const result: VisionCaptionMap = {}

  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = cleanText(record.id, 120)
    if (!id || !expected.has(id)) continue
    const rawKind = cleanText(record.kind, 20)
    const kind: VisionKind = rawKind === 'formula' || rawKind === 'diagram' ? rawKind : 'unknown'
    const confidence = typeof record.confidence === 'number' ? Math.max(0, Math.min(1, record.confidence)) : 0
    result[id] = {
      kind,
      latex: cleanText(record.latex, 2_000),
      markdown: cleanText(record.markdown, 2_000),
      confidence
    }
  }
  return result
}

function captionText(visual: MaterialVisualDescriptor, caption: VisionCaption | undefined): string {
  if (!visual.pngPath) {
    return `[视觉对象 ${visual.id}：渲染失败，原文件已保留]`
  }
  if (!caption) {
    return `[视觉对象 ${visual.id}：未完成识别，原图 ${basename(visual.pngPath)}]`
  }
  const details: string[] = []
  if (caption.latex) details.push(`LaTeX：${caption.latex}`)
  if (caption.markdown) details.push(`说明：${caption.markdown}`)
  if (!details.length) details.push('模型未能可靠识别该对象，请参考保留的原图。')
  const label = caption.kind === 'formula' ? '公式' : caption.kind === 'diagram' ? '几何图/示意图' : '视觉对象'
  return `[视觉对象 ${visual.id}｜${label}｜置信度 ${caption.confidence.toFixed(2)}]\n${details.join('\n')}\n原图：${basename(visual.pngPath)}`
}

export function applyVisualCaptions(
  text: string,
  visuals: MaterialVisualDescriptor[],
  captions: VisionCaptionMap
): string {
  const byId = new Map(visuals.map((visual) => [visual.id, visual]))
  return text.replace(/\[\[VISUAL:([^\]]+)\]\]/g, (marker, id: string) => {
    const visual = byId.get(id)
    return visual ? captionText(visual, captions[id]) : marker
  })
}
