import * as Dialog from '@radix-ui/react-dialog'
import { ExternalLink, FileText, LoaderCircle, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useAiStore } from '@renderer/stores/aiStore'

function formatSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function MaterialLibraryDialog() {
  const open = useAiStore((state) => state.materialsOpen)
  const materials = useAiStore((state) => state.materials)
  const setOpen = useAiStore((state) => state.setMaterialsOpen)
  const importMaterial = useAiStore((state) => state.importMaterial)
  const deleteMaterial = useAiStore((state) => state.deleteMaterial)
  const revealMaterial = useAiStore((state) => state.revealMaterial)
  const [busy, setBusy] = useState(false)

  const runImport = async () => {
    setBusy(true)
    await importMaterial()
    setBusy(false)
  }

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`将资料「${name}」移入系统回收站？`)) return
    await deleteMaterial(id)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content material-dialog" aria-describedby="material-description">
          <div className="dialog-heading">
            <div>
              <p className="eyebrow">工作区资料</p>
              <Dialog.Title className="dialog-title"><FileText size={19} />课程资料库</Dialog.Title>
            </div>
            <Dialog.Close asChild><button className="icon-button" type="button" aria-label="关闭"><X size={17} /></button></Dialog.Close>
          </div>
          <Dialog.Description id="material-description" className="dialog-description">
            支持 PDF、DOCX、PPTX、Markdown 和 TXT。文件会复制到工作区，每次生成时重新解析，不执行 OCR。
          </Dialog.Description>
          <button className="material-import-button" type="button" disabled={busy} onClick={() => void runImport()}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}导入资料
          </button>
          <div className="material-list">
            {materials.length ? materials.map((item) => (
              <div className="material-item" key={item.id}>
                <span className="material-item__icon"><FileText size={17} /></span>
                <span className="material-item__meta">
                  <strong title={item.name}>{item.name}</strong>
                  <small>{item.extension.replace('.', '').toUpperCase()} · {formatSize(item.size)} · {new Date(item.importedAt).toLocaleDateString('zh-CN')}</small>
                </span>
                <button className="icon-button" type="button" title="在文件管理器中显示" onClick={() => void revealMaterial(item.id)}><ExternalLink size={15} /></button>
                <button className="icon-button icon-button--danger" type="button" title="删除资料" onClick={() => void remove(item.id, item.name)}><Trash2 size={15} /></button>
              </div>
            )) : <div className="material-empty">还没有课程资料。导入后可在这里长期复用。</div>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
