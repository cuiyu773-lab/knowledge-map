import { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { IPC } from '@shared/ipc'
import type {
  AiConfigInput,
  AiConsultRequest,
  AiGenerateRequest,
  ApiResult,
  AppSettings,
  ExportRequest,
  MindMapDocument,
  ThemeMode,
  WindowCommand,
  WorkspaceDescriptor
} from '@shared/types'
import { AiService } from './ai'
import { AppError, WorkspaceService } from './workspace'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
if (process.env.ZHITU_USER_DATA) app.setPath('userData', process.env.ZHITU_USER_DATA)
const service = new WorkspaceService()
const aiService = new AiService(service)
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

function handleWithEvent<T>(
  channel: string,
  callback: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<T> | T
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, value: await callback(event, ...args) }
    } catch (error) {
      return errorResult(error)
    }
  })
}

const TITLE_BAR_HEIGHT = 38
const TITLE_BAR_THEMES: Record<ThemeMode, { color: string; symbolColor: string }> = {
  light: { color: '#e8ddc7', symbolColor: '#293027' },
  dark: { color: '#24281f', symbolColor: '#eee5d4' }
}
const WINDOW_COMMANDS = new Set<WindowCommand>([
  'minimize',
  'toggle-maximize',
  'close',
  'reload',
  'toggle-full-screen',
  'zoom-in',
  'zoom-out',
  'reset-zoom',
  'toggle-devtools',
  'edit-undo',
  'edit-redo',
  'cut',
  'copy',
  'paste',
  'select-all'
])

function isWindowCommand(value: unknown): value is WindowCommand {
  return typeof value === 'string' && WINDOW_COMMANDS.has(value as WindowCommand)
}

function getEventWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) throw new AppError('WINDOW_NOT_FOUND', '窗口已经关闭')
  return window
}

function applyTitleBarTheme(window: BrowserWindow, theme: ThemeMode): void {
  const colors = TITLE_BAR_THEMES[theme]
  window.setTitleBarOverlay({ ...colors, height: TITLE_BAR_HEIGHT })
}

function executeWindowCommand(window: BrowserWindow, command: WindowCommand): void {
  const { webContents } = window
  switch (command) {
    case 'minimize':
      window.minimize()
      break
    case 'toggle-maximize':
      if (window.isMaximized()) window.unmaximize()
      else window.maximize()
      break
    case 'close':
      window.close()
      break
    case 'reload':
      webContents.reload()
      break
    case 'toggle-full-screen':
      window.setFullScreen(!window.isFullScreen())
      break
    case 'zoom-in':
      webContents.setZoomLevel(Math.min(5, webContents.getZoomLevel() + 0.5))
      break
    case 'zoom-out':
      webContents.setZoomLevel(Math.max(-5, webContents.getZoomLevel() - 0.5))
      break
    case 'reset-zoom':
      webContents.setZoomLevel(0)
      break
    case 'toggle-devtools':
      if (webContents.isDevToolsOpened()) webContents.closeDevTools()
      else webContents.openDevTools({ mode: 'detach' })
      break
    case 'edit-undo':
      webContents.undo()
      break
    case 'edit-redo':
      webContents.redo()
      break
    case 'cut':
      webContents.cut()
      break
    case 'copy':
      webContents.copy()
      break
    case 'paste':
      webContents.paste()
      break
    case 'select-all':
      webContents.selectAll()
      break
  }
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
  handle(IPC.aiGetConfig, () => aiService.getConfig())
  handle(IPC.aiSaveConfig, (input: AiConfigInput) => aiService.saveConfig(input))
  handle(IPC.aiTestConnection, (input?: AiConfigInput) => aiService.testConnection(input))
  handle(IPC.aiSessionRead, (mapId: string | null, draftId: string | null) => aiService.readSession(mapId, draftId))
  handle(IPC.aiSessionWrite, (session) => aiService.writeSession(session))
  handle(IPC.aiSessionClear, (mapId: string | null, draftId: string | null) => aiService.clearSession(mapId, draftId))
  handleWithEvent(IPC.aiConsult, (event, request: AiConsultRequest) =>
    aiService.consult(request, (progress) => event.sender.send(IPC.aiProgress, progress))
  )
  handleWithEvent(IPC.aiGenerate, (event, request: AiGenerateRequest) =>
    aiService.generate(request, (progress) => event.sender.send(IPC.aiProgress, progress))
  )
  handle(IPC.aiCancel, (progressId: string) => aiService.cancel(progressId))
  handle(IPC.materialsList, () => aiService.listMaterials())
  handle(IPC.materialsImportDialog, () => aiService.importMaterialDialog())
  handle(IPC.materialsDelete, (id: string) => aiService.deleteMaterial(id))
  handle(IPC.materialsReveal, (id: string) => aiService.revealMaterial(id))
  handleWithEvent(IPC.windowCommand, (event, command: unknown) => {
    if (!isWindowCommand(command)) throw new AppError('INVALID_WINDOW_COMMAND', '不支持的窗口命令')
    executeWindowCommand(getEventWindow(event), command)
  })
  handleWithEvent(IPC.setTitleBarTheme, (event, theme: unknown) => {
    if (theme !== 'light' && theme !== 'dark') throw new AppError('INVALID_THEME', '不支持的主题模式')
    applyTitleBarTheme(getEventWindow(event), theme)
  })
}

function createWindow(): void {
  const windowIcon = app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(currentDirectory, '../../build/icon.ico')
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#e8dcc7',
    title: '知图',
    icon: windowIcon,
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...TITLE_BAR_THEMES.light, height: TITLE_BAR_HEIGHT },
    webPreferences: {
      preload: join(currentDirectory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.setMenuBarVisibility(false)

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
  Menu.setApplicationMenu(null)
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
