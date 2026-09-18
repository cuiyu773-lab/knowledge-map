export const SCHEMA_VERSION = 1

export type ThemeMode = 'light' | 'dark'
export type ExportFormat = 'png' | 'svg' | 'pdf'
export type WindowCommand =
  | 'minimize'
  | 'toggle-maximize'
  | 'close'
  | 'reload'
  | 'toggle-full-screen'
  | 'zoom-in'
  | 'zoom-out'
  | 'reset-zoom'
  | 'toggle-devtools'
  | 'edit-undo'
  | 'edit-redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'select-all'
export type ExportQuality = 'standard' | 'high' | 'ultra'
export const DEFAULT_EXPORT_QUALITY: ExportQuality = 'high'
export type NodeColor = 'oat' | 'moss' | 'clay' | 'terracotta' | 'river' | 'plum' | 'ink'
export type NodeShape = 'rounded' | 'pill' | 'rect' | 'underline'
export type LineStyle = 'solid' | 'dashed' | 'dotted'
export type PanelVisibility = { outline: boolean; inspector: boolean }

export interface ManualOffset {
  x: number
  y: number
}

export interface NodeStyle {
  color: NodeColor
  shape: NodeShape
  fontScale: number
  lineStyle: LineStyle
}

export interface MindNode {
  id: string
  parentId: string | null
  order: number
  title: string
  summary: string
  detailMarkdown: string
  style: NodeStyle
  collapsed: boolean
  manualOffset: ManualOffset
}

export interface ViewportState {
  x: number
  y: number
  zoom: number
}

export interface MindMapDocument {
  schemaVersion: number
  id: string
  title: string
  createdAt: string
  updatedAt: string
  rootId: string
  nodes: Record<string, MindNode>
  viewport: ViewportState
}

export interface WorkspaceMeta {
  schemaVersion: number
  id: string
  name: string
  createdAt: string
  updatedAt: string
  mapOrder: string[]
}

export interface MapSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  fileName: string
  nodeCount: number
}

export interface WorkspaceDescriptor {
  path: string
  meta: WorkspaceMeta
  maps: MapSummary[]
}

export interface RecentWorkspace {
  path: string
  name: string
  lastOpenedAt: string
}

export interface MapReadResult {
  document: MindMapDocument
  hash: string
  readOnly: boolean
  warning?: string
}

export interface SnapshotSummary {
  fileName: string
  createdAt: string
  size: number
}

export interface ExportRequest {
  format: ExportFormat
  data: string
  defaultName: string
}

export interface ApiError {
  code: string
  message: string
  detail?: string
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError }

export interface SearchHit {
  mapId: string
  mapTitle: string
  nodeId: string
  nodeTitle: string
  snippet: string
}

export interface OutlineRow {
  node: MindNode
  depth: number
  hasChildren: boolean
  selected: boolean
  onPath: boolean
}

export interface ConflictState {
  type: 'external-change'
  diskHash: string
}

export interface AppSettings {
  theme: ThemeMode
  panels: PanelVisibility
  exportQuality: ExportQuality
  lastWorkspacePath?: string
}

export type AiMode = 'new' | 'extend'
export type AiScale = 'concise' | 'standard' | 'detailed'
export type AiPreviewStrategy = 'append' | 'replace' | 'merge'

export interface AiQuestion {
  id: string
  question: string
  options?: string[]
}

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  kind: 'text' | 'questions' | 'preview'
  content: string
  questions?: AiQuestion[]
  createdAt: string
}

export interface AiPreviewNode {
  id: string
  title: string
  summary: string
  included: boolean
  children: AiPreviewNode[]
}

export interface AiPreview {
  title: string
  summary: string
  children: AiPreviewNode[]
  targetNodeId?: string
  createdAt: string
}

export interface AiSession {
  schemaVersion: 1
  mapId: string | null
  draftId: string | null
  targetNodeId: string | null
  mode: AiMode
  scale: AiScale
  includeFullMap: boolean
  materialIds: string[]
  messages: AiMessage[]
  pendingQuestions: AiQuestion[]
  clarificationRound: number
  pendingPreview: AiPreview | null
  updatedAt: string
}

export interface AiPublicConfig {
  baseUrl: string
  model: string
  hasApiKey: boolean
  dataConsent: boolean
}

export interface AiConfigInput {
  baseUrl: string
  model: string
  apiKey?: string
  clearApiKey?: boolean
  dataConsent: boolean
}

export interface AiQuestionAnswer {
  id: string
  answer: string
}

export interface AiConsultRequest {
  session: AiSession
  prompt: string
  answers: AiQuestionAnswer[]
  mapContext: string
  progressId: string
}

export interface AiConsultResult {
  kind: 'questions' | 'ready'
  questions: AiQuestion[]
  round: number
  assistantText: string
}

export interface AiGenerateRequest {
  session: AiSession
  mapContext: string
  progressId: string
}

export interface AiProgress {
  progressId: string
  stage: 'extracting' | 'rendering' | 'recognizing' | 'summarizing' | 'thinking' | 'generating'
  message: string
  current?: number
  total?: number
}

export interface MaterialSummary {
  id: string
  name: string
  extension: string
  size: number
  importedAt: string
}
