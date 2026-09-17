import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Check,
  ChevronDown,
  FilePlus2,
  FileText,
  LoaderCircle,
  MessageSquareText,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  WandSparkles,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AiPreviewNode, AiQuestionAnswer } from '@shared/types'
import { useAiStore } from '@renderer/stores/aiStore'
import { useMapStore } from '@renderer/stores/mapStore'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { AiSettingsDialog } from './AiSettingsDialog'
import { MaterialLibraryDialog } from './MaterialLibraryDialog'

function countIncluded(nodes: AiPreviewNode[]): number {
  return nodes.reduce((count, node) => count + (node.included ? 1 + countIncluded(node.children) : 0), 0)
}

function updateBranch(
  nodes: AiPreviewNode[],
  id: string,
  updater: (node: AiPreviewNode) => AiPreviewNode
): AiPreviewNode[] {
  return nodes.map((node) => {
    if (node.id === id) return updater(node)
    const children = updateBranch(node.children, id, updater)
    return children === node.children ? node : { ...node, children }
  })
}

function PreviewBranch({
  node,
  depth,
  onUpdate
}: {
  node: AiPreviewNode
  depth: number
  onUpdate: (id: string, updater: (node: AiPreviewNode) => AiPreviewNode) => void
}) {
  return (
    <div className="ai-preview-branch" style={{ '--ai-depth': depth } as React.CSSProperties}>
      <div className="ai-preview-row">
        <label className="ai-preview-check" title="包含此分支">
          <input
            type="checkbox"
            checked={node.included}
            onChange={(event) => onUpdate(node.id, (current) => ({ ...current, included: event.target.checked }))}
          />
        </label>
        <input
          className="ai-preview-title"
          aria-label="主题标题"
          value={node.title}
          disabled={!node.included}
          onChange={(event) => onUpdate(node.id, (current) => ({ ...current, title: event.target.value.slice(0, 80) }))}
        />
      </div>
      <textarea
        className="ai-preview-summary"
        aria-label="主题摘要"
        rows={2}
        value={node.summary}
        disabled={!node.included}
        placeholder="摘要"
        onChange={(event) => onUpdate(node.id, (current) => ({ ...current, summary: event.target.value.slice(0, 240) }))}
      />
      {node.children.length > 0 && (
        <div className="ai-preview-children">
          {node.children.map((child) => <PreviewBranch key={child.id} node={child} depth={depth + 1} onUpdate={onUpdate} />)}
        </div>
      )}
    </div>
  )
}

