import { create } from 'zustand'
import {
  collectAiMapContext,
  createAiSession,
  normalizeAiMaterialIds,
  toggleAiMaterialId
} from '@shared/ai'
import type {
  AiConfigInput,
  AiMessage,
  AiMode,
  AiPreview,
  AiPreviewStrategy,
  AiProgress,
  AiPublicConfig,
  AiQuestionAnswer,
  AiScale,
  AiSession,
  MaterialSummary
} from '@shared/types'
import { useMapStore } from './mapStore'
import { useWorkspaceStore } from './workspaceStore'

interface AiState {
  open: boolean
  configOpen: boolean
  materialsOpen: boolean
  loading: boolean
  generating: boolean
  progress: AiProgress | null
  error: string | null
  session: AiSession | null
  config: AiPublicConfig | null
  materials: MaterialSummary[]
  progressId: string | null
  openDrawer: () => Promise<void>
  closeDrawer: () => void
  loadForActiveMap: () => Promise<void>
  setMode: (mode: AiMode) => Promise<void>
  setTargetNode: (nodeId: string) => void
  setScale: (scale: AiScale) => void
  setIncludeFullMap: (include: boolean) => void
  toggleMaterial: (id: string) => void
  updatePreview: (updater: (preview: AiPreview) => AiPreview) => void
  submitPrompt: (prompt: string) => Promise<void>
  answerQuestions: (answers: AiQuestionAnswer[]) => Promise<void>
  generatePreview: () => Promise<void>
  cancelGeneration: () => Promise<void>
  applyToCurrent: (strategy: AiPreviewStrategy) => Promise<boolean>
  applyAsNewMap: () => Promise<boolean>
  clearSession: () => Promise<void>
  loadConfig: () => Promise<void>
  saveConfig: (input: AiConfigInput) => Promise<boolean>
  testConnection: (input: AiConfigInput) => Promise<boolean>
  loadMaterials: () => Promise<void>
  importMaterial: () => Promise<void>
  deleteMaterial: (id: string) => Promise<void>
  revealMaterial: (id: string) => Promise<void>
  setConfigOpen: (open: boolean) => void
  setMaterialsOpen: (open: boolean) => void
  receiveProgress: (progress: AiProgress) => void
  clearError: () => void
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

function makeMessage(
  role: AiMessage['role'],
  kind: AiMessage['kind'],
  content: string,
  questions?: AiMessage['questions']
): AiMessage {
  return {
    id: crypto.randomUUID(),
    role,
    kind,
    content,
    ...(questions?.length ? { questions } : {}),
    createdAt: new Date().toISOString()
  }
}

export const useAiStore = create<AiState>((set, get) => {
  const persist = async (session: AiSession): Promise<boolean> => {
    const next = { ...session, updatedAt: new Date().toISOString() }
    const result = await window.zhitu.ai.writeSession(next)
    if (!result.ok) {
      set({ error: result.error.message })
      return false
    }
    return true
  }

  const schedulePersist = (session: AiSession) => {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => void persist(session), 500)
  }

  const setSession = (session: AiSession, persistNow = true) => {
    set({ session })
    if (persistNow) void persist(session)
  }

  const runConsult = async (prompt: string, answers: AiQuestionAnswer[]): Promise<void> => {
    const state = get()
    const session = state.session
    if (!session || state.generating) return
    const mapState = useMapStore.getState()
    const mapContext =
      session.mode === 'extend' && mapState.document && session.targetNodeId
        ? collectAiMapContext(mapState.document, session.targetNodeId, session.includeFullMap)
        : ''
    const progressId = crypto.randomUUID()
    set({ generating: true, progressId, progress: null, error: null })
    const result = await window.zhitu.ai.consult({ session, prompt, answers, mapContext, progressId })
    if (!result.ok) {
      set({ generating: false, progressId: null, progress: null, error: result.error.message })
      if (result.error.code !== 'AI_CANCELED') useWorkspaceStore.getState().showToast(result.error.message, 'error')
      return
    }
    const assistant = makeMessage('assistant', result.value.kind === 'questions' ? 'questions' : 'text', result.value.assistantText, result.value.questions)
    const next: AiSession = {
      ...session,
      messages: [...session.messages, assistant],
      pendingQuestions: result.value.kind === 'questions' ? result.value.questions : [],
      clarificationRound: result.value.round
    }
    set({ session: next, generating: false, progressId: null, progress: null })
    await persist(next)
  }

  return {
    open: false,
    configOpen: false,
    materialsOpen: false,
    loading: false,
    generating: false,
    progress: null,
    error: null,
    session: null,
    config: null,
    materials: [],
    progressId: null,

    openDrawer: async () => {
      set({ open: true })
      await Promise.all([get().loadConfig(), get().loadMaterials(), get().loadForActiveMap()])
    },

    closeDrawer: () => set({ open: false, error: null }),

    loadForActiveMap: async () => {
      const mapId = useWorkspaceStore.getState().activeMapId
      if (!mapId) {
        const current = get().session
        const draftId = current?.draftId ?? crypto.randomUUID()
        const session = current?.draftId
          ? { ...current, materialIds: normalizeAiMaterialIds(current.materialIds) }
          : createAiSession(null, draftId)
        set({ session, loading: false })
        return
      }
      const current = get().session
      if (current && current.draftId) return
      if (current?.mapId === mapId) return
      if (current) await persist(current)
      set({ loading: true })
      const result = await window.zhitu.ai.readSession(mapId, null)
      if (!result.ok) {
        set({ loading: false, error: result.error.message })
        return
      }
      const selectedNodeId = useMapStore.getState().selectedNodeId
      const session = result.value
        ? { ...result.value, materialIds: normalizeAiMaterialIds(result.value.materialIds) }
        : {
            ...createAiSession(mapId, null),
            mode: selectedNodeId ? ('extend' as const) : ('new' as const),
            targetNodeId: selectedNodeId
          }
      set({ session, loading: false, error: null })
    },

    setMode: async (mode) => {
      const current = get().session
      if (!current || get().generating) return
      if (mode === current.mode) {
        const selectedNodeId = useMapStore.getState().selectedNodeId
        if (mode === 'extend' && selectedNodeId && current.targetNodeId !== selectedNodeId && !current.pendingPreview) {
          setSession({ ...current, targetNodeId: selectedNodeId })
        }
        return
      }
      if (mode === 'new') {
        await persist(current)
        const draftId = crypto.randomUUID()
        const draft = {
          ...createAiSession(null, draftId),
          mode: 'new' as const,
          materialIds: normalizeAiMaterialIds(current.materialIds)
        }
        set({ session: draft, error: null })
        await persist(draft)
        return
      }
      const mapId = useWorkspaceStore.getState().activeMapId
      const selectedNodeId = useMapStore.getState().selectedNodeId
      if (!mapId || !selectedNodeId) {
        useWorkspaceStore.getState().showToast('请先选择要补充的节点', 'info')
        return
      }
      const result = await window.zhitu.ai.readSession(mapId, null)
      if (!result.ok) {
        set({ error: result.error.message })
        return
      }
      const session = result.value
        ? { ...result.value, materialIds: normalizeAiMaterialIds(result.value.materialIds) }
        : {
            ...createAiSession(mapId, null),
            mode: 'extend' as const,
            targetNodeId: selectedNodeId
          }
      const next = {
        ...session,
        mode: 'extend' as const,
        targetNodeId: selectedNodeId,
        materialIds: normalizeAiMaterialIds(current.materialIds)
      }
      set({ session: next, error: null })
      await persist(next)
    },

    setTargetNode: (nodeId) => {
      const current = get().session
      if (!current || current.mode !== 'extend' || current.pendingPreview || get().generating) return
      if (current.targetNodeId === nodeId) return
      setSession({ ...current, targetNodeId: nodeId })
    },

    setScale: (scale) => {
      const session = get().session
      if (!session || get().generating) return
      const next = { ...session, scale }
      setSession(next)
    },

    setIncludeFullMap: (includeFullMap) => {
      const session = get().session
      if (!session || get().generating) return
      const next = { ...session, includeFullMap }
      setSession(next)
    },

    toggleMaterial: (id) => {
      const session = get().session
      if (!session || get().generating) return
      const materialIds = toggleAiMaterialId(session.materialIds, id)
      setSession({ ...session, materialIds })
    },

    updatePreview: (updater) => {
      const session = get().session
      if (!session?.pendingPreview || get().generating) return
      const next = { ...session, pendingPreview: updater(structuredClone(session.pendingPreview)) }
      set({ session: next })
      schedulePersist(next)
    },

    submitPrompt: async (prompt) => {
      const normalized = prompt.trim()
      const session = get().session
      if (!normalized || !session || get().generating) return
      const withMessage = {
        ...session,
        messages: [...session.messages, makeMessage('user', 'text', normalized)],
        pendingQuestions: [],
        pendingPreview: null
      }
      set({ session: withMessage, error: null })
      await persist(withMessage)
      await runConsult(normalized, [])
    },

    answerQuestions: async (answers) => {
      const session = get().session
      if (!session || get().generating || !answers.some((item) => item.answer.trim())) return
      const answerText = answers.map((item) => `${item.id}：${item.answer.trim()}`).join('\n')
      const withMessage = {
        ...session,
        messages: [...session.messages, makeMessage('user', 'text', answerText)],
        pendingQuestions: []
      }
      set({ session: withMessage, error: null })
      await persist(withMessage)
      await runConsult('请根据这些回答继续判断，必要时再追问一次。', answers)
    },

    generatePreview: async () => {
      const session = get().session
      if (!session || get().generating) return
      const mapState = useMapStore.getState()
      const mapContext =
        session.mode === 'extend' && mapState.document && session.targetNodeId
          ? collectAiMapContext(mapState.document, session.targetNodeId, session.includeFullMap)
          : ''
      const progressId = crypto.randomUUID()
      set({ generating: true, progressId, progress: null, error: null })
      const result = await window.zhitu.ai.generate({ session, mapContext, progressId })
      if (!result.ok) {
        set({ generating: false, progressId: null, progress: null, error: result.error.message })
        if (result.error.code !== 'AI_CANCELED') useWorkspaceStore.getState().showToast(result.error.message, 'error')
        return
      }
      const preview = result.value
      const next: AiSession = {
        ...session,
        pendingQuestions: [],
        pendingPreview: preview,
        messages: [...session.messages, makeMessage('assistant', 'preview', preview.title)]
      }
      set({ session: next, generating: false, progressId: null, progress: null })
      await persist(next)
    },

    cancelGeneration: async () => {
      const progressId = get().progressId
      if (!progressId) return
      await window.zhitu.ai.cancel(progressId)
    },

    applyToCurrent: async (strategy) => {
      const session = get().session
      const preview = session?.pendingPreview
      const targetNodeId = session?.targetNodeId
      if (!session || !preview || !targetNodeId || !useMapStore.getState().document) return false
      useMapStore.getState().applyGeneratedPreview(targetNodeId, preview, strategy)
      const next = { ...session, pendingPreview: null }
      set({ session: next })
      await persist(next)
      await useMapStore.getState().save()
      useWorkspaceStore.getState().showToast('AI 大纲已应用，可使用 Ctrl+Z 撤销', 'success')
      return true
    },

    applyAsNewMap: async () => {
      const session = get().session
      const preview = session?.pendingPreview
      if (!session || !preview) return false
      const summary = await useWorkspaceStore.getState().createMap(preview.title)
      if (!summary) return false
      useMapStore.getState().applyGeneratedRoot(preview)
      await useMapStore.getState().save()
      const next: AiSession = {
        ...session,
        mapId: summary.id,
        draftId: null,
        mode: 'new',
        targetNodeId: null,
        pendingPreview: null
      }
      set({ session: next })
      await persist(next)
      if (session.draftId) await window.zhitu.ai.clearSession(null, session.draftId)
      useWorkspaceStore.getState().showToast('AI 导图已创建', 'success')
      return true
    },

    clearSession: async () => {
      const session = get().session
      if (!session || get().generating) return
      const result = await window.zhitu.ai.clearSession(session.mapId, session.draftId)
      if (!result.ok) {
        set({ error: result.error.message })
        return
      }
      const next = createAiSession(session.mapId, session.draftId)
      next.mode = session.mode
      next.targetNodeId = session.targetNodeId
      set({ session: next, error: null })
      await persist(next)
    },

    loadConfig: async () => {
      const result = await window.zhitu.ai.getConfig()
      if (result.ok) set({ config: result.value })
      else set({ error: result.error.message })
    },

    saveConfig: async (input) => {
      const result = await window.zhitu.ai.saveConfig(input)
      if (!result.ok) {
        set({ error: result.error.message })
        return false
      }
      set({ config: result.value, error: null })
      return true
    },

    testConnection: async (input) => {
      const result = await window.zhitu.ai.testConnection(input)
      if (!result.ok) {
        set({ error: result.error.message })
        return false
      }
      set({ error: null })
      return true
    },

    loadMaterials: async () => {
      const result = await window.zhitu.materials.list()
      if (result.ok) set({ materials: result.value })
      else set({ error: result.error.message })
    },

    importMaterial: async () => {
      const result = await window.zhitu.materials.importDialog()
      if (!result.ok) {
        set({ error: result.error.message })
        return
      }
      if (!result.value) return
      await get().loadMaterials()
      useWorkspaceStore.getState().showToast(`资料「${result.value.name}」已导入`, 'success')
    },

    deleteMaterial: async (id) => {
      const result = await window.zhitu.materials.delete(id)
      if (!result.ok) {
        set({ error: result.error.message })
        return
      }
      const session = get().session
      if (session) {
        const materialIds = normalizeAiMaterialIds(session.materialIds)
        if (materialIds.includes(id)) setSession({ ...session, materialIds: materialIds.filter((item) => item !== id) })
      }
      await get().loadMaterials()
    },

    revealMaterial: async (id) => {
      const result = await window.zhitu.materials.reveal(id)
      if (!result.ok) set({ error: result.error.message })
    },

    setConfigOpen: (configOpen) => {
      set({ configOpen })
      if (configOpen) void get().loadConfig()
    },
    setMaterialsOpen: (materialsOpen) => {
      set({ materialsOpen })
      if (materialsOpen) void get().loadMaterials()
    },
    receiveProgress: (progress) => {
      if (progress.progressId === get().progressId) set({ progress })
    },
    clearError: () => set({ error: null })
  }
})
