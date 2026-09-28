import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ThemePane } from './ThemePane'

const appearance = vi.hoisted(() => ({
  mode: 'night' as 'paper' | 'night' | 'system',
  font: 'sans' as 'serif' | 'sans' | 'system',
  motion: false,
  action: undefined as { props: { onClick: () => void } } | undefined
}))

vi.mock('../../shell/useTheme', () => ({
  useAppearance: () => ({
    ...appearance,
    theme: appearance.mode === 'night' ? 'night' : 'paper',
    setMode: (value: typeof appearance.mode) => { appearance.mode = value },
    setFont: (value: typeof appearance.font) => { appearance.font = value },
    setMotion: (value: boolean) => { appearance.motion = value }
  })
}))

vi.mock('../../ui/Primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ui/Primitives')>()
  return {
    ...actual,
    Btn: ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => {
      if (children === '恢复默认') appearance.action = { props: { onClick } }
      return <button type="button">{children}</button>
    }
  }
})

describe('主题与字体', () => {
  it('恢复默认仅重置主题和正文字体，保留减少动效偏好', () => {
    appearance.mode = 'night'
    appearance.font = 'sans'
    appearance.motion = false
    renderToStaticMarkup(<ThemePane />)

    appearance.action?.props.onClick()

    expect(appearance.mode).toBe('paper')
    expect(appearance.font).toBe('serif')
    expect(appearance.motion).toBe(false)
  })
})
