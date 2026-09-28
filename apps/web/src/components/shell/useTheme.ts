import { useCallback, useSyncExternalStore } from 'react'

/**
 * 应用外观偏好：主题模式 / 正文字体 / 动效（设置中心「主题与字体」「缩放与可访问性」）。
 *
 * 承载方式沿用仓库既有约定 —— 只写 document.documentElement.dataset，
 * 颜色与排版全部由 styles/95-paper-theme.css 的令牌派生，这里不新增第二套颜色体系：
 *
 *   dataset.theme  = 'paper' | 'night'                 解析后的实际主题
 *   dataset.font   = 'serif' | 'sans' | 'system'        小说正文字体栈（--font-prose）
 *   dataset.motion = 'on' | 'off'                       过渡与动效开关
 *
 * 注意：font 只作用于「小说正文」（.mjp-prose 走 --font-prose），不改界面字体，
 * 与参考样例设置中心「正文字体」一栏的语义一致（样例默认高亮「宋体优先」，
 * 而仓库正文原本就是 var(--font-serif)，因此默认值取 serif 不产生观感变化）。
 *
 * 主题模式比主题多一档 'system'（跟随系统深色偏好）。为了不破坏既有调用方，
 * useTheme() 的签名保持原样，仍然只返回解析后的 'paper' | 'night'。
 */

export type MojingTheme = 'paper' | 'night'
export type MojingThemeMode = MojingTheme | 'system'
export type MojingFont = 'serif' | 'sans' | 'system'

export type Appearance = {
  mode: MojingThemeMode
  font: MojingFont
  motion: boolean
}

const THEME_KEY = 'mojing.theme'
const FONT_KEY = 'mojing.font'
const MOTION_KEY = 'mojing.motion'
const THEME_TRANSITION_MS = 460

const DARK_QUERY = '(prefers-color-scheme: dark)'
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    // 隐私模式下 localStorage 不可用，回落到默认值。
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 写入失败不影响本次会话内的使用。
  }
}

function media(query: string): MediaQueryList | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
  return window.matchMedia(query)
}

function readMode(): MojingThemeMode {
  const saved = read(THEME_KEY)
  return saved === 'paper' || saved === 'night' || saved === 'system' ? saved : 'paper'
}

/** 默认「宋体优先」：与 styles/96-paper-shell.css 里 .mjp-prose 既有的 var(--font-serif) 一致。 */
function readFont(): MojingFont {
  const saved = read(FONT_KEY)
  return saved === 'serif' || saved === 'sans' || saved === 'system' ? saved : 'serif'
}

/** 未显式设置过时跟随系统 reduced-motion，避免对着系统偏好反向操作。 */
function readMotion(): boolean {
  const saved = read(MOTION_KEY)
  if (saved === 'on') return true
  if (saved === 'off') return false
  return !(media(REDUCED_MOTION_QUERY)?.matches ?? false)
}

function resolveTheme(mode: MojingThemeMode): MojingTheme {
  if (mode !== 'system') return mode
  return media(DARK_QUERY)?.matches ? 'night' : 'paper'
}

/* 模块级单例：设置中心与顶栏可能同时挂载，外观是应用级状态，
   放在组件外才能保证两侧读到同一份真值、且不会互相覆盖。 */
let state: Appearance = { mode: readMode(), font: readFont(), motion: readMotion() }
const listeners = new Set<() => void>()
let themeTransitionTimer: ReturnType<typeof setTimeout> | undefined

function emit(): void {
  listeners.forEach((listener) => listener())
}

function apply(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.theme = resolveTheme(state.mode)
  root.dataset.font = state.font
  root.dataset.motion = state.motion ? 'on' : 'off'
}

function startThemeTransition(): void {
  if (typeof document === 'undefined' || !state.motion) return
  const root = document.documentElement
  root.dataset.themeTransition = 'on'
  if (themeTransitionTimer) clearTimeout(themeTransitionTimer)
  themeTransitionTimer = setTimeout(() => {
    delete root.dataset.themeTransition
    themeTransitionTimer = undefined
  }, THEME_TRANSITION_MS)
}

function update(patch: Partial<Appearance>, persist = true): void {
  const next = { ...state, ...patch }
  const modeChanged = patch.mode !== undefined && next.mode !== state.mode
  // An explicit choice is still a preference when it equals the system value.
  if (persist) {
    if (patch.mode !== undefined) write(THEME_KEY, next.mode)
    if (patch.font !== undefined) write(FONT_KEY, next.font)
    if (patch.motion !== undefined) write(MOTION_KEY, next.motion ? 'on' : 'off')
  }
  if (next.mode === state.mode && next.font === state.font && next.motion === state.motion) return
  state = next
  apply()
  if (modeChanged) startThemeTransition()
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): Appearance {
  return state
}

// 跟随系统：只在用户没有显式指定过动效偏好时才让系统偏好接管。
media(DARK_QUERY)?.addEventListener('change', () => {
  if (state.mode === 'system') {
    state = { ...state }
    apply()
    emit()
  }
})
media(REDUCED_MOTION_QUERY)?.addEventListener('change', (event) => {
  if (read(MOTION_KEY) === null) update({ motion: !event.matches }, false)
})

// 首帧渲染前落地，避免主题闪烁。
apply()

export type UseAppearanceResult = {
  mode: MojingThemeMode
  /** 解析后的实际主题，可直接喂给 AppShell 的 theme 属性。 */
  theme: MojingTheme
  font: MojingFont
  motion: boolean
  setMode: (mode: MojingThemeMode) => void
  setFont: (font: MojingFont) => void
  setMotion: (motion: boolean) => void
}

/** 外观偏好（含「跟随系统」主题模式与动效开关），落盘到 localStorage 并同步 dataset。 */
export function useAppearance(): UseAppearanceResult {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)
  const setMode = useCallback((mode: MojingThemeMode) => update({ mode }), [])
  const setFont = useCallback((font: MojingFont) => update({ font }), [])
  const setMotion = useCallback((motion: boolean) => update({ motion }), [])
  return { mode: snapshot.mode, theme: resolveTheme(snapshot.mode), font: snapshot.font, motion: snapshot.motion, setMode, setFont, setMotion }
}

/** 双态主题：顶栏与外壳沿用，签名与行为保持不变（'system' 模式下切换等于显式指定反向主题）。 */
export function useTheme(): { theme: MojingTheme; setTheme: (theme: MojingTheme) => void; toggleTheme: () => void } {
  const { theme, setMode } = useAppearance()
  const setTheme = useCallback((next: MojingTheme) => setMode(next), [setMode])
  const toggleTheme = useCallback(() => setMode(theme === 'paper' ? 'night' : 'paper'), [theme, setMode])
  return { theme, setTheme, toggleTheme }
}
