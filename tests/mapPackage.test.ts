import { describe, expect, it } from 'vitest'
import { collectAssetReferences, normalizeAssetReference } from '@shared/assetReferences'
import {
  MapPackageError,
  isAllowedPackageEntry,
  parseMapPackageManifest,
  remapNodeIds,
  uniqueImportedTitle
} from '@shared/mapPackage'
import { createMindMapDocument, createNode } from '@shared/schema'

const SHA = 'a'.repeat(64)

function sampleDocument() {
  const document = createMindMapDocument('map-1', 'root', '课程')
  const child = createNode('child', 'root', 0, '第一章')
  const grandChild = createNode('grand', 'child', 0, '第一节')
  child.detailMarkdown = [
    '![图](assets/abc123.png)',
    '<img src="zhitu-asset://workspace/assets/def456.jpg" />',
    '![远程](https://example.com/remote.png)',
    '![数据](data:image/png;base64,AAAA)'
  ].join('\n')
  document.nodes.child = child
  document.nodes.grand = grandChild
  return document
}

function sampleManifest(): Record<string, unknown> {
  return {
    packageVersion: 1,
    kind: 'map',
    appVersion: '0.5.0',
    exportedAt: '2026-01-01T08:00:00.000Z',
    map: {
      id: 'map-1',
      title: '课程',
      nodeCount: 3,
      createdAt: '2025-12-01T00:00:00.000Z',
      updatedAt: '2025-12-02T00:00:00.000Z'
    },
    assets: {
      'assets/abc123.png': { path: 'assets/abc123.png', sha256: SHA, mime: 'image/png', size: 128 }
    }
  }
}

function packageErrorCode(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof MapPackageError ? error.code : null
  }
}

describe('工程包清单解析', () => {
  it('接受合法清单并归一化字段', () => {
    const manifest = parseMapPackageManifest(sampleManifest())
    expect(manifest.packageVersion).toBe(1)
    expect(manifest.kind).toBe('map')
    expect(manifest.map.id).toBe('map-1')
    expect(manifest.assets['assets/abc123.png']?.sha256).toBe(SHA)
  })

  it('拒绝不支持的包版本', () => {
    const raw = { ...sampleManifest(), packageVersion: 2 }
    expect(packageErrorCode(() => parseMapPackageManifest(raw))).toBe('MAP_PACKAGE_VERSION')
  })

  it('拒绝缺少导图信息的清单', () => {
    const raw = { ...sampleManifest() } as Record<string, unknown>
    delete raw.map
    expect(packageErrorCode(() => parseMapPackageManifest(raw))).toBe('MAP_PACKAGE_INVALID')
  })

  it('拒绝上跳与绝对路径的资源条目', () => {
    const escaping = sampleManifest()
    escaping.assets = { 'assets/../secret.png': { path: 'assets/../secret.png', sha256: SHA, mime: 'image/png', size: 1 } }
    expect(packageErrorCode(() => parseMapPackageManifest(escaping))).toBe('MAP_PACKAGE_PATH_INVALID')

    const absolute = sampleManifest()
    absolute.assets = { 'C:/tmp/a.png': { path: 'C:/tmp/a.png', sha256: SHA, mime: 'image/png', size: 1 } }
    expect(packageErrorCode(() => parseMapPackageManifest(absolute))).toBe('MAP_PACKAGE_PATH_INVALID')
  })

  it('拒绝非图片资源与非法校验值', () => {
    const wrongMime = sampleManifest()
    wrongMime.assets = { 'assets/a.bin': { path: 'assets/a.bin', sha256: SHA, mime: 'application/zip', size: 1 } }
    expect(packageErrorCode(() => parseMapPackageManifest(wrongMime))).toBe('MAP_PACKAGE_ASSET_UNSUPPORTED')

    const badHash = sampleManifest()
    badHash.assets = { 'assets/a.png': { path: 'assets/a.png', sha256: 'zz', mime: 'image/png', size: 1 } }
    expect(packageErrorCode(() => parseMapPackageManifest(badHash))).toBe('MAP_PACKAGE_ASSET_INVALID')
  })

  it('只放行 manifest、map 与 assets 目录下的条目', () => {
    expect(isAllowedPackageEntry('manifest.json')).toBe(true)
    expect(isAllowedPackageEntry('map.json')).toBe(true)
    expect(isAllowedPackageEntry('assets/abc.png')).toBe(true)
    expect(isAllowedPackageEntry('assets/')).toBe(false)
    expect(isAllowedPackageEntry('../map.json')).toBe(false)
    expect(isAllowedPackageEntry('/etc/passwd')).toBe(false)
    expect(isAllowedPackageEntry('extra/other.json')).toBe(false)
  })
})

describe('工程包资源引用收集', () => {
  it('同时收集 Markdown 图片与 img 标签中的本地图片', () => {
    const references = collectAssetReferences(sampleDocument(), 'root')
    expect([...references.keys()].sort()).toEqual(['assets/abc123.png', 'assets/def456.jpg'])
    expect(references.get('assets/abc123.png')).toEqual(['child'])
  })

  it('忽略远程与内联图片地址', () => {
    expect(normalizeAssetReference('https://example.com/a.png')).toBeNull()
    expect(normalizeAssetReference('data:image/png;base64,AAAA')).toBeNull()
    expect(normalizeAssetReference('assets/abc.png')).toBe('assets/abc.png')
  })
})

describe('导入辅助函数', () => {
  it('重建节点 id 后根节点与父子引用自洽', () => {
    const document = sampleDocument()
    let sequence = 0
    const remapped = remapNodeIds(document, () => `new-${++sequence}`)
    expect(remapped.rootId).toBe('new-1')
    expect(remapped.nodes['new-1']?.parentId).toBeNull()
    expect(remapped.nodes['new-2']?.parentId).toBe('new-1')
    expect(remapped.nodes['new-3']?.parentId).toBe('new-2')
    expect(Object.keys(remapped.nodes)).toHaveLength(3)
    expect(remapped.nodes['new-2']?.title).toBe('第一章')
    expect(remapped.id).toBe(document.id)
  })

  it('导入标题按已有名称递增去重', () => {
    expect(uniqueImportedTitle('课程', [])).toBe('课程（导入）')
    expect(uniqueImportedTitle('课程', ['课程（导入）'])).toBe('课程（导入 2）')
    expect(uniqueImportedTitle('课程', ['课程（导入）', '课程（导入 2）'])).toBe('课程（导入 3）')
    expect(uniqueImportedTitle('   ', [])).toBe('未命名导图（导入）')
  })
})