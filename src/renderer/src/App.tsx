import { useEffect } from 'react'
import { LoaderCircle } from 'lucide-react'
import { useAiStore } from '@renderer/stores/aiStore'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { AppMenuBar } from './components/AppMenuBar'
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

  useEffect(() => window.zhitu.ai.onProgress((progress) => useAiStore.getState().receiveProgress(progress)), [])

  return (
    <>
      <div className="app-frame">
        <AppMenuBar />
        <div className="app-content">
          {initializing
            ? <div className="app-loading"><LoaderCircle className="spin" size={28} /><span>正在打开知图…</span></div>
            : descriptor ? <WorkspaceShell /> : <StartupScreen />}
        </div>
      </div>
      <ConflictDialog />
      <SnapshotDialog />
      <SearchOverlay />
      <Toast />
    </>
  )
}
