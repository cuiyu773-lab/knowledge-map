import { useState } from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { AlertTriangle, FileArchive } from 'lucide-react'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'

function readableSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function readableTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

export function PackageImportDialog() {
  const preview = useWorkspaceStore((state) => state.packagePreview)
  const closePackagePreview = useWorkspaceStore((state) => state.closePackagePreview)
  const commitImport = useWorkspaceStore((state) => state.commitImport)
  const [working, setWorking] = useState(false)

  if (!preview) return null

  const run = async (strategy: 'overwrite' | 'rename') => {
    setWorking(true)
    await commitImport(strategy)
    setWorking(false)
  }

  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && closePackagePreview()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content className="dialog-content dialog-content--narrow">
          <AlertDialog.Title className="dialog-title">
            <FileArchive size={19} />
            导入工程包
          </AlertDialog.Title>
          <AlertDialog.Description className="dialog-description">
            工程包中的导图会加入当前工作区，包内图片按内容哈希合并，不会删除工作区中已有的图片。
          </AlertDialog.Description>
          <dl className="package-summary">
            <div><dt>导图标题</dt><dd>{preview.title}</dd></div>
            <div><dt>节点数量</dt><dd>{preview.nodeCount}</dd></div>
            <div><dt>图片数量</dt><dd>{preview.assetCount}</dd></div>
            <div><dt>文件大小</dt><dd>{readableSize(preview.totalBytes)}</dd></div>
            <div><dt>导出时间</dt><dd>{readableTime(preview.exportedAt)}</dd></div>
          </dl>
          {preview.conflict && (
            <p className="package-conflict">
              <AlertTriangle size={15} />
              <span>工作区中已存在《{preview.conflict.title}》。覆盖会替换这张导图的内容，覆盖前会自动生成一份恢复快照；保留两者会另建一张标题带「（导入）」的副本。</span>
            </p>
          )}
          <div className="dialog-actions">
            <AlertDialog.Cancel className="button" disabled={working}>取消</AlertDialog.Cancel>
            {preview.conflict ? (
              <>
                <button className="button button--danger" type="button" disabled={working} onClick={() => void run('overwrite')}>
                  覆盖
                </button>
                <button className="button button--primary" type="button" disabled={working} onClick={() => void run('rename')}>
                  保留两者
                </button>
              </>
            ) : (
              <button className="button button--primary" type="button" disabled={working} onClick={() => void run('rename')}>
                导入
              </button>
            )}
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}