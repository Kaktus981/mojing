import { describe, expect, it } from 'vitest'

import {
  applyAddDirectionCard,
  applyAddOutlineVolume,
  applyCreateBlankOutline,
  applyDirectionAnswerEdit,
  applyDirectionCardFieldEdit,
  applyOutlineFieldEdit,
  applyVolumeFieldEdit,
  createBlankOutline,
  type OutlineWritingDraft
} from './outlineIntegrationModel'

/**
 * M3 · 空项目到总纲与卷纲：手写内容的纯 mutator 测试。
 *
 * 这些函数是「总纲 / 卷 / 方向卡」的唯一写入口，页面只负责把它们包进
 * `updateProject`，因此这里证明四件事：
 *   1. 空白大纲契约完整且不含任何示例内容；
 *   2. 只有在还没有大纲时才创建，已有大纲不会被覆盖；
 *   3. 改动定稿规划时退回「草稿」，并刷新大纲时间；
 *   4. 重复操作（重复点击、越界索引、找不到目标）不会产生副作用。
 */

const NOW = '2026-09-14T10:00:00.000Z'

const emptyDraft = (): OutlineWritingDraft => ({
  outline: undefined,
  directionCards: [],
  directionQuestions: [],
  directionQuestionAnswers: []
})

const draftWithOutline = (): OutlineWritingDraft => ({
  outline: {
    status: '定稿',
    synopsis: '',
    themes: [],
    mainConflict: '',
    endingDirection: '',
    volumes: [],
    updatedAt: '2026-09-01T00:00:00.000Z'
  },
  directionCards: [],
  directionQuestions: [],
  directionQuestionAnswers: []
})

describe('空白大纲', () => {
  it('契约完整且不含任何示例内容', () => {
    expect(createBlankOutline(NOW)).toEqual({
      status: '草稿',
      synopsis: '',
      themes: [],
      mainConflict: '',
      endingDirection: '',
      volumes: [],
      updatedAt: NOW
    })
  })

  it('只有还没有大纲时才会创建，已有大纲不会被覆盖', () => {
    const empty = emptyDraft()
    expect(applyCreateBlankOutline(empty, NOW)).toBe(true)
    expect(empty.outline).toEqual(createBlankOutline(NOW))

    const existing = draftWithOutline()
    expect(applyCreateBlankOutline(existing, NOW)).toBe(false)
    expect(existing.outline!.status).toBe('定稿')
  })

  it('没有大纲时任何字段写入都不生效', () => {
    const draft = emptyDraft()
    expect(applyOutlineFieldEdit(draft, 'synopsis', '内容', NOW)).toBe(false)
    expect(applyAddOutlineVolume(draft, 'vol-1', NOW)).toBe(false)
    expect(draft.outline).toBeUndefined()
  })
})

describe('总纲字段', () => {
  it('可手写修改，并把定稿规划退回草稿', () => {
    const draft = draftWithOutline()
    expect(applyOutlineFieldEdit(draft, 'synopsis', '旧城的潮汐钟会改写昨天。', NOW)).toBe(true)
    expect(draft.outline!.synopsis).toBe('旧城的潮汐钟会改写昨天。')
    expect(draft.outline!.status, '改定稿规划必须退回草稿').toBe('草稿')
    expect(draft.outline!.updatedAt).toBe(NOW)

    expect(applyOutlineFieldEdit(draft, 'mainConflict', '记住真相与维持秩序的对立', NOW)).toBe(true)
    expect(applyOutlineFieldEdit(draft, 'endingDirection', '接手巡夜职责', NOW)).toBe(true)
    expect(draft.outline!.mainConflict).toBe('记住真相与维持秩序的对立')
    expect(draft.outline!.endingDirection).toBe('接手巡夜职责')
  })
})

