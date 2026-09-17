import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  ChevronDown,
  CloudOff,
  Download,
  FilePlus2,
  FolderOpen,
  GalleryHorizontalEnd,
  History,
  Import,
  Moon,
  PanelLeft,
  PanelRight,
  Redo2,
  Save,
  Search,
  Sparkles,
  Sun,
  Trash2,
  Undo2
} from 'lucide-react'
import { getCanvasCommands } from '@renderer/lib/canvasBridge'
import { useAiStore } from '@renderer/stores/aiStore'
import { useMapStore } from '@renderer/stores/mapStore'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'

function saveLabel(saving: boolean, dirty: boolean, error: string | null): string {
  if (saving) return '保存中…'
  if (error) return '保存失败'
  if (dirty) return '尚未保存'
  return '已保存'
}

export function CommandBar() {
  const descriptor = useWorkspaceStore((state) => state.descriptor)
  const activeMapId = useWorkspaceStore((state) => state.activeMapId)
  const settings = useWorkspaceStore((state) => state.settings)
  const selectMap = useWorkspaceStore((state) => state.selectMap)
  const createMap = useWorkspaceStore((state) => state.createMap)
  const importMarkdown = useWorkspaceStore((state) => state.importMarkdown)
  const deleteMap = useWorkspaceStore((state) => state.deleteMap)
  const closeWorkspace = useWorkspaceStore((state) => state.closeWorkspace)
  const toggleTheme = useWorkspaceStore((state) => state.toggleTheme)
  const togglePanel = useWorkspaceStore((state) => state.togglePanel)
  const setSearchOpen = useWorkspaceStore((state) => state.setSearchOpen)
  const setSnapshotsOpen = useWorkspaceStore((state) => state.setSnapshotsOpen)
  const showToast = useWorkspaceStore((state) => state.showToast)
  const document = useMapStore((state) => state.document)
  const dirty = useMapStore((state) => state.dirty)
  const saving = useMapStore((state) => state.saving)
  const saveError = useMapStore((state) => state.saveError)
  const past = useMapStore((state) => state.past)
  const future = useMapStore((state) => state.future)
  const activeMap = descriptor?.maps.find((map) => map.id === activeMapId)
  const openAi = useAiStore((state) => state.openDrawer)
  const aiGenerating = useAiStore((state) => state.generating)
  const setAiConfigOpen = useAiStore((state) => state.setConfigOpen)
  const setMaterialsOpen = useAiStore((state) => state.setMaterialsOpen)

  const exportMap = async (format: 'png' | 'svg' | 'pdf') => {
    await useMapStore.getState().save()
    await getCanvasCommands()?.exportMap(format)
  }

  const newMap = async () => {
    const title = window.prompt('新导图名称', '新导图')
    if (title?.trim()) await createMap(title.trim())
  }

  const removeMap = async () => {
    if (!activeMap || !window.confirm(`将「${activeMap.title}」移入系统回收站？`)) return
    await deleteMap(activeMap.id)
  }

  const leaveWorkspace = async () => {
    if (dirty && !window.confirm('当前修改尚未保存，仍要关闭工作区吗？')) return
    await closeWorkspace()
  }

  return (
    <header className="command-bar">
      <div className="command-bar__brand">
        <span className="brand-mark"><GalleryHorizontalEnd size={18} /></span>
        <span className="brand-name">知图</span>
      </div>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="map-switcher" type="button" disabled={aiGenerating}>
            <span>{activeMap?.title ?? '未选择导图'}</span>
            <ChevronDown size={14} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu-content" sideOffset={8} align="start">
            <DropdownMenu.Label className="menu-label">{descriptor?.meta.name}</DropdownMenu.Label>
            {descriptor?.maps.map((map) => (
              <DropdownMenu.Item key={map.id} className="menu-item" disabled={aiGenerating} onSelect={() => void selectMap(map.id)}>
                <span className="menu-item__title">{map.title}</span>
                <small>{map.nodeCount} 节点</small>
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator className="menu-separator" />
            <DropdownMenu.Item className="menu-item" disabled={aiGenerating} onSelect={() => void newMap()}>
              <FilePlus2 size={15} />新建导图
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <input
        className="document-title"
        aria-label="导图标题"
        value={document?.title ?? ''}
        disabled={!document}
        onChange={(event) => useMapStore.getState().setDocumentTitle(event.target.value)}
      />

      <span className={`save-state ${saveError ? 'is-error' : dirty ? 'is-dirty' : ''}`} title={saveError ?? undefined}>
        {saveError ? <CloudOff size={13} /> : <Save size={13} />}
        {saveLabel(saving, dirty, saveError)}
      </span>

      <div className="command-group">
        <button className="icon-button" type="button" title="撤销 Ctrl+Z" disabled={!past.length} onClick={() => useMapStore.getState().undo()}><Undo2 size={17} /></button>
        <button className="icon-button" type="button" title="重做 Ctrl+Y" disabled={!future.length} onClick={() => useMapStore.getState().redo()}><Redo2 size={17} /></button>
        <button className="icon-button" type="button" title="搜索 Ctrl+F" onClick={() => setSearchOpen(true)}><Search size={17} /></button>
      </div>

      <button className="button button--small button--ai" type="button" onClick={() => void openAi()}>
        <Sparkles size={15} />AI 制作
      </button>

      <div className="command-group command-group--right">
        <button className="icon-button" type="button" title="大纲面板" onClick={() => togglePanel('outline')}><PanelLeft size={17} /></button>
        <button className="icon-button" type="button" title="详情面板" onClick={() => togglePanel('inspector')}><PanelRight size={17} /></button>
        <button className="icon-button" type="button" title={settings.theme === 'light' ? '切换到深色' : '切换到浅色'} onClick={toggleTheme}>
          {settings.theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
        </button>
        <button className="icon-button" type="button" title="历史快照" onClick={() => setSnapshotsOpen(true)}><History size={17} /></button>
        <button className="button button--small" type="button" disabled={!dirty || saving} onClick={() => void useMapStore.getState().save()}>
          <Save size={15} />保存
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="button button--small button--primary" type="button"><Download size={15} />导出<ChevronDown size={13} /></button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu-content" sideOffset={7} align="end">
              <DropdownMenu.Item className="menu-item" onSelect={() => void exportMap('png')}>PNG 图片</DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={() => void exportMap('svg')}>SVG 矢量图</DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={() => void exportMap('pdf')}>PDF 文档</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="icon-button" type="button" title="更多操作"><ChevronDown size={16} /></button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu-content" sideOffset={7} align="end">
              <DropdownMenu.Item className="menu-item" onSelect={() => void importMarkdown()}><Import size={15} />导入 Markdown</DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={() => setMaterialsOpen(true)}><Import size={15} />课程资料库</DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={() => setAiConfigOpen(true)}><Sparkles size={15} />AI 配置</DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" disabled={aiGenerating} onSelect={() => void newMap()}><FilePlus2 size={15} />新建导图</DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={() => void window.zhitu.workspace.reveal(descriptor?.path ?? '')}><FolderOpen size={15} />在文件管理器中显示</DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item className="menu-item menu-item--danger" disabled={aiGenerating} onSelect={() => void removeMap()}><Trash2 size={15} />删除当前导图</DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" disabled={aiGenerating} onSelect={() => void leaveWorkspace()}>关闭工作区</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  )
}
