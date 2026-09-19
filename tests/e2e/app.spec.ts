import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

interface ExportFileRequest {
  label: string
  quality: string | null
  file: string
}

function pngDimensions(buffer: Buffer): { width: number; height: number } {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

async function exportFile(app: ElectronApplication, page: Page, item: ExportFileRequest): Promise<void> {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, item.file)
  await page.getByRole('button', { name: /导出/ }).click()
  const menuItem = page.getByRole('menuitem', { name: item.label })
  if (item.quality) {
    await menuItem.focus()
    await page.keyboard.press('ArrowRight')
    const qualityItem = page.getByRole('menuitemradio', { name: new RegExp('^' + item.quality) })
    await expect(qualityItem).toBeVisible()
    await qualityItem.click({ force: true })
  } else {
    await menuItem.click()
  }
  await expect.poll(async () => {
    try {
      return (await stat(item.file)).size
    } catch {
      return 0
    }
  }, { timeout: 20_000 }).toBeGreaterThan(100)
}

test('可启动、打开工作区、编辑节点并自动保存', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'zhitu-e2e-'))
  const userData = path.join(root, 'user-data')
  const settingsPath = path.join(userData, 'settings.json')
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
    settingsPath,
    JSON.stringify({ theme: 'light', panels: { outline: true, inspector: true }, lastWorkspacePath: workspace }, null, 2)
  )

  const app = await electron.launch({
    args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-sandbox', '--disable-software-rasterizer', '.'],
    env: { ...process.env, ZHITU_USER_DATA: userData, LOCALAPPDATA: localAppData, APPDATA: appData }
  })
  const page = await app.firstWindow()
  await expect(page.getByText('把知识画成', { exact: false })).toBeVisible()
  await expect(page.locator('.app-titlebar')).toBeVisible()
  await expect(page.getByRole('navigation', { name: '应用菜单' })).toBeVisible()
  expect(await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().every((window) => !window.isMenuBarVisible())
  )).toBe(true)
  await page.getByRole('button', { name: '文件' }).click()
  await expect(page.getByRole('menuitem', { name: /新建导图/ })).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByText('Ctrl+N')).toBeVisible()
  await page.keyboard.press('Escape')
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
  await page.getByRole('button', { name: '文件' }).click()
  await expect(page.getByRole('menuitem', { name: '保存 Ctrl+S' })).not.toHaveAttribute('aria-disabled', 'true')
  await page.getByRole('menuitem', { name: /导出/ }).hover()
  await page.getByRole('menuitem', { name: 'PNG 图片' }).hover()
  await expect(page.getByRole('menuitemradio', { name: /^高清/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '视图' }).click()
  await expect(page.getByRole('menuitemcheckbox', { name: '大纲面板' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('menuitemradio', { name: '深色主题' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: 'test-results/zhitu-workspace-dark.png' })

  await page.getByRole('button', { name: /导出/ }).click()
  await page.getByRole('menuitem', { name: 'PNG 图片' }).hover()
  await expect(page.getByRole('menuitemradio', { name: /^高清/ })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  const standardPngFile = path.join(root, '导图-standard.png')
  const highPngFile = path.join(root, '导图-high.png')
  const ultraPngFile = path.join(root, '导图-ultra.png')
  const highPdfFile = path.join(root, '导图-high.pdf')
  const exports: ExportFileRequest[] = [
    { label: 'PNG 图片', quality: '标准', file: standardPngFile },
    { label: 'PNG 图片', quality: '高清（推荐）', file: highPngFile },
    { label: 'SVG 矢量图', quality: null, file: path.join(root, '导图.svg') },
    { label: 'PDF 文档', quality: '高清（推荐）', file: highPdfFile },
    { label: 'PNG 图片', quality: '超清', file: ultraPngFile }
  ]
  for (const item of exports) await exportFile(app, page, item)

  const standardPng = pngDimensions(await readFile(standardPngFile))
  const highPng = pngDimensions(await readFile(highPngFile))
  const ultraPng = pngDimensions(await readFile(ultraPngFile))
  expect(highPng.width).toBeGreaterThan(standardPng.width)
  expect(ultraPng.width).toBeGreaterThan(highPng.width)
  expect(highPng.width / standardPng.width).toBeGreaterThan(1.2)
  expect(highPng.width / standardPng.width).toBeLessThan(1.3)
  expect(ultraPng.width / highPng.width).toBeGreaterThan(1.15)
  expect(ultraPng.width / highPng.width).toBeLessThan(1.25)

  const pdfText = (await readFile(highPdfFile)).toString('latin1')
  const pdfWidthMatch = pdfText.match(/\/Width\s+(\d+)/)
  const pdfHeightMatch = pdfText.match(/\/Height\s+(\d+)/)
  expect(pdfWidthMatch).not.toBeNull()
  expect(pdfHeightMatch).not.toBeNull()
  expect(Number(pdfWidthMatch![1])).toBeGreaterThanOrEqual(1000)
  expect(Number(pdfHeightMatch![1])).toBeGreaterThanOrEqual(290)

  await expect.poll(async () => {
    const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as { exportQuality?: string }
    return settings.exportQuality
  }).toBe('ultra')

  await page.waitForTimeout(1300)
  const mapFiles = (await readdir(path.join(workspace, 'maps'))).filter((file) => file.endsWith('.mindmap.json'))
  expect(mapFiles).toHaveLength(1)
  const saved = JSON.parse(await readFile(path.join(workspace, 'maps', mapFiles[0]!), 'utf8'))
  expect(Object.values(saved.nodes).some((node: any) => node.title === '快速排序')).toBe(true)

  await app.close()

  const restartedApp = await electron.launch({
    args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-sandbox', '--disable-software-rasterizer', '.'],
    env: { ...process.env, ZHITU_USER_DATA: userData, LOCALAPPDATA: localAppData, APPDATA: appData }
  })
  try {
    const restartedPage = await restartedApp.firstWindow()
    await restartedPage.getByRole('button').filter({ hasText: '端到端测试' }).click()
    await expect(restartedPage.getByLabel('大纲编辑')).toBeVisible()
    await restartedPage.getByRole('button', { name: /导出/ }).click()
    await restartedPage.getByRole('menuitem', { name: 'PNG 图片' }).hover()
    await expect(restartedPage.getByRole('menuitemradio', { name: /^超清/ })).toHaveAttribute('aria-checked', 'true')
  } finally {
    await restartedApp.close()
  }
})
