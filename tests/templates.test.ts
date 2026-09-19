import { describe, expect, it } from 'vitest'
import { createMapFromAiTemplatePreview, parseAiPreview } from '@shared/ai'
import { BUILTIN_TEMPLATES } from '@shared/builtinTemplates'
import { createMindMapDocument, createNode } from '@shared/schema'
import {
  applyStylePreset,
  createTemplateSnapshot,
  instantiateTemplate,
  parseMindMapTemplate,
  templateSkeletonForAi
} from '@shared/templates'
import type { AiPreview, TemplateNodeBehavior } from '@shared/types'

function sampleDocument() {
  const document = createMindMapDocument('map-1', 'root', '课程')
  const fixed = createNode('fixed', 'root', 0, '固定分支')
  const expand = createNode('expand', 'root', 1, '可扩充分支')
  const optional = createNode('optional', 'root', 2, '可选分支')
  fixed.summary = '固定摘要'
  fixed.detailMarkdown = '![图](assets/demo.png)'
  expand.style.color = 'moss'
  document.nodes.fixed = fixed
  document.nodes.expand = expand
  document.nodes.optional = optional
  return document
}

function preview(children: AiPreview['children']): AiPreview {
  return { title: '课程', summary: '', children, createdAt: new Date().toISOString() }
}

describe('模板快照与应用', () => {
  it('可从子树创建并实例化为全新导图', () => {
    const document = sampleDocument()
    const result = createTemplateSnapshot({
      id: 'template-1', name: '课程框架', description: '测试', category: 'course', source: 'user',
      document, rootNodeId: 'expand', behaviors: { expand: 'fixed' }, assets: {}, aiRecommendationEnabled: false,
      now: '2026-01-01T00:00:00.000Z'
    })
    expect(result.kind).toBe('subtree')
    expect(result.rootKey).toBe('expand')
    expect(result.nodes.expand?.parentKey).toBeNull()
    const instance = instantiateTemplate(result, '新课程', '2026-02-01T00:00:00.000Z', (() => {
      let value = 0
      return () => `id-${++value}`
    })())
    expect(instance.title).toBe('新课程')
    expect(Object.values(instance.nodes)).toHaveLength(1)
    expect(instance.nodes[instance.rootId]?.title).toBe('可扩充分支')
  })

  it('样式预设支持节点、子树和整图范围', () => {
    const document = sampleDocument()
    const style = { color: 'river' as const, shape: 'pill' as const, fontScale: 1.1, lineStyle: 'dashed' as const }
    expect(applyStylePreset(document, 'expand', 'node', style).nodes.root?.style.color).toBe('oat')
    expect(applyStylePreset(document, 'root', 'subtree', style).nodes.optional?.style.color).toBe('river')
    expect(applyStylePreset(document, 'expand', 'map', style).nodes.fixed?.style.shape).toBe('pill')
  })

  it('可解析模板并保留未来变量字段', () => {
    const template = BUILTIN_TEMPLATES[0]!
    const parsed = parseMindMapTemplate({ ...template, variables: [{ key: 'course', label: '课程名', defaultValue: '数据结构' }] })
    expect(parsed.variables[0]?.label).toBe('课程名')
    expect(templateSkeletonForAi(parsed)).toContain('[concepts]')
  })
})

describe('AI 模板骨架校正', () => {
  it('固定节点不改写，可扩充节点接受新增子和详注', () => {
    const document = sampleDocument()
    const behaviors: Record<string, TemplateNodeBehavior> = { fixed: 'fixed', expand: 'expandable', optional: 'optional' }
    const template = createTemplateSnapshot({
      id: 'template-ai', name: 'AI 模板', description: '', category: 'course', source: 'user',
      document, rootNodeId: 'root', behaviors, assets: {}, aiRecommendationEnabled: true
    })
    const generated = preview([
      { id: 'a', templateNodeKey: 'fixed', title: '被篡改标题', summary: '被篡改', detailMarkdown: '被篡改', included: true, children: [{ id: 'x', title: '越权节点', summary: 'x', detailMarkdown: '', included: true, children: [] }] },
      { id: 'b', templateNodeKey: 'expand', title: '可扩充分支', summary: 'AI 摘要', detailMarkdown: 'AI 详注', included: true, children: [{ id: 'c', title: '新增知识点', summary: '新摘要', detailMarkdown: '新详注', included: true, children: [] }] }
    ])
    const merged = parseAiPreview({
      title: '课程', summary: '根摘要', children: [
        { templateKey: 'fixed', title: '被篡改标题', summary: '被篡改', children: [{ title: '越权节点', summary: 'x' }] },
        { templateKey: 'expand', title: '可扩充分支', summary: 'AI 摘要', detailMarkdown: 'AI 详注', children: [{ title: '新增知识点', summary: '新摘要', detailMarkdown: '新详注' }] }
      ]
    }, undefined, template)
    expect(merged.title).toBe('课程')
    expect(merged.children[0]?.title).toBe('固定分支')
    expect(merged.children[0]?.summary).toBe('固定摘要')
    expect(merged.children[0]?.children).toHaveLength(0)
    expect(merged.children[1]?.detailMarkdown).toBe('AI 详注')
    expect(merged.children[1]?.children[0]?.title).toBe('新增知识点')
    expect(merged.corrections?.restored).toBeGreaterThanOrEqual(1)

    const instance = createMapFromAiTemplatePreview(template, merged, 'AI 生成课程', undefined, (() => {
      let value = 0
      return () => `node-${++value}`
    })())
    const generatedNode = Object.values(instance.nodes).find((node) => node.title === '新增知识点')
    expect(generatedNode?.style.color).toBe('moss')
    expect(generatedNode?.detailMarkdown).toBe('新详注')
  })
})