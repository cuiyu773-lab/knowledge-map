import { useEffect } from 'react'
import { LoaderCircle } from 'lucide-react'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { ConflictDialog } from './components/ConflictDialog'
import { SearchOverlay } from './components/SearchOverlay'
import { SnapshotDialog } from './components/SnapshotDialog'
import { StartupScreen } from './components/StartupScreen'
import { Toast } from './components/Toast'
import { WorkspaceShell } from './components/WorkspaceShell'

export function App() {
  const initializing = useWorkspaceStore((state) => state.initializing)
  const descriptor = useWorkspaceStore((state) => state.descriptor)
  const settings = useWorkspaceStore((state) => state.settings)
  const initialize = useWorkspaceStore((state) => state.initialize)

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  if (initializing) {
    return <div className="app-loading"><LoaderCircle className="spin" size={28} /><span>正在打开知图…</span></div>
  }

  return (
    <>
      {descriptor ? <WorkspaceShell /> : <StartupScreen />}
      <ConflictDialog />
      <SnapshotDialog />
      <SearchOverlay />
      <Toast />
    </>
  )
}
