import { useState } from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { AlertTriangle, Copy } from 'lucide-react'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { useMapStore } from '@renderer/stores/mapStore'

export function ConflictDialog() {
  const conflict = useWorkspaceStore((state) => state.conflict)
  const clear = useWorkspaceStore((state) => state.setConflict)
  const activeMapId = useWorkspaceStore((state) => state.activeMapId)
  const showToast = useWorkspaceStore((state) => state.showToast)
  const [working, setWorking] = useState(false)

  const reload = async () => {
    if (!activeMapId) return
    setWorking(true)
    await useMapStore.getState().loadMap(activeMapId)
    setWorking(false)
    clear(null)
    showToast('已重新载入磁盘版本', 'success')
  }

  const saveCopy = async () => {
    const document = useMapStore.getState().document
    if (!document) return
    setWorking(true)
    const result = await window.zhitu.maps.saveCopy(document)
    setWorking(false)
    if (!result.ok) {
      showToast(result.error.message, 'error')
      return
    }
    if (result.value) {
      clear(null)
      showToast('当前编辑版本已另存', 'success')
    }
  }

  const overwrite = async () => {
    setWorking(true)
    const saved = await useMapStore.getState().save(true)
    setWorking(false)
    if (saved) {
      clear(null)
      showToast('已以当前编辑内容覆盖磁盘版本', 'success')
    }
  }

  return (
    <AlertDialog.Root open={Boolean(conflict)} onOpenChange={(open) => !open && clear(null)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content className="dialog-content dialog-content--narrow">
          <AlertDialog.Title className="dialog-title">
            <AlertTriangle size={19} />
            导图被外部修改
          </AlertDialog.Title>
          <AlertDialog.Description className="dialog-description">
            磁盘上的文件与打开时不一致。重新载入会放弃当前未保存修改；覆盖会使用编辑器中的版本。
          </AlertDialog.Description>
          <div className="dialog-actions">
            <AlertDialog.Cancel className="button" disabled={working}>稍后处理</AlertDialog.Cancel>
            <button className="button" type="button" disabled={working} onClick={() => void saveCopy()}>
              <Copy size={15} />另存当前版本
            </button>
            <button className="button button--danger" type="button" disabled={working} onClick={() => void overwrite()}>
              覆盖磁盘版本
            </button>
            <button className="button button--primary" type="button" disabled={working} onClick={() => void reload()}>
              重新载入
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

