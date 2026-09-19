import { create } from 'zustand'
import type { AiPreview, AiPreviewStrategy, MindMapDocument, NodeStyle, StylePreset, TemplateApplyScope } from '@shared/types'
import { applyAiPreview, createRootFromAiPreview } from '@shared/ai'
import { applyStylePreset as applyStylePresetToDocument } from '@shared/templates'
import {
  deleteSubtree,
  insertChild,
  insertSibling,
  moveNode,
  promoteNode,
  reorderNode,
  updateNode
} from '@shared/tree'

interface MapState {
  document: MindMapDocument | null
  selectedNodeId: string | null
  fileHash: string
  dirty: boolean
  saving: boolean
  lastSavedAt: string | null
  saveError: string | null
  readOnly: boolean
  past: MindMapDocument[]
  future: MindMapDocument[]
  editingNodeId: string | null
  loadMap: (mapId: string) => Promise<boolean>
  loadDocument: (document: MindMapDocument, hash: string, readOnly?: boolean) => Promise<void>
  reset: () => void
  selectNode: (nodeId: string) => void
  requestRename: (nodeId: string) => void
  finishRename: () => void
  addChild: (parentId?: string) => void
  addSibling: (referenceId?: string) => void
  removeSelected: () => void
  promoteSelected: () => void
  reorderSelected: (delta: -1 | 1) => void
  dropNode: (activeId: string, targetId: string, mode: 'before' | 'inside' | 'after') => void
  patchNode: (nodeId: string, patch: Parameters<typeof updateNode>[2]) => void
  patchStyle: (nodeId: string, style: Partial<NodeStyle>) => void
  applyStylePreset: (nodeId: string, scope: TemplateApplyScope, preset: StylePreset) => void
  setOffset: (nodeId: string, offset: { x: number; y: number }) => void
  toggleCollapsed: (nodeId: string) => void
  clearOffsets: () => void
  setViewport: (viewport: MindMapDocument['viewport']) => void
  setDocumentTitle: (title: string) => void
  applyGeneratedPreview: (targetNodeId: string, preview: AiPreview, strategy: AiPreviewStrategy) => void
  applyGeneratedRoot: (preview: AiPreview) => void
  undo: () => void
  redo: () => void
  save: (force?: boolean) => Promise<boolean>
  checkExternalChange: () => Promise<boolean>
  snapshot: () => Promise<boolean>
}

function stamp(document: MindMapDocument): MindMapDocument {
  return { ...document, updatedAt: new Date().toISOString() }
}

