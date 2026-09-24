import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'

async function stubSaveDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
  }, filePath)
}

async function stubOpenDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
  }, filePath)
}

async function openFileMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: '文件' }).click()
}

test('可导出工程包、导入为副本、覆盖导入并拒绝损坏包', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'zhitu-package-e2e-'))
  const userData = path.join(root, 'user-data')
  const localAppData = path.join(root, 'local-app-data')
  const appData = path.join(root, 'app-data')
  const workspace = path.join(root, '工程包测试工作区')
  const packageFile = path.join(root, '我的学习导图.zmap')
  const brokenFile = path.join(root, '损坏包.zmap')
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
      JSON.stringify({ schemaVersion: 1, id: 'workspace-package-e2e', name: '工程包测试工作区', createdAt: now, updatedAt: now, mapOrder: [] }, null, 2)
    ),
    writeFile(
      path.join(userData, 'recent-workspaces.json'),
      JSON.stringify([{ path: workspace, name: '工程包测试工作区', lastOpenedAt: now }], null, 2)
    ),
    writeFile(path.join(userData, 'settings.json'), JSON.stringify({ theme: 'light', panels: { outline: true, inspector: true }, exportQuality: 'high' }, null, 2)),
    writeFile(brokenFile, '这不是一个 zip 工程包')
  ])

  const app = await electron.launch({
    args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-sandbox', '--disable-software-rasterizer', '.'],
    env: { ...process.env, ZHITU_USER_DATA: userData, LOCALAPPDATA: localAppData, APPDATA: appData }
  })

  try {
    const page = await app.firstWindow()
    await page.getByRole('button').filter({ hasText: '工程包测试工作区' }).click()
    await expect(page.getByLabel('大纲编辑')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: '添加根节点的子主题' }).click()
    const titleInput = page.locator('.outline-title-input')
    await titleInput.fill('工程包节点')
    await titleInput.press('Enter')
    await page.keyboard.press('Control+S')
    await expect(page.getByText('本地文件已同步')).toBeVisible()

    // 导出工程包，并校验包结构与清单
    await stubSaveDialog(app, packageFile)
    await openFileMenu(page)
    await page.getByRole('menuitem', { name: /导出工程包/ }).click()
    await expect(page.getByText('工程包已导出')).toBeVisible()
    await expect.poll(async () => {
      try {
        return (await stat(packageFile)).size
      } catch {
        return 0
      }
    }, { timeout: 20_000 }).toBeGreaterThan(100)

    const archive = unzipSync(new Uint8Array(await readFile(packageFile)))
    const manifest = JSON.parse(strFromU8(archive['manifest.json']!)) as {
      packageVersion: number
      kind: string
      map: { id: string; title: string; nodeCount: number }
      assets: Record<string, unknown>
    }
    expect(manifest.packageVersion).toBe(1)
    expect(manifest.kind).toBe('map')
    expect(manifest.map.title).toBe('我的学习导图')
    expect(manifest.map.nodeCount).toBe(2)
    expect(Object.keys(manifest.assets)).toHaveLength(0)
    const packagedMap = JSON.parse(strFromU8(archive['map.json']!)) as { id: string; nodes: Record<string, { title: string }> }
    expect(packagedMap.id).toBe(manifest.map.id)
    expect(Object.values(packagedMap.nodes).some((node) => node.title === '工程包节点')).toBe(true)

    // 导入同 id 工程包，选择保留两者
    await stubOpenDialog(app, packageFile)
    await openFileMenu(page)
    await page.getByRole('menuitem', { name: /导入工程包/ }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/工作区中已存在/)).toBeVisible()
    await page.screenshot({ path: 'test-results/zhitu-package-import.png' })
    await dialog.getByRole('button', { name: '保留两者' }).click()
    await expect(page.getByText('工程包已导入')).toBeVisible()
    await expect(page.getByLabel('导图标题')).toHaveValue('我的学习导图（导入）')
    await page.locator('.map-switcher').click()
    await expect(page.locator('.menu-item__title')).toHaveCount(2)
    await page.keyboard.press('Escape')

    // 再次导入并选择覆盖，覆盖前应写入恢复快照
    await stubOpenDialog(app, packageFile)
    await openFileMenu(page)
    await page.getByRole('menuitem', { name: /导入工程包/ }).click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.getByRole('alertdialog').getByRole('button', { name: '覆盖' }).click()
    await expect(page.getByText('已覆盖导入的导图')).toBeVisible()
    await expect(page.getByLabel('导图标题')).toHaveValue('我的学习导图')
    const snapshots = await readdir(path.join(workspace, '.history', packagedMap.id)).catch(() => [])
    expect(snapshots.some((file) => file.endsWith('.snapshot.json'))).toBe(true)

    // 损坏的工程包必须报错且不产生新导图
    const before = (await readdir(path.join(workspace, 'maps'))).filter((file) => file.endsWith('.mindmap.json')).length
    await stubOpenDialog(app, brokenFile)
    await openFileMenu(page)
    await page.getByRole('menuitem', { name: /导入工程包/ }).click()
    await expect(page.getByText(/工程包无法解压/)).toBeVisible()
    const after = (await readdir(path.join(workspace, 'maps'))).filter((file) => file.endsWith('.mindmap.json')).length
    expect(after).toBe(before)
  } finally {
    await app.close()
  }
})