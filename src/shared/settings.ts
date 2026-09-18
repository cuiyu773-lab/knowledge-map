import {
  DEFAULT_EXPORT_QUALITY,
  type AppSettings,
  type ExportQuality,
  type PanelVisibility,
  type ThemeMode
} from './types'

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'light',
  panels: { outline: true, inspector: true },
  exportQuality: DEFAULT_EXPORT_QUALITY
}

export function isExportQuality(value: unknown): value is ExportQuality {
  return value === 'standard' || value === 'high' || value === 'ultra'
}

function normalizeTheme(value: unknown): ThemeMode {
  return value === 'dark' ? 'dark' : 'light'
}

function normalizePanels(value: unknown): PanelVisibility {
  const panels = value && typeof value === 'object' ? value as Partial<PanelVisibility> : {}
  return {
    outline: typeof panels.outline === 'boolean' ? panels.outline : DEFAULT_APP_SETTINGS.panels.outline,
    inspector: typeof panels.inspector === 'boolean' ? panels.inspector : DEFAULT_APP_SETTINGS.panels.inspector
  }
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const settings = value && typeof value === 'object' ? value as Partial<AppSettings> : {}
  const normalized: AppSettings = {
    theme: normalizeTheme(settings.theme),
    panels: normalizePanels(settings.panels),
    exportQuality: isExportQuality(settings.exportQuality)
      ? settings.exportQuality
      : DEFAULT_APP_SETTINGS.exportQuality
  }
  if (typeof settings.lastWorkspacePath === 'string') normalized.lastWorkspacePath = settings.lastWorkspacePath
  return normalized
}
