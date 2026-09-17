import * as Dialog from '@radix-ui/react-dialog'
import { CheckCircle2, KeyRound, LoaderCircle, Settings2, ShieldCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAiStore } from '@renderer/stores/aiStore'

export function AiSettingsDialog() {
  const open = useAiStore((state) => state.configOpen)
  const config = useAiStore((state) => state.config)
  const error = useAiStore((state) => state.error)
  const setOpen = useAiStore((state) => state.setConfigOpen)
  const saveConfig = useAiStore((state) => state.saveConfig)
  const testConnection = useAiStore((state) => state.testConnection)
  const clearError = useAiStore((state) => state.clearError)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [clearApiKey, setClearApiKey] = useState(false)
  const [dataConsent, setDataConsent] = useState(false)
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)
  const [tested, setTested] = useState(false)

  useEffect(() => {
    if (!open) return
    setBaseUrl(config?.baseUrl ?? '')
    setModel(config?.model ?? '')
    setApiKey('')
    setClearApiKey(false)
    setDataConsent(config?.dataConsent ?? false)
    setTested(false)
    clearError()
  }, [open, config, clearError])

  const input = () => ({ baseUrl, model, apiKey: apiKey || undefined, clearApiKey, dataConsent })

  const runTest = async () => {
    setBusy('test')
    setTested(await testConnection(input()))
    setBusy(null)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy('save')
    const saved = await saveConfig(input())
    setBusy(null)
    if (saved) setOpen(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content ai-config-dialog" aria-describedby="ai-config-description">
          <div className="dialog-heading">
            <div>
              <p className="eyebrow">模型服务</p>
              <Dialog.Title className="dialog-title"><Settings2 size={19} />AI 配置</Dialog.Title>
            </div>
            <Dialog.Close asChild><button className="icon-button" type="button" aria-label="关闭"><X size={17} /></button></Dialog.Close>
          </div>
          <Dialog.Description id="ai-config-description" className="dialog-description">
            知图使用 OpenAI 兼容的 Chat Completions 接口。API Key 由系统安全存储保护，不会暴露给页面代码。
          </Dialog.Description>
          <form className="ai-config-form" onSubmit={submit}>
            <label className="field">
              <span>Base URL</span>
              <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" autoComplete="url" />
              <small>可填写服务根地址或完整的 /chat/completions 地址。</small>
            </label>
            <label className="field">
              <span>模型名称</span>
              <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="按服务商文档填写" autoComplete="off" />
            </label>
            <label className="field">
              <span><KeyRound size={13} />API Key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={config?.hasApiKey ? '已安全保存，留空表示不修改' : '本地服务可留空'}
                autoComplete="new-password"
              />
            </label>
            {config?.hasApiKey && (
              <label className="check-row">
                <input type="checkbox" checked={clearApiKey} onChange={(event) => setClearApiKey(event.target.checked)} />
                <span>清除已保存的 API Key</span>
              </label>
            )}
            <label className="consent-box">
              <input type="checkbox" checked={dataConsent} onChange={(event) => setDataConsent(event.target.checked)} />
              <ShieldCheck size={18} />
              <span>
                <strong>允许发送所选内容</strong>
                <small>生成或测试连接时，选中的资料文本、导图上下文和对话会发送到你填写的服务地址。</small>
              </span>
            </label>
            {error && <div className="inline-error">{error}</div>}
            {tested && !error && <div className="inline-success"><CheckCircle2 size={14} />连接成功</div>}
            <div className="dialog-actions ai-config-actions">
              <button className="button" type="button" disabled={Boolean(busy)} onClick={() => void runTest()}>
                {busy === 'test' ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />}测试连接
              </button>
              <button className="button button--primary" type="submit" disabled={Boolean(busy)}>
                {busy === 'save' ? <LoaderCircle className="spin" size={14} /> : null}保存配置
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
