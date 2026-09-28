import { describe, expect, it } from 'vitest'
import type { NovelProject } from '../../../../../../../packages/contracts/src'
import { getTaskCenterNextStep } from './taskCenterModel'

const project = (overrides: Partial<NovelProject> = {}): NovelProject => ({
  chapters: [{ id: 'chapter-1' }],
  outline: undefined,
  worldBible: undefined,
  ...overrides
} as NovelProject)

describe('task center priority', () => {
  it('starts with the outline when both outline and worldbuilding are missing', () => {
    expect(getTaskCenterNextStep(project())).toMatchObject({
      label: '先建立小说大纲',
      target: { stageId: 'outline', subnavId: 'outline-foundation' }
    })
  })

  it('moves to worldbuilding after the outline exists', () => {
    expect(getTaskCenterNextStep(project({ outline: {} as NovelProject['outline'] }))).toMatchObject({
      label: '先建立世界观',
      target: { stageId: 'world', subnavId: 'world-overview' }
    })
  })

  it('only recommends writing after both planning foundations exist', () => {
    expect(getTaskCenterNextStep(project({ outline: {} as NovelProject['outline'], worldBible: {} as NovelProject['worldBible'] }))).toMatchObject({
      label: '继续推进当前章节',
      target: { stageId: 'writing', subnavId: 'prose-editor' }
    })
  })

  it('asks for chapter planning when both foundations exist without chapters', () => {
    expect(getTaskCenterNextStep(project({ chapters: [], outline: {} as NovelProject['outline'], worldBible: {} as NovelProject['worldBible'] }))).toMatchObject({
      label: '先规划第一章',
      target: { stageId: 'outline', subnavId: 'chapter-directory' }
    })
  })
})
