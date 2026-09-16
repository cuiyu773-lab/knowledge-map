import { useEffect } from 'react'
import { AlertCircle, FolderTree, HardDrive, LoaderCircle } from 'lucide-react'
import { getCanvasCommands } from '@renderer/lib/canvasBridge'
import { useMapStore } from '@renderer/stores/mapStore'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { CommandBar } from './CommandBar'
import { MindMapCanvas } from './MindMapCanvas'
import { NodeInspector } from './NodeInspector'
import { OutlineView } from './OutlineView'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.matches('input, textarea, select, [contenteditable="true"]') || Boolean(target.closest('[contenteditable="true"]'))
}

export function WorkspaceShell() {
  const descriptor = useWorkspaceStore((state) => state.descriptor)
  const busy = useWorkspaceStore((state) => state.busy)
  const activeMapId = useWorkspaceStore((state) => state.activeMapId)
  const settings = useWorkspaceStore((state) => state.settings)
  const createMap = useWorkspaceStore((state) => state.createMap)
  const setConflict = useWorkspaceStore((state) => state.setConflict)
  const setSearchOpen = useWorkspaceStore((state) => state.setSearchOpen)
  const showToast = useWorkspaceStore((state) => state.showToast)
  const document = useMapStore((state) => state.document)
  const selectedNodeId = useMapStore((state) => state.selectedNodeId)
  const dirty = useMapStore((state) => state.dirty)
  const saving = useMapStore((state) => state.saving)
  const saveError = useMapStore((state) => state.saveError)
  const readOnly = useMapStore((state) => state.readOnly)

  useEffect(() => {
    if (descriptor && !activeMapId && !document && !busy && !readOnly) void createMap('我的学习导图')
  }, [descriptor, activeMapId, document, busy, readOnly, createMap])

  useEffect(() => {
    if (!document || !dirty) return
    const timer = setTimeout(() => {
      void useMapStore.getState().save().then((saved) => {
        if (!saved) showToast('自动保存失败，请检查磁盘权限', 'error')
      })
    }, 800)
    return () => clearTimeout(timer)
  }, [document?.id, document?.updatedAt, dirty, showToast])

  useEffect(() => {
    if (!document) return
    const timer = setInterval(async () => {
      if (!useMapStore.getState().dirty || useMapStore.getState().saving) return
      await useMapStore.getState().save()
      await useMapStore.getState().snapshot()
    }, 5 * 60 * 1000)
    return () => clearInterval(timer)
  }, [document?.id])

  useEffect(() => {
    return window.zhitu.onFocus(() => {
      void useMapStore.getState().checkExternalChange().then((changed) => {
        if (changed) setConflict({ type: 'external-change', diskHash: 'changed' })
      })
    })
  }, [setConflict])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!useMapStore.getState().dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const editable = isEditableTarget(event.target)
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void useMapStore.getState().save().then((saved) => {
          if (saved) showToast('已保存', 'success')
        })
        return
      }
      if (modifier && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setSearchOpen(true)
        return
      }
      if (modifier && event.key === '0') {
        event.preventDefault()
        getCanvasCommands()?.fitView()
        return
      }
      if (editable) return
      const documentState = useMapStore.getState().document
      const selected = useMapStore.getState().selectedNodeId
      if (!documentState || !selected) return
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        event.shiftKey ? useMapStore.getState().redo() : useMapStore.getState().undo()
        return
      }
      if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        useMapStore.getState().redo()
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        useMapStore.getState().addSibling(selected)
      } else if (event.key === 'Tab') {
        event.preventDefault()
        event.shiftKey ? useMapStore.getState().promoteSelected() : useMapStore.getState().addChild(selected)
      } else if (event.altKey && event.key === 'ArrowUp') {
        event.preventDefault()
        useMapStore.getState().reorderSelected(-1)
      } else if (event.altKey && event.key === 'ArrowDown') {
        event.preventDefault()
        useMapStore.getState().reorderSelected(1)
      } else if (event.key === ' ') {
        event.preventDefault()
        useMapStore.getState().toggleCollapsed(selected)
      } else if (event.key === 'F2') {
        event.preventDefault()
        if (!settings.panels.outline) useWorkspaceStore.getState().togglePanel('outline')
        setTimeout(() => useMapStore.getState().requestRename(selected), 0)
      } else if (event.key === 'Delete' && selected !== documentState.rootId) {
        event.preventDefault()
        const node = documentState.nodes[selected]
        if (window.confirm(`删除「${node?.title ?? '该主题'}」及其全部子主题？`)) {
          useMapStore.getState().removeSelected()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [settings.panels.outline, setSearchOpen, showToast])

  if (!descriptor) return null

  return (
    <div className="workspace-shell">
      <CommandBar />
      {readOnly && (
        <div className="system-banner system-banner--warning">
          <AlertCircle size={15} />
          当前导图以只读方式打开，原文件不会被覆盖。
        </div>
      )}
      {saveError && (
        <div className="system-banner system-banner--error">
          <AlertCircle size={15} />
          {saveError}
          <button type="button" onClick={() => void useMapStore.getState().save(true)}>重试保存</button>
        </div>
      )}
      <div className={`workspace-grid ${settings.panels.outline ? '' : 'without-outline'} ${settings.panels.inspector ? '' : 'without-inspector'}`}>
        {settings.panels.outline && <OutlineView />}
        <MindMapCanvas />
        {settings.panels.inspector && <NodeInspector />}
      </div>
      <footer className="status-bar">
        <span title={descriptor.path}><HardDrive size={13} />{descriptor.meta.name}</span>
        <span><FolderTree size={13} />{document ? Object.keys(document.nodes).length : 0} 个节点</span>
        <span className="status-bar__path">{selectedNodeId && document ? document.nodes[selectedNodeId]?.title : '未选择节点'}</span>
        <span className="status-bar__spacer" />
        <span>{saving ? <><LoaderCircle className="spin" size={13} />正在保存</> : dirty ? '有未保存修改' : '本地文件已同步'}</span>
      </footer>
      {busy && <div className="busy-overlay"><LoaderCircle className="spin" size={22} />正在处理…</div>}
    </div>
  )
}

