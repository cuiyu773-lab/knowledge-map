import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { BookTemplate, X } from 'lucide-react'
import type { MindMapDocument, TemplateCategory, TemplateNodeBehavior } from '@shared/types'
import { TEMPLATE_CATEGORIES } from '@shared/templates'
import { getChildren } from '@shared/tree'
import { useMapStore } from '@renderer/stores/mapStore'
import { useTemplateStore } from '@renderer/stores/templateStore'

function BehaviorRow({ document, nodeId, rootNodeId, behaviors, onBehavior }: {
  document: MindMapDocument
  nodeId: string
  rootNodeId: string
  behaviors: Record<string, TemplateNodeBehavior>
  onBehavior: (nodeId: string, behavior: TemplateNodeBehavior) => void
}) {
  const node = document.nodes[nodeId]
  if (!node) return null
  return (
    <div className="template-behavior-node">
      <div className="template-behavior-row">
        <span title={node.title}>{node.title || '未命名主题'}</span>
        <select aria-label={`${node.title || '节点'}的 AI 行为`} value={nodeId === rootNodeId ? 'fixed' : behaviors[nodeId] ?? 'expandable'} disabled={nodeId === rootNodeId} onChange={(event) => onBehavior(nodeId, event.target.value as TemplateNodeBehavior)}>
          <option value="fixed">固定</option><option value="expandable">可扩充</option><option value="optional">可选</option>
        </select>
      </div>
      <div className="template-behavior-children">{getChildren(document, nodeId).map((child) => <BehaviorRow key={child.id} document={document} nodeId={child.id} rootNodeId={rootNodeId} behaviors={behaviors} onBehavior={onBehavior} />)}</div>
    </div>
  )
}

export function TemplateSaveDialog() {
  const open = useTemplateStore((state) => state.saveOpen)
  const rootNodeId = useTemplateStore((state) => state.saveRootNodeId)
  const setOpen = useTemplateStore((state) => state.setSaveOpen)
  const saveTemplate = useTemplateStore((state) => state.saveTemplate)
  const document = useMapStore((state) => state.document)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<TemplateCategory>('other')
  const [behaviors, setBehaviors] = useState<Record<string, TemplateNodeBehavior>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !document || !rootNodeId) return
    const root = document.nodes[rootNodeId]
    const next: Record<string, TemplateNodeBehavior> = {}
    Object.keys(document.nodes).forEach((id) => { next[id] = id === rootNodeId ? 'fixed' : 'expandable' })
    setName(rootNodeId === document.rootId ? document.title : root?.title ?? '未命名模板')
    setDescription('')
    setCategory(rootNodeId === document.rootId ? 'course' : 'other')
    setBehaviors(next)
  }, [open, document, rootNodeId])

  const submit = async () => {
    if (!document || !rootNodeId || !name.trim()) return
    setBusy(true)
    const saved = await saveTemplate({ document, rootNodeId, name: name.trim(), description: description.trim(), category, behaviors })
    setBusy(false)
    if (saved) setOpen(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => setOpen(next, rootNodeId ?? undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content template-save-dialog" aria-label="保存为模板">
          <div className="dialog-heading"><div><p className="eyebrow">创建模板</p><Dialog.Title className="dialog-title"><BookTemplate size={18} />保存为模板</Dialog.Title></div><Dialog.Close className="icon-button" aria-label="关闭"><X size={16} /></Dialog.Close></div>
          <div className="template-save-grid">
            <div className="template-save-form">
              <label className="field"><span>模板名称</span><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>
              <label className="field"><span>说明</span><textarea rows={3} maxLength={240} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="这个模板适合什么场景？" /></label>
              <label className="field"><span>分类</span><select value={category} onChange={(event) => setCategory(event.target.value as TemplateCategory)}>{TEMPLATE_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            </div>
            <div className="template-behavior-panel">
              <div className="template-behavior-heading"><strong>AI 生成行为</strong><small>固定：保持不变；可扩充：补充摘要、详注与子节点；可选：允许 AI 省略。</small></div>
              <div className="template-behavior-tree">{document && rootNodeId && <BehaviorRow document={document} nodeId={rootNodeId} rootNodeId={rootNodeId} behaviors={behaviors} onBehavior={(id, behavior) => setBehaviors((current) => ({ ...current, [id]: behavior }))} />}</div>
            </div>
          </div>
          <div className="dialog-actions"><Dialog.Close className="button">取消</Dialog.Close><button className="button button--primary" type="button" disabled={busy || !name.trim()} onClick={() => void submit()}>{busy ? '保存中…' : '保存模板'}</button></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}