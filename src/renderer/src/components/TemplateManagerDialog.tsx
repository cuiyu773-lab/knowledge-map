import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { BookTemplate, Download, Import, Palette, Pencil, RefreshCw, Trash2, X } from 'lucide-react'
import type { MindMapDocument, TemplateDetail, TemplateNodeBehavior } from '@shared/types'
import { TEMPLATE_CATEGORIES } from '@shared/templates'
import { useMapStore } from '@renderer/stores/mapStore'
import { useTemplateStore } from '@renderer/stores/templateStore'

function relativePaths(document: MindMapDocument, parentId: string | null = null, prefix: string[] = []): Map<string, string[]> {
  const result = new Map<string, string[]>()
  Object.values(document.nodes).filter((node) => node.parentId === parentId).sort((a, b) => a.order - b.order).forEach((node) => {
    const parts = [...prefix, node.title.trim()]
    result.set(node.id, parts)
    relativePaths(document, node.id, parts).forEach((value, key) => result.set(key, value))
  })
  return result
}

export function TemplateManagerDialog() {
  const open = useTemplateStore((state) => state.managerOpen)
  const setOpen = useTemplateStore((state) => state.setManagerOpen)
  const templates = useTemplateStore((state) => state.templates)
  const presets = useTemplateStore((state) => state.presets)
  const removeTemplate = useTemplateStore((state) => state.removeTemplate)
  const renameTemplate = useTemplateStore((state) => state.renameTemplate)
  const exportTemplate = useTemplateStore((state) => state.exportTemplate)
  const importTemplate = useTemplateStore((state) => state.importTemplate)
  const setAiRecommendation = useTemplateStore((state) => state.setAiRecommendation)
  const setBehaviors = useTemplateStore((state) => state.setBehaviors)
  const updateTemplate = useTemplateStore((state) => state.updateTemplate)
  const removePreset = useTemplateStore((state) => state.removePreset)
  const renamePreset = useTemplateStore((state) => state.renamePreset)
  const document = useMapStore((state) => state.document)
  const selectedNodeId = useMapStore((state) => state.selectedNodeId)
  const [tab, setTab] = useState<'templates' | 'presets'>('templates')
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<TemplateDetail | null>(null)
  const selected = useMemo(() => templates.find((item) => item.id === selectedId) ?? null, [templates, selectedId])
  useEffect(() => { if (open) { setTab('templates'); setSelectedId(templates[0]?.id ?? '') } }, [open, templates.length])
  useEffect(() => {
    if (!selectedId) { setDetail(null); return }
    void window.zhitu.templates.get(selectedId).then((result) => { if (result.ok) setDetail(result.value) })
  }, [selectedId])

  const changeBehavior = async (key: string, behavior: TemplateNodeBehavior) => {
    if (!detail) return
    const behaviors = Object.fromEntries(Object.values(detail.template.nodes).map((node) => [node.key, node.aiBehavior]))
    behaviors[key] = behavior
    if (await setBehaviors(detail.template.id, behaviors)) {
      const result = await window.zhitu.templates.get(detail.template.id)
      if (result.ok) setDetail(result.value)
    }
  }

  const updateFromCurrent = async () => {
    if (!detail || !document || detail.template.source === 'builtin') return
    const rootNodeId = detail.template.kind === 'subtree' && selectedNodeId ? selectedNodeId : document.rootId
    const currentPaths = relativePaths(document, rootNodeId)
    const templatePaths = new Map<string, string[]>()
    const collect = (key: string, prefix: string[]) => {
      const node = detail.template.nodes[key]
      if (!node) return
      const next = [...prefix, node.title.trim()]
      templatePaths.set(node.key, next)
      Object.values(detail.template.nodes).filter((item) => item.parentKey === key).forEach((child) => collect(child.key, next))
    }
    collect(detail.template.rootKey, [])
    const pathBehaviors = new Map([...templatePaths].map(([key, value]) => [value.join('\u0000'), detail.template.nodes[key]?.aiBehavior ?? 'expandable']))
    const behaviors: Record<string, TemplateNodeBehavior> = {}
    currentPaths.forEach((parts, id) => { behaviors[id] = pathBehaviors.get(parts.join('\u0000')) ?? 'expandable' })
    if (await updateTemplate({ id: detail.template.id, document, rootNodeId, name: detail.template.name, description: detail.template.description, category: detail.template.category, behaviors })) {
      const result = await window.zhitu.templates.get(detail.template.id)
      if (result.ok) setDetail(result.value)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content template-manager-dialog" aria-label="模板与预设">
      <div className="dialog-heading"><div><p className="eyebrow">资源库</p><Dialog.Title className="dialog-title"><BookTemplate size={18} />模板与样式预设</Dialog.Title></div><Dialog.Close className="icon-button" aria-label="关闭"><X size={16} /></Dialog.Close></div>
      <div className="segmented template-manager-tabs"><button className={tab === 'templates' ? 'is-active' : ''} type="button" onClick={() => setTab('templates')}><BookTemplate size={14} />模板</button><button className={tab === 'presets' ? 'is-active' : ''} type="button" onClick={() => setTab('presets')}><Palette size={14} />样式预设</button></div>
      {tab === 'templates' ? <div className="template-manager-grid">
        <div className="template-manager-list"><div className="template-manager-actions"><button className="button button--small" type="button" onClick={() => void importTemplate()}><Import size={14} />导入</button></div>{templates.map((item) => <button key={item.id} className={`template-manager-item ${selectedId === item.id ? 'is-selected' : ''}`} type="button" onClick={() => setSelectedId(item.id)}><span><strong>{item.name}</strong><small>{item.source === 'builtin' ? '内置' : '我的'} · {item.nodeCount} 节点</small></span><span>{TEMPLATE_CATEGORIES.find((category) => category.value === item.category)?.label}</span></button>)}</div>
        <div className="template-manager-detail">{selected ? <><h3>{selected.name}</h3><p>{selected.description || '暂无说明'}</p><div className="template-preview__branches"><small>一级主题</small>{selected.topLevelTitles.map((title) => <span key={title}>{title}</span>)}</div>{detail && <div className="template-manager-behaviors"><small>AI 行为标记</small>{Object.values(detail.template.nodes).map((node) => <label key={node.key}><span>{node.title}</span><select value={node.key === detail.template.rootKey ? 'fixed' : node.aiBehavior} disabled={detail.template.source === 'builtin' || node.key === detail.template.rootKey} onChange={(event) => void changeBehavior(node.key, event.target.value as TemplateNodeBehavior)}><option value="fixed">固定</option><option value="expandable">可扩充</option><option value="optional">可选</option></select></label>)}</div>}{selected.source === 'user' && <label className="check-row"><input type="checkbox" checked={selected.aiRecommendationEnabled} onChange={(event) => void setAiRecommendation(selected.id, event.target.checked)} />允许 AI 推荐（仅发送名称、说明和一级主题）</label>}<div className="template-manager-detail__actions"><button className="button button--small" type="button" disabled={selected.source === 'builtin'} onClick={() => { const name = window.prompt('模板名称', selected.name); if (name?.trim()) void renameTemplate(selected.id, name.trim()) }}><Pencil size={14} />重命名</button><button className="button button--small" type="button" onClick={() => void exportTemplate(selected.id)}><Download size={14} />导出</button><button className="button button--small" type="button" disabled={selected.source === 'builtin' || !document} onClick={() => void updateFromCurrent()}><RefreshCw size={14} />用当前导图更新</button><button className="button button--small button--danger" type="button" disabled={selected.source === 'builtin'} onClick={() => { if (window.confirm(`删除模板「${selected.name}」？`)) void removeTemplate(selected.id) }}><Trash2 size={14} />删除</button></div></> : <p className="template-empty">选择一个模板查看详情</p>}</div>
      </div> : <div className="preset-manager-list">{presets.map((item) => <div className="preset-manager-item" key={item.id}><span className={`preset-swatch color-swatch color-swatch--${item.style.color}`} /><span><strong>{item.name}</strong><small>{item.source === 'builtin' ? '内置' : '我的'} · {item.style.shape} · {Math.round(item.style.fontScale * 100)}%</small></span><button className="icon-button" type="button" disabled={item.source === 'builtin'} title="重命名" onClick={() => { const name = window.prompt('预设名称', item.name); if (name?.trim()) void renamePreset(item.id, name.trim()) }}><Pencil size={14} /></button><button className="icon-button icon-button--danger" type="button" disabled={item.source === 'builtin'} title="删除" onClick={() => { if (window.confirm(`删除预设「${item.name}」？`)) void removePreset(item.id) }}><Trash2 size={14} /></button></div>)}{!presets.length && <p className="template-empty">暂无预设</p>}</div>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  )
}
