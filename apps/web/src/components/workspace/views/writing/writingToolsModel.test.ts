import { describe, expect, it } from 'vitest'

import {
  CHAPTER_CONTROL_FIELDS,
  CHAPTER_STATUS_OPTIONS,
  HANDOFF_STATUS_OPTIONS,
  NARRATIVE_MODE_OPTIONS,
  RETRO_PLAN_RESULT_OPTIONS,
  applyChapterControlEdit,
  applyChapterHandoffStatusEdit,
  applyChapterRetroEdit,
  applyChapterStatusEdit,
  applyReplacePlan,
  planReplaceAll,
  searchProse,
  undoReplacePlan,
  type WritingToolsDraft
} from './writingToolsModel'

/**
 * M6 · 正文子页写通道测试。
 *
 * 三条关键行为：
 *   1. 交接不能空着标记「已交接」（不制造假完成）；
 *   2. 批量替换执行前逐段复核，预览之后被改过的段落会让整批取消；
 *   3. 撤销只在「还是替换后的样子」时生效，不覆盖新内容。
 */

const NOW = '2026-09-14T22:00:00.000Z'

const draft = (): WritingToolsDraft => ({
  chapters: [
    {
      id: 'ch-1',
      chapterNumber: 1,
      title: '古钟初鸣',
      status: '草稿',
      blocks: [
        { id: 'b1', text: '林砚在旧城发现古钟，古钟会改写记忆。' },
        { id: 'b2', text: '他决定隐瞒古钟的事。' }
      ]
    },
    {
      id: 'ch-2',
      chapterNumber: 2,
      title: '裂痕',
      status: '草稿',
      blocks: [{ id: 'b3', text: '古钟再次响起。' }]
    }
  ],
  outline: {
    volumes: [
      {
        chapters: [
          { id: 'ch-1', storyTime: '第一天', narrativeMode: '顺叙', pov: '林砚' },
          { id: 'ch-2', pov: '' }
        ]
      }
    ]
  }
})

describe('写作控制', () => {
  it('只接受契约里的叙述方式枚举，并能改故事时间与视角', () => {
    expect([...CHAPTER_CONTROL_FIELDS]).toEqual(['storyTime', 'narrativeMode', 'pov'])
    expect([...NARRATIVE_MODE_OPTIONS]).toEqual(['顺叙', '倒叙', '插叙', '回忆'])

    const target = draft()
    expect(applyChapterControlEdit(target, 'ch-1', 'narrativeMode', '不存在的模式')).toBe(false)
    expect(applyChapterControlEdit(target, 'ch-2', 'narrativeMode', '倒叙')).toBe(true)
    expect(target.outline!.volumes[0]!.chapters[1]!.narrativeMode).toBe('倒叙')

    expect(applyChapterControlEdit(target, 'ch-2', 'storyTime', '第二天')).toBe(true)
    expect(applyChapterControlEdit(target, 'ch-2', 'pov', '巡夜人')).toBe(true)
    expect(target.outline!.volumes[0]!.chapters[1]).toMatchObject({ storyTime: '第二天', pov: '巡夜人' })
  })

  it('可以清空可选的故事时间与叙述方式，但清不掉视角字段本身', () => {
    const target = draft()
    expect(applyChapterControlEdit(target, 'ch-1', 'storyTime', '')).toBe(true)
    expect(target.outline!.volumes[0]!.chapters[0]!.storyTime).toBeUndefined()
    expect(applyChapterControlEdit(target, 'ch-1', 'narrativeMode', '')).toBe(true)
    expect(target.outline!.volumes[0]!.chapters[0]!.narrativeMode).toBeUndefined()
  })

  it('正文状态只接受三个真实取值', () => {
    expect([...CHAPTER_STATUS_OPTIONS]).toEqual(['草稿', '待审校', '定稿'])
    const target = draft()
    expect(applyChapterStatusEdit(target, 'ch-1', '定稿')).toBe(true)
    expect(target.chapters[0]!.status).toBe('定稿')
    expect(applyChapterStatusEdit(target, 'ch-1', '已发布')).toBe(false)
    expect(applyChapterStatusEdit(target, 'ch-1', '定稿'), '同值不写').toBe(false)
  })
})