describe('卷', () => {
  it('首卷为第 1 卷且章纲为空，后续卷号取最大值 +1', () => {
    const draft = draftWithOutline()
    applyCreateBlankOutline(draft, NOW)

    expect(applyAddOutlineVolume(draft, 'vol-1', NOW)).toBe(true)
    expect(draft.outline!.volumes[0]).toMatchObject({
      id: 'vol-1',
      volumeNumber: 1,
      title: '第1卷',
      goal: '',
      climax: '',
      resolution: '',
      chapters: []
    })

    expect(applyAddOutlineVolume(draft, 'vol-2', NOW)).toBe(true)
    expect(draft.outline!.volumes[1]!.volumeNumber).toBe(2)
  })

  it('重复的卷 id 不会被追加两次', () => {
    const draft = draftWithOutline()
    applyCreateBlankOutline(draft, NOW)
    applyAddOutlineVolume(draft, 'vol-1', NOW)

    expect(applyAddOutlineVolume(draft, 'vol-1', NOW)).toBe(false)
    expect(draft.outline!.volumes).toHaveLength(1)
  })

  it('卷字段可手写修改，并遵守同一条退回草稿规则', () => {
    const draft = draftWithOutline()
    applyCreateBlankOutline(draft, NOW)
    applyAddOutlineVolume(draft, 'vol-1', NOW)
    draft.outline!.status = '定稿'

    expect(applyVolumeFieldEdit(draft, 'vol-1', 'title', '潮汐卷', NOW)).toBe(true)
    expect(applyVolumeFieldEdit(draft, 'vol-1', 'goal', '确认记忆被改写', NOW)).toBe(true)
    expect(applyVolumeFieldEdit(draft, 'vol-1', 'climax', '与巡夜人对峙', NOW)).toBe(true)
    expect(applyVolumeFieldEdit(draft, 'vol-1', 'resolution', '暂时守住秘密', NOW)).toBe(true)

    expect(draft.outline!.volumes[0]).toMatchObject({
      title: '潮汐卷',
      goal: '确认记忆被改写',
      climax: '与巡夜人对峙',
      resolution: '暂时守住秘密'
    })
    expect(draft.outline!.status).toBe('草稿')
    expect(applyVolumeFieldEdit(draft, 'missing', 'title', 'x', NOW)).toBe(false)
  })
})

describe('方向卡与方向问答', () => {
  it('可手动建立方向卡，新建卡片是合法的空候选', () => {
    const draft = emptyDraft()
    const cardId = applyAddDirectionCard(draft, NOW)
    expect(cardId).toBeTruthy()

    expect(draft.directionCards![0]).toMatchObject({
      id: cardId,
      version: 1,
      status: '候选',
      premise: '',
      coreConflict: '',
      protagonistHook: '',
      emotionalPromise: '',
      openingSituation: '',
      unresolvedQuestions: [],
      createdAt: NOW,
      updatedAt: NOW
    })
  })

  it('方向卡字段可编辑，找不到卡片时不产生副作用', () => {
    const draft = emptyDraft()
    const cardId = applyAddDirectionCard(draft, NOW)!

    expect(applyDirectionCardFieldEdit(draft, cardId, 'title', '潮汐调查线', NOW)).toBe(true)
    expect(applyDirectionCardFieldEdit(draft, cardId, 'premise', '钟声会改写昨天', NOW)).toBe(true)
    expect(draft.directionCards![0]!.title).toBe('潮汐调查线')
    expect(draft.directionCards![0]!.premise).toBe('钟声会改写昨天')
    expect(draft.directionCards![0]!.updatedAt).toBe(NOW)
    expect(applyDirectionCardFieldEdit(draft, 'missing', 'title', 'x', NOW)).toBe(false)
  })

  it('方向问答可编辑，答案数组按位置补齐，越界不写', () => {
    const draft = emptyDraft()
    draft.directionQuestions = ['谁在改写记忆？', '主角的代价是什么？']

    expect(applyDirectionAnswerEdit(draft, 1, '代价是被所有人遗忘')).toBe(true)
    expect(draft.directionQuestionAnswers![0]).toBe('')
    expect(draft.directionQuestionAnswers![1]).toBe('代价是被所有人遗忘')
    expect(applyDirectionAnswerEdit(draft, 5, '越界')).toBe(false)
  })
})
