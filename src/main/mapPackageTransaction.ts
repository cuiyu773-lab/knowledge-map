import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { AppError } from './errors'
import { parseWorkspaceMeta } from '@shared/schema'
import type { MindMapDocument, WorkspaceMeta } from '@shared/types'

async function regularFile(filePath: string): Promise<Buffer | null> {
  const stat = await fs.lstat(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!stat) return null
  if (!stat.isFile() || stat.isSymbolicLink()) throw new AppError('INVALID_PATH', '导入目标不是普通文件')
  return fs.readFile(filePath)
}

async function ensureDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true })
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AppError('INVALID_PATH', '导入目标目录不能是链接')
}

/** 独占创建目标，创建后立即登记，以便后续写入失败时也能清理。 */
async function writeNewFile(target: string, buffer: Buffer, created: () => void): Promise<void> {
  const file = await fs.open(target, 'wx')
  created()
  try {
    await file.writeFile(buffer)
  } finally {
    await file.close()
  }
}

/** 暂存所有内容后提交；索引成功替换才算完成，失败则恢复原导图及新增资源。 */
export async function commitMapPackageFiles(
  workspacePath: string,
  document: MindMapDocument,
  assets: Map<string, Buffer>,
  overwrite: boolean
): Promise<{ meta: WorkspaceMeta; overwritten: boolean }> {
  if (!/^[a-zA-Z0-9-]{1,120}$/.test(document.id)) throw new AppError('INVALID_ID', '导图 ID 无效')
  for (const name of ['maps', 'assets', '.history']) await ensureDirectory(path.join(workspacePath, name))
  const mapPath = path.join(workspacePath, 'maps', document.id + '.mindmap.json')
  const metaPath = path.join(workspacePath, 'workspace.json')
  const previousMeta = await regularFile(metaPath)
  if (!previousMeta) throw new AppError('INVALID_WORKSPACE', '工作区索引不存在')
  const meta = parseWorkspaceMeta(JSON.parse(previousMeta.toString('utf8')))
  const previous = await regularFile(mapPath)
  if (previous && !overwrite) throw new AppError('FILE_CONFLICT', '导入目标导图已存在')
  const nextMeta: WorkspaceMeta = {
    ...meta,
    updatedAt: new Date().toISOString(),
    mapOrder: meta.mapOrder.includes(document.id) ? [...meta.mapOrder] : [...meta.mapOrder, document.id]
  }
  const staging = await fs.mkdtemp(path.join(workspacePath, '.zmap-import-'))
  const createdAssets: string[] = []
  let replacedMap = false
  let snapshot: string | null = null
  let rollbackFailed = false
  try {
    await fs.writeFile(path.join(staging, 'map.json'), JSON.stringify(document, null, 2) + '\n')
    await fs.writeFile(path.join(staging, 'workspace.json'), JSON.stringify(nextMeta, null, 2))
    if (previous) await fs.writeFile(path.join(staging, 'previous.json'), previous)
    for (const [relativePath, buffer] of assets) {
      // 包内名称不能直接决定文件系统目标，图片路径必须由内容生成。
      const digest = createHash('sha256').update(buffer).digest('hex')
      if (!new RegExp('^assets/' + digest + '\\.(png|jpg|gif|webp)$').test(relativePath)) {
        throw new AppError('INVALID_PATH', '导入图片必须使用内容哈希路径')
      }
      const target = path.join(workspacePath, relativePath)
      const existing = await regularFile(target)
      if (existing) {
        if (!existing.equals(buffer)) throw new AppError('MAP_PACKAGE_ASSET_INVALID', '工作区已有同名但内容不同的图片')
        continue
      }
      try {
        await writeNewFile(target, buffer, () => createdAssets.push(target))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const raced = await regularFile(target)
        if (!raced?.equals(buffer)) throw new AppError('FILE_CONFLICT', '导入期间图片文件发生冲突')
      }
    }
    if (previous) {
      const directory = path.join(workspacePath, '.history', document.id)
      await ensureDirectory(directory)
      let timestamp = Date.now()
      while (true) {
        const candidate = path.join(directory, timestamp + '.snapshot.json')
        try {
          await writeNewFile(candidate, previous, () => { snapshot = candidate })
          break
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
          timestamp += 1
        }
      }
    }
    const current = await regularFile(mapPath)
    if (previous ? !current?.equals(previous) : current !== null) throw new AppError('FILE_CONFLICT', '导入期间导图文件发生变化')
    if (!(await regularFile(metaPath))?.equals(previousMeta)) throw new AppError('FILE_CONFLICT', '导入期间工作区索引发生变化')
    await fs.rename(path.join(staging, 'map.json'), mapPath)
    replacedMap = true
    await fs.rename(path.join(staging, 'workspace.json'), metaPath)
    return { meta: nextMeta, overwritten: previous !== null }
  } catch (error) {
    const failures: unknown[] = []
    if (replacedMap) {
      try {
        if (previous) await fs.rename(path.join(staging, 'previous.json'), mapPath)
        else await fs.unlink(mapPath)
      } catch (rollbackError) {
        failures.push(rollbackError)
      }
    }
    // 导图恢复失败时，保留它引用的新图片和恢复快照供人工恢复。
    if (!failures.length) {
      for (const target of createdAssets) {
        try { await fs.unlink(target) } catch (rollbackError) { failures.push(rollbackError) }
      }
      if (snapshot) {
        try { await fs.unlink(snapshot) } catch (rollbackError) { failures.push(rollbackError) }
      }
    }
    if (failures.length) {
      rollbackFailed = true
      throw new AppError('MAP_PACKAGE_ROLLBACK_FAILED', '导入失败且未能完全回滚，恢复文件保留于：' + staging,
        [error, ...failures].map(String).join('\n'))
    }
    throw error
  } finally {
    // 清理失败不改变已完成的提交结果；回滚失败时必须保留恢复文件。
    if (!rollbackFailed) await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
}
