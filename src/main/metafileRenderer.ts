import { execFile, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AppError } from './errors'

const HELPER_VERSION = '1.0.0'
const HELPER_TIMEOUT_MS = 120_000
const HELPER_MAX_OUTPUT_BYTES = 1024 * 1024

export interface RenderedMetafile {
  id: string
  slideNumber: number
  relationshipId: string
  sourceKind: 'wmf' | 'emf'
  sourcePath: string | null
  pngPath: string | null
  sourceSha256: string
  pngSha256: string
  width: number
  height: number
  error?: string
}

export interface MetafileRenderResult {
  objects: RenderedMetafile[]
  warnings: string[]
  manifestPath: string
}

export interface RenderMetafilesOptions {
  sourceHash?: string
  sourcePath?: string
  signal?: AbortSignal
  dpi?: number
  maxSide?: number
  maxPixels?: number
  timeoutMs?: number
}

interface HelperCommand {
  command: string
  prefixArgs: string[]
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function resolveHelper(): Promise<HelperCommand> {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const executableCandidates = [
    resourcesPath ? path.join(resourcesPath, 'metafile-renderer.exe') : '',
    path.join(process.cwd(), 'build', 'metafile-renderer', 'metafile-renderer.exe')
  ].filter(Boolean)

  for (const candidate of executableCandidates) {
    if (await pathExists(candidate)) return { command: candidate, prefixArgs: [] }
  }

  const scriptPath = path.join(process.cwd(), 'resources', 'metafile_renderer.py')
  if (await pathExists(scriptPath)) {
    return { command: process.env.ZHITU_PYTHON ?? 'python', prefixArgs: [scriptPath] }
  }

  throw new AppError('MATERIAL_RENDERER_MISSING', '未找到 WMF/EMF 渲染器')
}

function safeManifestName(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.includes('\0')) return null
  if (path.basename(value) !== value) return null
  return value
}

function parseManifest(raw: unknown, outputDirectory: string): MetafileRenderResult {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  if (value.schemaVersion !== 1 || !Array.isArray(value.objects)) {
    throw new AppError('MATERIAL_RENDER_FAILED', 'WMF/EMF 渲染清单格式无效')
  }

  const objects: RenderedMetafile[] = []
  for (const item of value.objects) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (
      typeof record.id !== 'string' ||
      typeof record.slideNumber !== 'number' ||
      typeof record.relationshipId !== 'string' ||
      (record.sourceKind !== 'wmf' && record.sourceKind !== 'emf')
    ) {
      continue
    }
    const sourceName = safeManifestName(record.sourceFile)
    const pngName = safeManifestName(record.pngFile)
    const hasPng = typeof record.error !== 'string' && pngName !== null
    objects.push({
      id: record.id,
      slideNumber: record.slideNumber,
      relationshipId: record.relationshipId,
      sourceKind: record.sourceKind,
      sourcePath: sourceName ? path.join(outputDirectory, sourceName) : null,
      pngPath: hasPng ? path.join(outputDirectory, pngName) : null,
      sourceSha256: typeof record.sourceSha256 === 'string' ? record.sourceSha256 : '',
      pngSha256: typeof record.pngSha256 === 'string' ? record.pngSha256 : '',
      width: typeof record.width === 'number' ? record.width : 0,
      height: typeof record.height === 'number' ? record.height : 0,
      error: typeof record.error === 'string' ? record.error : undefined
    })
  }

  const warnings = Array.isArray(value.warnings)
    ? value.warnings.filter((warning): warning is string => typeof warning === 'string')
    : []
  return {
    objects,
    warnings,
    manifestPath: path.join(outputDirectory, 'manifest.json')
  }
}

function abortError(): Error {
  return new AppError('AI_CANCELED', '已取消生成')
}

function runHelper(
  helper: HelperCommand,
  args: string[],
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    let child: ChildProcess | null = null
    const onAbort = (): void => {
      child?.kill()
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child = execFile(
      helper.command,
      [...helper.prefixArgs, ...args],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: HELPER_MAX_OUTPUT_BYTES,
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
      },
      (error, _stdout, stderr) => {
        signal?.removeEventListener('abort', onAbort)
        child = null
        if (signal?.aborted) {
          reject(abortError())
          return
        }
        if (error) {
          const timeout = (error as NodeJS.ErrnoException).code === 'ETIMEDOUT' || error.killed
          const detail = stderr.trim().replace(/\s+/g, ' ').slice(0, 500)
          reject(
            new AppError(
              timeout ? 'MATERIAL_RENDER_TIMEOUT' : 'MATERIAL_RENDER_FAILED',
              timeout ? 'WMF/EMF 渲染超时' : 'WMF/EMF 渲染失败',
              detail || error.message
            )
          )
          return
        }
        resolve()
      }
    )
  })
}

async function readExistingManifest(
  manifestPath: string,
  outputDirectory: string,
  sourceHash: string,
  dpi: number,
  maxSide: number,
  maxPixels: number
): Promise<MetafileRenderResult | null> {
  try {
    const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>
    if (
      raw.helperVersion !== HELPER_VERSION ||
      raw.sourceHash !== sourceHash ||
      raw.requestedDpi !== dpi ||
      raw.maxSide !== maxSide ||
      raw.maxPixels !== maxPixels
    ) {
      return null
    }
    return parseManifest(raw, outputDirectory)
  } catch {
    return null
  }
}

export async function renderMetafiles(
  sourceBuffer: Buffer,
  outputDirectory: string,
  options: RenderMetafilesOptions = {}
): Promise<MetafileRenderResult> {
  const sourceHash = options.sourceHash ?? ''
  const dpi = options.dpi ?? 576
  const maxSide = options.maxSide ?? 4096
  const maxPixels = options.maxPixels ?? 16_000_000
  const manifestPath = path.join(outputDirectory, 'manifest.json')

  if (sourceHash) {
    const cached = await readExistingManifest(manifestPath, outputDirectory, sourceHash, dpi, maxSide, maxPixels)
    if (cached) return cached
  }

  const helper = await resolveHelper()
  await fs.mkdir(outputDirectory, { recursive: true })

  let temporaryDirectory: string | null = null
  let inputPath = options.sourcePath ?? ''
  if (!inputPath) {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'zhitu-metafile-'))
    inputPath = path.join(temporaryDirectory, 'source.pptx')
    await fs.writeFile(inputPath, sourceBuffer)
  }

  try {
    await runHelper(
      helper,
      [
        '--input',
        inputPath,
        '--output',
        outputDirectory,
        '--dpi',
        String(dpi),
        '--max-side',
        String(maxSide),
        '--max-pixels',
        String(maxPixels),
        '--source-hash',
        sourceHash
      ],
      options.signal,
      options.timeoutMs ?? HELPER_TIMEOUT_MS
    )
    return parseManifest(JSON.parse(await fs.readFile(manifestPath, 'utf8')), outputDirectory)
  } finally {
    if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true })
  }
}