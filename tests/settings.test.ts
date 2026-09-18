import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS, isExportQuality, normalizeAppSettings } from '@shared/settings'

describe('应用设置归一化', () => {
  it('为缺失的设置提供高清默认值', () => {
    expect(normalizeAppSettings(undefined)).toEqual(DEFAULT_APP_SETTINGS)
    expect(normalizeAppSettings({ theme: 'dark', panels: { outline: false } })).toEqual({
      theme: 'dark',
      panels: { outline: false, inspector: true },
      exportQuality: 'high'
    })
  })

  it('保留合法的导出画质并修正非法值', () => {
    expect(normalizeAppSettings({ exportQuality: 'ultra' }).exportQuality).toBe('ultra')
    expect(normalizeAppSettings({ exportQuality: 'invalid' }).exportQuality).toBe('high')
    expect(isExportQuality('standard')).toBe(true)
    expect(isExportQuality('invalid')).toBe(false)
  })

  it('保留工作区路径', () => {
    expect(normalizeAppSettings({ lastWorkspacePath: 'D:/导图' }).lastWorkspacePath).toBe('D:/导图')
  })
})
