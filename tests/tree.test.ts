import { describe, expect, it } from 'vitest'
import {
  deleteSubtree,
  getChildren,
  insertChild,
  insertSibling,
  moveNode,
  promoteNode,
  reorderNode
} from '@shared/tree'
import { createMindMapDocument } from '@shared/schema'

function document() {
  return createMindMapDocument('map-1', 'root', '学习')
}

describe('树结构操作', () => {
  it('创建同级和子级并保持顺序', () => {
    let doc = document()
    doc = insertChild(doc, 'root', '主题一', 'a').document
    doc = insertChild(doc, 'root', '主题二', 'b').document
    doc = insertSibling(doc, 'a', '主题一之间', 'c').document
    expect(getChildren(doc, 'root').map((node) => node.title)).toEqual(['主题一', '主题一之间', '主题二'])
  })

  it('提升节点时移动到父节点之后', () => {
    let doc = document()
    doc = insertChild(doc, 'root', '父主题', 'a').document
    doc = insertChild(doc, 'a', '子主题', 'b').document
    doc = insertChild(doc, 'root', '后续主题', 'c').document
    doc = promoteNode(doc, 'b')
    expect(getChildren(doc, 'root').map((node) => node.id)).toEqual(['a', 'b', 'c'])
  })

  it('排序只改变同级顺序', () => {
    let doc = document()
    doc = insertChild(doc, 'root', 'A', 'a').document
    doc = insertChild(doc, 'root', 'B', 'b').document
    doc = insertChild(doc, 'root', 'C', 'c').document
    doc = reorderNode(doc, 'c', -1)
    expect(getChildren(doc, 'root').map((node) => node.id)).toEqual(['a', 'c', 'b'])
  })

  it('阻止把节点移动到自己的后代下', () => {
    let doc = document()
    doc = insertChild(doc, 'root', 'A', 'a').document
    doc = insertChild(doc, 'a', 'B', 'b').document
    const next = moveNode(doc, 'a', 'b', 'inside')
    expect(next).toBe(doc)
  })

  it('删除子树且不能删除根节点', () => {
    let doc = document()
    doc = insertChild(doc, 'root', 'A', 'a').document
    doc = insertChild(doc, 'a', 'B', 'b').document
    doc = insertChild(doc, 'root', 'C', 'c').document
    const result = deleteSubtree(doc, 'a')
    expect(Object.keys(result.document.nodes).sort()).toEqual(['c', 'root'])
    expect(result.nextSelectedId).toBe('c')
    expect(deleteSubtree(doc, 'root').document).toBe(doc)
  })
})
