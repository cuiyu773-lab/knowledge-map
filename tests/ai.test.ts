import { describe, expect, it } from 'vitest'
import {
  applyAiPreview,
  collectAiMapContext,
  createRootFromAiPreview,
  parseAiPreview,
  parseAiQuestions,
  parseModelJson
} from '@shared/ai'
import { createMindMapDocument, createNode } from '@shared/schema'
import type { AiPreview } from '@shared/types'

function preview(children: AiPreview['children']): AiPreview {
  return {
    title: '数据结构',
    summary: '课程导图',
    children,
    createdAt: new Date().toISOString()
  }
}

describe('AI 大纲处理', () => {
  it('从模型文本中提取 JSON、追问和大纲', () => {
    expect(parseModelJson('```json\n{"ready":false}\n```')).toEqual({ ready: false })
    expect(parseAiQuestions({ questions: [{ id: 'q1', question: '面向考试还是理解？', options: ['考试', '理解'] }] })).toEqual([
      { id: 'q1', question: '面向考试还是理解？', options: ['考试', '理解'] }
    ])
    const parsed = parseAiPreview({
      title: '算法',
      summary: '核心思想与复杂度',
      children: [{ title: '排序', summary: '常见排序算法', children: [{ title: '快速排序', summary: '分治' }] }]
    })
    expect(parsed.title).toBe('算法')
    expect(parsed.children[0]?.children[0]?.title).toBe('快速排序')
    expect(parsed.children[0]?.included).toBe(true)
  })

  it('追加、替换和智能合并均保持节点结构有效', () => {
    const base = createMindMapDocument('m1', 'root', '算法')
    const existing = createNode('sort', 'root', 0, '排序')
    base.nodes.sort = existing
    const generated = preview([
      {
        id: 'p1',
        title: '排序',
        summary: '排序算法总结',
        included: true,
        children: [{ id: 'p2', title: '快速排序', summary: '分治', included: true, children: [] }]
      },
      { id: 'p3', title: '查找', summary: '查找算法', included: true, children: [] }
    ])

    const appended = applyAiPreview(base, 'root', generated, 'append')
    expect(Object.values(appended.nodes).filter((node) => node.parentId === 'root')).toHaveLength(3)

    const merged = applyAiPreview(base, 'root', generated, 'merge')
    expect(merged.nodes.sort?.summary).toBe('排序算法总结')
    expect(Object.values(merged.nodes).some((node) => node.parentId === 'sort' && node.title === '快速排序')).toBe(true)
    expect(Object.values(merged.nodes).some((node) => node.parentId === 'root' && node.title === '查找')).toBe(true)

    const replaced = applyAiPreview(base, 'root', generated, 'replace')
    expect(replaced.nodes.sort).toBeUndefined()
    expect(Object.values(replaced.nodes).filter((node) => node.parentId === 'root')).toHaveLength(2)
  })

  it('可用 AI 根主题创建新导图并收集局部上下文', () => {
    const base = createMindMapDocument('m1', 'root', '旧标题')
    base.nodes.child = createNode('child', 'root', 0, '子主题')
    const generated = preview([{ id: 'p1', title: '第一部分', summary: '摘要', included: true, children: [] }])
    const next = createRootFromAiPreview(base, generated)
    expect(next.title).toBe('数据结构')
    expect(next.nodes.root?.summary).toBe('课程导图')
    expect(Object.values(next.nodes).some((node) => node.title === '第一部分')).toBe(true)
    expect(collectAiMapContext(next, 'root', false)).toContain('数据结构')
  })
})
