import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { BookTemplate, Check, FilePlus2, Search, Sparkles, X } from 'lucide-react'
import { TEMPLATE_CATEGORIES } from '@shared/templates'
import { useTemplateStore } from '@renderer/stores/templateStore'

const MODE_TITLE = { map: '选择新导图模板', workspace: '选择起始模板', ai: '选择 AI 生成模板' } as const

export function TemplatePickerDialog() {
  const mode = useTemplateStore((state) => state.pickerMode)
  const templates = useTemplateStore((state) => state.templates)
  const resolvePicker = useTemplateStore((state) => state.resolvePicker)
  const [selectedId, setSelectedId] = useState('blank')
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<'all' | 'builtin' | 'user'>('all')
  const filtered = useMemo(() => templates.filter((item) => {
    const keyword = query.trim().toLocaleLowerCase('zh-CN')
    const matchesQuery = !keyword || `${item.name} ${item.description} ${item.topLevelTitles.join(' ')}`.toLocaleLowerCase('zh-CN').includes(keyword)
    return matchesQuery && (source === 'all' || item.source === source)
  }), [templates, query, source])
  useEffect(() => { if (mode) { setSelectedId('blank'); setQuery(''); setSource('all') } }, [mode])
  const selected = templates.find((item) => item.id === selectedId)

  return (
    <Dialog.Root open={Boolean(mode)} onOpenChange={(open) => { if (!open) resolvePicker(null) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content template-picker" aria-label={mode ? MODE_TITLE[mode] : '选择模板'}>
          <div className="dialog-heading">
            <div><p className="eyebrow">模板库</p><Dialog.Title className="dialog-title"><BookTemplate size={18} />{mode ? MODE_TITLE[mode] : '选择模板'}</Dialog.Title></div>
            <Dialog.Close className="icon-button" aria-label="关闭"><X size={16} /></Dialog.Close>
          </div>
          <div className="template-toolbar">
            <label className="template-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模板" /></label>
            <div className="segmented template-source-switch">
              <button className={source === 'all' ? 'is-active' : ''} type="button" onClick={() => setSource('all')}>全部</button>
              <button className={source === 'builtin' ? 'is-active' : ''} type="button" onClick={() => setSource('builtin')}>内置</button>
              <button className={source === 'user' ? 'is-active' : ''} type="button" onClick={() => setSource('user')}>我的</button>
            </div>
          </div>
          <div className="template-picker__body">
            <div className="template-card-list">
              <button className={`template-card template-card--blank ${selectedId === 'blank' ? 'is-selected' : ''}`} type="button" onClick={() => setSelectedId('blank')}>
                <span className="template-card__icon"><FilePlus2 size={18} /></span><span><strong>空白导图</strong><small>只创建一个根主题</small></span>{selectedId === 'blank' && <Check size={15} />}
              </button>
              {filtered.map((item) => (
                <button key={item.id} className={`template-card ${selectedId === item.id ? 'is-selected' : ''}`} type="button" onClick={() => setSelectedId(item.id)}>
                  <span className="template-card__icon"><BookTemplate size={18} /></span>
                  <span><strong>{item.name}</strong><small>{TEMPLATE_CATEGORIES.find((category) => category.value === item.category)?.label} · {item.nodeCount} 节点 · {item.source === 'builtin' ? '内置' : '我的'}</small></span>
                  {selectedId === item.id && <Check size={15} />}
                </button>
              ))}
              {!filtered.length && <div className="template-empty">没有匹配的模板</div>}
            </div>
            <div className="template-preview">
              {selected ? <>
                <span className="template-preview__icon"><Sparkles size={20} /></span><h3>{selected.name}</h3><p>{selected.description || '暂无说明'}</p>
                <div className="template-preview__tag">{selected.kind === 'map' ? '整图模板' : '子树模板'}</div>
                <div className="template-preview__branches"><small>一级主题</small>{selected.topLevelTitles.map((title) => <span key={title}>{title}</span>)}</div>
                {selected.assetCount > 0 && <small>包含 {selected.assetCount} 张图片</small>}
              </> : <><span className="template-preview__icon"><FilePlus2 size={20} /></span><h3>空白导图</h3><p>不套用结构，从单根节点开始。</p></>}
            </div>
          </div>
          <div className="dialog-actions">
            <Dialog.Close className="button">取消</Dialog.Close>
            <button className="button button--primary" type="button" onClick={() => resolvePicker(selected ?? 'blank')}>{selected ? `使用「${selected.name}」` : '使用空白'}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}