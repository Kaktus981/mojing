import { describe, expect, it } from 'vitest'
import type { AssistantChange, NovelProject } from '../../contracts/src'
import { NovelProjectSchema } from '../../contracts/src'
import { NovelDatabaseService } from './novelDatabase'
import { makeNovel } from './novelTestFactory'
import { applyAssistantDraft, buildAdoptPreview } from './assistantCandidates'
import { saveScopedRevisionDraft } from './localRevision'

function beat(cardId: string, id: string, title: string): AssistantChange {
  return {
    kind: 'beat', chapterId: cardId,
    beat: { id, title, purpose: '', conflict: '', outcome: '', order: 1, location: '', timeframe: '', reveal: '', characterIds: [], threadActions: [] }
  }
}

function chapterChange(id: string, chapterNumber: number, objective: string): AssistantChange {
  return {
    kind: 'chapter',
    chapter: {
      id, volumeNumber: 1, chapterNumber, title: `第${chapterNumber}章`, pov: '林砚', objective,
      conflict: '', turningPoint: '', reveal: '', endingHook: '', characterIds: [], setupThreadIds: [],
      payoffThreadIds: [], beats: [], beatStatus: '未生成', beatFindings: [], status: '已规划'
    }
  }
}

function setup(chapterCount = 3) {
  const database = new NovelDatabaseService(':memory:')
  const project = structuredClone(makeNovel(chapterCount)) as NovelProject
  const [c1, c2, c3] = project.chapters
  const card = (chapter: NovelProject['chapters'][number], volumeNumber: number) => ({
    id: chapter.id, volumeNumber, chapterNumber: chapter.chapterNumber, title: chapter.title, pov: '林砚',
    objective: '原目标', conflict: '', turningPoint: '', reveal: '', endingHook: '', characterIds: [],
    setupThreadIds: [], payoffThreadIds: [], beats: [], beatStatus: '未生成' as const, beatFindings: [], status: '已规划' as const
  })
  project.outline!.volumes = [
    { id: 'v1', volumeNumber: 1, title: '旧城', goal: '', climax: '', resolution: '', chapters: [card(c1!, 1), card(c2!, 1)] },
    { id: 'v2', volumeNumber: 2, title: '潮汐', goal: '', climax: '', resolution: '', chapters: [card(c3!, 2)] }
  ]
  const parsed = NovelProjectSchema.parse(project)
  database.createProject(parsed)
  return { database, project: parsed, c1: c1!, c2: c2!, c3: c3! }
}

