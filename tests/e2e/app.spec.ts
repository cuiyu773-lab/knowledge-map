import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('可启动、打开工作区、编辑节点并自动保存', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'zhitu-e2e-'))
  const userData = path.join(root, 'user-data')
  const workspace = path.join(root, '学习工作区')
  await Promise.all([
    mkdir(path.join(workspace, 'maps'), { recursive: true }),
    mkdir(path.join(workspace, 'assets'), { recursive: true }),
    mkdir(path.join(workspace, '.history'), { recursive: true }),
    mkdir(userData, { recursive: true })
  ])
  const now = new Date().toISOString()
  await writeFile(
    path.join(workspace, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: 'workspace-e2e',
      name: '端到端测试',
      createdAt: now,
      updatedAt: now,
      mapOrder: []
    }, null, 2)
  )

  await writeFile(
    path.join(userData, 'recent-workspaces.json'),
    JSON.stringify([{ path: workspace, name: '端到端测试', lastOpenedAt: now }], null, 2)
  )
  await writeFile(
    path.join(userData, 'settings.json'),
    JSON.stringify({ theme: 'light', panels: { outline: true, inspector: true }, lastWorkspacePath: workspace }, null, 2)
  )

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, ZHITU_USER_DATA: userData }
  })
  const page = await app.firstWindow()
  await expect(page.getByText('把知识画成', { exact: false })).toBeVisible()

  await page.getByRole('button').filter({ hasText: '端到端测试' }).click()
  await expect(page.getByText('端到端测试')).toBeVisible()
  await expect(page.getByLabel('大纲编辑')).toBeVisible()

  await page.getByRole('button', { name: '添加根节点的子主题' }).click()
  const titleInput = page.locator('.outline-title-input')
  await expect(titleInput).toBeVisible()
  await titleInput.fill('快速排序')
  await titleInput.press('Enter')
  await expect(page.getByLabel('大纲编辑').getByText('快速排序', { exact: true })).toBeVisible()

  await page.screenshot({ path: 'test-results/zhitu-workspace.png' })
  await page.getByTitle('切换到深色').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: 'test-results/zhitu-workspace-dark.png' })

  const exports = [
    { format: 'png', label: 'PNG 图片', file: path.join(root, '导图.png') },
    { format: 'svg', label: 'SVG 矢量图', file: path.join(root, '导图.svg') },
    { format: 'pdf', label: 'PDF 文档', file: path.join(root, '导图.pdf') }
  ]
  for (const item of exports) {
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, item.file)
    await page.getByRole('button', { name: /导出/ }).click()
    await page.getByRole('menuitem', { name: item.label }).click()
    await expect.poll(async () => {
      try {
        return (await stat(item.file)).size
      } catch {
        return 0
      }
    }, { timeout: 20_000 }).toBeGreaterThan(100)
  }

  await page.waitForTimeout(1300)
  const mapFiles = (await readdir(path.join(workspace, 'maps'))).filter((file) => file.endsWith('.mindmap.json'))
  expect(mapFiles).toHaveLength(1)
  const saved = JSON.parse(await readFile(path.join(workspace, 'maps', mapFiles[0]!), 'utf8'))
  expect(Object.values(saved.nodes).some((node: any) => node.title === '快速排序')).toBe(true)

  await app.close()
})






