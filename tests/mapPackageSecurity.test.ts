// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app, dialog } from 'electron'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { readMapPackageArchive } from '../src/main/mapPackageArchive'
import { MapPackageService } from '../src/main/mapPackage'
import { WorkspaceService } from '../src/main/workspace'
import { validateImage } from '../src/main/imageAsset'
import { collectAssetReferences, rewriteDocumentAssetReferences } from '@shared/assetReferences'
import { createMindMapDocument, createNode, createWorkspaceMeta, parseMindMapDocument } from '@shared/schema'
import { isAllowedPackageEntry, MAP_PACKAGE_LIMITS } from '@shared/mapPackage'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(), getVersion: () => '0.6.0' },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: {}
}))

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=', 'base64')
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
let root: string
let workspace: WorkspaceService

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'zhitu-package-security-'))
  const userData = path.join(root, 'user-data')
  await fs.mkdir(userData)
  vi.mocked(app.getPath).mockReturnValue(userData)
  await fs.writeFile(path.join(root, 'workspace.json'), JSON.stringify(createWorkspaceMeta('w1', '测试')))
  workspace = new WorkspaceService()
  await workspace.openWorkspacePath(root)
})

afterEach(async () => {
  vi.restoreAllMocks()
  // root 仅来自 mkdtemp，且路径必须位于本次测试的临时目录。
  if (root && path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith('zhitu-package-security-')) {
    await fs.rm(root, { recursive: true, force: true })
  }
})

function sample(markdown = '![图](assets/demo.png)') {
  const doc = createMindMapDocument('map-1', 'root', '课程')
  doc.nodes.root!.detailMarkdown = markdown
  return doc
}

function archive(document = sample(), content: Buffer | null = png, name = 'assets/demo.png', mime = 'image/png'): Buffer {
  const assets = content ? { [name]: { path: name, sha256: digest(content), size: content.length, mime } } : {}
  return Buffer.from(zipSync({
    'manifest.json': strToU8(JSON.stringify({
      packageVersion: 1, kind: 'map', appVersion: '0.6.0', exportedAt: document.updatedAt,
      map: { id: document.id, title: document.title, nodeCount: Object.keys(document.nodes).length, createdAt: document.createdAt, updatedAt: document.updatedAt },
      assets
    })),
    'map.json': strToU8(JSON.stringify(document)),
    ...(content ? { [name]: content } : {})
  }))
}

async function prepare(service: MapPackageService, bytes = archive()) {
  const source = path.join(root, 'input.zmap')
  await fs.writeFile(source, bytes)
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [source] })
  const preview = await service.prepareImport()
  expect(preview).not.toBeNull()
  return preview!
}

function patchSizes(bytes: Buffer, size: number): Buffer {
  const result = Buffer.from(bytes)
  const end = result.length - 22
  const directory = result.readUInt32LE(end + 16)
  result.writeUInt32LE(size, directory + 24)
  result.writeUInt32LE(size, result.readUInt32LE(directory + 42) + 22)
  return result
}

