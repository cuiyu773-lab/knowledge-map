import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { History, RotateCcw, X } from 'lucide-react'
import type { SnapshotSummary } from '@shared/types'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { useMapStore } from '@renderer/stores/mapStore'

function readableSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function SnapshotDialog() {
  const open = useWorkspaceStore((state) => state.snapshotsOpen)
  const setOpen = useWorkspaceStore((state) => state.setSnapshotsOpen)
  const showToast = useWorkspaceStore((state) => state.showToast)
  const [items, setItems] = useState<SnapshotSummary[]>([])
  const [working, setWorking] = useState<string | null>(null)

  const load = async () => {
    const document = useMapStore.getState().document
    if (!document) return
    const result = await window.zhitu.history.list(document.id)
    if (result.ok) setItems(result.value)
    else showToast(result.error.message, 'error')
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  const restore = async (fileName: string) => {
    const document = useMapStore.getState().document
    if (!document) return
    setWorking(fileName)
    const result = await window.zhitu.history.restore(document.id, fileName)
    if (result.ok) {
      await useMapStore.getState().loadDocument(result.value, useMapStore.getState().fileHash, false)
      useMapStore.setState({ dirty: true })
      await useMapStore.getState().save()
      showToast('已恢复快照，并保存为新版本', 'success')
      setOpen(false)
    } else {
      showToast(result.error.message, 'error')
    }
    setWorking(null)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-heading">
            <div>
              <p className="eyebrow">恢复点</p>
              <Dialog.Title className="dialog-title"><History size={19} />历史快照</Dialog.Title>
            </div>
            <Dialog.Close className="icon-button" aria-label="关闭"><X size={18} /></Dialog.Close>
          </div>
          <Dialog.Description className="dialog-description">
            每 5 分钟以及删除、导入前自动生成，最多保留 20 份。
          </Dialog.Description>
          <div className="snapshot-list">
            {items.length ? items.map((item) => (
              <div className="snapshot-item" key={item.fileName}>
                <span>
                  <strong>{new Date(item.createdAt).toLocaleString('zh-CN')}</strong>
                  <small>{readableSize(item.size)}</small>
                </span>
                <button
                  className="button button--small"
                  type="button"
                  disabled={Boolean(working)}
                  onClick={() => void restore(item.fileName)}
                >
                  <RotateCcw size={14} />
                  恢复
                </button>
              </div>
            )) : <p className="empty-copy">还没有快照。开始编辑后会自动生成。</p>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
