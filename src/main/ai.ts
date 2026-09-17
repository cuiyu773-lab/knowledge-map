import { app, dialog, net, safeStorage, shell } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { MAX_AI_MATERIALS, parseAiPreview, parseAiQuestions, parseModelJson } from '@shared/ai'
import type {
  AiConfigInput,
  AiConsultRequest,
  AiConsultResult,
  AiGenerateRequest,
  AiPreview,
  AiProgress,
  AiPublicConfig,
  AiSession,
  MaterialSummary
} from '@shared/types'
import {
  extractMaterialContent,
  MATERIAL_EXTENSIONS,
  MATERIAL_MAX_BYTES,
  type MaterialVisualDescriptor
} from './materialParser'
import {
  applyVisualCaptions,
  buildVisionPrompt,
  parseVisionResponse,
  visionCacheKey,
  type VisionCaptionMap
} from './vision'
import { AppError } from './errors'
import type { WorkspaceService } from './workspace'

const CHUNK_CHARS = 12_000
const SUMMARY_CHARS = 1_500
const MATERIAL_CONTEXT_CHARS = 30_000
const MAX_TOTAL_MATERIAL_CHARS = 1_500_000
const MODEL_TIMEOUT_MS = 90_000

interface StoredAiConfig {
  baseUrl: string
  model: string
  dataConsent: boolean
}

interface StoredCredential {
  encryptedApiKey: string
}

interface StoredMaterial extends MaterialSummary {
  hash: string
  storedName: string
}

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ChatContentPart[]
}

interface ChatResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }>
    }
  }>
}

type ProgressCallback = (progress: AiProgress) => void

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temporary, content, 'utf8')
  await fs.rename(temporary, filePath)
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T
}

function safeId(value: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(value)) throw new AppError('INVALID_ID', '标识无效')
  return value
}

function cleanMessage(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function splitText(text: string, size: number): string[] {
  const chunks: string[] = []
  for (let index = 0; index < text.length; index += size) chunks.push(text.slice(index, index + size))
  return chunks
}

function normalizeBaseUrl(baseUrl: string): string {
  let url: URL
  try {
    url = new URL(baseUrl.trim())
  } catch {
    throw new AppError('AI_CONFIG_INVALID', '模型接口地址无效')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new AppError('AI_CONFIG_INVALID', '模型接口仅支持 HTTP 或 HTTPS')
  const pathname = url.pathname.replace(/\/+$/, '')
  url.pathname = pathname.endsWith('/chat/completions') ? pathname : `${pathname}/chat/completions`.replace(/\/{2,}/g, '/')
  url.search = ''
  url.hash = ''
  return url.toString()
}

function responseContent(data: ChatResponse): string {
  const content = data.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part) => part.text ?? '').join('')
  throw new AppError('AI_RESPONSE_EMPTY', '模型没有返回内容')
}

export class AiService {
  private readonly configPath = path.join(app.getPath('userData'), 'ai-settings.json')
  private readonly credentialPath = path.join(app.getPath('userData'), 'ai-credentials.json')
  private memoryApiKey: string | null = null
  private readonly jobs = new Map<string, AbortController>()

  constructor(private readonly workspace: WorkspaceService) {}

  async getConfig(): Promise<AiPublicConfig> {
    const config = await this.readConfig()
    const apiKey = await this.readApiKey()
    return {
      ...config,
      hasApiKey: Boolean(apiKey)
    }
  }

  async saveConfig(input: AiConfigInput): Promise<AiPublicConfig> {
    const baseUrl = input.baseUrl.trim()
    const model = input.model.trim()
    if (baseUrl) normalizeBaseUrl(baseUrl)
    const config: StoredAiConfig = {
      baseUrl,
      model,
      dataConsent: Boolean(input.dataConsent)
    }
    await atomicWrite(this.configPath, JSON.stringify(config, null, 2))

    if (input.clearApiKey) await this.clearApiKey()
    else if (input.apiKey?.trim()) await this.writeApiKey(input.apiKey.trim())
    return this.getConfig()
  }

