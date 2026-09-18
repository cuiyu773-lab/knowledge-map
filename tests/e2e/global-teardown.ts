import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'

const KEEP_DIRECTORIES = new Set(['.git', 'node_modules', 'out', 'release', 'src', 'test-results', 'tests'])

async function isSpellingCache(candidate: string): Promise<boolean> {
  const microsoft = path.join(candidate, 'Microsoft')
  const spelling = path.join(microsoft, 'Spelling')
  const neutral = path.join(spelling, 'neutral')
  try {
    const [rootEntries, microsoftEntries, spellingEntries, neutralEntries] = await Promise.all([
      readdir(candidate),
      readdir(microsoft),
      readdir(spelling),
      readdir(neutral)
    ])
    return (
      rootEntries.length === 1 && rootEntries[0] === 'Microsoft' &&
      microsoftEntries.length === 1 && microsoftEntries[0] === 'Spelling' &&
      spellingEntries.length === 1 && spellingEntries[0] === 'neutral' &&
      neutralEntries.length === 0
    )
  } catch {
    return false
  }
}

export default async function globalTeardown(): Promise<void> {
  const root = path.resolve(process.cwd())
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || KEEP_DIRECTORIES.has(entry.name)) continue
    const candidate = path.resolve(root, entry.name)
    if (!candidate.startsWith(`${root}${path.sep}`)) continue
    try {
      const candidateStat = await stat(candidate)
      if (!candidateStat.isDirectory() || !(await isSpellingCache(candidate))) continue
      await rm(candidate, { recursive: true, force: true })
    } catch {
      // 目录可能在系统拼写缓存清理过程中并发消失，忽略即可。
    }
  }
}