describe('章后交接', () => {
  it('复盘字段可写，取值受限的字段不接受非法值', () => {
    const target = draft()
    expect(applyChapterRetroEdit(target, 'ch-1', { actualResult: '顺利发现古钟' }, NOW)).toBe(true)
    expect(applyChapterRetroEdit(target, 'ch-1', { planResult: '计划未兑现' }, NOW)).toBe(true)
    expect(applyChapterRetroEdit(target, 'ch-1', { planResult: '随便写的' }, NOW)).toBe(false)
    expect(applyChapterRetroEdit(target, 'ch-1', { nextAdjustment: '下章先去地底' }, NOW)).toBe(true)

    expect(target.chapters[0]!.retro).toMatchObject({
      actualResult: '顺利发现古钟',
      planResult: '计划未兑现',
      nextAdjustment: '下章先去地底',
      deviationReason: ''
    })
    expect([...RETRO_PLAN_RESULT_OPTIONS]).toContain('计划未兑现')
  })

  it('没有写下任何结果时不能标记「已交接」', () => {
    const target = draft()
    const refused = applyChapterHandoffStatusEdit(target, 'ch-1', '已交接', NOW)
    expect(refused.ok).toBe(false)
    expect(refused.message).toMatch(/先写下本章结果/)
    expect(target.chapters[0]!.handoffStatus).toBeUndefined()

    applyChapterRetroEdit(target, 'ch-1', { actualResult: '顺利发现古钟' }, NOW)
    const done = applyChapterHandoffStatusEdit(target, 'ch-1', '已交接', NOW)
    expect(done.ok).toBe(true)
    expect(target.chapters[0]!.handoffStatus).toBe('已交接')
    expect(target.chapters[0]!.retro!.confirmedAt, '确认时间必须真实记录').toBe(NOW)
    expect([...HANDOFF_STATUS_OPTIONS]).toContain('已交接')
  })

  it('写交接口径不会触碰正文内容，也不会产生记忆', () => {
    const target = draft()
    const before = JSON.stringify(target.chapters[0]!.blocks)
    applyChapterRetroEdit(target, 'ch-1', { actualResult: '有进展', deviationReason: '节奏偏慢' }, NOW)
    applyChapterHandoffStatusEdit(target, 'ch-1', '已完成待复盘', NOW)
    expect(JSON.stringify(target.chapters[0]!.blocks), '交接不改正文').toBe(before)
    expect(Object.keys(target)).toEqual(['chapters', 'outline'])
  })

  it('退出「已交接」会清掉确认时间，不留下空头确认', () => {
    const target = draft()
    applyChapterRetroEdit(target, 'ch-1', { actualResult: '有进展' }, NOW)
    applyChapterHandoffStatusEdit(target, 'ch-1', '已交接', NOW)
    applyChapterHandoffStatusEdit(target, 'ch-1', '需补写', NOW)
    expect(target.chapters[0]!.handoffStatus).toBe('需补写')
    expect(target.chapters[0]!.retro!.confirmedAt).toBeUndefined()
  })
})

describe('查找', () => {
  it('当前章与全书范围不同，命中带真实章节与段落位置', () => {
    const target = draft()
    const inChapter = searchProse(target.chapters, '古钟', 'chapter', 'ch-1')
    expect(inChapter.map((hit) => [hit.chapterNumber, hit.blockId, hit.offset])).toEqual([[1, 'b1', 7], [1, 'b1', 10], [1, 'b2', 5]])

    const inBook = searchProse(target.chapters, '古钟', 'book', 'ch-1')
    expect(inBook.map((hit) => hit.chapterId)).toEqual(['ch-1', 'ch-1', 'ch-1', 'ch-2'])

    expect(searchProse(target.chapters, '', 'book', 'ch-1')).toHaveLength(0)
    expect(searchProse(target.chapters, '不存在', 'book', 'ch-1')).toHaveLength(0)
  })

  it('命中摘要包含命中词附近的真实上下文', () => {
    const target = draft()
    const [hit] = searchProse(target.chapters, '隐瞒', 'book', 'ch-1')
    expect(hit!.excerpt).toContain('隐瞒')
    expect(hit!.before).toBe('他决定隐瞒古钟的事。')
  })
})

