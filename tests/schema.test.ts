import { describe, expect, it } from 'vitest'
import { createMindMapDocument, parseMindMapDocument, parseWorkspaceMeta } from '@shared/schema'

describe('文件 schema', () => {
  it('读取当前版本并补齐样式', () => {
    const raw = createMindMapDocument('m1', 'r1', '导图')
    const parsed = parseMindMapDocument({ ...raw, nodes: { r1: { ...raw.nodes.r1, style: undefined } } })
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.nodes.r1?.style.color).toBe('oat')
  })

  it('拒绝高于当前版本的导图', () => {
    expect(() => parseMindMapDocument({ ...createMindMapDocument('m1', 'r1'), schemaVersion: 99 })).toThrow('高于当前支持的版本')
  })

  it('过滤工作区中的非法导图 ID', () => {
    const meta = parseWorkspaceMeta({
      schemaVersion: 1,
      id: 'w1',
      name: '学习',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mapOrder: ['m1', 2, 'm2']
    })
    expect(meta.mapOrder).toEqual(['m1', 'm2'])
  })
})
