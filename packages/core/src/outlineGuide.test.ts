import { describe, expect, it } from 'vitest'
import type { InitialOutlineCandidate, NovelProject } from '../../contracts/src'
import { NovelProjectSchema } from '../../contracts/src'
import { NovelDatabaseService } from './novelDatabase'
import { makeNovel } from './novelTestFactory'
import {
  answerGuideSlot, effectiveAnswers, ensureGuideSession, guideReadiness, initialOutlineChanges, nextGuideQuestion, saveInitialOutlineDraft
} from './outlineGuide'
import { buildAdoptPreview } from './assistantCandidates'

function projectWith(seed: string, patch: (project: NovelProject) => void = () => {}): NovelProject {
  const base = makeNovel(1)
  const project = structuredClone(base) as NovelProject
  project.seed = seed
  patch(project)
  return NovelProjectSchema.parse(project)
}

/** 去掉项目里已有的角色/冲突，用于验证「从零开始」的引导顺序。 */
function bareProject(seed: string): NovelProject {
  return projectWith(seed, (draft) => {
    draft.worldBible!.entries = []
    draft.outline!.mainConflict = ''
    draft.outline!.endingDirection = ''
  })
}

function setup(seed = '巡夜人发现旧城的潮汐钟正在改写人们对昨天的记忆。') {
  const database = new NovelDatabaseService(':memory:')
  const project = projectWith(seed)
  database.createProject(project)
  return { database, project }
}

const candidate: InitialOutlineCandidate = {
  core: '一座会改写记忆的钟，逼一个巡夜人选择记住还是遗忘。',
  skeleton: { 开端: '钟声第一次异常', 发展: '追查钟的来源', 转折: '巡夜人发现自己也被改写过', 高潮: '在钟前做出取舍', 结局: '城市记住了代价' },
  volumes: [{ volumeNumber: 1, title: '旧城', goal: '确认钟真的在改写记忆' }, { volumeNumber: 2, title: '潮汐', goal: '找到钟的来源并付出代价' }],
  storylines: [{ title: '潮汐钟的真相', why: '全书的悬念主线' }],
  pending: ['主角与目标']
}

