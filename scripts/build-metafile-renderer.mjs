import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const distPath = path.join(root, 'build', 'metafile-renderer')
const workPath = path.join(root, 'build', 'pyinstaller', 'work')
const specPath = path.join(root, 'build', 'pyinstaller')
await Promise.all([
  mkdir(distPath, { recursive: true }),
  mkdir(workPath, { recursive: true }),
  mkdir(specPath, { recursive: true })
])

const python = process.env.ZHITU_PYTHON ?? 'python'
const args = [
  '-m',
  'PyInstaller',
  '--noconfirm',
  '--clean',
  '--onefile',
  '--name',
  'metafile-renderer',
  '--distpath',
  distPath,
  '--workpath',
  workPath,
  '--specpath',
  specPath,
  path.join(root, 'resources', 'metafile_renderer.py')
]

const child = spawn(python, args, {
  stdio: 'inherit',
  env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
})
child.on('error', (error) => {
  console.error(`无法启动渲染器打包器：${error.message}`)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`渲染器打包被信号 ${signal} 终止`)
    process.exit(1)
  }
  process.exit(code ?? 1)
})
