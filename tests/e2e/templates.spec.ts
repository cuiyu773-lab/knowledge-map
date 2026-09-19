import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('可从内置模板创建导图并保存个人模板', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'zhitu-template-e2e-'))
  const userData = path.join(root, 'user-data')
  const localAppData = path.join(root, 'local-app-data')
  const appData = path.join(root, 'app-data')
  const workspace = path.join(root, '模板测试工作区')
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
    writeFile(path.join(workspace, 'workspace.json'), JSON.stringify({ schemaVersion: 1, id: 'workspace-template-e2e', name: '模板测试工作区', createdAt: now, updatedAt: now, mapOrder: [] }, null, 2)),
    writeFile(path.join(userData, 'recent-workspaces.json'), JSON.stringify([{ path: workspace, name: '模板测试工作区', lastOpenedAt: now }], null, 2)),
    writeFile(path.join(userData, 'settings.json'), JSON.stringify({ theme: 'light', panels: { outline: true, inspector: true }, exportQuality: 'high' }, null, 2))
  ])

  const app = await electron.launch({
    args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-sandbox', '--disable-software-rasterizer', '.'],
    env: { ...process.env, ZHITU_USER_DATA: userData, LOCALAPPDATA: localAppData, APPDATA: appData }
  })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button').filter({ hasText: '模板测试工作区' }).click()
    await expect(page.getByLabel('大纲编辑')).toBeVisible({ timeout: 15_000 })
    await page.locator('.map-switcher').click()
    await page.getByRole('menuitem', { name: /新建导图/ }).click()
    await expect(page.getByRole('dialog', { name: '选择新导图模板' })).toBeVisible()
    await page.getByRole('button', { name: /课程知识框架/ }).first().click()
    await page.getByRole('button', { name: '使用「课程知识框架」' }).click()
    await expect(page.getByLabel('导图标题')).toHaveValue('课程知识框架')
    await expect(page.getByLabel('大纲编辑').getByText('核心概念', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '文件' }).click()
    await page.getByRole('menuitem', { name: '保存整张导图为模板…' }).click()
    await expect(page.getByRole('dialog', { name: '保存为模板' })).toBeVisible()
    await page.getByLabel('模板名称').fill('我的课程框架')
    await page.getByRole('button', { name: '保存模板' }).click()
    await expect(page.getByText('模板已保存')).toBeVisible()
    await page.getByRole('button', { name: '文件' }).click()
    await page.getByRole('menuitem', { name: '模板与预设…' }).click()
    await expect(page.getByRole('dialog', { name: '模板与样式预设' })).toBeVisible()
    await expect(page.getByText('我的课程框架')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '模板与样式预设' })).toBeHidden()
    await page.keyboard.press('Control+S')
    await expect(page.getByText('本地文件已同步')).toBeVisible()
  } finally {
    await app.close()
  }
})
