export const SCHEMA_VERSION = 1

export type ThemeMode = 'light' | 'dark'
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
  format: 'png' | 'svg' | 'pdf'
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
  lastWorkspacePath?: string
}
