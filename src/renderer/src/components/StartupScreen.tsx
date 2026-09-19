import { useState, type FormEvent } from 'react'
import { BookOpenCheck, Clock3, FolderOpen, Plus } from 'lucide-react'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { useTemplateStore } from '@renderer/stores/templateStore'

export function StartupScreen() {
  const [name, setName] = useState('我的学习工作区')
  const recents = useWorkspaceStore((state) => state.recents)
  const busy = useWorkspaceStore((state) => state.busy)
  const createWorkspace = useWorkspaceStore((state) => state.createWorkspace)
  const chooseWorkspace = useWorkspaceStore((state) => state.chooseWorkspace)
  const openWorkspace = useWorkspaceStore((state) => state.openWorkspace)
  const openTemplatePicker = useTemplateStore((state) => state.openPicker)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !name.trim()) return
    const picked = await openTemplatePicker('workspace')
    if (picked === null) return
    await createWorkspace(name.trim(), picked === 'blank' ? undefined : picked.id)
  }

  return (
    <main className="startup">
      <div className="startup__grain" aria-hidden="true" />
      <section className="startup__hero">
        <div className="brand-lockup brand-lockup--large">
          <span className="brand-mark"><BookOpenCheck size={24} strokeWidth={1.8} /></span>
          <span>知图</span>
        </div>
        <p className="eyebrow">本地学习图谱</p>
        <h1>把知识画成<br />走得通的路。</h1>
        <p className="startup__lead">
          大纲负责想清楚，画布负责看明白。每张导图都是工作区里的普通文件，离线可用，随时迁移。
        </p>
        <div className="startup__facts" aria-label="产品特性">
          <span>本地文件</span>
          <span>无需账号</span>
          <span>Markdown / LaTeX</span>
        </div>
      </section>

      <section className="startup__panel">
        <form className="startup__create" onSubmit={submit}>
          <label htmlFor="workspace-name">新建学习工作区</label>
          <div className="input-action">
            <input
              id="workspace-name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：数据结构"
            />
            <button className="button button--primary" type="submit" disabled={busy || !name.trim()}>
              <Plus size={17} />
              选择位置并创建
            </button>
          </div>
        </form>

        <button className="button button--wide" type="button" disabled={busy} onClick={() => void chooseWorkspace()}>
          <FolderOpen size={17} />
          打开已有工作区
        </button>

        <div className="startup__recent">
          <div className="section-label">
            <Clock3 size={15} />
            最近使用
          </div>
          {recents.length ? (
            <div className="recent-list">
              {recents.map((workspace) => (
                <button
                  key={workspace.path}
                  className="recent-item"
                  type="button"
                  disabled={busy}
                  onClick={() => void openWorkspace(workspace.path)}
                >
                  <span className="recent-item__stripe" aria-hidden="true" />
                  <span>
                    <strong>{workspace.name}</strong>
                    <small>{workspace.path}</small>
                  </span>
                  <time>{new Date(workspace.lastOpenedAt).toLocaleDateString('zh-CN')}</time>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-copy">还没有打开过工作区。创建后，最近目录会保存在本机。</p>
          )}
        </div>
      </section>
    </main>
  )
}