describe('受限 ZIP 读取', () => {
  it('读取合法的 DEFLATE 和未压缩工程包', async () => {
    for (const level of [0, 6] as const) {
      const bytes = Buffer.from(zipSync({ 'map.json': strToU8('内容') }, { level }))
      const entries = await readMapPackageArchive(bytes)
      expect(Buffer.from(entries['map.json']!).toString()).toBe('内容')
    }
  })

  it('在解压前拒绝声明超过预算的条目', async () => {
    const bytes = patchSizes(Buffer.from(zipSync({ 'map.json': strToU8('x') })), MAP_PACKAGE_LIMITS.unpackedBytes + 1)
    await expect(readMapPackageArchive(bytes)).rejects.toMatchObject({ code: 'MAP_PACKAGE_TOO_LARGE' })
  })

  it('真实输出超过伪造的较小声明时中止解压', async () => {
    const bytes = patchSizes(Buffer.from(zipSync({ 'map.json': new Uint8Array(2 * 1024 * 1024) })), 1)
    await expect(readMapPackageArchive(bytes)).rejects.toMatchObject({ code: 'MAP_PACKAGE_TOO_LARGE' })
  })

  it('拒绝文件过多、非法路径与大小写别名', async () => {
    const many = Object.fromEntries(Array.from({ length: 203 }, (_, index) => ['assets/' + index + '.png', png]))
    await expect(readMapPackageArchive(Buffer.from(zipSync(many)))).rejects.toMatchObject({ code: 'MAP_PACKAGE_TOO_LARGE' })
    await expect(readMapPackageArchive(Buffer.from(zipSync({ '../map.json': png })))).rejects.toMatchObject({ code: 'MAP_PACKAGE_PATH_INVALID' })
    await expect(readMapPackageArchive(Buffer.from(zipSync({ 'assets/a.png': png, 'assets/A.png': png })))).rejects.toMatchObject({ code: 'MAP_PACKAGE_INVALID' })
  })

  it('拒绝损坏的中央目录、截断包与 CRC 不符', async () => {
    const bytes = Buffer.from(zipSync({ 'map.json': strToU8('x') }, { level: 0 }))
    const broken = Buffer.from(bytes)
    broken[30 + broken.readUInt16LE(26)]! ^= 1
    await expect(readMapPackageArchive(broken)).rejects.toMatchObject({ code: 'MAP_PACKAGE_INVALID' })
    await expect(readMapPackageArchive(bytes.subarray(0, bytes.length - 1))).rejects.toMatchObject({ code: 'MAP_PACKAGE_INVALID' })
    await expect(readMapPackageArchive(Buffer.from('不是 zip'))).rejects.toMatchObject({ code: 'MAP_PACKAGE_INVALID' })
  })

  it('拒绝 Windows 特殊路径、分隔符别名和链接名称', () => {
    for (const name of ['assets/../a.png', 'assets/a.png:stream', 'assets/CON.png', 'assets/a.png.', 'assets/a.png ', 'assets//a.png', 'assets/./a.png', 'assets\\a.png']) {
      expect(isAllowedPackageEntry(name)).toBe(false)
    }
  })
})

describe('节点结构与图片语法', () => {
  it('拒绝重复 ID、键不一致、缺失父级、孤立环和根节点环', () => {
    const badKey = sample()
    badKey.nodes.other = { ...badKey.nodes.root! }
    expect(() => parseMindMapDocument(badKey)).toThrow()
    const missing = sample()
    missing.nodes.child = createNode('child', 'missing', 0)
    expect(() => parseMindMapDocument(missing)).toThrow()
    const cycle = sample()
    cycle.nodes.a = createNode('a', 'b', 0)
    cycle.nodes.b = createNode('b', 'a', 0)
    expect(() => parseMindMapDocument(cycle)).toThrow()
    const rootCycle = sample()
    rootCycle.nodes.root!.parentId = 'root'
    expect(() => parseMindMapDocument(rootCycle)).toThrow()
  })

  it('拒绝超过深度或节点数量限制的树', () => {
    const deep = sample()
    let parent = 'root'
    for (let index = 0; index < 258; index += 1) {
      const id = 'node-' + index
      deep.nodes[id] = createNode(id, parent, 0)
      parent = id
    }
    expect(() => parseMindMapDocument(deep)).toThrow()
    const wide = sample()
    for (let index = 0; index < 10000; index += 1) {
      const id = 'node-' + index
      wide.nodes[id] = createNode(id, 'root', index)
    }
    expect(() => parseMindMapDocument(wide)).toThrow()
  })

  it('收集引用式、尖括号 URL、HTML 空白属性、实体及百分号编码图片', () => {
    const doc = sample([
      '![引用][pic]', '[pic]: assets/demo.png',
      '![空格](<assets/a%20b.png>)',
      '<img SRC = "assets/a&amp;b.png"><img src=assets/unquoted.png>',
      '![远程](https://example.com/a.png)',
      '代码：' + String.fromCharCode(96) + '![伪图](assets/code.png)' + String.fromCharCode(96)
    ].join('\n\n'))
    expect([...collectAssetReferences(doc, doc.rootId).keys()].sort()).toEqual([
      'assets/a b.png', 'assets/a&b.png', 'assets/demo.png', 'assets/unquoted.png'
    ])
  })

  it('改写真实图片并保留标题、代码和非图片文字', () => {
    const tick = String.fromCharCode(96)
    const doc = sample('![引用][pic]\n\n[pic]: assets/demo.png\n\n<img src = "assets/demo.png">\n\n' +
      tick + '![引用][pic]' + tick + '\n\n普通文字 assets/demo.png')
    const rewritten = rewriteDocumentAssetReferences(doc, new Map([['assets/demo.png', 'assets/new.png']]))
    expect([...collectAssetReferences(rewritten, rewritten.rootId).keys()]).toEqual(['assets/new.png'])
    expect(rewritten.nodes.root!.detailMarkdown).toContain(tick + '![引用][pic]' + tick)
    expect(rewritten.nodes.root!.detailMarkdown).toContain('普通文字 assets/demo.png')
  })

  it('拒绝非图片内容、伪装 MIME、非图片扩展名和超大图片', () => {
    expect(() => validateImage(Buffer.from('html'), 'a.png')).toThrow()
    expect(() => validateImage(png, 'a.html', 'image/png')).toThrow()
    expect(() => validateImage(png, 'a.png', 'image/jpeg')).toThrow()
    expect(() => validateImage(Buffer.alloc(MAP_PACKAGE_LIMITS.imageBytes + 1), 'a.png')).toThrow()
  })
})

