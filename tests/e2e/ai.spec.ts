import { _electron as electron, expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('可完成 AI 追问、生成预览并创建新导图', async () => {
  let receivedAuthorization = ''
  const server = createServer((request, response) => {
    receivedAuthorization = request.headers.authorization ?? ''
    let body = ''
    request.on('data', (chunk) => { body += String(chunk) })
    request.on('end', () => {
      const payload = JSON.parse(body) as { messages?: Array<{ role: string; content: string }> }
      const allText = (payload.messages ?? []).map((message) => message.content).join('\n')
      let content: string
      if (allText.includes('课程思维导图设计师')) {
        content = JSON.stringify({
          title: 'AI 测试导图',
          summary: '用于端到端测试的导图',
          children: [
            { title: '第一部分', summary: '第一部分摘要', children: [{ title: '知识点', summary: '知识点摘要' }] },
            { title: '第二部分', summary: '第二部分摘要', children: [] }
          ]
        })
      } else if (allText.includes('本轮回答')) {
        content = JSON.stringify({ ready: true, assistantText: '信息已足够，可以直接生成大纲。', questions: [] })
      } else {
        content = JSON.stringify({
          ready: false,
          assistantText: '还需要确认目标。',
          questions: [{ id: 'q1', question: '面向考试还是理解？', options: ['考试', '理解'] }]
        })
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content } }] }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('模拟服务启动失败')

  const root = await mkdtemp(path.join(tmpdir(), 'zhitu-ai-e2e-'))
  const userData = path.join(root, 'user-data')
  const localAppData = path.join(root, 'local-app-data')
  const appData = path.join(root, 'app-data')
  const workspace = path.join(root, '学习工作区')
  await Promise.all([
    mkdir(path.join(workspace, 'maps'), { recursive: true }),
    mkdir(path.join(workspace, 'assets'), { recursive: true }),
    mkdir(path.join(workspace, '.history'), { recursive: true }),
    mkdir(userData, { recursive: true }),
    mkdir(localAppData, { recursive: true }),
    mkdir(appData, { recursive: true })
  ])
  const now = new Date().toISOString()
  await Promise.all([
    writeFile(
      path.join(workspace, 'workspace.json'),
      JSON.stringify({ schemaVersion: 1, id: 'workspace-ai-e2e', name: 'AI 测试工作区', createdAt: now, updatedAt: now, mapOrder: [] }, null, 2)
    ),
    writeFile(
      path.join(userData, 'recent-workspaces.json'),
      JSON.stringify([{ path: workspace, name: 'AI 测试工作区', lastOpenedAt: now }], null, 2)
    ),
    writeFile(
      path.join(userData, 'settings.json'),
      JSON.stringify({ theme: 'light', panels: { outline: true, inspector: true } }, null, 2)
    )
  ])

  const app = await electron.launch({
    args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-sandbox', '--disable-software-rasterizer', '.'],
    env: { ...process.env, ZHITU_USER_DATA: userData, LOCALAPPDATA: localAppData, APPDATA: appData }
  })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button').filter({ hasText: 'AI 测试工作区' }).click()
    await expect(page.getByRole('button', { name: 'AI 制作' })).toBeVisible()
    await page.getByRole('button', { name: 'AI 制作' }).click()
    await page.getByRole('button', { name: '去配置' }).click()
    await page.getByLabel('Base URL').fill(`http://127.0.0.1:${address.port}/v1`)
    await page.getByLabel('模型名称').fill('mock-model')
    await page.getByLabel('API Key').fill('test-secret-key')
    await page.getByRole('checkbox', { name: /允许发送所选内容/ }).check()
    await page.getByRole('button', { name: '保存配置' }).click()

    await page.getByRole('button', { name: '新建导图', exact: true }).click()
    await page.getByPlaceholder(/整理数据结构课程/).fill('整理数据结构课程')
    await page.getByTitle('发送 Ctrl+Enter').click()
    await expect(page.getByText('面向考试还是理解？')).toBeVisible()
    await page.getByRole('button', { name: '考试', exact: true }).click()
    await page.getByRole('button', { name: '提交回答' }).click()
    await expect(page.getByText('信息已足够，可以直接生成大纲。')).toBeVisible()
    await page.getByRole('button', { name: '直接生成' }).click()
    await expect(page.getByLabel('根主题', { exact: true })).toHaveValue('AI 测试导图')
    await expect(page.locator('.ai-preview-title').first()).toHaveValue('第一部分')
    await page.screenshot({ path: 'test-results/zhitu-ai-drawer.png' })
    await page.getByRole('button', { name: '创建新导图' }).click()
    await expect(page.getByLabel('导图标题')).toHaveValue('AI 测试导图')

    await expect.poll(async () => (await readdir(path.join(workspace, 'maps'))).filter((name) => name.endsWith('.mindmap.json')).length).toBe(2)
    await expect.poll(async () => (await readdir(path.join(workspace, 'maps'))).filter((name) => name.endsWith('.ai-session.json')).length).toBe(2)
    expect(receivedAuthorization).toBe('Bearer test-secret-key')
    const credentialText = await readFile(path.join(userData, 'ai-credentials.json'), 'utf8').catch(() => '')
    expect(credentialText).not.toContain('test-secret-key')
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