  async testConnection(input?: AiConfigInput): Promise<void> {
    const stored = await this.readConfig()
    const config: StoredAiConfig = input
      ? {
          baseUrl: input.baseUrl.trim(),
          model: input.model.trim(),
          dataConsent: Boolean(input.dataConsent)
        }
      : stored
    this.assertModelConfig(config)
    const apiKey = input?.apiKey?.trim() || (await this.readApiKey())
    this.assertConsent(config)
    await this.callModel(
      [{ role: 'user', content: '请只回复 JSON：{"ok":true}' }],
      apiKey ?? '',
      config,
      new AbortController().signal,
      15_000
    )
  }

  async listMaterials(): Promise<MaterialSummary[]> {
    const records = await this.readMaterialIndex()
    return records
      .map(({ hash: _hash, storedName: _storedName, ...summary }) => summary)
      .sort((a, b) => b.importedAt.localeCompare(a.importedAt))
  }

  async importMaterialDialog(): Promise<MaterialSummary | null> {
    const selection = await dialog.showOpenDialog({
      title: '导入课程资料',
      properties: ['openFile'],
      filters: [{ name: '课程资料', extensions: ['pdf', 'docx', 'pptx', 'md', 'markdown', 'txt'] }]
    })
    if (selection.canceled || !selection.filePaths[0]) return null
    return this.importMaterial(selection.filePaths[0])
  }

  async importMaterial(sourcePath: string): Promise<MaterialSummary> {
    const extension = path.extname(sourcePath).toLowerCase()
    if (!MATERIAL_EXTENSIONS.has(extension)) throw new AppError('UNSUPPORTED_MATERIAL', '暂不支持该资料格式')
    const stat = await fs.stat(sourcePath)
    if (!stat.isFile()) throw new AppError('INVALID_MATERIAL', '只能导入文件')
    if (stat.size > MATERIAL_MAX_BYTES) throw new AppError('MATERIAL_TOO_LARGE', '单个资料不能超过 50MB')
    const buffer = await fs.readFile(sourcePath)
    const hash = createHash('sha256').update(buffer).digest('hex')
    const records = await this.readMaterialIndex()
    const existing = records.find((item) => item.hash === hash)
    if (existing) return this.toMaterialSummary(existing)

    const storedName = `${hash.slice(0, 32)}${extension === '.markdown' ? '.md' : extension}`
    const target = this.materialFilePath(storedName)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, buffer, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    const record: StoredMaterial = {
      id: hash.slice(0, 32),
      name: path.basename(sourcePath).slice(0, 180),
      extension: extension === '.markdown' ? '.md' : extension,
      size: stat.size,
      importedAt: new Date().toISOString(),
      hash,
      storedName
    }
    await this.writeMaterialIndex([record, ...records])
    return this.toMaterialSummary(record)
  }