describe('工程包跨工作区与失败恢复', () => {
  it('保留不同内容的旧图片，按内容哈希导入新图片', async () => {
    const old = Buffer.from('原有图片')
    await fs.writeFile(path.join(root, 'assets', 'demo.png'), old)
    const service = new MapPackageService(workspace)
    const preview = await prepare(service)
    const imported = await service.commitImport(preview.importId, 'rename')
    const target = 'assets/' + digest(png) + '.png'
    expect(await fs.readFile(path.join(root, target))).toEqual(png)
    expect(await fs.readFile(path.join(root, 'assets/demo.png'))).toEqual(old)
    expect([...collectAssetReferences(imported.document, imported.document.rootId).keys()]).toEqual([target])
  })

  it('复用内容一致的资源，同哈希路径损坏则失败且不生成导图', async () => {
    const target = path.join(root, 'assets', digest(png) + '.png')
    await fs.writeFile(target, Buffer.from('损坏'))
    const service = new MapPackageService(workspace)
    const preview = await prepare(service)
    await expect(service.commitImport(preview.importId, 'rename')).rejects.toMatchObject({ code: 'MAP_PACKAGE_ASSET_INVALID' })
    expect(await fs.readdir(path.join(root, 'maps'))).toEqual([])
    expect(await fs.readFile(target)).toEqual(Buffer.from('损坏'))
  })

  it('覆盖前保存旧内容快照，重复提交被拒绝', async () => {
    const old = sample('原有内容')
    await workspace.createMapFromDocument(old)
    const service = new MapPackageService(workspace)
    const preview = await prepare(service)
    const result = await service.commitImport(preview.importId, 'overwrite')
    expect(result.overwritten).toBe(true)
    const snapshots = await workspace.listSnapshots(old.id)
    expect(snapshots).toHaveLength(1)
    const raw = await fs.readFile(path.join(root, '.history', old.id, snapshots[0]!.fileName), 'utf8')
    expect(JSON.parse(raw).nodes.root.detailMarkdown).toBe('原有内容')
    await expect(service.commitImport(preview.importId, 'overwrite')).rejects.toMatchObject({ code: 'MAP_PACKAGE_STALE' })
  })

  it('导出带图片工程包后可在另一工作区完整导入', async () => {
    await fs.writeFile(path.join(root, 'assets/demo.png'), png)
    const source = path.join(root, 'roundtrip.zmap')
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: source })
    const exporter = new MapPackageService(workspace)
    await exporter.exportPackage(sample('![图][pic]\n\n[pic]: assets/demo.png'))
    const other = path.join(root, 'other')
    await fs.mkdir(other)
    await fs.writeFile(path.join(other, 'workspace.json'), JSON.stringify(createWorkspaceMeta('w2', '另一个工作区')))
    await workspace.openWorkspacePath(other)
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [source] })
    const importer = new MapPackageService(workspace)
    const preview = await importer.prepareImport()
    const result = await importer.commitImport(preview!.importId, 'rename')
    const references = [...collectAssetReferences(result.document, result.document.rootId).keys()]
    expect(references).toEqual(['assets/' + digest(png) + '.png'])
    expect(await fs.readFile(path.join(other, references[0]!))).toEqual(png)
  })

  it('拒绝缺图、伪装图片、错误 MIME 以及未声明的资源', async () => {
    const service = new MapPackageService(workspace)
    await expect(prepare(service, archive(sample(), null))).rejects.toMatchObject({ code: 'MAP_PACKAGE_MISSING_ASSET' })
    await expect(prepare(service, archive(sample(), Buffer.from('html')))).rejects.toMatchObject({ code: 'MAP_PACKAGE_ASSET_INVALID' })
    await expect(prepare(service, archive(sample(), png, 'assets/demo.png', 'image/jpeg'))).rejects.toMatchObject({ code: 'MAP_PACKAGE_ASSET_INVALID' })
    const entries = await readMapPackageArchive(archive())
    entries['assets/extra.png'] = png
    await expect(prepare(service, Buffer.from(zipSync(entries)))).rejects.toMatchObject({ code: 'MAP_PACKAGE_ASSET_INVALID' })
  })

  it('拒绝图片 SHA 或尺寸不符，预览不写入资源和导图', async () => {
    const service = new MapPackageService(workspace)
    const entries = await readMapPackageArchive(archive())
    const manifest = JSON.parse(Buffer.from(entries['manifest.json']!).toString())
    manifest.assets['assets/demo.png'].sha256 = '0'.repeat(64)
    entries['manifest.json'] = strToU8(JSON.stringify(manifest))
    await expect(prepare(service, Buffer.from(zipSync(entries)))).rejects.toMatchObject({ code: 'MAP_PACKAGE_ASSET_INVALID' })
    expect(await fs.readdir(path.join(root, 'assets'))).toEqual([])
    expect(await fs.readdir(path.join(root, 'maps'))).toEqual([])
  })

  it('索引写入失败时恢复原导图、索引和本次新增图片', async () => {
    await workspace.createMapFromDocument(sample('旧内容'))
    const previousMap = await fs.readFile(path.join(root, 'maps/map-1.mindmap.json'))
    const previousMeta = await fs.readFile(path.join(root, 'workspace.json'))
    const service = new MapPackageService(workspace)
    const preview = await prepare(service)
    const rename = fs.rename.bind(fs)
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(from).endsWith('workspace.json')) throw new Error('模拟索引写入失败')
      return rename(from, to)
    })
    await expect(service.commitImport(preview.importId, 'overwrite')).rejects.toThrow('模拟索引写入失败')
    spy.mockRestore()
    expect(await fs.readFile(path.join(root, 'maps/map-1.mindmap.json'))).toEqual(previousMap)
    expect(await fs.readFile(path.join(root, 'workspace.json'))).toEqual(previousMeta)
    expect(await fs.readdir(path.join(root, 'assets'))).toEqual([])
    expect((await fs.readdir(root)).filter((name) => name.startsWith('.zmap-import-'))).toEqual([])
  })

  it('第二张图片写入失败时清理第一张，保留原有图片', async () => {
    const entries = await readMapPackageArchive(archive())
    const second = Buffer.concat([png, Buffer.from('另一张')])
    const manifest = JSON.parse(Buffer.from(entries['manifest.json']!).toString())
    manifest.assets['assets/second.png'] = { path: 'assets/second.png', sha256: digest(second), size: second.length, mime: 'image/png' }
    entries['manifest.json'] = strToU8(JSON.stringify(manifest))
    entries['assets/second.png'] = second
    await fs.writeFile(path.join(root, 'assets/existing.png'), png)
    const service = new MapPackageService(workspace)
    const preview = await prepare(service, Buffer.from(zipSync(entries)))
    const open = fs.open.bind(fs)
    let links = 0
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      if (flags === 'wx' && String(file).includes(path.sep + 'assets' + path.sep)) links += 1
      if (links === 2) throw new Error('模拟第二张图片失败')
      return open(file, flags, mode)
    })
    await expect(service.commitImport(preview.importId, 'rename')).rejects.toThrow('模拟第二张图片失败')
    spy.mockRestore()
    expect(await fs.readdir(path.join(root, 'assets'))).toEqual(['existing.png'])
    expect(await fs.readdir(path.join(root, 'maps'))).toEqual([])
  })

  it('导出前限制 JSON 大小，避免产生无法导入的包', async () => {
    const service = new MapPackageService(workspace)
    await expect(service.exportPackage(sample('x'.repeat(MAP_PACKAGE_LIMITS.jsonBytes)))).rejects.toMatchObject({ code: 'MAP_PACKAGE_TOO_LARGE' })
  })

  it('工作区变化和新一轮取消选择都会使旧预览失效', async () => {
    const service = new MapPackageService(workspace)
    const preview = await prepare(service)
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await service.prepareImport()).toBeNull()
    await expect(service.commitImport(preview.importId, 'rename')).rejects.toMatchObject({ code: 'MAP_PACKAGE_STALE' })
    const second = await prepare(service)
    await workspace.closeWorkspace()
    await expect(service.commitImport(second.importId, 'rename')).rejects.toMatchObject({ code: 'MAP_PACKAGE_STALE' })
  })
})

