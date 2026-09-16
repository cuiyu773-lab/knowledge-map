import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  ApiResult,
  AppSettings,
  ExportRequest,
  MapReadResult,
  MapSummary,
  MindMapDocument,
  RecentWorkspace,
  SnapshotSummary,
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
  onFocus: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on(IPC.appFocus, listener)
    return () => { ipcRenderer.removeListener(IPC.appFocus, listener) }
  }
}

contextBridge.exposeInMainWorld('zhitu', api)

export type ZhituApi = typeof api


