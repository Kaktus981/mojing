import { describe, expect, it } from 'vitest'
import type { AssistantChange, NovelProject } from '../../contracts/src'
import { NovelProjectSchema } from '../../contracts/src'
import { NovelDatabaseService, type DatabaseWriteCheckpoint } from './novelDatabase'
import { makeNovel } from './novelTestFactory'
import { applyAssistantDraft, buildAdoptPreview, saveAssistantDraft, updateAssistantDraft } from './assistantCandidates'

/** 造一个两卷项目，第一卷两章，第二卷一章。 */
function fixture(): NovelProject {
  const base = makeNovel(3)
  const project = structuredClone(base) as NovelProject
  const [c1, c2, c3] = project.chapters
  const card = (chapter: NovelProject['chapters'][number], volumeNumber: number) => ({
    id: chapter.id, volumeNumber, chapterNumber: chapter.chapterNumber, title: chapter.title, pov: '林砚',
    objective: '原目标', conflict: '原冲突', turningPoint: '', reveal: '', endingHook: '',
    characterIds: ['char-1'], setupThreadIds: [], payoffThreadIds: [], beats: [], beatStatus: '未生成' as const,
    beatFindings: [], status: '已规划' as const
  })
  project.outline!.volumes = [
    { id: 'v1', volumeNumber: 1, title: '旧城', goal: '', climax: '', resolution: '', chapters: [card(c1!, 1), card(c2!, 1)] },
    { id: 'v2', volumeNumber: 2, title: '潮汐', goal: '', climax: '', resolution: '', chapters: [card(c3!, 2)] }
  ]
  project.outline!.synopsis = '原总纲'
  return NovelProjectSchema.parse(project)
}

const outlineChange: AssistantChange = { kind: 'outline', synopsis: '新总纲', mainConflict: '新冲突', endingDirection: '新结局' }
const chapterChange = (chapter: NovelProject['chapters'][number], objective: string): AssistantChange => ({
  kind: 'chapter',
  chapter: {
    id: chapter.id, volumeNumber: 1, chapterNumber: chapter.chapterNumber, title: chapter.title, pov: '林砚',
    objective, conflict: '新冲突', turningPoint: '', reveal: '', endingHook: '',
    characterIds: [], setupThreadIds: [], payoffThreadIds: [], beats: [], beatStatus: '未生成', beatFindings: [], status: '已规划'
  }
})

function setup() {
  const database = new NovelDatabaseService(':memory:')
  const project = fixture()
  database.createProject(project)
  return { database, project }
}

