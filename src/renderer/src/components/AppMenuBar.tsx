import { useEffect, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { BookTemplate, Check, ChevronRight, LibraryBig } from 'lucide-react'
import type { ExportFormat, ExportQuality, ThemeMode, WindowCommand } from '@shared/types'
import { getCanvasCommands } from '@renderer/lib/canvasBridge'
import { useAiStore } from '@renderer/stores/aiStore'
import { useMapStore } from '@renderer/stores/mapStore'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { useTemplateStore } from '@renderer/stores/templateStore'

const EXPORT_QUALITIES: Array<{ value: ExportQuality; label: string }> = [
  { value: 'standard', label: '标准' },
  { value: 'high', label: '高清（推荐）' },
  { value: 'ultra', label: '超清' }
]

const EXPORT_DETAILS: Record<ExportFormat, Record<ExportQuality, string>> = {
  png: { standard: '2×', high: '2.5×', ultra: '3×' },
  pdf: { standard: '1.5×', high: '1.75×', ultra: '2×' },
  svg: { standard: '', high: '', ultra: '' }
}

function MenuShortcut({ children }: { children: string }) {
  return <span className="menu-shortcut">{children}</span>
}

function MenuIndicator() {
  return (
    <span className="menu-item__indicator" aria-hidden="true">
      <DropdownMenu.ItemIndicator><Check size={14} /></DropdownMenu.ItemIndicator>
    </span>
  )
}

function isEditableTarget(target: Element | null): target is HTMLElement {
  if (!(target instanceof HTMLElement) || !target.isConnected) return false
  return target.matches('input, textarea, select, [contenteditable="true"]') || Boolean(target.closest('[contenteditable="true"]'))
}

function ExportQualityItems({
  format,
  currentQuality,
  onSelect
}: {
  format: 'png' | 'pdf'
  currentQuality: ExportQuality
  onSelect: (format: 'png' | 'pdf', quality: ExportQuality) => void
}) {
  return (
    <DropdownMenu.RadioGroup value={currentQuality}>
      {EXPORT_QUALITIES.map((quality) => (
        <DropdownMenu.RadioItem
          key={quality.value}
          className="menu-item"
          value={quality.value}
          onSelect={() => onSelect(format, quality.value)}
        >
          <MenuIndicator />
          <span>{quality.label}</span>
          <small>{EXPORT_DETAILS[format][quality.value]}</small>
        </DropdownMenu.RadioItem>
      ))}
    </DropdownMenu.RadioGroup>
  )
}

export function AppMenuBar() {
  const descriptor = useWorkspaceStore((state) => state.descriptor)
  const busy = useWorkspaceStore((state) => state.busy)
  const settings = useWorkspaceStore((state) => state.settings)
  const chooseWorkspace = useWorkspaceStore((state) => state.chooseWorkspace)
  const closeWorkspace = useWorkspaceStore((state) => state.closeWorkspace)
  const createMap = useWorkspaceStore((state) => state.createMap)
  const createMapFromTemplate = useTemplateStore((state) => state.createMapFromTemplate)
  const openTemplatePicker = useTemplateStore((state) => state.openPicker)
  const setTemplateSaveOpen = useTemplateStore((state) => state.setSaveOpen)
  const setTemplateManagerOpen = useTemplateStore((state) => state.setManagerOpen)
  const importMarkdown = useWorkspaceStore((state) => state.importMarkdown)
  const setExportQuality = useWorkspaceStore((state) => state.setExportQuality)
  const setSearchOpen = useWorkspaceStore((state) => state.setSearchOpen)
  const setSnapshotsOpen = useWorkspaceStore((state) => state.setSnapshotsOpen)
  const setTheme = useWorkspaceStore((state) => state.setTheme)
  const showToast = useWorkspaceStore((state) => state.showToast)
  const togglePanel = useWorkspaceStore((state) => state.togglePanel)
  const mapDocument = useMapStore((state) => state.document)
  const selectedNodeId = useMapStore((state) => state.selectedNodeId)
  const dirty = useMapStore((state) => state.dirty)
  const saving = useMapStore((state) => state.saving)
  const readOnly = useMapStore((state) => state.readOnly)
  const past = useMapStore((state) => state.past)
  const future = useMapStore((state) => state.future)
  const aiGenerating = useAiStore((state) => state.generating)
  const activeTargetRef = useRef<HTMLElement | null>(null)
  const [hasTextTarget, setHasTextTarget] = useState(false)

  const captureActiveTarget = () => {
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : null
    activeTargetRef.current = target
    setHasTextTarget(isEditableTarget(target))
  }

  const runWindowCommand = (command: WindowCommand) => {
    void window.zhitu.shell.command(command)
  }

  const runTextCommand = (command: WindowCommand) => {
    const target = activeTargetRef.current
    if (!isEditableTarget(target)) return
    window.setTimeout(() => {
      target.focus()
      void window.zhitu.shell.command(command)
    }, 0)
  }

  const newMap = async () => {
    const picked = await openTemplatePicker('map')
    if (picked === null) return
    if (picked === 'blank') await createMap('新导图')
    else await createMapFromTemplate(picked.id, picked.name)
  }

  const openWorkspace = async () => {
    const mapState = useMapStore.getState()
    if (mapState.document && mapState.dirty && !mapState.readOnly) {
      const saved = await mapState.save()
      if (!saved) {
        showToast('保存失败，已取消切换工作区', 'error')
        return
      }
    }
    await chooseWorkspace()
  }

  const leaveWorkspace = async () => {
    if (dirty && !window.confirm('当前修改尚未保存，仍要关闭工作区吗？')) return
    await closeWorkspace()
  }

  const saveMap = async () => {
    const saved = await useMapStore.getState().save()
    if (saved) showToast('已保存', 'success')
  }

  const exportMap = async (format: ExportFormat, quality: ExportQuality) => {
    await useMapStore.getState().save()
    await getCanvasCommands()?.exportMap(format, quality)
  }

  const selectExportQuality = (format: 'png' | 'pdf', quality: ExportQuality) => {
    setExportQuality(quality)
    void exportMap(format, quality)
  }

  const undo = () => {
    if (isEditableTarget(activeTargetRef.current)) runTextCommand('edit-undo')
    else useMapStore.getState().undo()
  }

  const redo = () => {
    if (isEditableTarget(activeTargetRef.current)) runTextCommand('edit-redo')
    else useMapStore.getState().redo()
  }

  const removeSelected = () => {
    const state = useMapStore.getState()
    const selected = state.selectedNodeId
    const current = state.document
    if (!selected || !current || selected === current.rootId) return
    if (window.confirm(`删除「${current.nodes[selected]?.title ?? '该主题'}」及其全部子主题？`)) {
      state.removeSelected()
    }
  }

  useEffect(() => {
    void window.zhitu.shell.setTitleBarTheme(settings.theme)
  }, [settings.theme])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey
      if (event.key === 'F11') {
        event.preventDefault()
        runWindowCommand('toggle-full-screen')
        return
      }
      if (!modifier) return
      const key = event.key.toLowerCase()
      if (key === 'n' && !event.shiftKey && descriptor && !busy && !aiGenerating) {
        event.preventDefault()
        void newMap()
      } else if (key === 'o' && !event.shiftKey && !busy) {
        event.preventDefault()
        void openWorkspace()
      } else if ((key === '=' || key === '+') && !event.altKey) {
        event.preventDefault()
        runWindowCommand('zoom-in')
      } else if (key === '-' && !event.altKey) {
        event.preventDefault()
        runWindowCommand('zoom-out')
      } else if (key === '0' && event.shiftKey) {
        event.preventDefault()
        runWindowCommand('reset-zoom')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [aiGenerating, busy, descriptor, settings.theme])

  const canDeleteNode = Boolean(mapDocument && selectedNodeId && selectedNodeId !== mapDocument.rootId && !readOnly)
  const canUndo = past.length > 0 || hasTextTarget
  const canRedo = future.length > 0 || hasTextTarget

  return (
    <header className="app-titlebar" aria-label="窗口菜单栏">
      <nav className="app-titlebar__menus" aria-label="应用菜单" onPointerDownCapture={captureActiveTarget}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="app-menu-trigger">文件</DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu-content app-menu-content" sideOffset={6} align="start">
              <DropdownMenu.Item className="menu-item" disabled={!descriptor || busy || aiGenerating} onSelect={() => void newMap()}>
                <span>新建导图</span><MenuShortcut>Ctrl+N</MenuShortcut>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" disabled={!descriptor || busy} onSelect={() => setTemplateManagerOpen(true)}>
                <span><LibraryBig size={15} />模板与预设…</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" disabled={busy} onSelect={() => void openWorkspace()}>
                <span>打开工作区…</span><MenuShortcut>Ctrl+O</MenuShortcut>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" disabled={!descriptor || busy} onSelect={() => void leaveWorkspace()}>
                <span>关闭工作区</span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item className="menu-item" disabled={!mapDocument || readOnly || saving || !dirty} onSelect={() => void saveMap()}>
                <span>保存</span><MenuShortcut>Ctrl+S</MenuShortcut>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" disabled={!mapDocument || readOnly} onSelect={() => mapDocument && setTemplateSaveOpen(true, mapDocument.rootId)}>
                <span><BookTemplate size={15} />保存整张导图为模板…</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" disabled={!mapDocument || readOnly || !selectedNodeId || selectedNodeId === mapDocument.rootId} onSelect={() => selectedNodeId && setTemplateSaveOpen(true, selectedNodeId)}>
                <span><BookTemplate size={15} />将当前主题保存为模板…</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" disabled={!descriptor || busy} onSelect={() => void importMarkdown()}>
                <span>导入 Markdown…</span>
              </DropdownMenu.Item>
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className="menu-item" disabled={!mapDocument || busy}>
                  <span>导出</span><ChevronRight className="menu-item__submenu-icon" size={14} />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent className="menu-content app-menu-content" sideOffset={5} alignOffset={-6}>
                    <DropdownMenu.Sub>
                      <DropdownMenu.SubTrigger className="menu-item">
                        <span>PNG 图片</span><ChevronRight className="menu-item__submenu-icon" size={14} />
                      </DropdownMenu.SubTrigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.SubContent className="menu-content app-menu-content" sideOffset={5} alignOffset={-6}>
                          <ExportQualityItems format="png" currentQuality={settings.exportQuality} onSelect={selectExportQuality} />
                        </DropdownMenu.SubContent>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Sub>
                    <DropdownMenu.Item className="menu-item" onSelect={() => void exportMap('svg', settings.exportQuality)}>
                      <span>SVG 矢量图</span>
                    </DropdownMenu.Item>
                    <DropdownMenu.Sub>
                      <DropdownMenu.SubTrigger className="menu-item">
                        <span>PDF 文档</span><ChevronRight className="menu-item__submenu-icon" size={14} />
                      </DropdownMenu.SubTrigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.SubContent className="menu-content app-menu-content" sideOffset={5} alignOffset={-6}>
                          <ExportQualityItems format="pdf" currentQuality={settings.exportQuality} onSelect={selectExportQuality} />
                        </DropdownMenu.SubContent>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Sub>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item
                className="menu-item"
                disabled={!descriptor}
                onSelect={() => void window.zhitu.workspace.reveal(descriptor?.path ?? '')}
              >
                <span>在文件管理器中显示</span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item className="menu-item" onSelect={() => runWindowCommand('close')}>
                <span>退出</span><MenuShortcut>Alt+F4</MenuShortcut>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="app-menu-trigger">编辑</DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu-content app-menu-content" sideOffset={6} align="start">
              <DropdownMenu.Item className="menu-item" disabled={!canUndo} onSelect={undo}>
                <span>撤销</span><MenuShortcut>Ctrl+Z</MenuShortcut>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" disabled={!canRedo} onSelect={redo}>
                <span>重做</span><MenuShortcut>Ctrl+Y</MenuShortcut>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item className="menu-item" disabled={!hasTextTarget} onSelect={() => runTextCommand('cut')}>
                <span>剪切</span><MenuShortcut>Ctrl+X</MenuShortcut>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" disabled={!hasTextTarget} onSelect={() => runTextCommand('copy')}>
                <span>复制</span><MenuShortcut>Ctrl+C</MenuShortcut>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" disabled={!hasTextTarget} onSelect={() => runTextCommand('paste')}>
                <span>粘贴</span><MenuShortcut>Ctrl+V</MenuShortcut>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" disabled={!hasTextTarget} onSelect={() => runTextCommand('select-all')}>
                <span>全选</span><MenuShortcut>Ctrl+A</MenuShortcut>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item className="menu-item menu-item--danger" disabled={!canDeleteNode} onSelect={removeSelected}>
                <span>删除当前主题</span><MenuShortcut>Delete</MenuShortcut>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="app-menu-trigger">视图</DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu-content app-menu-content" sideOffset={6} align="start">
              <DropdownMenu.CheckboxItem
                className="menu-item"
                checked={settings.panels.outline}
                disabled={!mapDocument}
                onCheckedChange={() => togglePanel('outline')}
              >
                <MenuIndicator /><span>大纲面板</span>
              </DropdownMenu.CheckboxItem>
              <DropdownMenu.CheckboxItem
                className="menu-item"
                checked={settings.panels.inspector}
                disabled={!mapDocument}
                onCheckedChange={() => togglePanel('inspector')}
              >
                <MenuIndicator /><span>详情面板</span>
              </DropdownMenu.CheckboxItem>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item className="menu-item" disabled={!mapDocument} onSelect={() => setSearchOpen(true)}>
                <span>搜索</span><MenuShortcut>Ctrl+F</MenuShortcut>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" disabled={!mapDocument} onSelect={() => setSnapshotsOpen(true)}>
                <span>历史快照</span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.RadioGroup value={settings.theme} onValueChange={(value) => setTheme(value as ThemeMode)}>
                <DropdownMenu.RadioItem className="menu-item" value="light">
                  <MenuIndicator /><span>浅色主题</span>
                </DropdownMenu.RadioItem>
                <DropdownMenu.RadioItem className="menu-item" value="dark">
                  <MenuIndicator /><span>深色主题</span>
                </DropdownMenu.RadioItem>
              </DropdownMenu.RadioGroup>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item className="menu-item" disabled={!mapDocument} onSelect={() => getCanvasCommands()?.fitView()}>
                <span>适应画布</span><MenuShortcut>Ctrl+0</MenuShortcut>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={() => runWindowCommand('zoom-in')}>
                <span>放大</span><MenuShortcut>Ctrl+=</MenuShortcut>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={() => runWindowCommand('zoom-out')}>
                <span>缩小</span><MenuShortcut>Ctrl+-</MenuShortcut>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={() => runWindowCommand('reset-zoom')}>
                <span>重置缩放</span><MenuShortcut>Ctrl+Shift+0</MenuShortcut>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item className="menu-item" onSelect={() => runWindowCommand('toggle-full-screen')}>
                <span>切换全屏</span><MenuShortcut>F11</MenuShortcut>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="app-menu-trigger">窗口</DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu-content app-menu-content" sideOffset={6} align="start">
              <DropdownMenu.Item className="menu-item" onSelect={() => runWindowCommand('minimize')}>
                <span>最小化</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={() => runWindowCommand('toggle-maximize')}>
                <span>最大化/还原</span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item className="menu-item" onSelect={() => runWindowCommand('close')}>
                <span>关闭窗口</span><MenuShortcut>Alt+F4</MenuShortcut>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </nav>
      <div className="app-titlebar__drag" aria-hidden="true" />
    </header>
  )
}
