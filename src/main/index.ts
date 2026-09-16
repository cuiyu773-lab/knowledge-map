import { app, BrowserWindow, ipcMain, net, protocol, shell } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { IPC } from '@shared/ipc'
import type {
  ApiResult,
  AppSettings,
  ExportRequest,
  MindMapDocument,
  WorkspaceDescriptor
} from '@shared/types'
import { AppError, WorkspaceService } from './workspace'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
if (process.env.ZHITU_USER_DATA) app.setPath('userData', process.env.ZHITU_USER_DATA)
const service = new WorkspaceService()
let mainWindow: BrowserWindow | null = null

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'zhitu-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

function errorResult(error: unknown): ApiResult<never> {
  if (error instanceof AppError) {
    return { ok: false, error: { code: error.code, message: error.message, detail: error.detail } }
  }
  return {
    ok: false,
    error: { code: 'UNEXPECTED', message: error instanceof Error ? error.message : '发生未知错误' }
  }
}

function handle<T>(channel: string, callback: (...args: any[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, value: await callback(...args) }
    } catch (error) {
      return errorResult(error)
    }
  })
}

function registerIpc(): void {
  handle(IPC.recentWorkspaces, () => service.getRecentWorkspaces())
  ipcMain.handle(IPC.createWorkspace, (_event, name: string) => service.createWorkspace(name))
  ipcMain.handle(IPC.chooseWorkspace, () => service.chooseWorkspace())
  handle(IPC.openWorkspacePath, (workspacePath: string) => service.openWorkspacePath(workspacePath))
  handle(IPC.closeWorkspace, () => service.closeWorkspace())
  handle(IPC.revealWorkspace, async (workspacePath: string) => shell.showItemInFolder(join(workspacePath, 'workspace.json')))
  handle(IPC.getSettings, () => service.readSettings())
  handle(IPC.setSettings, (settings: AppSettings) => service.writeSettings(settings))
  handle(IPC.listMaps, () => service.listMaps())
  handle(IPC.createMap, (title: string) => service.createMap(title))
  handle(IPC.readMap, (mapId: string) => service.readMap(mapId))
  handle(IPC.saveMap, (document: MindMapDocument, expectedHash?: string, force?: boolean) =>
    service.saveMap(document, expectedHash, force)
  )
  handle(IPC.saveMapCopy, (document: MindMapDocument) => service.saveMapCopy(document))
  handle(IPC.mapHash, (mapId: string) => service.mapHash(mapId))
  handle(IPC.trashMap, (mapId: string) => service.trashMap(mapId))
  handle(IPC.createSnapshot, (mapId: string) => service.createSnapshot(mapId))
  handle(IPC.listSnapshots, (mapId: string) => service.listSnapshots(mapId))
  handle(IPC.restoreSnapshot, (mapId: string, fileName: string) => service.restoreSnapshot(mapId, fileName))
  handle(IPC.importAssetDialog, () => service.importAssetDialog())
  handle(IPC.importAssetBytes, (bytes: number[], name: string) => service.importAssetBytes(bytes, name))
  handle(IPC.importMarkdown, () => service.importMarkdown())
  handle(IPC.saveExport, (request: ExportRequest) => service.saveExport(request))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#e8dcc7',
    title: '知图',
    webPreferences: {
      preload: join(currentDirectory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('focus', () => mainWindow?.webContents.send(IPC.appFocus))
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) void mainWindow.loadURL(rendererUrl)
  else void mainWindow.loadFile(join(currentDirectory, '../renderer/index.html'))
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.zhitu.studymap')
  protocol.handle('zhitu-asset', async (request) => {
    try {
      const url = new URL(request.url)
      const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      const filePath = service.resolveAsset(relativePath)
      return net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response('素材不存在', { status: 404 })
    }
  })
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})



