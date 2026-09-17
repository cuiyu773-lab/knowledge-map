import { create } from 'zustand'
import type {
  AppSettings,
  ConflictState,
  MapSummary,
  PanelVisibility,
  RecentWorkspace,
  ThemeMode,
  WorkspaceDescriptor
} from '@shared/types'
import { useMapStore } from './mapStore'

export interface ToastMessage {
  id: number
  kind: 'info' | 'success' | 'error'
  message: string
}

interface WorkspaceState {
  initializing: boolean
  recents: RecentWorkspace[]
  descriptor: WorkspaceDescriptor | null
  activeMapId: string | null
  settings: AppSettings
  busy: boolean
  toast: ToastMessage | null
  conflict: ConflictState | null
  searchOpen: boolean
  snapshotsOpen: boolean
  initialize: () => Promise<void>
  createWorkspace: (name: string) => Promise<boolean>
  chooseWorkspace: () => Promise<boolean>
  openWorkspace: (workspacePath: string) => Promise<boolean>
  closeWorkspace: () => Promise<void>
  selectMap: (mapId: string) => Promise<void>
  createMap: (title?: string) => Promise<MapSummary | null>
  importMarkdown: () => Promise<void>
  deleteMap: (mapId: string) => Promise<void>
  refreshMaps: () => Promise<void>
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  togglePanel: (panel: keyof PanelVisibility) => void
  showToast: (message: string, kind?: ToastMessage['kind']) => void
  clearToast: () => void
  setConflict: (conflict: ConflictState | null) => void
  setSearchOpen: (open: boolean) => void
  setSnapshotsOpen: (open: boolean) => void
}

const defaultSettings: AppSettings = {
  theme: 'light',
  panels: { outline: true, inspector: true }
}

let toastSequence = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  initializing: true,
  recents: [],
  descriptor: null,
  activeMapId: null,
  settings: defaultSettings,
  busy: false,
  toast: null,
  conflict: null,
  searchOpen: false,
  snapshotsOpen: false,

  initialize: async () => {
    const [recentResult, settingsResult] = await Promise.all([
      window.zhitu.workspace.recents(),
      window.zhitu.settings.read()
    ])
    set({
      initializing: false,
      recents: recentResult.ok ? recentResult.value : [],
      settings: settingsResult.ok ? settingsResult.value : defaultSettings
    })
  },

  createWorkspace: async (name) => {
    set({ busy: true })
    const result = await window.zhitu.workspace.create(name)
    set({ busy: false })
    if (!result.ok) {
      if (result.error.code !== 'CANCELED') get().showToast(result.error.message, 'error')
      return false
    }
    set({ descriptor: result.value, activeMapId: result.value.maps[0]?.id ?? null })
    if (result.value.maps[0]) await useMapStore.getState().loadMap(result.value.maps[0].id)
    else await get().createMap('我的学习导图')
    await get().initialize()
    return true
  },

  chooseWorkspace: async () => {
    set({ busy: true })
    const result = await window.zhitu.workspace.choose()
    set({ busy: false })
    if (!result.ok) {
      if (result.error.code !== 'CANCELED') get().showToast(result.error.message, 'error')
      return false
    }
    set({ descriptor: result.value, activeMapId: result.value.maps[0]?.id ?? null })
    if (result.value.maps[0]) await useMapStore.getState().loadMap(result.value.maps[0].id)
    return true
  },

  openWorkspace: async (workspacePath) => {
    set({ busy: true })
    const result = await window.zhitu.workspace.openPath(workspacePath)
    set({ busy: false })
    if (!result.ok) {
      get().showToast(result.error.message, 'error')
      return false
    }
    set({ descriptor: result.value, activeMapId: result.value.maps[0]?.id ?? null })
    if (result.value.maps[0]) await useMapStore.getState().loadMap(result.value.maps[0].id)
    return true
  },

  closeWorkspace: async () => {
    await useMapStore.getState().save().catch(() => undefined)
    await window.zhitu.workspace.close()
    useMapStore.getState().reset()
    set({ descriptor: null, activeMapId: null, searchOpen: false, conflict: null })
  },

  selectMap: async (mapId) => {
    if (get().activeMapId === mapId) return
    const saved = await useMapStore.getState().save()
    if (!saved) return
    set({ activeMapId: mapId })
    await useMapStore.getState().loadMap(mapId)
  },

  createMap: async (title = '未命名导图') => {
    set({ busy: true })
    const result = await window.zhitu.maps.create(title)
    set({ busy: false })
    if (!result.ok) {
      get().showToast(result.error.message, 'error')
      return null
    }
    set((state) => ({
      activeMapId: result.value.summary.id,
      descriptor: state.descriptor
        ? { ...state.descriptor, maps: [...state.descriptor.maps, result.value.summary] }
        : null
    }))
    await useMapStore.getState().loadDocument(result.value.document, '', false)
    return result.value.summary
  },

  importMarkdown: async () => {
    set({ busy: true })
    const result = await window.zhitu.markdown.import()
    set({ busy: false })
    if (!result.ok) {
      get().showToast(result.error.message, 'error')
      return
    }
    if (!result.value) return
    set((state) => ({
      activeMapId: result.value!.summary.id,
      descriptor: state.descriptor
        ? { ...state.descriptor, maps: [...state.descriptor.maps, result.value!.summary] }
        : null
    }))
    await useMapStore.getState().loadDocument(result.value.document, '', false)
    if (result.value.warnings.length) {
      get().showToast(`已导入，但有 ${result.value.warnings.length} 张图片未能复制`, 'info')
    } else {
      get().showToast('Markdown 已导入', 'success')
    }
  },

  deleteMap: async (mapId) => {
    const result = await window.zhitu.maps.trash(mapId)
    if (!result.ok) {
      get().showToast(result.error.message, 'error')
      return
    }
    const descriptor = get().descriptor
    const nextMaps = descriptor?.maps.filter((map) => map.id !== mapId) ?? []
    set((state) => ({
      descriptor: state.descriptor ? { ...state.descriptor, maps: nextMaps } : null,
      activeMapId: state.activeMapId === mapId ? nextMaps[0]?.id ?? null : state.activeMapId
    }))
    useMapStore.getState().reset()
    if (nextMaps[0]) await useMapStore.getState().loadMap(nextMaps[0].id)
    get().showToast('导图已移入回收站', 'success')
  },

  refreshMaps: async () => {
    const result = await window.zhitu.maps.list()
    if (result.ok) set((state) => ({ descriptor: state.descriptor ? { ...state.descriptor, maps: result.value } : null }))
  },

  setTheme: (theme) => {
    const settings = { ...get().settings, theme }
    set({ settings })
    void window.zhitu.settings.write(settings)
  },

  toggleTheme: () => get().setTheme(get().settings.theme === 'light' ? 'dark' : 'light'),

  togglePanel: (panel) => {
    const panels = { ...get().settings.panels, [panel]: !get().settings.panels[panel] }
    const settings = { ...get().settings, panels }
    set({ settings })
    void window.zhitu.settings.write(settings)
  },

  showToast: (message, kind = 'info') => {
    if (toastTimer) clearTimeout(toastTimer)
    const toast = { id: ++toastSequence, kind, message }
    set({ toast })
    toastTimer = setTimeout(() => set({ toast: null }), 3600)
  },

  clearToast: () => set({ toast: null }),
  setConflict: (conflict) => set({ conflict }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setSnapshotsOpen: (snapshotsOpen) => set({ snapshotsOpen })
}))

export function mapTitle(maps: MapSummary[], mapId: string | null): string {
  return maps.find((map) => map.id === mapId)?.title ?? '未选择导图'
}
