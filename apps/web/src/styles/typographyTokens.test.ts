import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const theme = readFileSync(resolve(__dirname, '95-paper-theme.css'), 'utf8')

describe('墨境舒适级字体令牌', () => {
  it('将全局字号提升到可长时间阅读的层级，同时保留清晰的字号阶梯', () => {
    expect(theme).toMatch(/--fs-11:\s*13px;/)
    expect(theme).toMatch(/--fs-12:\s*14px;/)
    expect(theme).toMatch(/--fs-13:\s*15px;/)
    expect(theme).toMatch(/--fs-14:\s*16px;/)
    expect(theme).toMatch(/--fs-15:\s*17px;/)
    expect(theme).toMatch(/--fs-17:\s*19px;/)
    expect(theme).toMatch(/--fs-20:\s*24px;/)
    expect(theme).toMatch(/--fs-24:\s*30px;/)
    expect(theme).toMatch(/body\s*\{[\s\S]*font-size:\s*15px;/)
  })
})
