import { useEffect, useRef, type CSSProperties } from 'react'
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { ChevronRight, GripVertical, Plus, Rows3 } from 'lucide-react'
import type { MindNode } from '@shared/types'
import { getChildren, getNodePath } from '@shared/tree'
import { useMapStore } from '@renderer/stores/mapStore'

interface RowProps {
  node: MindNode
  depth: number
  path: Set<string>
}

function OutlineRow({ node, depth, path }: RowProps) {
  const document = useMapStore((state) => state.document)
  const selectedNodeId = useMapStore((state) => state.selectedNodeId)
  const editingNodeId = useMapStore((state) => state.editingNodeId)
  const selectNode = useMapStore((state) => state.selectNode)
  const toggleCollapsed = useMapStore((state) => state.toggleCollapsed)
  const addChild = useMapStore((state) => state.addChild)
  const patchNode = useMapStore((state) => state.patchNode)
  const finishRename = useMapStore((state) => state.finishRename)
  const inputRef = useRef<HTMLInputElement>(null)
  const children = document ? getChildren(document, node.id) : []
  const isEditing = editingNodeId === node.id

  const draggable = useDraggable({ id: `drag-${node.id}`, data: { nodeId: node.id } })
  const droppable = useDroppable({
    id: `drop-${node.id}`,
    data: { nodeId: node.id },
    disabled: node.parentId === null
  })

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isEditing])

  return (
    <div
      ref={droppable.setNodeRef}
      className={`outline-node ${selectedNodeId === node.id ? 'is-selected' : ''} ${path.has(node.id) ? 'on-path' : ''}`}
      data-depth={depth}
      style={{ '--depth': depth } as CSSProperties}
    >
      <div className="outline-row" onClick={() => selectNode(node.id)}>
        <span
          ref={draggable.setNodeRef}
          className="outline-drag-handle"
          style={{ transform: CSS.Transform.toString(draggable.transform) }}
          {...draggable.listeners}
          {...draggable.attributes}
          aria-label={`拖动 ${node.title}`}
        >
          <GripVertical size={14} />
        </span>
        <button
          className={`outline-toggle ${node.collapsed ? '' : 'is-open'}`}
          type="button"
          aria-label={node.collapsed ? '展开' : '折叠'}
          disabled={!children.length}
          onClick={(event) => {
            event.stopPropagation()
            toggleCollapsed(node.id)
          }}
        >
          {children.length ? <ChevronRight size={14} /> : <span />}
        </button>
        {isEditing ? (
          <input
            ref={inputRef}
            className="outline-title-input"
            value={node.title}
            onChange={(event) => patchNode(node.id, { title: event.target.value })}
            onClick={(event) => event.stopPropagation()}
            onBlur={finishRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault()
                finishRename()
              }
            }}
          />
        ) : (
          <span className="outline-title">{node.title || '未命名主题'}</span>
        )}
        {node.collapsed && children.length > 0 && <span className="outline-count">{children.length}</span>}
        <button
          className="outline-add"
          type="button"
          aria-label="添加子主题"
          onClick={(event) => {
            event.stopPropagation()
            addChild(node.id)
          }}
        >
          <Plus size={14} />
        </button>
      </div>
      {!node.collapsed && children.map((child) => (
        <OutlineRow key={child.id} node={child} depth={depth + 1} path={path} />
      ))}
    </div>
  )
}

export function OutlineView() {
  const document = useMapStore((state) => state.document)
  const selectedNodeId = useMapStore((state) => state.selectedNodeId)
  const dropNode = useMapStore((state) => state.dropNode)
  const addChild = useMapStore((state) => state.addChild)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const path = new Set(document && selectedNodeId ? getNodePath(document, selectedNodeId) : [])

  const onDragEnd = (event: DragEndEvent) => {
    const activeId = event.active.data.current?.nodeId as string | undefined
    const targetId = event.over?.data.current?.nodeId as string | undefined
    if (!activeId || !targetId || !document || activeId === targetId) return
    if (targetId === document.rootId) {
      dropNode(activeId, targetId, 'inside')
      return
    }
    const activeRect = event.active.rect.current.translated
    const overRect = event.over?.rect
    if (!activeRect || !overRect) return
    const activeCenter = activeRect.top + activeRect.height / 2
    const overCenter = overRect.top + overRect.height / 2
    const mode = activeCenter < overCenter - 14 ? 'before' : activeCenter > overCenter + 14 ? 'after' : 'inside'
    dropNode(activeId, targetId, mode)
  }

  if (!document) return null

  return (
    <aside className="outline-panel" aria-label="大纲编辑">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">结构</p>
          <h2><Rows3 size={16} />大纲</h2>
        </div>
        <button className="icon-button" type="button" aria-label="添加根节点的子主题" onClick={() => addChild(document.rootId)}>
          <Plus size={17} />
        </button>
      </div>
      <div className="outline-scroll">
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <OutlineRow node={document.nodes[document.rootId]!} depth={0} path={path} />
        </DndContext>
      </div>
      <div className="outline-footer">
        {Object.keys(document.nodes).length} 个节点
        <span>拖拽调整层级</span>
      </div>
    </aside>
  )
}
