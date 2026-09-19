import { _electron as electron, expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('AI 可按模板推荐生成并保留骨架样式', async () => {
  let consultBody = ''
  let generationBody = ''
  const privateName = '私人模板机密'
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += String(chunk) })
    request.on('end', () => {
      const payload = JSON.parse(body) as { messages?: Array<{ role: string; content: string }> }
      const allText = (payload.messages ?? []).map((message) => message.content).join('\n')
      let content: string
      if (allText.includes('课程思维导图设计师')) {
        generationBody = allText
        content = JSON.stringify({ title: '课程知识框架', summary: '数据结构课程导图', children: [
          { templateKey: 'concepts', title: '被篡改', summary: '核心概念摘要', detailMarkdown: '核心概念详注', children: [{ title: '数据结构基础', summary: '基础概念', detailMarkdown: '基础详注' }] },
          { templateKey: 'principles', title: '原理与推导', summary: '原理摘要', detailMarkdown: '原理详注', children: [] },
          { templateKey: 'examples', title: '典型例题', summary: '例题摘要', detailMarkdown: '例题详注', children: [] },
          { templateKey: 'mistakes', title: '易错点', summary: '易错摘要', detailMarkdown: '易错详注', children: [] }
        ] })
      } else {
        consultBody = allText
        content = JSON.stringify({ ready: true, assistantText: '已找到合适模板。', questions: [], templateIds: ['builtin-course-framework'] })
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content } }] }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('模拟服务启动失败')
  const root = await mkdtemp(path.join(tmpdir(), 'zhitu-ai-template-e2e-'))
  const userData = path.join(root, 'user-data')
  const localAppData = path.join(root, 'local-app-data')
  const appData = path.join(root, 'app-data')
  const workspace = path.join(root, 'AI 模板工作区')
  const now = new Date().toISOString()
  await Promise.all([
    mkdir(path.join(workspace, 'maps'), { recursive: true }), mkdir(path.join(workspace, 'assets'), { recursive: true }),
    mkdir(path.join(workspace, '.history'), { recursive: true }), mkdir(userData, { recursive: true }),
    mkdir(localAppData, { recursive: true }), mkdir(appData, { recursive: true }),
    mkdir(path.join(userData, 'templates', 'private-template'), { recursive: true })
  ])
  await Promise.all([
    writeFile(path.join(workspace, 'workspace.json'), JSON.stringify({ schemaVersion: 1, id: 'ai-template-workspace', name: 'AI 模板工作区', createdAt: now, updatedAt: now, mapOrder: [] }, null, 2)),
    writeFile(path.join(userData, 'recent-workspaces.json'), JSON.stringify([{ path: workspace, name: 'AI 模板工作区', lastOpenedAt: now }], null, 2)),
    writeFile(path.join(userData, 'settings.json'), JSON.stringify({ theme: 'light', panels: { outline: true, inspector: true } }, null, 2)),
    writeFile(path.join(userData, 'templates', 'private-template', 'template.json'), JSON.stringify({ schemaVersion: 1, id: 'private-template', name: privateName, description: '不应发送给模型', category: 'other', kind: 'map', source: 'user', createdAt: now, updatedAt: now, revision: 'private', title: privateName, rootKey: 'root', nodes: { root: { key: 'root', parentKey: null, order: 0, title: privateName, summary: '', detailMarkdown: '', style: { color: 'oat', shape: 'rounded', fontScale: 1, lineStyle: 'solid' }, collapsed: false, manualOffset: { x: 0, y: 0 }, aiBehavior: 'fixed' } }, assets: {}, viewport: { x: 0, y: 0, zoom: 1 }, variables: [], aiRecommendationEnabled: false }, null, 2))
  ])
  const app = await electron.launch({ args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-sandbox', '--disable-software-rasterizer', '.'], env: { ...process.env, ZHITU_USER_DATA: userData, LOCALAPPDATA: localAppData, APPDATA: appData } })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button').filter({ hasText: 'AI 模板工作区' }).click()
    await expect(page.getByLabel('大纲编辑')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'AI 制作' }).click()
    await page.getByRole('button', { name: '去配置' }).click()
    await page.getByLabel('Base URL').fill(`http://127.0.0.1:${address.port}/v1`)
    await page.getByLabel('模型名称').fill('mock-model')
    await page.getByLabel('API Key').fill('test-key')
    await page.getByRole('checkbox', { name: /允许发送所选内容/ }).check()
    await page.getByRole('button', { name: '保存配置' }).click()
    await page.locator('.ai-mode-switch').getByRole('button', { name: '新建导图' }).click()
    await page.getByPlaceholder(/整理数据结构课程/).fill('整理数据结构课程')
    await page.getByTitle('发送 Ctrl+Enter').click()
    await expect(page.getByRole('button', { name: /课程知识框架/ })).toBeVisible()
    await page.getByRole('button', { name: /课程知识框架/ }).click()
    await expect(page.getByText('模板：课程知识框架')).toBeVisible()
    await page.getByRole('button', { name: '直接生成' }).click()
    await expect(page.locator('.ai-preview-root input')).toHaveValue('课程知识框架')
    await expect(page.locator('.ai-preview-root input')).toBeDisabled()
    await expect(page.locator('.ai-preview-title').first()).toHaveValue('核心概念')
    await expect(page.locator('.ai-preview-detail').first()).toHaveValue('核心概念详注')
    await page.getByRole('button', { name: '创建新导图' }).click()
    await expect(page.getByLabel('大纲编辑').getByText('数据结构基础', { exact: true })).toBeVisible()
    expect(consultBody).toContain('候选模板')
    expect(consultBody).not.toContain(privateName)
    expect(generationBody).toContain('模板骨架')
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
