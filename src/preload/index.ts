import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  ApiResult,
  AppSettings,
  AiConfigInput,
  AiConsultRequest,
  AiConsultResult,
  AiGenerateRequest,
  AiPreview,
  AiProgress,
  AiPublicConfig,
  AiSession,
  ExportRequest,
  MapReadResult,
  MapSummary,
  MaterialSummary,
  MindMapDocument,
  RecentWorkspace,
  SnapshotSummary,
  ThemeMode,
  WindowCommand,
  WorkspaceDescriptor
} from '@shared/types'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<ApiResult<T>> =>
  ipcRenderer.invoke(channel, ...args) as Promise<ApiResult<T>>

const api = {
  workspace: {
    recents: () => invoke<RecentWorkspace[]>(IPC.recentWorkspaces),
    create: (name: string) => invoke<WorkspaceDescriptor>(IPC.createWorkspace, name),
    choose: () => invoke<WorkspaceDescriptor>(IPC.chooseWorkspace),
    openPath: (workspacePath: string) => invoke<WorkspaceDescriptor>(IPC.openWorkspacePath, workspacePath),
    close: () => invoke<void>(IPC.closeWorkspace),
    reveal: (workspacePath: string) => invoke<void>(IPC.revealWorkspace, workspacePath)
  },
  settings: {
    read: () => invoke<AppSettings>(IPC.getSettings),
    write: (settings: AppSettings) => invoke<AppSettings>(IPC.setSettings, settings)
  },
  maps: {
    list: () => invoke<MapSummary[]>(IPC.listMaps),
    create: (title: string) => invoke<{ summary: MapSummary; document: MindMapDocument }>(IPC.createMap, title),
    read: (mapId: string) => invoke<MapReadResult>(IPC.readMap, mapId),
    save: (document: MindMapDocument, expectedHash?: string, force?: boolean) =>
      invoke<{ hash: string }>(IPC.saveMap, document, expectedHash, force),
    saveCopy: (document: MindMapDocument) => invoke<string | null>(IPC.saveMapCopy, document),
    hash: (mapId: string) => invoke<string | null>(IPC.mapHash, mapId),
    trash: (mapId: string) => invoke<void>(IPC.trashMap, mapId)
  },
  history: {
    create: (mapId: string) => invoke<SnapshotSummary>(IPC.createSnapshot, mapId),
    list: (mapId: string) => invoke<SnapshotSummary[]>(IPC.listSnapshots, mapId),
    restore: (mapId: string, fileName: string) =>
      invoke<MindMapDocument>(IPC.restoreSnapshot, mapId, fileName)
  },
  assets: {
    pick: () => invoke<string | null>(IPC.importAssetDialog),
    importBytes: (bytes: number[], name: string) => invoke<string>(IPC.importAssetBytes, bytes, name)
  },
  markdown: {
    import: () =>
      invoke<{ document: MindMapDocument; summary: MapSummary; warnings: string[] } | null>(IPC.importMarkdown)
  },
  exports: {
    save: (request: ExportRequest) => invoke<string | null>(IPC.saveExport, request)
  },
  ai: {
    getConfig: () => invoke<AiPublicConfig>(IPC.aiGetConfig),
    saveConfig: (input: AiConfigInput) => invoke<AiPublicConfig>(IPC.aiSaveConfig, input),
    testConnection: (input?: AiConfigInput) => invoke<void>(IPC.aiTestConnection, input),
    readSession: (mapId: string | null, draftId: string | null) =>
      invoke<AiSession | null>(IPC.aiSessionRead, mapId, draftId),
    writeSession: (session: AiSession) => invoke<void>(IPC.aiSessionWrite, session),
    clearSession: (mapId: string | null, draftId: string | null) =>
      invoke<void>(IPC.aiSessionClear, mapId, draftId),
    consult: (request: AiConsultRequest) => invoke<AiConsultResult>(IPC.aiConsult, request),
    generate: (request: AiGenerateRequest) => invoke<AiPreview>(IPC.aiGenerate, request),
    cancel: (progressId: string) => invoke<void>(IPC.aiCancel, progressId),
    onProgress: (callback: (progress: AiProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: AiProgress) => callback(progress)
      ipcRenderer.on(IPC.aiProgress, listener)
      return () => { ipcRenderer.removeListener(IPC.aiProgress, listener) }
    }
  },
  shell: {
    command: (command: WindowCommand) => invoke<void>(IPC.windowCommand, command),
    setTitleBarTheme: (theme: ThemeMode) => invoke<void>(IPC.setTitleBarTheme, theme)
  },
  materials: {
    list: () => invoke<MaterialSummary[]>(IPC.materialsList),
    importDialog: () => invoke<MaterialSummary | null>(IPC.materialsImportDialog),
    delete: (id: string) => invoke<void>(IPC.materialsDelete, id),
    reveal: (id: string) => invoke<void>(IPC.materialsReveal, id)
  },
  onFocus: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on(IPC.appFocus, listener)
    return () => { ipcRenderer.removeListener(IPC.appFocus, listener) }
  }
}

contextBridge.exposeInMainWorld('zhitu', api)

export type ZhituApi = typeof api
