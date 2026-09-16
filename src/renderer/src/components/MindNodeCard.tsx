import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import type { MindNode } from '@shared/types'
import { getChildren } from '@shared/tree'
import { useMapStore } from '@renderer/stores/mapStore'
import { summarizeMarkdown } from '@renderer/lib/markdown'

export interface MindNodeData extends Record<string, unknown> {
  node: MindNode
  onPath: boolean
}

export type MindNodeCanvasNode = Node<MindNodeData, 'zhituNode'>

function MindNodeCardComponent({ data, selected }: NodeProps<MindNodeCanvasNode>) {
  const document = useMapStore((state) => state.document)
  const addChild = useMapStore((state) => state.addChild)
  const toggleCollapsed = useMapStore((state) => state.toggleCollapsed)
  const node = data.node
  const childCount = document ? getChildren(document, node.id).length : 0
  const summary = node.summary.trim() || summarizeMarkdown(node.detailMarkdown)

  return (
    <article
      className={[
        'mind-node',
        `mind-node--${node.style.shape}`,
        `mind-node--${node.style.color}`,
        selected ? 'is-selected' : '',
        data.onPath ? 'on-path' : '',
        node.parentId === null ? 'is-root' : ''
      ].filter(Boolean).join(' ')}
      style={{ '--node-font-scale': node.style.fontScale } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Left} className="mind-node__handle" />
      <div className="mind-node__accent" aria-hidden="true" />
      <div className="mind-node__content">
        <strong>{node.title || '未命名主题'}</strong>
        {summary && <p>{summary}</p>}
      </div>
      <div className="mind-node__actions nodrag">
        <button
          type="button"
          aria-label="添加子主题"
          title="添加子主题"
          onClick={(event) => {
            event.stopPropagation()
            addChild(node.id)
          }}
        >
          <Plus size={14} />
        </button>
        {childCount > 0 && (
          <button
            type="button"
            aria-label={node.collapsed ? '展开子主题' : '折叠子主题'}
            title={node.collapsed ? '展开子主题' : '折叠子主题'}
            onClick={(event) => {
              event.stopPropagation()
              toggleCollapsed(node.id)
            }}
          >
            {node.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="mind-node__handle" />
    </article>
  )
}

export const MindNodeCard = memo(MindNodeCardComponent)
