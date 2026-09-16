import { describe, expect, it } from 'vitest'
import { importMarkdownToMindMap } from '@shared/markdown'
import { getChildren } from '@shared/tree'

describe('Markdown 导入', () => {
  it('按标题和列表构建层级，并把段落放入节点详情', async () => {
    let sequence = 0
    const result = await importMarkdownToMindMap({
      fileName: '算法.md',
      markdown: `# 算法\n\n总览段落\n\n## 排序\n\n- 快速排序\n  - 分治\n  - 原地分区\n- 归并排序\n`,
      idFactory: () => `id-${++sequence}`
    })
    const root = result.document.nodes[result.document.rootId]!
    const sections = getChildren(result.document, root.id)
    expect(root.title).toBe('算法')
    expect(root.detailMarkdown).toContain('总览段落')
    expect(sections[0]?.title).toBe('排序')
    const sorts = getChildren(result.document, sections[0]!.id)
    expect(sorts.map((node) => node.title)).toEqual(['快速排序', '归并排序'])
    expect(getChildren(result.document, sorts[0]!.id).map((node) => node.title)).toEqual(['分治', '原地分区'])
  })

  it('复制相对图片并保留公式源码', async () => {
    let sequence = 0
    const requested: string[] = []
    const result = await importMarkdownToMindMap({
      fileName: '数学.md',
      markdown: '# 数学\n\n公式 $a^2+b^2=c^2$\n\n![图](./images/triangle.png)',
      idFactory: () => `id-${++sequence}`,
      rewriteImage: async (source) => {
        requested.push(source)
        return 'assets/triangle.png'
      }
    })
    const root = result.document.nodes[result.document.rootId]!
    expect(requested).toEqual(['./images/triangle.png'])
    expect(root.detailMarkdown).toContain('$a^2+b^2=c^2$')
    expect(root.detailMarkdown).toContain('assets/triangle.png')
  })

  it('多个一级标题时以文件名作为根节点', async () => {
    let sequence = 0
    const result = await importMarkdownToMindMap({
      fileName: '主题.md',
      markdown: '# 第一张\n\n内容\n\n# 第二张\n',
      idFactory: () => `id-${++sequence}`
    })
    const root = result.document.nodes[result.document.rootId]!
    expect(root.title).toBe('主题')
    expect(getChildren(result.document, root.id).map((node) => node.title)).toEqual(['第一张', '第二张'])
  })
})
