import { create } from 'zustand'
import type { SaveStylePresetInput, SaveTemplateInput, StylePreset, TemplateApplyScope, TemplateNodeBehavior, TemplateSummary, UpdateTemplateInput } from '@shared/types'
import { useMapStore } from './mapStore'
import { useWorkspaceStore } from './workspaceStore'

export type TemplatePickerMode = 'map' | 'workspace' | 'ai'
export type TemplatePickResult = TemplateSummary | 'blank' | null

interface TemplateState {
  templates: TemplateSummary[]
  presets: StylePreset[]
  loading: boolean
  pickerMode: TemplatePickerMode | null
  pickerResolver: ((result: TemplatePickResult) => void) | null
  managerOpen: boolean
  saveOpen: boolean
  saveRootNodeId: string | null
  presetOpen: boolean
  initialize: () => Promise<void>
  refresh: () => Promise<void>
  openPicker: (mode: TemplatePickerMode) => Promise<TemplatePickResult>
  resolvePicker: (result: TemplatePickResult) => void
  createMapFromTemplate: (templateId: string, title?: string) => Promise<boolean>
  saveTemplate: (input: SaveTemplateInput) => Promise<boolean>
  updateTemplate: (input: UpdateTemplateInput) => Promise<boolean>
  renameTemplate: (id: string, name: string) => Promise<boolean>
  removeTemplate: (id: string) => Promise<boolean>
  setAiRecommendation: (id: string, enabled: boolean) => Promise<boolean>
  setBehaviors: (id: string, behaviors: Record<string, TemplateNodeBehavior>) => Promise<boolean>
  importTemplate: () => Promise<boolean>
  exportTemplate: (id: string) => Promise<boolean>
  savePreset: (input: SaveStylePresetInput) => Promise<StylePreset | null>
  renamePreset: (id: string, name: string) => Promise<boolean>
  removePreset: (id: string) => Promise<boolean>
  applyPreset: (presetId: string, nodeId: string, scope: TemplateApplyScope) => boolean
  setManagerOpen: (open: boolean) => void
  setSaveOpen: (open: boolean, rootNodeId?: string) => void
  setPresetOpen: (open: boolean) => void
}

export const useTemplateStore = create<TemplateState>((set, get) => ({
  templates: [],
  presets: [],
  loading: false,
  pickerMode: null,
  pickerResolver: null,
  managerOpen: false,
  saveOpen: false,
  saveRootNodeId: null,
  presetOpen: false,

  initialize: async () => {
    await get().refresh()
  },

  refresh: async () => {
    set({ loading: true })
    const [templates, presets] = await Promise.all([
      window.zhitu.templates.list(),
      window.zhitu.presets.list()
    ])
    set({
      loading: false,
      templates: templates.ok ? templates.value : [],
      presets: presets.ok ? presets.value : []
    })
  },

  openPicker: (mode) => new Promise<TemplatePickResult>((resolve) => {
    const previous = get().pickerResolver
    if (previous) previous(null)
    set({ pickerMode: mode, pickerResolver: resolve })
    void get().refresh()
  }),

  resolvePicker: (result) => {
    const resolver = get().pickerResolver
    set({ pickerMode: null, pickerResolver: null })
    resolver?.(result)
  },

  createMapFromTemplate: async (templateId, title) => {
    const summary = await useWorkspaceStore.getState().createMapFromTemplate(templateId, title)
    return Boolean(summary)
  },

  saveTemplate: async (input) => {
    const result = await window.zhitu.templates.save(input)
    if (!result.ok) {
      useWorkspaceStore.getState().showToast(result.error.message, 'error')
      return false
    }
    await get().refresh()
    useWorkspaceStore.getState().showToast('模板已保存', 'success')
    return true
  },

  updateTemplate: async (input) => {
    const result = await window.zhitu.templates.update(input)
    if (!result.ok) {
      useWorkspaceStore.getState().showToast(result.error.message, 'error')
      return false
    }
    await get().refresh()
    useWorkspaceStore.getState().showToast('模板已更新', 'success')
    return true
  },

  renameTemplate: async (id, name) => {
    const result = await window.zhitu.templates.rename(id, name)
    if (!result.ok) {
      useWorkspaceStore.getState().showToast(result.error.message, 'error')
      return false
    }
    await get().refresh()
    return true
  },

  removeTemplate: async (id) => {
    const result = await window.zhitu.templates.remove(id)
    if (!result.ok) {
      useWorkspaceStore.getState().showToast(result.error.message, 'error')
      return false
    }
    await get().refresh()
    useWorkspaceStore.getState().showToast('模板已移入系统回收站', 'success')
    return true
  },

  setAiRecommendation: async (id, enabled) => {
    const result = await window.zhitu.templates.setAiRecommendation(id, enabled)
    if (!result.ok) {
      useWorkspaceStore.getState().showToast(result.error.message, 'error')
      return false
    }
    await get().refresh()
    return true
  },

  setBehaviors: async (id, behaviors) => {
    const result = await window.zhitu.templates.setBehaviors(id, behaviors)
    if (!result.ok) {
      useWorkspaceStore.getState().showToast(result.error.message, 'error')
      return false
    }
    await get().refresh()
    return true
  },

  importTemplate: async () => {
    const result = await window.zhitu.templates.importPackage()
    if (!result.ok) {
      useWorkspaceStore.getState().showToast(result.error.message, 'error')
      return false
    }
    if (!result.value) return false
    await get().refresh()
    useWorkspaceStore.getState().showToast('模板已导入', 'success')
    return true
  },

  exportTemplate: async (id) => {
    const result = await window.zhitu.templates.exportPackage(id)
    if (!result.ok) {
      useWorkspaceStore.getState().showToast(result.error.message, 'error')
      return false
    }
    if (result.value) useWorkspaceStore.getState().showToast('模板已导出', 'success')
    return Boolean(result.value)
  },

  savePreset: async (input) => {
    const result = await window.zhitu.presets.save(input)
    if (!result.ok) {
      useWorkspaceStore.getState().showToast(result.error.message, 'error')
      return null
    }
    await get().refresh()
    useWorkspaceStore.getState().showToast('样式预设已保存', 'success')
    return result.value
  },

  renamePreset: async (id, name) => {
    const result = await window.zhitu.presets.rename(id, name)
    if (!result.ok) {
      useWorkspaceStore.getState().showToast(result.error.message, 'error')
      return false
    }
    await get().refresh()
    return true
  },

  removePreset: async (id) => {
    const result = await window.zhitu.presets.remove(id)
    if (!result.ok) {
      useWorkspaceStore.getState().showToast(result.error.message, 'error')
      return false
    }
    await get().refresh()
    return true
  },

  applyPreset: (presetId, nodeId, scope) => {
    const preset = get().presets.find((item) => item.id === presetId)
    if (!preset || !useMapStore.getState().document) return false
    useMapStore.getState().applyStylePreset(nodeId, scope, preset)
    useWorkspaceStore.getState().showToast('样式已套用，可使用 Ctrl+Z 撤销', 'success')
    return true
  },

  setManagerOpen: (managerOpen) => set({ managerOpen }),
  setSaveOpen: (saveOpen, rootNodeId) => set({ saveOpen, saveRootNodeId: saveOpen ? rootNodeId ?? null : null }),
  setPresetOpen: (presetOpen) => set({ presetOpen })
}))