describe('导入提交的额外边界', () => {
  it('复用哈希与内容都相同的图片', async () => {
    const target = path.join(root, 'assets', digest(png) + '.png')
    await fs.writeFile(target, png)
    const service = new MapPackageService(workspace)
    const preview = await prepare(service)
    const result = await service.commitImport(preview.importId, 'rename')
    expect(result.overwritten).toBe(false)
    expect(await fs.readdir(path.join(root, 'assets'))).toEqual([digest(png) + '.png'])
  })

  it('新导图索引提交失败时删除新导图和图片', async () => {
    const beforeMeta = await fs.readFile(path.join(root, 'workspace.json'))
    const service = new MapPackageService(workspace)
    const preview = await prepare(service)
    const rename = fs.rename.bind(fs)
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(from).endsWith('workspace.json')) throw new Error('模拟索引失败')
      return rename(from, to)
    })
    await expect(service.commitImport(preview.importId, 'rename')).rejects.toThrow('模拟索引失败')
    spy.mockRestore()
    expect(await fs.readdir(path.join(root, 'maps'))).toEqual([])
    expect(await fs.readdir(path.join(root, 'assets'))).toEqual([])
    expect(await fs.readFile(path.join(root, 'workspace.json'))).toEqual(beforeMeta)
  })

  it('回滚本身失败时保留备份、新资源并返回恢复位置', async () => {
    await workspace.createMapFromDocument(sample('需要恢复的原内容'))
    const service = new MapPackageService(workspace)
    const preview = await prepare(service)
    const rename = fs.rename.bind(fs)
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(from).endsWith('workspace.json') || String(from).endsWith('previous.json')) throw new Error('模拟磁盘故障')
      return rename(from, to)
    })
    await expect(service.commitImport(preview.importId, 'overwrite')).rejects.toMatchObject({ code: 'MAP_PACKAGE_ROLLBACK_FAILED' })
    spy.mockRestore()
    const recovery = (await fs.readdir(root)).filter((name) => name.startsWith('.zmap-import-'))
    expect(recovery).toHaveLength(1)
    const old = JSON.parse(await fs.readFile(path.join(root, recovery[0]!, 'previous.json'), 'utf8'))
    expect(old.nodes.root.detailMarkdown).toBe('需要恢复的原内容')
    expect(await fs.readFile(path.join(root, 'assets', digest(png) + '.png'))).toEqual(png)
  })

  it('等待已经开始的自动保存完成，期间拒绝切换工作区', async () => {
    await workspace.createMapFromDocument(sample('旧内容'))
    const service = new MapPackageService(workspace)
    const preview = await prepare(service)
    const rename = fs.rename.bind(fs)
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const entered = new Promise<void>((resolve) => { started = resolve })
    let delayed = false
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (!delayed && String(to).endsWith('map-1.mindmap.json')) {
        delayed = true
        started()
        await gate
      }
      return rename(from, to)
    })
    const saving = workspace.saveMap(sample('保存中的最新修改'))
    await entered
    const importing = service.commitImport(preview.importId, 'overwrite')
    await expect(workspace.closeWorkspace()).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' })
    release()
    await saving
    await importing
    spy.mockRestore()
    const imported = await workspace.readMap('map-1')
    expect([...collectAssetReferences(imported.document, imported.document.rootId).keys()]).toEqual(['assets/' + digest(png) + '.png'])
    const snapshots = await workspace.listSnapshots('map-1')
    const old = JSON.parse(await fs.readFile(path.join(root, '.history/map-1', snapshots[0]!.fileName), 'utf8'))
    expect(old.nodes.root.detailMarkdown).toBe('保存中的最新修改')
  })

  it('导出前累计未压缩图片预算，不生成无法重新导入的工程包', async () => {
    const doc = sample(Array.from({ length: 7 }, (_, index) => '![图](assets/' + index + '.png)').join('\n'))
    const image = Buffer.alloc(24 * 1024 * 1024)
    png.copy(image)
    let index = 0
    const spy = vi.spyOn(workspace, 'readWorkspaceAsset').mockImplementation(async () => {
      image.writeUInt32LE(index++, image.length - 4)
      return image
    })
    const service = new MapPackageService(workspace)
    await expect(service.exportPackage(doc)).rejects.toMatchObject({ code: 'MAP_PACKAGE_TOO_LARGE' })
    spy.mockRestore()
  })

  it('结构无效的导图在预览阶段被拒绝且不写工作区', async () => {
    const doc = sample()
    doc.nodes.child = createNode('child', 'missing', 0)
    const service = new MapPackageService(workspace)
    await expect(prepare(service, archive(doc))).rejects.toMatchObject({ code: 'MAP_PACKAGE_INVALID' })
    expect(await fs.readdir(path.join(root, 'maps'))).toEqual([])
    expect(await fs.readdir(path.join(root, 'assets'))).toEqual([])
  })
})
