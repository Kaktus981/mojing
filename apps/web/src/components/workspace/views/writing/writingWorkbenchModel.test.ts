import { describe, expect, it } from 'vitest'
import { resolveWritingWorkbenchVisual } from './writingWorkbenchModel'

describe('writing workbench visual mapping', () => {
  it('keeps the prose editor on the harbor ink background', () => {
    expect(resolveWritingWorkbenchVisual('prose-editor')).toMatchObject({ title: '正文工作台', background: 'harbor' })
  })

  it('falls back to a known workbench instead of an empty visual shell', () => {
    expect(resolveWritingWorkbenchVisual('unknown')).toMatchObject({ title: '正文工作台', eyebrow: '正文创作' })
  })
})