describe('局部修改与分批细化（D1/D3）', () => {
  it('改某个步骤时，不能顺手改写整章或同章其它步骤', () => {
    const { database, project, c1 } = setup()
    const scope = { kind: 'beat' as const, projectId: project.id, objectId: c1.id, beatId: 'b1' }
    expect(() => saveScopedRevisionDraft({ database, project, scope, changes: [chapterChange(c1.id, 1, '越权改整章')] }))
      .toThrowError(/不能改写整章/)
    expect(() => saveScopedRevisionDraft({ database, project, scope, changes: [beat(c1.id, 'b2', '越权改别的步骤')] }))
      .toThrowError(/不能改写同章的其它步骤/)
    expect(saveScopedRevisionDraft({ database, project, scope, changes: [beat(c1.id, 'b1', '只改这一步')] }).draft.changes).toHaveLength(1)
    database.close()
  })

  it('改某卷时不能碰别的卷，改某章时不能碰别的章', () => {
    const { database, project, c1, c3 } = setup()
    const volume = { kind: 'volume' as const, projectId: project.id, objectId: 'v1' }
    expect(() => saveScopedRevisionDraft({ database, project, scope: volume, changes: [chapterChange(c3.id, 3, '越权改第二卷')] }))
      .toThrowError(/只能改动当前卷里的章/)

    const chapter = { kind: 'chapter' as const, projectId: project.id, objectId: c1.id }
    expect(() => saveScopedRevisionDraft({ database, project, scope: chapter, changes: [chapterChange(c3.id, 3, '越权改别的章')] }))
      .toThrowError(/只能改动当前选中的这一章/)
    database.close()
  })

  it('改故事线时不能顺带改章纲或步骤', () => {
    const { database, project, c1 } = setup()
    const line = {
      kind: 'storyline' as const, projectId: project.id, objectId: 'line-1'
    }
    expect(() => saveScopedRevisionDraft({ database, project, scope: line, changes: [chapterChange(c1.id, 1, '越权')] }))
      .toThrowError(/不能顺带修改章纲/)
    expect(() => saveScopedRevisionDraft({ database, project, scope: line, changes: [beat(c1.id, 'b1', '越权')] }))
      .toThrowError(/不能顺带修改剧情步骤/)
    database.close()
  })

  it('局部修改不能改写故事核心或全书总纲', () => {
    const { database, project, c1 } = setup()
    const chapter = { kind: 'chapter' as const, projectId: project.id, objectId: c1.id }
    expect(() => saveScopedRevisionDraft({
      database, project, scope: chapter, changes: [{ kind: 'outline', synopsis: '越权', mainConflict: '', endingDirection: '' }]
    })).toThrowError(/不能改写故事核心或全书总纲/)
    database.close()
  })

  it('多章批次只覆盖作者明确选中的章', () => {
    const { database, project, c1, c2, c3 } = setup()
    const scope = { kind: 'volume' as const, projectId: project.id, objectId: 'v1' }
    // 选中第一卷两章，却想改第三卷那章：越界。
    expect(() => saveScopedRevisionDraft({
      database, project, scope, batchChapterIds: [c1.id, c2.id],
      changes: [chapterChange(c1.id, 1, 'A'), chapterChange(c3.id, 3, '越权')]
    })).toThrowError(/批次只能覆盖你明确选中的章/)

    expect(() => saveScopedRevisionDraft({ database, project, scope, batchChapterIds: [], changes: [chapterChange(c1.id, 1, 'A')] }))
      .toThrowError(/至少选中一章/)

    const batch = saveScopedRevisionDraft({
      database, project, scope, batchChapterIds: [c1.id, c2.id],
      changes: [chapterChange(c1.id, 1, 'A'), chapterChange(c2.id, 2, 'B')]
    })
    expect(batch.draft.changes).toHaveLength(2)
    database.close()
  })

  it('采用局部修改后只改目标，关联正文的文字与 ID 都不变，并标注下游待复核', () => {
    const { database, project, c1 } = setup()
    const before = database.getProject(project.id)
    const bodyBefore = before.chapters.find((item) => item.id === c1.id)!
    const scope = { kind: 'chapter' as const, projectId: project.id, objectId: c1.id }
    const draft = saveScopedRevisionDraft({ database, project, scope, changes: [chapterChange(c1.id, 1, '新目标')] }).draft

    const preview = buildAdoptPreview({ project: database.getProject(project.id), draft })
    expect(preview.downstream.some((item) => /第1章正文/.test(item.label)), '要提示关联正文待复核').toBe(true)

    const applied = applyAssistantDraft({
      database, projectId: project.id, draftId: draft.id,
      expectedVersion: draft.version, expectedPreviewDigest: preview.previewDigest
    })
    const card = applied.outline!.volumes.flatMap((v) => v.chapters).find((item) => item.id === c1.id)!
    expect(card.objective).toBe('新目标')
    const bodyAfter = applied.chapters.find((item) => item.id === c1.id)!
    expect(bodyAfter.id).toBe(bodyBefore.id)
    expect(bodyAfter.blocks.map((item) => item.text)).toEqual(bodyBefore.blocks.map((item) => item.text))
    // 不重建稳定 ID：别的章 id 完全没动。
    expect(applied.outline!.volumes.flatMap((v) => v.chapters).map((item) => item.id).sort())
      .toEqual(before.outline!.volumes.flatMap((v) => v.chapters).map((item) => item.id).sort())
    database.close()
  })

  it('不同目标的草稿按作用域隔离，切页不会串用', () => {
    const { database, project, c1, c2 } = setup()
    const first = saveScopedRevisionDraft({
      database, project, scope: { kind: 'chapter', projectId: project.id, objectId: c1.id },
      changes: [chapterChange(c1.id, 1, '第一章的目标')]
    }).draft
    const second = saveScopedRevisionDraft({
      database, project, scope: { kind: 'chapter', projectId: project.id, objectId: c2.id },
      changes: [chapterChange(c2.id, 2, '第二章的目标')]
    }).draft
    expect(second.id).not.toBe(first.id)
    const firstChange = database.getAssistantDraft(project.id, `chapter:${c1.id}`, '局部修改')?.changes[0]
    const secondChange = database.getAssistantDraft(project.id, `chapter:${c2.id}`, '局部修改')?.changes[0]
    expect(firstChange).toMatchObject({ kind: 'chapter', chapter: { objective: '第一章的目标' } })
    expect(secondChange).toMatchObject({ kind: 'chapter', chapter: { objective: '第二章的目标' } })
    database.close()
  })
})
