import { X } from 'lucide-react'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'

export function Toast() {
  const toast = useWorkspaceStore((state) => state.toast)
  const clear = useWorkspaceStore((state) => state.clearToast)
  if (!toast) return null
  return (
    <div className={`toast toast--${toast.kind}`} role="status">
      <span>{toast.message}</span>
      <button className="icon-button icon-button--small" type="button" aria-label="关闭通知" onClick={clear}>
        <X size={15} />
      </button>
    </div>
  )
}