  async deleteMaterial(id: string): Promise<void> {
    const records = await this.readMaterialIndex()
    const record = records.find((item) => item.id === id)
    if (!record) return
    const target = this.materialFilePath(record.storedName)
    await shell.trashItem(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    await fs.rm(this.derivedMaterialDirectory(record.id), { recursive: true, force: true })
    await this.writeMaterialIndex(records.filter((item) => item.id !== id))
  }

  async revealMaterial(id: string): Promise<void> {
    const record = (await this.readMaterialIndex()).find((item) => item.id === id)
    if (!record) throw new AppError('MATERIAL_NOT_FOUND', '资料不存在')
    shell.showItemInFolder(this.materialFilePath(record.storedName))
  }

  async readSession(mapId: string | null, draftId: string | null): Promise<AiSession | null> {
    const sessionPath = this.sessionPath(mapId, draftId)
    try {
      const raw = await readJson<unknown>(sessionPath)
      if (!raw || typeof raw !== 'object') throw new Error('会话格式无效')
      const session = raw as AiSession
      if (session.schemaVersion !== 1) throw new Error('会话版本不受支持')
      return session
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new AppError('AI_SESSION_INVALID', 'AI 会话文件损坏')
    }
  }

  async writeSession(session: AiSession): Promise<void> {
    if (session.schemaVersion !== 1) throw new AppError('AI_SESSION_INVALID', 'AI 会话版本无效')
    if (!session.mapId && !session.draftId) throw new AppError('AI_SESSION_INVALID', 'AI 会话缺少归属')
    const next = { ...session, updatedAt: new Date().toISOString() }
    await atomicWrite(this.sessionPath(session.mapId, session.draftId), JSON.stringify(next, null, 2))
  }

  async clearSession(mapId: string | null, draftId: string | null): Promise<void> {
    await fs.unlink(this.sessionPath(mapId, draftId)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }

  cancel(progressId: string): void {
    this.jobs.get(progressId)?.abort()
  }

  async consult(request: AiConsultRequest, onProgress: ProgressCallback): Promise<AiConsultResult> {
    const { config, apiKey } = await this.resolveModel()
    this.assertConsent(config)
    if (request.session.clarificationRound >= 2) {
      return { kind: 'ready', questions: [], round: 2, assistantText: '信息已足够，可以直接生成大纲。' }
    }
    const signal = this.startJob(request.progressId)
    try {
      const materialContext = await this.prepareMaterialContext(
        request.session.materialIds,
        signal,
        onProgress,
        request.progressId
      )
      const history = this.historyText(request.session)
      const answers = request.answers.map((item) => `${item.id}: ${item.answer}`).join('\n')
      onProgress({ progressId: request.progressId, stage: 'thinking', message: '正在分析需求与资料…' })
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content:
            '你是中文思维导图规划助手。先判断信息是否足够。若仍需关键澄清，最多提出 3 个问题，每个问题可提供 2-6 个简洁选项；若信息已足够，则 ready=true。只输出 JSON，不要输出 Markdown。JSON 格式：{"ready":boolean,"assistantText":"简述","questions":[{"id":"q1","question":"问题","options":["选项"]}]}。'
        },
        {
          role: 'user',
          content: [
            `模式：${request.session.mode === 'new' ? '新建导图' : '补充选中节点'}`,
            `用户要求：${request.prompt || '按已有对话继续'}`,
            answers ? `本轮回答：\n${answers}` : '',
            history ? `此前对话：\n${history}` : '',
            request.mapContext ? `当前导图上下文：\n${request.mapContext}` : '',
            materialContext ? `课程资料摘要：\n${materialContext}` : ''
          ]
            .filter(Boolean)
            .join('\n\n')
        }
      ]
      const raw = await this.callJson(messages, apiKey, config, signal)
      const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      const questions = parseAiQuestions(record)
      const ready = record.ready === true || questions.length === 0
      return {
        kind: ready ? 'ready' : 'questions',
        questions: ready ? [] : questions,
        round: request.session.clarificationRound + 1,
        assistantText: cleanMessage(record.assistantText, 500) || (ready ? '信息已足够，可以生成大纲。' : '还需要确认几个方向。')
      }
    } finally {
      this.jobs.delete(request.progressId)
    }
  }