export const useMapStore = create<MapState>((set, get) => {
  const apply = (next: MindMapDocument, selectedNodeId?: string) => {
    const current = get().document
    if (!current || next === current) return
    set((state) => ({
      document: stamp(next),
      dirty: true,
      saveError: null,
      past: [...state.past.slice(-49), structuredClone(current)],
      future: [],
      ...(selectedNodeId ? { selectedNodeId } : {})
    }))
  }

  return {
    document: null,
    selectedNodeId: null,
    fileHash: '',
    dirty: false,
    saving: false,
    lastSavedAt: null,
    saveError: null,
    readOnly: false,
    past: [],
    future: [],
    editingNodeId: null,

    loadMap: async (mapId) => {
      const result = await window.zhitu.maps.read(mapId)
      if (!result.ok) {
        set({ saveError: result.error.message, readOnly: true })
        return false
      }
      await get().loadDocument(result.value.document, result.value.hash, result.value.readOnly)
      return true
    },

    loadDocument: async (document, hash, readOnly = false) => {
      set({
        document: structuredClone(document),
        selectedNodeId: document.rootId,
        fileHash: hash,
        dirty: false,
        past: [],
        future: [],
        readOnly,
        saveError: null,
        lastSavedAt: new Date().toISOString()
      })
    },

    reset: () =>
      set({
        document: null,
        selectedNodeId: null,
        fileHash: '',
        dirty: false,
        past: [],
        future: [],
        readOnly: false,
        saveError: null
      }),

    selectNode: (nodeId) => {
      if (get().document?.nodes[nodeId]) set({ selectedNodeId: nodeId })
    },

    requestRename: (nodeId) => set({ selectedNodeId: nodeId, editingNodeId: nodeId }),
    finishRename: () => set({ editingNodeId: null }),

    addChild: (parentId) => {
      const document = get().document
      const selected = parentId ?? get().selectedNodeId ?? document?.rootId
      if (!document || !selected) return
      const result = insertChild(document, selected)
      apply(result.document, result.nodeId)
      set({ editingNodeId: result.nodeId })
    },

    addSibling: (referenceId) => {
      const document = get().document
      const selected = referenceId ?? get().selectedNodeId ?? document?.rootId
      if (!document || !selected) return
      const result = insertSibling(document, selected)
      apply(result.document, result.nodeId)
      set({ editingNodeId: result.nodeId })
    },

    removeSelected: () => {
      const document = get().document
      const selected = get().selectedNodeId
      if (!document || !selected || selected === document.rootId) return
      const result = deleteSubtree(document, selected)
      apply(result.document, result.nextSelectedId)
    },

    promoteSelected: () => {
      const document = get().document
      const selected = get().selectedNodeId
      if (!document || !selected) return
      apply(promoteNode(document, selected), selected)
    },

    reorderSelected: (delta) => {
      const document = get().document
      const selected = get().selectedNodeId
      if (!document || !selected) return
      apply(reorderNode(document, selected, delta), selected)
    },

    dropNode: (activeId, targetId, mode) => {
      const document = get().document
      if (!document) return
      apply(moveNode(document, activeId, targetId, mode), activeId)
    },

    patchNode: (nodeId, patch) => {
      const document = get().document
      if (!document) return
      apply(updateNode(document, nodeId, patch), nodeId)
    },

    patchStyle: (nodeId, style) => {
      const document = get().document
      const node = document?.nodes[nodeId]
      if (!document || !node) return
      apply(updateNode(document, nodeId, { style: { ...node.style, ...style } }), nodeId)
    },

    applyStylePreset: (nodeId, scope, preset) => {
      const document = get().document
      if (!document || !document.nodes[nodeId]) return
      apply(applyStylePresetToDocument(document, nodeId, scope, preset.style), nodeId)
    },

    setOffset: (nodeId, offset) => {
      const document = get().document
      if (!document) return
      apply(updateNode(document, nodeId, { manualOffset: offset }), nodeId)
    },

    toggleCollapsed: (nodeId) => {
      const document = get().document
      const node = document?.nodes[nodeId]
      if (!document || !node) return
      apply(updateNode(document, nodeId, { collapsed: !node.collapsed }), nodeId)
    },

    clearOffsets: () => {
      const document = get().document
      if (!document) return
      const nodes = Object.fromEntries(
        Object.entries(document.nodes).map(([id, node]) => [id, { ...node, manualOffset: { x: 0, y: 0 } }])
      )
      apply({ ...document, nodes }, get().selectedNodeId ?? undefined)
    },

    setViewport: (viewport) => {
      const document = get().document
      if (!document) return
      set({ document: { ...document, viewport }, dirty: true })
    },

    setDocumentTitle: (title) => {
      const document = get().document
      if (!document) return
      apply({ ...document, title }, get().selectedNodeId ?? undefined)
    },

    applyGeneratedPreview: (targetNodeId, preview, strategy) => {
      const document = get().document
      if (!document || !document.nodes[targetNodeId]) return
      apply(applyAiPreview(document, targetNodeId, preview, strategy), targetNodeId)
    },

    applyGeneratedRoot: (preview) => {
      const document = get().document
      if (!document) return
      apply(createRootFromAiPreview(document, preview), document.rootId)
    },

    undo: () => {
      const state = get()
      const previous = state.past.at(-1)
      if (!previous || !state.document) return
      set({
        document: previous,
        past: state.past.slice(0, -1),
        future: [state.document, ...state.future].slice(0, 50),
        dirty: true,
        selectedNodeId: previous.nodes[state.selectedNodeId ?? previous.rootId]?.id ?? previous.rootId
      })
    },

    redo: () => {
      const state = get()
      const next = state.future[0]
      if (!next || !state.document) return
      set({
        document: next,
        past: [...state.past, state.document].slice(-50),
        future: state.future.slice(1),
        dirty: true,
        selectedNodeId: next.nodes[state.selectedNodeId ?? next.rootId]?.id ?? next.rootId
      })
    },

    save: async (force = false) => {
      const state = get()
      if (!state.document || state.readOnly) return !state.readOnly
      if (!state.dirty && !force) return true
      set({ saving: true, saveError: null })
      const documentBeingSaved = state.document
      const result = await window.zhitu.maps.save(documentBeingSaved, state.fileHash || undefined, force)
      if (!result.ok) {
        set({ saving: false, saveError: result.error.message })
        return false
      }
      const hasNewerChanges = get().document !== documentBeingSaved
      set({
        saving: false,
        dirty: hasNewerChanges,
        fileHash: result.value.hash,
        lastSavedAt: new Date().toISOString(),
        saveError: null
      })
      return true
    },

    checkExternalChange: async () => {
      const state = get()
      if (!state.document || !state.fileHash) return false
      const result = await window.zhitu.maps.hash(state.document.id)
      if (!result.ok || !result.value || result.value === state.fileHash) return false
      return true
    },

    snapshot: async () => {
      const document = get().document
      if (!document) return false
      const result = await window.zhitu.history.create(document.id)
      return result.ok
    }
  }
})


