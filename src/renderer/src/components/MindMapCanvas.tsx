import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  getNodesBounds,
  useReactFlow,
  type Edge,
  type NodeChange,
  type OnNodeDrag,
  type NodeTypes,
  type Viewport
} from '@xyflow/react'
import { Focus, LocateFixed, Minus, Plus, RotateCcw } from 'lucide-react'
import { getNodePath, getVisibleNodeIds } from '@shared/tree'
import { useMapStore } from '@renderer/stores/mapStore'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { calculateLayout } from '@renderer/lib/layout'
import { registerCanvasCommands } from '@renderer/lib/canvasBridge'
import { createExportRequest } from '@renderer/lib/exportMap'
import { MindNodeCard, type MindNodeCanvasNode } from './MindNodeCard'

const nodeTypes: NodeTypes = { zhituNode: MindNodeCard }

function lineDash(style: 'solid' | 'dashed' | 'dotted'): string | undefined {
  if (style === 'dashed') return '8 6'
  if (style === 'dotted') return '2 5'
  return undefined
}

function MindMapCanvasInner() {
  const document = useMapStore((state) => state.document)
  const selectedNodeId = useMapStore((state) => state.selectedNodeId)
  const selectNode = useMapStore((state) => state.selectNode)
  const setOffset = useMapStore((state) => state.setOffset)
  const setViewport = useMapStore((state) => state.setViewport)
  const clearOffsets = useMapStore((state) => state.clearOffsets)
  const showToast = useWorkspaceStore((state) => state.showToast)
  const flow = useReactFlow<MindNodeCanvasNode>()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<Awaited<ReturnType<typeof calculateLayout>>>({})
  const [nodes, setNodes] = useState<MindNodeCanvasNode[]>([])
  const lastFitMap = useRef<string | null>(null)

  const structureKey = document
    ? Object.values(document.nodes)
        .map((node) => `${node.id}:${node.parentId}:${node.order}:${node.title}:${node.summary}:${node.collapsed}`)
        .join('|')
    : ''

  useEffect(() => {
    if (!document) return
    let canceled = false
    void calculateLayout(document).then((result) => {
      if (!canceled) setLayout(result)
    })
    return () => {
      canceled = true
    }
  }, [document?.id, structureKey])

  const path = useMemo(
    () => new Set(document && selectedNodeId ? getNodePath(document, selectedNodeId) : []),
    [document, selectedNodeId]
  )

  const generatedNodes = useMemo<MindNodeCanvasNode[]>(() => {
    if (!document) return []
    return getVisibleNodeIds(document).flatMap((id) => {
      const node = document.nodes[id]
      const position = layout[id]
      if (!node || !position) return []
      return [{
        id,
        type: 'zhituNode' as const,
        position: {
          x: position.x + node.manualOffset.x,
          y: position.y + node.manualOffset.y
        },
        data: { node, onPath: path.has(id) },
        selected: selectedNodeId === id,
        draggable: true,
        connectable: false,
        width: position.width,
        height: position.height
      }]
    })
  }, [document, layout, path, selectedNodeId])

  useEffect(() => setNodes(generatedNodes), [generatedNodes])

  const edges = useMemo<Edge[]>(() => {
    if (!document) return []
    return Object.values(document.nodes).flatMap((node) => {
      if (!node.parentId) return []
      if (!layout[node.id] || !layout[node.parentId]) return []
      return [{
        id: `${node.parentId}-${node.id}`,
        source: node.parentId,
        target: node.id,
        type: 'smoothstep',
        animated: false,
        style: {
          stroke: 'var(--edge)',
          strokeWidth: path.has(node.id) && path.has(node.parentId) ? 2.2 : 1.4,
          strokeDasharray: lineDash(node.style.lineStyle)
        },
        className: path.has(node.id) && path.has(node.parentId) ? 'mind-edge on-path' : 'mind-edge'
      }]
    })
  }, [document, layout, path])

  useEffect(() => {
    if (!document || !Object.keys(layout).length || lastFitMap.current === document.id) return
    const timer = setTimeout(() => {
      void flow.fitView({ padding: 0.22, duration: 380, maxZoom: 1.1 })
      lastFitMap.current = document.id
    }, 80)
    return () => clearTimeout(timer)
  }, [document?.id, layout, flow])

  useEffect(() => {
    if (!document) return
    registerCanvasCommands({
      fitView: () => void flow.fitView({ padding: 0.22, duration: 420, maxZoom: 1.15 }),
      exportMap: async (format, quality) => {
        const viewportElement = wrapperRef.current?.querySelector('.react-flow__viewport') as HTMLElement | null
        if (!viewportElement) return
        const bounds = getNodesBounds(flow.getNodes())
        if (!bounds.width || !bounds.height) {
          showToast('当前导图没有可导出的节点', 'error')
          return
        }
        try {
          showToast(`正在生成 ${format.toUpperCase()}…`, 'info')
          const backgroundColor = getComputedStyle(wrapperRef.current!).getPropertyValue('--canvas-export-bg').trim()
          const request = await createExportRequest(
            viewportElement,
            bounds,
            flow.getViewport(),
            backgroundColor || '#e8dcc7',
            document.title,
            format,
            quality
          )
          const result = await window.zhitu.exports.save(request)
          if (!result.ok) showToast(result.error.message, 'error')
          else if (result.value) showToast('导出完成', 'success')
        } catch (error) {
          showToast(error instanceof Error ? error.message : '导出失败', 'error')
        }
      }
    })
    return () => registerCanvasCommands(null)
  }, [document, flow, showToast])

  const onNodesChange = (changes: NodeChange<MindNodeCanvasNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current))
  }

  const onNodeDragStop: OnNodeDrag<MindNodeCanvasNode> = (_event, node) => {
    const base = layout[node.id]
    if (!base) return
    setOffset(node.id, {
      x: Math.round(node.position.x - base.x),
      y: Math.round(node.position.y - base.y)
    })
  }

  const onMoveEnd = (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    setViewport(viewport)
  }

  if (!document) return null

  return (
    <section className="mind-canvas" ref={wrapperRef} aria-label="思维导图画布">
      <ReactFlow<MindNodeCanvasNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_event, node) => selectNode(node.id)}
        onNodeDragStop={onNodeDragStop}
        onMoveEnd={onMoveEnd}
        defaultViewport={document.viewport}
        minZoom={0.2}
        maxZoom={1.8}
        panOnScroll
        zoomOnDoubleClick={false}
        nodesConnectable={false}
        onlyRenderVisibleElements={false}
        proOptions={{ hideAttribution: true }}
        className="mind-canvas__flow"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.15}
          color="var(--canvas-dot)"
          style={{ backgroundColor: 'var(--canvas-bg)' }}
        />
        <MiniMap
          className="mind-minimap"
          nodeColor={(node) => `var(--node-${(node.data as { node?: { style?: { color?: string } } }).node?.style?.color ?? 'oat'})`}
          maskColor="var(--canvas-mask)"
          pannable
          zoomable
        />
        <Panel position="bottom-left" className="canvas-controls">
          <button type="button" title="缩小" aria-label="缩小" onClick={() => void flow.zoomOut({ duration: 180 })}><Minus size={16} /></button>
          <button type="button" title="适应画布" aria-label="适应画布" onClick={() => void flow.fitView({ padding: 0.22, duration: 320 })}><Focus size={16} /></button>
          <button type="button" title="放大" aria-label="放大" onClick={() => void flow.zoomIn({ duration: 180 })}><Plus size={16} /></button>
          <button type="button" title="清除手动偏移" aria-label="清除手动偏移" onClick={clearOffsets}><RotateCcw size={16} /></button>
        </Panel>
        <Panel position="bottom-right" className="canvas-hint">
          <LocateFixed size={13} />
          拖拽节点微调 · 大纲调整结构
        </Panel>
      </ReactFlow>
    </section>
  )
}

export function MindMapCanvas() {
  return (
    <ReactFlowProvider>
      <MindMapCanvasInner />
    </ReactFlowProvider>
  )
}