  async generate(request: AiGenerateRequest, onProgress: ProgressCallback): Promise<AiPreview> {
    const { config, apiKey } = await this.resolveModel()
    this.assertConsent(config)
    const signal = this.startJob(request.progressId)
    try {
      const materialContext = await this.prepareMaterialContext(
        request.session.materialIds,
        signal,
        onProgress,
        request.progressId
      )
      onProgress({ progressId: request.progressId, stage: 'generating', message: '正在生成主题大纲…' })
      const scale = {
        concise: '精简：约 10-20 个节点，最好不超过 3 层',
        standard: '标准：约 20-45 个节点，最好不超过 4 层',
        detailed: '详尽：约 45-80 个节点，最好不超过 5 层'
      }[request.session.scale]
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content:
            '你是课程思维导图设计师。请根据用户要求、当前结构和资料摘要生成准确、无重复、层级清晰的中文主题树。所有节点都要有 15-80 字的摘要，不生成 Markdown 详注。只输出 JSON，不要输出代码块或解释。JSON 格式：{"title":"根主题或分支主题","summary":"根主题摘要","children":[{"title":"主题","summary":"摘要","children":[]}]}。'
        },
        {
          role: 'user',
          content: [
            `生成模式：${request.session.mode === 'new' ? '新建完整导图' : '为当前选中节点补充下级分支'}`,
            `规模：${scale}`,
            `要求：\n${this.historyText(request.session)}`,
            request.mapContext ? `当前导图上下文：\n${request.mapContext}` : '',
            materialContext ? `课程资料摘要：\n${materialContext}` : '',
            request.session.mode === 'new'
              ? '请返回完整根主题和主要分支。'
              : '请只返回应挂到当前选中节点下的新增分支；title 可沿用当前节点名称。'
          ]
            .filter(Boolean)
            .join('\n\n')
        }
      ]
      const raw = await this.callJson(messages, apiKey, config, signal)
      return parseAiPreview(raw, request.session.targetNodeId ?? undefined)
    } finally {
      this.jobs.delete(request.progressId)
    }
  }

  private async resolveModel(): Promise<{ config: StoredAiConfig; apiKey: string }> {
    const config = await this.readConfig()
    this.assertModelConfig(config)
    const apiKey = await this.readApiKey()
    if (!apiKey && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(config.baseUrl)) {
      throw new AppError('AI_KEY_MISSING', '尚未配置 API Key')
    }
    this.assertConsent(config)
    return { config, apiKey: apiKey ?? '' }
  }

  private assertModelConfig(config: StoredAiConfig): void {
    if (!config.baseUrl.trim() || !config.model.trim()) throw new AppError('AI_CONFIG_MISSING', '请先配置模型地址和模型名称')
    normalizeBaseUrl(config.baseUrl)
  }

  private assertConsent(config: StoredAiConfig): void {
    if (!config.dataConsent) throw new AppError('AI_CONSENT_REQUIRED', '请先确认允许将选中的资料和导图内容发送给模型服务')
  }

  private async readConfig(): Promise<StoredAiConfig> {
    try {
      const value = await readJson<Partial<StoredAiConfig>>(this.configPath)
      return {
        baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
        model: typeof value.model === 'string' ? value.model : '',
        dataConsent: value.dataConsent === true
      }
    } catch {
      return { baseUrl: '', model: '', dataConsent: false }
    }
  }

  private async readApiKey(): Promise<string | null> {
    if (this.memoryApiKey) return this.memoryApiKey
    if (!safeStorage.isEncryptionAvailable()) return null
    try {
      const credential = await readJson<StoredCredential>(this.credentialPath)
      const decrypted = safeStorage.decryptString(Buffer.from(credential.encryptedApiKey, 'base64'))
      return decrypted || null
    } catch {
      return null
    }
  }

  private async writeApiKey(apiKey: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      this.memoryApiKey = apiKey
      return
    }
    const encryptedApiKey = safeStorage.encryptString(apiKey).toString('base64')
    await atomicWrite(this.credentialPath, JSON.stringify({ encryptedApiKey } satisfies StoredCredential, null, 2))
    this.memoryApiKey = apiKey
  }

  private async clearApiKey(): Promise<void> {
    this.memoryApiKey = null
    await fs.unlink(this.credentialPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }

  private startJob(progressId: string): AbortSignal {
    this.jobs.get(progressId)?.abort()
    const controller = new AbortController()
    this.jobs.set(progressId, controller)
    return controller.signal
  }

  private async callJson(
    messages: ChatMessage[],
    apiKey: string,
    config: StoredAiConfig,
    signal: AbortSignal
  ): Promise<unknown> {
    const content = await this.callModel(messages, apiKey, config, signal)
    try {
      return parseModelJson(content)
    } catch {
      const repair = await this.callModel(
        [
          ...messages,
          { role: 'assistant', content: content.slice(0, 12_000) },
          { role: 'user', content: '上一条回复不是合法 JSON。请只重新输出合法 JSON，保留原有内容，不要解释或使用代码块。' }
        ],
        apiKey,
        config,
        signal
      )
      try {
        return parseModelJson(repair)
      } catch {
        throw new AppError('AI_RESPONSE_INVALID', '模型返回格式不正确，请重试或更换模型')
      }
    }
  }

  private async callModel(
    messages: ChatMessage[],
    apiKey: string,
    config: StoredAiConfig,
    signal: AbortSignal,
    timeoutMs = MODEL_TIMEOUT_MS
  ): Promise<string> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const forwardAbort = () => controller.abort()
    signal.addEventListener('abort', forwardAbort, { once: true })
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`
      const response = await net.fetch(normalizeBaseUrl(config.baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: config.model, messages, stream: false }),
        signal: controller.signal
      })
      const text = await response.text()
      if (!response.ok) this.throwHttpError(response.status, text)
      let data: ChatResponse
      try {
        data = JSON.parse(text) as ChatResponse
      } catch {
        throw new AppError('AI_RESPONSE_INVALID', '模型服务返回的内容不是 JSON')
      }
      return responseContent(data)
    } catch (error) {
      if (error instanceof AppError) throw error
      if (controller.signal.aborted) {
        if (signal.aborted) throw new AppError('AI_CANCELED', '已取消生成')
        throw new AppError('AI_TIMEOUT', '模型请求超时，请稍后重试')
      }
      throw new AppError('AI_NETWORK', `无法连接模型服务：${error instanceof Error ? error.message : '网络错误'}`)
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', forwardAbort)
    }
  }

  private throwHttpError(status: number, detail: string): never {
    const suffix = detail.replace(/\s+/g, ' ').slice(0, 240)
    if (status === 401 || status === 403) throw new AppError('AI_AUTH_FAILED', 'API Key 无效或没有访问权限', suffix)
    if (status === 404) throw new AppError('AI_ENDPOINT_NOT_FOUND', '模型地址或接口路径不存在', suffix)
    if (status === 429) throw new AppError('AI_RATE_LIMITED', '模型服务请求过于频繁，请稍后重试', suffix)
    if (status === 400 && /image_url|vision|multimodal|content.*type/i.test(detail)) {
      throw new AppError('AI_VISION_UNSUPPORTED', '当前模型不支持图片识别，请更换支持视觉输入的模型')
    }
    if (status >= 500) throw new AppError('AI_PROVIDER_ERROR', '模型服务暂时不可用', suffix)
    throw new AppError('AI_REQUEST_FAILED', `模型请求失败（HTTP ${status}）`, suffix)
  }

  private async prepareMaterialContext(
    materialIds: string[],
    signal: AbortSignal,
    onProgress: ProgressCallback,
    progressId: string
  ): Promise<string> {
    const uniqueIds = [...new Set(materialIds)].slice(0, MAX_AI_MATERIALS)
    if (!uniqueIds.length) return ''
    const records = await this.readMaterialIndex()
    const selected = uniqueIds
      .map((id) => records.find((record) => record.id === id))
      .filter((record): record is StoredMaterial => Boolean(record))
    if (selected.length !== uniqueIds.length) throw new AppError('MATERIAL_NOT_FOUND', '部分资料已被删除，请重新选择')

    const sections: string[] = []
    let totalChars = 0
    for (let index = 0; index < selected.length; index += 1) {
      const material = selected[index]!
      const sourcePath = this.materialFilePath(material.storedName)
      const derivedDirectory = this.derivedMaterialDirectory(material.id)
      onProgress({
        progressId,
        stage: material.extension === '.pptx' ? 'rendering' : 'extracting',
        message: material.extension === '.pptx' ? `正在提取公式与几何图：${material.name}` : `正在解析资料：${material.name}`,
        current: index + 1,
        total: selected.length
      })
      const buffer = await fs.readFile(sourcePath)
      const extracted = await extractMaterialContent(buffer, material.name, {
        sourceHash: material.hash,
        sourcePath,
        derivedDirectory,
        renderVisuals: material.extension === '.pptx',
        signal
      })
      let extractedText = extracted.text
      if (extracted.warnings.length) {
        const warnings = extracted.warnings.slice(0, 5).join('；')
        extractedText = `【资料解析警告：${warnings}】\n${extractedText}`
      }
      if (extracted.visuals.length) {
        onProgress({
          progressId,
          stage: 'recognizing',
          message: `正在识别公式与几何图：${material.name}`,
          current: index + 1,
          total: selected.length
        })
        const { config, apiKey } = await this.resolveModel()
        extractedText = await this.recognizeVisuals(
          extractedText,
          extracted.visuals,
          derivedDirectory,
          config,
          apiKey,
          signal,
          onProgress,
          progressId
        )
      }
      totalChars += extractedText.length
      if (totalChars > MAX_TOTAL_MATERIAL_CHARS) throw new AppError('MATERIAL_TEXT_TOO_LARGE', '所选资料文字总量过大，请减少资料数量')
      sections.push(`【资料：${material.name}】\n${extractedText}`)
    }

    const fullText = sections.join('\n\n')
    if (fullText.length <= MATERIAL_CONTEXT_CHARS) return fullText

    const chunks = sections.flatMap((section) => splitText(section, CHUNK_CHARS))
    const { config, apiKey } = await this.resolveModel()
    let summaries: string[] = []
    for (let index = 0; index < chunks.length; index += 1) {
      onProgress({
        progressId,
        stage: 'summarizing',
        message: `正在提炼资料重点：${index + 1}/${chunks.length}`,
        current: index + 1,
        total: chunks.length
      })
      const summary = await this.callModel(
        [
          {
            role: 'system',
            content: `请把课程资料片段压缩为不超过 ${SUMMARY_CHARS} 字的结构化摘要，保留概念、公式、定义、例题和章节关系，不要添加资料中没有的信息。只输出摘要正文。`
          },
          { role: 'user', content: chunks[index]! }
        ],
        apiKey,
        config,
        signal
      )
      summaries.push(summary.slice(0, SUMMARY_CHARS))
    }

    for (let level = 0; summaries.join('\n').length > MATERIAL_CONTEXT_CHARS && level < 3; level += 1) {
      const groups: string[] = []
      let current = ''
      for (const summary of summaries) {
        if (current && current.length + summary.length > CHUNK_CHARS) {
          groups.push(current)
          current = ''
        }
        current += `${current ? '\n' : ''}${summary}`
      }
      if (current) groups.push(current)
      const reduced: string[] = []
      for (let index = 0; index < groups.length; index += 1) {
        onProgress({
          progressId,
          stage: 'summarizing',
          message: `正在汇总资料重点：${index + 1}/${groups.length}`,
          current: index + 1,
          total: groups.length
        })
        const summary = await this.callModel(
          [
            { role: 'system', content: '请合并以下课程资料摘要，去重并保留完整知识结构，不超过 4000 字。只输出摘要正文。' },
            { role: 'user', content: groups[index]! }
          ],
          apiKey,
          config,
          signal
        )
        reduced.push(summary.slice(0, 4_000))
      }
      summaries = reduced
    }
    const result = summaries.join('\n\n')
    if (result.length > MATERIAL_CONTEXT_CHARS) {
      throw new AppError('MATERIAL_CONTEXT_TOO_LARGE', '资料压缩后仍超过模型上下文，请减少资料数量')
    }
    return result
  }

  private async recognizeVisuals(
    text: string,
    visuals: MaterialVisualDescriptor[],
    derivedDirectory: string,
    config: StoredAiConfig,
    apiKey: string,
    signal: AbortSignal,
    onProgress: ProgressCallback,
    progressId: string
  ): Promise<string> {
    const renderable = visuals.filter(
      (visual): visual is MaterialVisualDescriptor & { pngPath: string; pngSha256: string } =>
        Boolean(visual.pngPath && visual.pngSha256)
    )
    if (!renderable.length) return applyVisualCaptions(text, visuals, {})

    const cachePath = path.join(derivedDirectory, 'vision-cache.json')
    const cache = await this.readVisionCache(cachePath)
    const pendingByKey = new Map<string, MaterialVisualDescriptor & { pngPath: string; pngSha256: string }>()
    for (const visual of renderable) {
      const key = visionCacheKey(visual.pngSha256, config.model)
      if (!cache[key] && !pendingByKey.has(key)) pendingByKey.set(key, visual)
    }

    const pending = [...pendingByKey.values()]
    let failedBatches = 0
    for (let start = 0; start < pending.length; start += 4) {
      if (signal.aborted) throw new AppError('AI_CANCELED', '已取消生成')
      const batch = pending.slice(start, start + 4)
      onProgress({
        progressId,
        stage: 'recognizing',
        message: `正在识别公式与几何图：${Math.min(start + 4, pending.length)}/${pending.length}`,
        current: Math.min(start + 4, pending.length),
        total: pending.length
      })
      try {
        const content: ChatContentPart[] = [{ type: 'text', text: buildVisionPrompt(batch) }]
        for (const visual of batch) {
          const buffer = await fs.readFile(visual.pngPath)
          content.push({
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${buffer.toString('base64')}`,
              detail: 'high'
            }
          })
        }
        const response = await this.callModel([{ role: 'user', content }], apiKey, config, signal)
        const parsed = parseVisionResponse(response, batch)
        if (!Object.keys(parsed).length) {
          failedBatches += 1
          continue
        }
        for (const visual of batch) {
          const caption = parsed[visual.id]
          if (!caption) continue
          cache[visionCacheKey(visual.pngSha256, config.model)] = caption
        }
        await this.writeVisionCache(cachePath, cache)
      } catch (error) {
        if (error instanceof AppError && error.code === 'AI_CANCELED') throw error
        failedBatches += 1
        if (
          error instanceof AppError &&
          ['AI_VISION_UNSUPPORTED', 'AI_AUTH_FAILED', 'AI_CONFIG_MISSING', 'AI_CONSENT_REQUIRED', 'AI_NETWORK', 'AI_TIMEOUT', 'AI_RATE_LIMITED', 'AI_REQUEST_FAILED', 'AI_PROVIDER_ERROR'].includes(
            error.code
          )
        ) {
          break
        }
      }
    }

    const captions: VisionCaptionMap = {}
    for (const visual of renderable) {
      const caption = cache[visionCacheKey(visual.pngSha256, config.model)]
      if (caption) captions[visual.id] = caption
    }
    const result = applyVisualCaptions(text, visuals, captions)
    return failedBatches
      ? `【部分 WMF/EMF 视觉识别未完成，已保留原图与占位说明】\n${result}`
      : result
  }

  private async readVisionCache(cachePath: string): Promise<VisionCaptionMap> {
    try {
      const raw = await readJson<unknown>(cachePath)
      if (!raw || typeof raw !== 'object') return {}
      const result: VisionCaptionMap = {}
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!value || typeof value !== 'object') continue
        const record = value as Record<string, unknown>
        if (
          record.kind !== 'formula' &&
          record.kind !== 'diagram' &&
          record.kind !== 'unknown'
        ) {
          continue
        }
        result[key] = {
          kind: record.kind,
          latex: typeof record.latex === 'string' ? record.latex : '',
          markdown: typeof record.markdown === 'string' ? record.markdown : '',
          confidence: typeof record.confidence === 'number' ? record.confidence : 0
        }
      }
      return result
    } catch {
      return {}
    }
  }

  private async writeVisionCache(cachePath: string, cache: VisionCaptionMap): Promise<void> {
    await atomicWrite(cachePath, JSON.stringify(cache, null, 2))
  }

  private historyText(session: AiSession): string {
    return session.messages
      .filter((message) => message.kind !== 'preview')
      .slice(-12)
      .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`)
      .filter((line) => !line.endsWith('：'))
      .join('\n')
  }

  private async readMaterialIndex(): Promise<StoredMaterial[]> {
    try {
      const value = await readJson<unknown>(this.materialIndexPath())
      if (!Array.isArray(value)) return []
      return value.filter((item): item is StoredMaterial => {
        if (!item || typeof item !== 'object') return false
        const record = item as Partial<StoredMaterial>
        return (
          typeof record.id === 'string' &&
          typeof record.name === 'string' &&
          typeof record.extension === 'string' &&
          typeof record.size === 'number' &&
          typeof record.importedAt === 'string' &&
          typeof record.hash === 'string' &&
          typeof record.storedName === 'string'
        )
      })
    } catch {
      return []
    }
  }

  private async writeMaterialIndex(records: StoredMaterial[]): Promise<void> {
    await atomicWrite(this.materialIndexPath(), JSON.stringify(records, null, 2))
  }

  private toMaterialSummary(record: StoredMaterial): MaterialSummary {
    return {
      id: record.id,
      name: record.name,
      extension: record.extension,
      size: record.size,
      importedAt: record.importedAt
    }
  }

  private workspacePath(): string {
    if (!this.workspace.activePath) throw new AppError('NO_WORKSPACE', '尚未打开工作区')
    return this.workspace.activePath
  }

  private materialIndexPath(): string {
    return path.join(this.workspacePath(), 'materials', 'index.json')
  }

  private materialFilePath(storedName: string): string {
    if (path.basename(storedName) !== storedName) throw new AppError('INVALID_PATH', '资料路径无效')
    return path.join(this.workspacePath(), 'materials', 'files', storedName)
  }

  private derivedMaterialDirectory(materialId: string): string {
    return path.join(this.workspacePath(), 'materials', 'derived', safeId(materialId))
  }

  private sessionPath(mapId: string | null, draftId: string | null): string {
    if (mapId) return path.join(this.workspacePath(), 'maps', `${safeId(mapId)}.ai-session.json`)
    if (draftId) return path.join(this.workspacePath(), '.ai', 'drafts', `${safeId(draftId)}.json`)
    throw new AppError('AI_SESSION_INVALID', 'AI 会话缺少归属')
  }
}
