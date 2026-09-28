import { describe, expect, it } from 'vitest'
import { WorldEntrySchema } from '../../contracts/src'
import { applyWorldExpansion, previewWorldExpansion } from './worldExpansion'
import { makeNovel } from './novelTestFactory'

function entry(id: string, name: string) {
  return WorldEntrySchema.parse({ id, type: '地点', name, aliases: [], tags: ['扩展'], summary: '新的地点', notes: '', locked: false, aiVisibility: '按需召回', relations: [], customFields: {}, details: { fields: {}, lists: {} } })
}

describe('世界观按需扩展', () => {
  it('预览新增词条并标记正文/章纲影响，不直接改动正式项目', () => {
    const project = makeNovel(4)
    project.chapters[1]!.blocks[0]!.text += ' 主角抵达雾港。'
    const preview = previewWorldExpansion(project, { title: '雾港扩展', reason: '第二卷需要一个新的调查地点', proposedEntries: [entry('harbor', '雾港')], sourceChapterIds: [project.chapters[1]!.id], plannedChapterNumbers: [3], transitionPlan: [{ chapterNumber: 3, purpose: '通过船票让读者第一次看到雾港', changes: ['新增地点', '新增线索'], suggestion: '先让角色听到地名，再在下一章抵达。' }] })
    expect(preview.proposal.affectedChapterIds).toContain(project.chapters[1]!.id)
    expect(preview.proposal.affectedOutlineChapterIds).toContain(project.outline!.volumes[0]!.chapters[2]!.id)
    expect(project.worldBible!.entries.some((item) => item.name === '雾港')).toBe(false)
    expect(preview.proposal.causalChain?.map((item) => item.layer)).toEqual(['底层规则', '社会影响', '人物与势力', '剧情呈现'])
    expect(preview.proposal.unresolvedQuestions).toHaveLength(3)
  })

  it('应用后只加入词条并把受影响正文标为待复核', () => {
    const project = makeNovel(3)
    project.chapters[0]!.blocks[0]!.text += ' 雾港的钟声传来。'
    const preview = previewWorldExpansion(project, { title: '雾港', reason: '引入新地点', proposedEntries: [entry('harbor', '雾港')], sourceChapterIds: [project.chapters[0]!.id], transitionPlan: [] })
    const candidate = { ...project, worldExpansionProposals: [preview.proposal] }
    const applied = applyWorldExpansion(candidate, preview.proposal)
    expect(applied.worldBible!.entries.some((item) => item.name === '雾港')).toBe(true)
    expect(applied.worldBible!.status).toBe('草稿')
    expect(applied.reviews.some((item) => item.chapterId === project.chapters[0]!.id && item.category === '世界规则')).toBe(true)
    expect(applied.worldExpansionProposals?.find((item) => item.id === preview.proposal.id)?.status).toBe('已应用')
  })

  it('世界观版本变化后拒绝旧扩展候选', () => {
    const project = makeNovel(2)
    const preview = previewWorldExpansion(project, { title: '雾港', reason: '测试过期', proposedEntries: [entry('harbor', '雾港')] })
    const changed = { ...project, revision: project.revision + 1 }
    expect(() => applyWorldExpansion({ ...changed, worldExpansionProposals: [preview.proposal] }, preview.proposal)).toThrow('已失效')
  })
})