describe('大纲引导（D1/D2）', () => {
  it('只有故事想法是硬条件，没写种子不能开始引导', () => {
    const database = new NovelDatabaseService(':memory:')
    const project = projectWith('   ')
    database.createProject(project)
    expect(() => ensureGuideSession(database, project)).toThrowError(/先写下最初的故事想法/)
    const readiness = guideReadiness(project, undefined)
    expect(readiness.hasSeed).toBe(false)
    expect(readiness.canGenerate).toBe(false)
    database.close()
  })

  it('一次只问一个缺口，且永远允许跳过', () => {
    const database = new NovelDatabaseService(':memory:')
    const project = bareProject('巡夜人发现旧城的潮汐钟正在改写人们对昨天的记忆。')
    database.createProject(project)
    const session = ensureGuideSession(database, project)
    const first = nextGuideQuestion(project, session)!
    expect(first.slot).toBe('protagonist')
    expect(first.options.length).toBeGreaterThanOrEqual(3)
    expect(first.options.length).toBeLessThanOrEqual(5)
    expect(first.options[0]!.reason.length).toBeGreaterThan(0)
    expect(first.allowSkip).toBe(true)

    const afterSkip = answerGuideSlot({ database, project, slot: first.slot, state: '已跳过' })
    const second = nextGuideQuestion(project, afterSkip)!
    expect(second.slot, '跳过之后问下一个，不卡在同一个问题上').toBe('coreConflict')
    database.close()
  })

  it('不确定与跳过都不阻断，未定的项进待确认', () => {
    const database = new NovelDatabaseService(':memory:')
    const project = bareProject('巡夜人发现旧城的潮汐钟正在改写人们对昨天的记忆。')
    database.createProject(project)
    // 主角「不确定」、结局「已跳过」：只要还有两项可用就能生成，缺的进待确认。
    let session = ensureGuideSession(database, project)
    session = answerGuideSlot({ database, project, slot: 'protagonist', state: '不确定' })
    session = answerGuideSlot({ database, project, slot: 'coreConflict', state: '已回答', value: '钟的代价是记忆' })
    session = answerGuideSlot({ database, project, slot: 'endingDirection', state: '已回答', value: '付出代价的苦甜结局' })
    const readiness = guideReadiness(project, session)
    expect(readiness.canGenerate).toBe(true)
    expect(readiness.pending).toContain('主角与目标')
    expect(readiness.pending).not.toContain('结局方向')

    // 换成「跳过」同样不阻断（此时主角已补上、主要阻力跳过，仍有一项可用 + 主角已答）。
    let skipped = answerGuideSlot({ database, project, slot: 'protagonist', state: '已回答', value: '巡夜人林砚' })
    skipped = answerGuideSlot({ database, project, slot: 'coreConflict', state: '已跳过' })
    expect(guideReadiness(project, skipped).canGenerate).toBe(true)
    expect(guideReadiness(project, skipped).pending).toContain('主要阻力')
    database.close()
  })

  it('AI 给出的选项在未被点击前不是事实', () => {
    const database = new NovelDatabaseService(':memory:')
    const project = bareProject('巡夜人发现旧城的潮汐钟正在改写人们对昨天的记忆。')
    database.createProject(project)
    const session = ensureGuideSession(database, project)
    const question = nextGuideQuestion(project, session)!
    // 仅仅拿到选项，不写入会话：就绪状态里不能出现这项。
    expect(question.options.length).toBeGreaterThan(0)
    expect(effectiveAnswers(project, session).some((item) => item.slot === question.slot)).toBe(false)
    const readiness = guideReadiness(project, session)
    expect(readiness.answered).not.toContain(question.slot)
    // 点击并明确记录之后才算已知。
    const answered = answerGuideSlot({ database, project, slot: question.slot, state: '已回答', value: question.options[0]!.label, source: '作者选择' })
    expect(guideReadiness(project, answered).answered).toContain(question.slot)
    database.close()
  })

  it('项目里已有的内容视为已知，不重复索取', () => {
    const { database, project } = setup()
    const rich = structuredClone(database.getProject(project.id))
    rich.outline!.mainConflict = '记忆被改写后还能不能相信自己的判断'
    database.saveProject(rich, rich.revision, '手动编辑', '用户编辑')
    const session = ensureGuideSession(database, database.getProject(rich.id))
    const readiness = guideReadiness(database.getProject(rich.id), session)
    expect(readiness.answered).toContain('coreConflict')
    expect(nextGuideQuestion(database.getProject(rich.id), session)!.slot).not.toBe('coreConflict')
    database.close()
  })

  it('缺口按对结构的影响排序，并说明为什么先问它（P04）', () => {
    const database = new NovelDatabaseService(':memory:')
    // 种子已经点明对抗，但阻力还没定：最影响结构的是「主要阻力」，不是固定顺序里的第一个。
    const project = bareProject('巡夜人发现钟声在改写记忆，他必须阻止第七夜的钟响。')
    database.createProject(project)
    const session = ensureGuideSession(database, project)
    const first = nextGuideQuestion(project, session)!
    expect(first.slot).toBe('coreConflict')
    expect(first.whyThisFirst.length).toBeGreaterThan(0)
    expect(first.whyThisFirst).toMatch(/阻力|对抗|阻止/)
    // 与「模板顺序」可区分：同一个项目里，种子没有信号时必须退回主角优先。
    const plain = bareProject('巡夜人发现旧城的潮汐钟正在改写人们对昨天的记忆。')
    database.createProject(plain)
    expect(nextGuideQuestion(plain, ensureGuideSession(database, plain))!.slot).toBe('protagonist')
    database.close()
  })

  it('选项贴合当前故事：用故事焦点与已回答内容生成，而不是固定模板拼整句种子（P04）', () => {
    const database = new NovelDatabaseService(':memory:')
    const project = bareProject('巡夜人发现旧城的潮汐钟正在改写人们对昨天的记忆。')
    database.createProject(project)
    const session = ensureGuideSession(database, project)
    const protagonistQuestion = nextGuideQuestion(project, session)!
    expect(protagonistQuestion.slot).toBe('protagonist')
    // 焦点是从种子里提炼的短语，不是把整句种子塞进模板。
    expect(protagonistQuestion.options.some((option) => option.label.includes('旧城的潮汐钟'))).toBe(true)
    expect(protagonistQuestion.options.every((option) => !option.label.includes('正在改写人们对昨天的记忆'))).toBe(true)

    // 作者定下主角之后，下一个问题必须把这名主角真正用进方向与理由里。
    const answered = answerGuideSlot({ database, project, slot: 'protagonist', state: '已回答', value: '巡夜人林砚', source: '作者选择' })
    const conflictQuestion = nextGuideQuestion(project, answered)!
    expect(conflictQuestion.slot).toBe('coreConflict')
    expect(conflictQuestion.options.some((option) => option.label.includes('林砚'))).toBe(true)

    // 同一槽位在两个不同故事里必须给出不同方向：证明不是固定模板。
    const other = bareProject('一名修表匠发现城里所有人的时间都在倒着走。')
    database.createProject(other)
    const otherQuestion = nextGuideQuestion(other, ensureGuideSession(database, other))!
    expect(otherQuestion.options.map((option) => option.label))
      .not.toEqual(protagonistQuestion.options.map((option) => option.label))
    database.close()
  })

  it('已有正式信息进入「已知」清单，作者能看见引导到底用了什么（P04）', () => {
    const { database, project } = setup()
    const readiness = guideReadiness(project, undefined)
    const known = readiness.known.find((item) => item.slot === 'protagonist')
    expect(known?.value).toContain('林砚')
    expect(known?.source).toBe('来自项目')
    expect(readiness.focus.length).toBeGreaterThan(0)
    // 未点击的方向永远不进「已知」。
    const session = ensureGuideSession(database, project)
    const question = nextGuideQuestion(project, session)!
    expect(guideReadiness(project, session).known.some((item) => item.value === question.options[0]!.label)).toBe(false)
    database.close()
  })

  it('退出再回来不丢回答，会话按项目持久化', () => {
    const { database, project } = setup()
    answerGuideSlot({ database, project, slot: 'protagonist', state: '已回答', value: '巡夜人林砚', source: '作者选择' })
    const reloaded = database.getGuideSession(project.id)!
    expect(reloaded.answers.find((item) => item.slot === 'protagonist')?.value).toBe('巡夜人林砚')
    expect(reloaded.askedSlots).toContain('protagonist')
    database.close()
  })
})

