import { describe, expect, it } from 'vitest'
import { NEW_PROJECT_TITLE_MAX, validateNewProjectInput } from './newProjectValidation'

describe('新建小说表单校验', () => {
  it('接受去除首尾空白后有效的名称和故事想法', () => {
    expect(validateNewProjectInput({ title: ' 潮汐钟 ', seed: ' 巡夜人发现城门少了一块砖。 ' })).toEqual({})
  })

  it('拒绝空白名称、空白故事想法和超过契约上限的名称', () => {
    expect(validateNewProjectInput({ title: '   ', seed: '\n' })).toEqual({ title: '请填写小说名称。', seed: '请写下最初的故事想法。' })
    expect(validateNewProjectInput({ title: '书'.repeat(NEW_PROJECT_TITLE_MAX + 1), seed: '有效故事想法' })).toEqual({ title: '小说名称不能超过 120 个字符。' })
  })
})
