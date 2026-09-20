export type AppTheme = 'warm' | 'dark'

const THEME_STORAGE_KEY = 'portfolio-os-theme'

export function readThemePreference(): AppTheme {
  if (typeof window === 'undefined') return 'warm'
  return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark'
    ? 'dark'
    : 'warm'
}

export function applyTheme(theme: AppTheme) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
  window.localStorage.setItem(THEME_STORAGE_KEY, theme)
}