describe('批量替换', () => {
  it('预览按段落合并命中并算出每段替换后的整段文本', () => {
    const target = draft()
    const hits = searchProse(target.chapters, '古钟', 'book', 'ch-1')
    const plan = planReplaceAll(hits, '古钟', '星纹钟')

    // 第 1 段里「古钟」出现两次，命中 4 处、落在 3 个段落
    expect(plan.hitCount).toBe(4)
    expect(plan.steps.map((step) => step.blockId)).toEqual(['b1', 'b2', 'b3'])
    expect(plan.steps[0]!.after).toBe('林砚在旧城发现星纹钟，星纹钟会改写记忆。')
    expect(target.chapters[0]!.blocks[0]!.text, '预览不改数据').toContain('古钟')
  })

  it('执行时逐段复核：预览之后被改过的段落会让整批取消', () => {
    const target = draft()
    const plan = planReplaceAll(searchProse(target.chapters, '古钟', 'book', 'ch-1'), '古钟', '星纹钟')

    // 作者在预览之后又改了同一段
    target.chapters[0]!.blocks[0]!.text = '林砚在旧城发现古钟，钟声会改写记忆。'
    const result = applyReplacePlan(target, plan)
    expect(result.ok).toBe(false)
    expect(result.applied).toBe(0)
    expect(result.message).toMatch(/已经变化/)
    expect(target.chapters[0]!.blocks[1]!.text, '整批取消，一个都不改').toBe('他决定隐瞒古钟的事。')
  })

  it('未被改动的段落正常替换，整章与全书都支持', () => {
    const target = draft()
    const plan = planReplaceAll(searchProse(target.chapters, '古钟', 'book', 'ch-1'), '古钟', '星纹钟')
    const result = applyReplacePlan(target, plan)

    expect(result.ok).toBe(true)
    expect(result.applied).toBe(3)
    expect(target.chapters[0]!.blocks.map((block) => block.text)).toEqual([
      '林砚在旧城发现星纹钟，星纹钟会改写记忆。',
      '他决定隐瞒星纹钟的事。'
    ])
    expect(target.chapters[1]!.blocks[0]!.text).toBe('星纹钟再次响起。')
  })

  it('替换后可以撤销；撤销前又被改过则不覆盖新内容', () => {
    const target = draft()
    const plan = planReplaceAll(searchProse(target.chapters, '古钟', 'book', 'ch-1'), '古钟', '星纹钟')
    applyReplacePlan(target, plan)
    expect(undoReplacePlan(target, plan).ok).toBe(true)
    expect(target.chapters[0]!.blocks[0]!.text).toBe('林砚在旧城发现古钟，古钟会改写记忆。')

    // 再替换一次，然后手动改动其中一段 → 撤销必须整批取消
    const second = planReplaceAll(searchProse(target.chapters, '古钟', 'book', 'ch-1'), '古钟', '星纹钟')
    applyReplacePlan(target, second)
    target.chapters[0]!.blocks[1]!.text = '他决定把星纹钟的事写进笔记。'
    const undo = undoReplacePlan(target, second)
    expect(undo.ok).toBe(false)
    expect(undo.restored).toBe(0)
    expect(target.chapters[0]!.blocks[0]!.text, '不因撤销而回退别人的新输入').toBe('林砚在旧城发现星纹钟，星纹钟会改写记忆。')
  })

  it('空计划与找不到目标都不会写坏数据', () => {
    const target = draft()
    const plan = planReplaceAll([], '古钟', '星纹钟')
    expect(applyReplacePlan(target, plan).ok).toBe(false)
    expect(undoReplacePlan(target, plan).ok).toBe(false)

    const broken = planReplaceAll(searchProse(target.chapters, '古钟', 'book', 'ch-1'), '古钟', '星纹钟')
    target.chapters[0]!.blocks = target.chapters[0]!.blocks.filter((block) => block.id !== 'b1')
    expect(applyReplacePlan(target, broken).ok).toBe(false)
  })
})
