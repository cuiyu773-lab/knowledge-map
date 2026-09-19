import { createMindMapDocument, createNode, DEFAULT_NODE_STYLE } from './schema'
import { createTemplateSnapshot } from './templates'
import type {
  MindMapDocument,
  MindMapTemplate,
  NodeStyle,
  StylePreset,
  TemplateCategory,
  TemplateNodeBehavior
} from './types'

interface BuiltinBranch {
  key: string
  title: string
  summary?: string
  behavior?: TemplateNodeBehavior
  children?: BuiltinBranch[]
}

const BUILTIN_SPECS: Array<{
  id: string
  name: string
  description: string
  category: TemplateCategory
  rootTitle: string
  branches: BuiltinBranch[]
}> = [
  {
    id: 'builtin-course-framework',
    name: '课程知识框架',
    description: '按概念、原理、例题、易错点和复习清单组织一门课程。',
    category: 'course',
    rootTitle: '课程知识框架',
    branches: [
      { key: 'concepts', title: '核心概念' },
      { key: 'principles', title: '原理与推导' },
      { key: 'examples', title: '典型例题' },
      { key: 'mistakes', title: '易错点' },
      { key: 'review', title: '复习清单', behavior: 'optional' }
    ]
  },
  {
    id: 'builtin-chapter-notes',
    name: '章节学习笔记',
    description: '整理单章学习目标、概念、公式、例题、疑问和总结。',
    category: 'course',
    rootTitle: '章节学习笔记',
    branches: [
      { key: 'goals', title: '学习目标' },
      { key: 'concepts', title: '核心概念' },
      { key: 'formulas', title: '公式与推导' },
      { key: 'examples', title: '例题与应用' },
      { key: 'questions', title: '疑问与待查' },
      { key: 'summary', title: '本章总结' }
    ]
  },
  {
    id: 'builtin-reading-notes',
    name: '阅读笔记',
    description: '围绕论点、概念、论据、质疑、引用和行动整理阅读内容。',
    category: 'reading',
    rootTitle: '阅读笔记',
    branches: [
      { key: 'thesis', title: '核心论点' },
      { key: 'concepts', title: '关键概念' },
      { key: 'evidence', title: '论据与材料' },
      { key: 'questions', title: '我的质疑' },
      { key: 'quotes', title: '重要引用' },
      { key: 'actions', title: '行动与延伸', behavior: 'optional' }
    ]
  },
  {
    id: 'builtin-problem-analysis',
    name: '问题分析',
    description: '从现象、目标、约束、原因、方案到验证和复盘完整拆解问题。',
    category: 'analysis',
    rootTitle: '问题分析',
    branches: [
      { key: 'phenomenon', title: '现象与目标' },
      { key: 'constraints', title: '约束条件' },
      { key: 'causes', title: '原因假设' },
      { key: 'solutions', title: '解决路径' },
      { key: 'verification', title: '验证方案' },
      { key: 'retrospective', title: '复盘', behavior: 'optional' }
    ]
  },
  {
    id: 'builtin-review-plan',
    name: '复习计划',
    description: '按知识清单、优先级、时间安排、练习、错题和复盘制定复习计划。',
    category: 'review',
    rootTitle: '复习计划',
    branches: [
      { key: 'checklist', title: '知识清单' },
      { key: 'priority', title: '优先级' },
      { key: 'schedule', title: '时间安排' },
      { key: 'practice', title: '练习任务' },
      { key: 'mistakes', title: '错题与薄弱点' },
      { key: 'retrospective', title: '阶段复盘', behavior: 'optional' }
    ]
  },
  {
    id: 'builtin-research-framework',
    name: '研究与论文框架',
    description: '组织研究问题、背景、方法、数据、结果、讨论和参考文献。',
    category: 'research',
    rootTitle: '研究与论文框架',
    branches: [
      { key: 'question', title: '研究问题' },
      { key: 'background', title: '背景与现状' },
      { key: 'method', title: '方法与设计' },
      { key: 'data', title: '数据与材料' },
      { key: 'results', title: '结果' },
      { key: 'discussion', title: '讨论' },
      { key: 'references', title: '参考文献', behavior: 'optional' }
    ]
  }
]

function addBranches(document: MindMapDocument, parentId: string, branches: BuiltinBranch[]): MindMapDocument {
  let next = document
  branches.forEach((branch, index) => {
    const child = createNode(branch.key, parentId, index, branch.title)
    child.summary = branch.summary ?? ''
    next = { ...next, nodes: { ...next.nodes, [child.id]: child } }
    if (branch.children?.length) next = addBranches(next, child.id, branch.children)
  })
  return next
}

function buildBuiltinTemplate(spec: typeof BUILTIN_SPECS[number]): MindMapTemplate {
  const rootId = 'root'
  let document = createMindMapDocument(spec.id, rootId, spec.rootTitle, '2026-01-01T00:00:00.000Z')
  document = addBranches(document, rootId, spec.branches)
  const behaviors: Record<string, TemplateNodeBehavior> = {}
  const applyBehaviors = (branches: BuiltinBranch[]) => {
    branches.forEach((branch) => {
      behaviors[branch.key] = branch.behavior ?? 'expandable'
      if (branch.children) applyBehaviors(branch.children)
    })
  }
  applyBehaviors(spec.branches)
  return createTemplateSnapshot({
    id: spec.id,
    name: spec.name,
    description: spec.description,
    category: spec.category,
    source: 'builtin',
    document,
    rootNodeId: rootId,
    behaviors,
    assets: {},
    aiRecommendationEnabled: true,
    now: '2026-01-01T00:00:00.000Z'
  })
}

export const BUILTIN_TEMPLATES: MindMapTemplate[] = BUILTIN_SPECS.map(buildBuiltinTemplate)

function preset(id: string, name: string, style: Partial<NodeStyle>): StylePreset {
  return {
    schemaVersion: 1,
    id,
    name,
    source: 'builtin',
    style: { ...DEFAULT_NODE_STYLE, ...style },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

export const BUILTIN_STYLE_PRESETS: StylePreset[] = [
  preset('builtin-preset-paper', '纸本层级', { color: 'oat', shape: 'rounded', fontScale: 1, lineStyle: 'solid' }),
  preset('builtin-preset-moss', '苔绿脉络', { color: 'moss', shape: 'rounded', fontScale: 1, lineStyle: 'solid' }),
  preset('builtin-preset-river', '河蓝重点', { color: 'river', shape: 'pill', fontScale: 1.05, lineStyle: 'solid' }),
  preset('builtin-preset-ink', '墨黑极简', { color: 'ink', shape: 'underline', fontScale: 0.95, lineStyle: 'dotted' })
]