describe('工作草稿与原子采用（D3）', () => {
  it('生成只落草稿，正式项目一个字都不变', () => {
    const { database, project } = setup()
    const before = JSON.stringify(database.getProject(project.id))
    const { draft } = saveAssistantDraft({
      database, project: database.getProject(project.id), target: { kind: 'outline', projectId: project.id },
      taskType: '初纲生成', stage: 'outline', changes: [outlineChange], summary: '初纲候选'
    })
    expect(database.getProject(project.id).outline?.synopsis).toBe('原总纲')
    expect(JSON.stringify(database.getProject(project.id))).toBe(before)
    expect(draft.status).toBe('待确认')
    database.close()
  })

  it('作者改过的草稿不会被新的生成覆盖，新结果只作为可回看候选', () => {
    const { database, project } = setup()
    const first = saveAssistantDraft({
      database, project: database.getProject(project.id), target: { kind: 'outline', projectId: project.id },
      taskType: '初纲生成', stage: 'outline', changes: [outlineChange], summary: '第一版'
    }).draft
    const edited = updateAssistantDraft({ database, project: database.getProject(project.id), draftId: first.id, version: first.version, changes: [{ ...outlineChange, synopsis: '作者手改的总纲' }] })
    expect(edited.authorEdited).toBe(true)
    expect(edited.changes[0]).toMatchObject({ synopsis: '作者手改的总纲' })

    const second = saveAssistantDraft({
      database, project: database.getProject(project.id), target: { kind: 'outline', projectId: project.id },
      taskType: '初纲生成', stage: 'outline', changes: [{ ...outlineChange, synopsis: '第二版生成' }], summary: '第二版'
    })
    expect(second.keptAuthorEdits).toBe(true)
    expect(second.draft.changes[0]).toMatchObject({ synopsis: '作者手改的总纲' })
    const records = database.listAssistantCandidateRecords(project.id)
    expect(records.length).toBeGreaterThanOrEqual(2)
    expect(records.map((item) => item.summary)).toContain('第二版')
    database.close()
  })

  it('旧版本写回被拒绝，不会覆盖更新的草稿', () => {
    const { database, project } = setup()
    const draft = saveAssistantDraft({
      database, project: database.getProject(project.id), target: { kind: 'outline', projectId: project.id },
      taskType: '初纲生成', stage: 'outline', changes: [outlineChange]
    }).draft
    updateAssistantDraft({ database, project: database.getProject(project.id), draftId: draft.id, version: draft.version, changes: [{ ...outlineChange, synopsis: '手改' }] })
    expect(() => updateAssistantDraft({
      database, project: database.getProject(project.id), draftId: draft.id, version: draft.version, changes: [{ ...outlineChange, synopsis: '旧版本写回' }]
    })).toThrowError(/已经被更新/)
    database.close()
  })

  it('采用前重新预览，采用后只改目标对象，正文与其他章不受影响', () => {
    const { database, project } = setup()
    const target = project.chapters[0]!
    const draft = saveAssistantDraft({
      database, project: database.getProject(project.id), target: { kind: 'chapter', projectId: project.id, objectId: target.id },
      taskType: '局部修改', stage: 'outline', changes: [chapterChange(target, '新目标')]
    }).draft
    const preview = buildAdoptPreview({ project: database.getProject(project.id), draft })
    expect(preview.blockers).toEqual([])
    expect(preview.items[0]!.action).toBe('修改')
    expect(preview.items[0]!.before).toContain('原目标')

    const beforeChapter2 = JSON.stringify(database.getProject(project.id).outline!.volumes[0]!.chapters[1])
    const applied = applyAssistantDraft({
      database, projectId: project.id, draftId: draft.id,
      expectedVersion: draft.version, expectedPreviewDigest: preview.previewDigest
    })
    const card = applied.outline!.volumes.flatMap((volume) => volume.chapters).find((item) => item.id === target.id)!
    expect(card.objective).toBe('新目标')
    expect(JSON.stringify(applied.outline!.volumes[0]!.chapters[1])).toBe(beforeChapter2)
    expect(applied.chapters.map((item) => item.blocks[0]!.text)).toEqual(project.chapters.map((item) => item.blocks[0]!.text))
    expect(database.getAssistantDraftById(project.id, draft.id)?.status).toBe('已采用')
    // 采用留可恢复版本。
    expect(database.listVersions(project.id).length).toBeGreaterThan(0)
    database.close()
  })

  it('重复采用被拒绝，不会执行第二次', () => {
    const { database, project } = setup()
    const target = project.chapters[0]!
    const draft = saveAssistantDraft({
      database, project: database.getProject(project.id), target: { kind: 'chapter', projectId: project.id, objectId: target.id },
      taskType: '局部修改', stage: 'outline', changes: [chapterChange(target, '新目标')]
    }).draft
    const preview = buildAdoptPreview({ project: database.getProject(project.id), draft })
    applyAssistantDraft({ database, projectId: project.id, draftId: draft.id, expectedVersion: draft.version, expectedPreviewDigest: preview.previewDigest })
    const afterFirst = JSON.stringify(database.getProject(project.id))
    expect(() => applyAssistantDraft({ database, projectId: project.id, draftId: draft.id, expectedVersion: draft.version, expectedPreviewDigest: preview.previewDigest }))
      .toThrowError(/已经采用过/)
    expect(JSON.stringify(database.getProject(project.id))).toBe(afterFirst)
    database.close()
  })

  it('预览之后项目被改动，旧预览摘要立刻失效', () => {
    const { database, project } = setup()
    const target = project.chapters[0]!
    const draft = saveAssistantDraft({
      database, project: database.getProject(project.id), target: { kind: 'chapter', projectId: project.id, objectId: target.id },
      taskType: '局部修改', stage: 'outline', changes: [chapterChange(target, '新目标')]
    }).draft
    const stale = buildAdoptPreview({ project: database.getProject(project.id), draft })
    const current = database.getProject(project.id)
    database.saveProject({ ...current, seed: '作者又改了种子' }, current.revision, '手动编辑', '用户编辑')

    expect(() => applyAssistantDraft({ database, projectId: project.id, draftId: draft.id, expectedVersion: draft.version, expectedPreviewDigest: stale.previewDigest }))
      .toThrowError(/已经从版本/)
    expect(database.getProject(project.id).outline!.volumes.flatMap((v) => v.chapters).find((item) => item.id === target.id)!.objective).toBe('原目标')
    database.close()
  })

  it('目标被删除后预览给出阻断，采用不会写出悬空内容', () => {
    const { database, project } = setup()
    const target = project.chapters[0]!
    const draft = saveAssistantDraft({
      database, project: database.getProject(project.id), target: { kind: 'chapter', projectId: project.id, objectId: target.id },
      taskType: '局部修改', stage: 'outline', changes: [chapterChange(target, '新目标')]
    }).draft
    const current = database.getProject(project.id)
    for (const volume of current.outline!.volumes) volume.chapters = volume.chapters.filter((item) => item.id !== target.id)
    database.saveProject(current, current.revision, '删除章纲', '结构调整')

    const preview = buildAdoptPreview({ project: database.getProject(project.id), draft })
    expect(preview.blockers.join(' ')).toMatch(/找不到该章纲|已经从版本/)
    expect(() => applyAssistantDraft({ database, projectId: project.id, draftId: draft.id, expectedVersion: draft.version, expectedPreviewDigest: preview.previewDigest })).toThrow()
    database.close()
  })

  it('两个项目在同一作用域、同一任务类型下各自建草稿：ID 全局唯一，互不冲突也互不串稿', () => {
    const { database, project } = setup()
    const other = makeNovel(1)
    database.createProject(other)

    // 同一作用域键（story-core:）、同一任务类型（引导构建），只是项目不同 —— 这是正常业务输入。
    const mine = saveAssistantDraft({
      database, project: database.getProject(project.id), target: { kind: 'story-core', projectId: project.id },
      taskType: '引导构建', stage: 'outline',
      changes: [{ kind: 'story-core', seed: '甲项目的故事核心', direction: '甲方向' }], summary: '甲的草稿'
    }).draft
    const theirs = saveAssistantDraft({
      database, project: database.getProject(other.id), target: { kind: 'story-core', projectId: other.id },
      taskType: '引导构建', stage: 'outline',
      changes: [{ kind: 'story-core', seed: '乙项目的故事核心', direction: '乙方向' }], summary: '乙的草稿'
    }).draft

    // 草稿 ID 全局唯一，两个项目不可能共用同一个主键。
    expect(mine.id).not.toBe(theirs.id)
    // 按 ID 跨项目读不到：归属只由「项目 + 作用域 + 任务类型」决定。
    expect(database.getAssistantDraftById(other.id, mine.id)).toBeUndefined()
    expect(database.getAssistantDraftById(project.id, theirs.id)).toBeUndefined()
    // 各自的草稿仍是自己的那一份，没有被对方覆盖。
    expect(database.getAssistantDraft(project.id, 'story-core:', '引导构建')?.summary).toBe('甲的草稿')
    expect(database.getAssistantDraft(other.id, 'story-core:', '引导构建')?.summary).toBe('乙的草稿')

    // 重复生成仍遵守「一份工作草稿 + 可回看历史候选」：只更新这一份，不新建第二份。
    const again = saveAssistantDraft({
      database, project: database.getProject(project.id), target: { kind: 'story-core', projectId: project.id },
      taskType: '引导构建', stage: 'outline',
      changes: [{ kind: 'story-core', seed: '甲项目第二版', direction: '甲方向' }], summary: '甲的第二版'
    }).draft
    expect(again.id, '同一项目同一作用域只有一份工作草稿').toBe(mine.id)
    expect(database.listAssistantDrafts(project.id, 'story-core:')).toHaveLength(1)
    expect(database.listAssistantDrafts(other.id, 'story-core:')).toHaveLength(1)
    expect(database.listAssistantCandidateRecords(project.id).length, '每次生成都留一条可回看候选').toBeGreaterThanOrEqual(2)
    database.close()
  })

  it('跨项目草稿既读不到也采用不了', () => {
    const { database, project } = setup()
    const other = makeNovel(1)
    database.createProject(other)
    const draft = saveAssistantDraft({
      database, project: database.getProject(project.id), target: { kind: 'outline', projectId: project.id },
      taskType: '初纲生成', stage: 'outline', changes: [outlineChange]
    }).draft
    expect(database.getAssistantDraftById(other.id, draft.id)).toBeUndefined()
    expect(() => buildAdoptPreview({ project: database.getProject(other.id), draft })).toThrowError(/不属于当前小说项目/)
    database.close()
  })

  it('事务中途失败时项目、版本与草稿状态都没有部分写入', () => {
    const { database, project } = setup()
    const target = project.chapters[0]!
    const draft = saveAssistantDraft({
      database, project: database.getProject(project.id), target: { kind: 'chapter', projectId: project.id, objectId: target.id },
      taskType: '局部修改', stage: 'outline', changes: [chapterChange(target, '新目标')]
    }).draft
    const preview = buildAdoptPreview({ project: database.getProject(project.id), draft })
    const before = JSON.stringify(database.getProject(project.id))
    const versionsBefore = database.listVersions(project.id).length

    // 在「已写入项目」之后、事务提交之前制造失败。
    database.setFailureInjectorForTest((stage: DatabaseWriteCheckpoint) => {
      if (stage === '已写入项目') throw new Error('注入的事务中断')
    })
    expect(() => applyAssistantDraft({ database, projectId: project.id, draftId: draft.id, expectedVersion: draft.version, expectedPreviewDigest: preview.previewDigest }))
      .toThrowError(/注入的事务中断/)
    database.setFailureInjectorForTest(undefined)

    expect(JSON.stringify(database.getProject(project.id)), '项目必须整体回滚').toBe(before)
    expect(database.listVersions(project.id).length).toBe(versionsBefore)
    expect(database.getAssistantDraftById(project.id, draft.id)?.status).toBe('待确认')
    database.close()
  })
})
