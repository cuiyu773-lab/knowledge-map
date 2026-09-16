import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { Braces, CircleDot, Info, Link2, Palette, Trash2, Type } from 'lucide-react'
import type { LineStyle, NodeColor, NodeShape } from '@shared/types'
import { getNodePath } from '@shared/tree'
import { useMapStore } from '@renderer/stores/mapStore'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { RichTextEditor } from './RichTextEditor'

const colors: Array<{ value: NodeColor; label: string }> = [
  { value: 'oat', label: '燕麦' },
  { value: 'moss', label: '苔绿' },
  { value: 'clay', label: '陶土' },
  { value: 'terracotta', label: '赭红' },
  { value: 'river', label: '河蓝' },
  { value: 'plum', label: '梅紫' },
  { value: 'ink', label: '墨黑' }
]

const shapes: Array<{ value: NodeShape; label: string }> = [
  { value: 'rounded', label: '圆角' },
  { value: 'pill', label: '胶囊' },
  { value: 'rect', label: '方框' },
  { value: 'underline', label: '下划' }
]

const lines: Array<{ value: LineStyle; label: string }> = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' }
]

export function NodeInspector() {
  const document = useMapStore((state) => state.document)
  const selectedNodeId = useMapStore((state) => state.selectedNodeId)
  const patchNode = useMapStore((state) => state.patchNode)
  const patchStyle = useMapStore((state) => state.patchStyle)
  const removeSelected = useMapStore((state) => state.removeSelected)
  const showToast = useWorkspaceStore((state) => state.showToast)
  const node = document && selectedNodeId ? document.nodes[selectedNodeId] : null
  if (!document || !node) {
    return <aside className="inspector-panel"><p className="empty-copy">选择一个节点后在这里编辑完整内容。</p></aside>
  }
  const path = getNodePath(document, node.id)

  return (
    <aside className="inspector-panel" aria-label="节点详情">
      <div className="panel-heading inspector-heading">
        <div>
          <p className="eyebrow">详情</p>
          <h2><Braces size={16} />节点内容</h2>
        </div>
      </div>
      <div className="inspector-scroll">
        <nav className="breadcrumb" aria-label="节点路径">
          {path.map((id, index) => (
            <span key={id}>
              {index > 0 && <i>/</i>}
              <button type="button" onClick={() => useMapStore.getState().selectNode(id)}>{document.nodes[id]?.title || '未命名'}</button>
            </span>
          ))}
        </nav>

        <label className="field">
          <span>标题</span>
          <input value={node.title} maxLength={200} onChange={(event) => patchNode(node.id, { title: event.target.value })} />
        </label>
        <label className="field">
          <span><Info size={13} />画布摘要</span>
          <textarea
            value={node.summary}
            rows={3}
            maxLength={280}
            placeholder="留空时自动截取笔记开头"
            onChange={(event) => patchNode(node.id, { summary: event.target.value })}
          />
        </label>

        <section className="inspector-section">
          <h3><Palette size={14} />颜色与形状</h3>
          <div className="color-row">
            {colors.map((color) => (
              <button
                key={color.value}
                type="button"
                className={`color-swatch color-swatch--${color.value} ${node.style.color === color.value ? 'is-active' : ''}`}
                title={color.label}
                aria-label={color.label}
                onClick={() => patchStyle(node.id, { color: color.value })}
              />
            ))}
          </div>
          <ToggleGroup.Root
            className="segmented"
            type="single"
            value={node.style.shape}
            onValueChange={(value) => value && patchStyle(node.id, { shape: value as NodeShape })}
            aria-label="节点形状"
          >
            {shapes.map((shape) => <ToggleGroup.Item key={shape.value} value={shape.value}>{shape.label}</ToggleGroup.Item>)}
          </ToggleGroup.Root>
        </section>

        <section className="inspector-section">
          <h3><Type size={14} />文字与连线</h3>
          <label className="range-field">
            <span>字号 {Math.round(node.style.fontScale * 100)}%</span>
            <input
              type="range"
              min="0.85"
              max="1.3"
              step="0.05"
              value={node.style.fontScale}
              onChange={(event) => patchStyle(node.id, { fontScale: Number(event.target.value) })}
            />
          </label>
          <ToggleGroup.Root
            className="segmented"
            type="single"
            value={node.style.lineStyle}
            onValueChange={(value) => value && patchStyle(node.id, { lineStyle: value as LineStyle })}
            aria-label="入边线型"
          >
            {lines.map((line) => <ToggleGroup.Item key={line.value} value={line.value}><Link2 size={12} />{line.label}</ToggleGroup.Item>)}
          </ToggleGroup.Root>
        </section>

        <section className="inspector-section inspector-section--editor">
          <h3><CircleDot size={14} />完整笔记</h3>
          <RichTextEditor key={node.id} value={node.detailMarkdown} onChange={(value) => patchNode(node.id, { detailMarkdown: value })} />
        </section>

        {node.id !== document.rootId && (
          <div className="inspector-danger">
            <button
              className="button button--danger button--wide"
              type="button"
              onClick={() => {
                if (window.confirm(`删除「${node.title}」及其全部子主题？`)) {
                  removeSelected()
                  showToast('节点已删除，可使用 Ctrl+Z 撤销', 'info')
                }
              }}
            >
              <Trash2 size={15} />
              删除该主题及子主题
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