describe('初纲候选（D2）', () => {
  it('只写故事核心、总纲、卷目标与故事线，不生成章节、正文、词条或伏笔', () => {
    const { database, project } = setup()
    const { changes } = initialOutlineChanges({ project, candidate })
    expect(changes.filter((item) => item.kind === 'outline')).toHaveLength(1)
    expect(changes.filter((item) => item.kind === 'volume')).toHaveLength(2)
    expect(changes.filter((item) => item.kind === 'storyline')).toHaveLength(1)
    // 初纲不产生任何章节或步骤变更。
    expect(changes.map((item) => item.kind)).toEqual(['outline', 'volume', 'volume', 'storyline'])
    void database
  })

  it('初纲落为草稿，采用前正式项目不变；变更作为一个依赖组整体确认', () => {
    const { database, project } = setup()
    const session = ensureGuideSession(database, project)
    const before = JSON.stringify(database.getProject(project.id))
    const saved = saveInitialOutlineDraft({ database, project, candidate, session, sourceDigest: 'digest-1' })
    expect(JSON.stringify(database.getProject(project.id))).toBe(before)

    const draft = database.getAssistantDraftById(project.id, saved.draftId)!
    expect(draft.dependencyGroups).toHaveLength(1)
    expect(draft.dependencyGroups[0]!.changeIndexes.length).toBe(draft.changes.length)
    expect(database.getGuideSession(project.id)?.status).toBe('已生成')

    const preview = buildAdoptPreview({ project: database.getProject(project.id), draft })
    expect(preview.blockers).toEqual([])
    expect(preview.items.length).toBe(draft.changes.length)
    database.close()
  })

  it('模型输出缺字段时不会吞错，也不会写出半份草稿', () => {
    const { database, project } = setup()
    const broken = { ...candidate, skeleton: { ...candidate.skeleton, 高潮: undefined } } as unknown as InitialOutlineCandidate
    expect(() => initialOutlineChanges({ project, candidate: broken })).not.toThrow()
    const before = JSON.stringify(database.getProject(project.id))
    expect(() => saveInitialOutlineDraft({ database, project, candidate: broken, session: ensureGuideSession(database, project), sourceDigest: 'd' }))
      .not.toThrow()
    expect(database.listAssistantDrafts(project.id).length).toBeLessThanOrEqual(1)
    // 正式项目仍然没被改动。
    expect(JSON.stringify(database.getProject(project.id))).toBe(before)
    database.close()
  })
})