export function AiDrawer() {
  const open = useAiStore((state) => state.open)
  const session = useAiStore((state) => state.session)
  const config = useAiStore((state) => state.config)
  const materials = useAiStore((state) => state.materials)
  const loading = useAiStore((state) => state.loading)
  const generating = useAiStore((state) => state.generating)
  const progress = useAiStore((state) => state.progress)
  const error = useAiStore((state) => state.error)
  const closeDrawer = useAiStore((state) => state.closeDrawer)
  const loadForActiveMap = useAiStore((state) => state.loadForActiveMap)
  const setMode = useAiStore((state) => state.setMode)
  const setTargetNode = useAiStore((state) => state.setTargetNode)
  const setScale = useAiStore((state) => state.setScale)
  const setIncludeFullMap = useAiStore((state) => state.setIncludeFullMap)
  const toggleMaterial = useAiStore((state) => state.toggleMaterial)
  const updatePreview = useAiStore((state) => state.updatePreview)
  const submitPrompt = useAiStore((state) => state.submitPrompt)
  const answerQuestions = useAiStore((state) => state.answerQuestions)
  const generatePreview = useAiStore((state) => state.generatePreview)
  const cancelGeneration = useAiStore((state) => state.cancelGeneration)
  const applyToCurrent = useAiStore((state) => state.applyToCurrent)
  const applyAsNewMap = useAiStore((state) => state.applyAsNewMap)
  const clearSession = useAiStore((state) => state.clearSession)
  const setConfigOpen = useAiStore((state) => state.setConfigOpen)
  const setMaterialsOpen = useAiStore((state) => state.setMaterialsOpen)
  const clearError = useAiStore((state) => state.clearError)
  const activeMapId = useWorkspaceStore((state) => state.activeMapId)
  const selectedNodeId = useMapStore((state) => state.selectedNodeId)
  const document = useMapStore((state) => state.document)
  const [prompt, setPrompt] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const scrollRef = useRef<HTMLDivElement>(null)
  const selectedTitle = session?.targetNodeId ? document?.nodes[session.targetNodeId]?.title : selectedNodeId ? document?.nodes[selectedNodeId]?.title : ''
  const selectedMaterials = useMemo(
    () => materials.filter((material) => session?.materialIds.includes(material.id)),
    [materials, session?.materialIds]
  )

  useEffect(() => {
    if (!open || !activeMapId) return
    void loadForActiveMap()
  }, [open, activeMapId, loadForActiveMap])

  useEffect(() => {
    setAnswers({})
  }, [session?.pendingQuestions])

  useEffect(() => {
    if (open && session?.mode === 'extend' && selectedNodeId && !session.pendingPreview && !generating) {
      setTargetNode(selectedNodeId)
    }
  }, [open, selectedNodeId, session?.mode, session?.pendingPreview, session?.targetNodeId, generating, setTargetNode])

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'auto' })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, session?.messages.length, session?.pendingQuestions, session?.pendingPreview])

  if (!open) return null

  const requestClose = () => {
    if (generating && !window.confirm('当前正在生成，关闭抽屉将取消任务。仍要关闭吗？')) return
    if (generating) void cancelGeneration()
    closeDrawer()
  }

  const sendPrompt = async (event: React.FormEvent) => {
    event.preventDefault()
    const value = prompt.trim()
    if (!value) return
    setPrompt('')
    await submitPrompt(value)
  }

  const submitAnswers = async () => {
    const values: AiQuestionAnswer[] = (session?.pendingQuestions ?? []).map((question) => ({
      id: question.id,
      answer: answers[question.id]?.trim() ?? ''
    }))
    await answerQuestions(values)
  }

  const markQuestionsAnswered = () => {
    const values: AiQuestionAnswer[] = (session?.pendingQuestions ?? []).map((question) => ({
      id: question.id,
      answer: answers[question.id]?.trim() ?? '未补充，请按你的判断生成'
    }))
    void answerQuestions(values)
  }

  const updateNode = (id: string, updater: (node: AiPreviewNode) => AiPreviewNode) => {
    updatePreview((preview) => ({ ...preview, children: updateBranch(preview.children, id, updater) }))
  }

  return (
    <>
      <aside className="ai-drawer" role="dialog" aria-label="AI 制作">
        <header className="ai-drawer__header">
          <div className="ai-drawer__title">
            <span className="ai-drawer__mark"><Sparkles size={17} /></span>
            <div><p className="eyebrow">智能制作</p><h2>AI 导图助手</h2></div>
          </div>
          <div className="ai-drawer__header-actions">
            <button className="icon-button" type="button" title="AI 配置" onClick={() => setConfigOpen(true)}><Settings2 size={16} /></button>
            <button className="icon-button" type="button" title="关闭" onClick={requestClose}><X size={17} /></button>
          </div>
        </header>

        <div className="ai-mode-switch" role="tablist" aria-label="制作模式">
          <button className={session?.mode === 'new' ? 'is-active' : ''} type="button" disabled={generating} onClick={() => void setMode('new')}><FilePlus2 size={14} />新建导图</button>
          <button className={session?.mode === 'extend' ? 'is-active' : ''} type="button" disabled={generating || !selectedNodeId} onClick={() => void setMode('extend')}><MessageSquareText size={14} />补充选中节点</button>
        </div>

        {!config?.baseUrl || !config.model || !config.dataConsent ? (
          <div className="ai-config-notice">
            <Settings2 size={18} />
            <div><strong>先连接一个模型服务</strong><span>知图不会内置账号或代理你的请求。</span></div>
            <button className="button button--small" type="button" onClick={() => setConfigOpen(true)}>去配置</button>
          </div>
        ) : null}

        <div className="ai-drawer__scroll" ref={scrollRef}>
          {loading ? (
            <div className="ai-loading"><LoaderCircle className="spin" size={20} />正在读取会话…</div>
          ) : session?.messages.length ? (
            <div className="ai-conversation">
              {session.messages.map((message) => (
                <div className={`ai-message ai-message--${message.role}`} key={message.id}>
                  <span>{message.role === 'user' ? '你' : 'AI'}</span>
                  <p>{message.content || (message.kind === 'preview' ? '已生成大纲预览' : '等待你的回答。')}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="ai-empty">
              <WandSparkles size={28} />
              <strong>从一个主题或一份资料开始</strong>
              <span>AI 会先确认方向，再生成可编辑的大纲预览。</span>
            </div>
          )}

          {session?.pendingQuestions.length ? (
            <section className="ai-question-panel">
              <div className="ai-section-title"><span>需要确认</span><small>最多再追问一轮</small></div>
              {session.pendingQuestions.map((question) => (
                <div className="ai-question" key={question.id}>
                  <strong>{question.question}</strong>
                  {question.options?.length ? (
                    <div className="ai-question__options">
                      {question.options.map((option) => (
                        <button
                          className={answers[question.id] === option ? 'is-active' : ''}
                          key={option}
                          type="button"
                          onClick={() => setAnswers((current) => ({ ...current, [question.id]: option }))}
                        >{option}</button>
                      ))}
                    </div>
                  ) : null}
                  <textarea
                    rows={2}
                    value={answers[question.id] ?? ''}
                    placeholder="输入补充说明"
                    onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                  />
                </div>
              ))}
              <div className="ai-question-actions">
                <button className="button button--small" type="button" disabled={generating} onClick={() => void markQuestionsAnswered()}>按当前判断继续</button>
                <button className="button button--small button--primary" type="button" disabled={generating || !Object.values(answers).some(Boolean)} onClick={() => void submitAnswers()}>提交回答</button>
              </div>
            </section>
          ) : null}

          {session?.pendingPreview ? (
            <section className="ai-preview-panel">
              <div className="ai-section-title">
                <span>大纲预览</span>
                <small>{countIncluded(session.pendingPreview.children)} 个节点</small>
              </div>
              <label className="field ai-preview-root">
                <span>根主题</span>
                <input
                  value={session.pendingPreview.title}
                  disabled={session.mode === 'extend'}
                  onChange={(event) => updatePreview((preview) => ({ ...preview, title: event.target.value.slice(0, 80) }))}
                />
              </label>
              {session.mode === 'new' ? (
                <label className="field ai-preview-root">
                  <span>根主题摘要</span>
                  <textarea
                    rows={2}
                    value={session.pendingPreview.summary}
                    onChange={(event) => updatePreview((preview) => ({ ...preview, summary: event.target.value.slice(0, 240) }))}
                  />
                </label>
              ) : null}
              <div className="ai-preview-tree">
                {session.pendingPreview.children.map((node) => <PreviewBranch key={node.id} node={node} depth={0} onUpdate={updateNode} />)}
              </div>
            </section>
          ) : null}
        </div>

        <div className="ai-drawer__composer">
          {generating && (
            <div className="ai-progress">
              <LoaderCircle className="spin" size={15} />
              <span>{progress?.message ?? '正在处理…'}</span>
              {progress?.total ? <small>{progress.current}/{progress.total}</small> : null}
              <button type="button" onClick={() => void cancelGeneration()}><Square size={11} />取消</button>
            </div>
          )}
          {error && <div className="inline-error ai-inline-error">{error}<button type="button" aria-label="关闭错误" onClick={clearError}><X size={13} /></button></div>}

          <div className="ai-context-row">
            <button className="ai-material-picker" type="button" disabled={generating} onClick={() => setMaterialsOpen(true)}>
              <FileText size={14} />
              {selectedMaterials.length ? `已选 ${selectedMaterials.length} 份资料` : '选择课程资料'}
            </button>
            <button className="ai-manage-materials" type="button" onClick={() => setMaterialsOpen(true)}>资料库</button>
          </div>
          {selectedMaterials.length > 0 && (
            <div className="ai-material-chips">
              {selectedMaterials.map((material) => (
                <button key={material.id} type="button" title="取消选择" onClick={() => toggleMaterial(material.id)}>
                  {material.name}<X size={11} />
                </button>
              ))}
            </div>
          )}
          <div className="ai-settings-row">
            <div className="ai-scale-switch" role="group" aria-label="生成规模">
              {([
                ['concise', '精简'],
                ['standard', '标准'],
                ['detailed', '详尽']
              ] as const).map(([value, label]) => (
                <button key={value} className={session?.scale === value ? 'is-active' : ''} type="button" disabled={generating} onClick={() => setScale(value)}>{label}</button>
              ))}
            </div>
            {session?.mode === 'extend' ? (
              <label className="ai-full-map-toggle" title="发送整张导图会占用更多上下文">
                <input type="checkbox" checked={session.includeFullMap} disabled={generating} onChange={(event) => setIncludeFullMap(event.target.checked)} />
                包含整张导图
              </label>
            ) : null}
          </div>
          {session?.mode === 'extend' ? (
            <div className="ai-target-hint">将补充到：<strong>{selectedTitle || '当前选中节点'}</strong></div>
          ) : null}
          <form className="ai-prompt" onSubmit={(event) => void sendPrompt(event)}>
            <textarea
              rows={3}
              value={prompt}
              disabled={generating}
              placeholder={session?.mode === 'extend' ? '描述要在该节点下补充什么…' : '例如：整理数据结构课程，突出算法思想和复杂度分析…'}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
            />
            <button className="icon-button ai-send" type="submit" disabled={generating || !prompt.trim()} title="发送 Ctrl+Enter"><ChevronDown size={17} /></button>
          </form>
          <div className="ai-composer-actions">
            <button className="button button--small" type="button" disabled={generating || !session?.messages.length} onClick={() => { if (window.confirm('清空当前导图的 AI 会话？')) void clearSession() }}><Trash2 size={13} />清空会话</button>
            <button className="button button--small button--primary" type="button" disabled={generating || !config?.model} onClick={() => void generatePreview()}><Sparkles size={13} />直接生成</button>
          </div>

          {session?.pendingPreview ? (
            session.mode === 'new' ? (
              <button className="button button--primary ai-apply-button" type="button" onClick={() => void applyAsNewMap()}><Check size={15} />创建新导图</button>
            ) : (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button className="button button--primary ai-apply-button" type="button"><Check size={15} />应用预览<ChevronDown size={13} /></button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="menu-content" side="top" align="end" sideOffset={8}>
                    <DropdownMenu.Item className="menu-item" onSelect={() => void applyToCurrent('append')}>追加且不覆盖</DropdownMenu.Item>
                    <DropdownMenu.Item className="menu-item" onSelect={() => void applyToCurrent('merge')}>按标题智能合并</DropdownMenu.Item>
                    <DropdownMenu.Separator className="menu-separator" />
                    <DropdownMenu.Item
                      className="menu-item menu-item--danger"
                      onSelect={() => {
                        if (window.confirm('替换会删除选中节点的现有子树，但可通过 Ctrl+Z 撤销。继续吗？')) void applyToCurrent('replace')
                      }}
                    >替换现有子树</DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            )
          ) : null}
        </div>
      </aside>
      <AiSettingsDialog />
      <MaterialLibraryDialog />
    </>
  )
}
