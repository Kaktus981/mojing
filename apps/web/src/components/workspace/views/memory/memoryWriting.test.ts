import { describe, expect, it } from 'vitest'

import {
  MANUAL_EVIDENCE_PREFIX,
  PLOT_THREAD_STATUS_OPTIONS,
  applyAddChapterMemory,
  applyAddPlotThread,
  applyChapterMemoryEdit,
  applyPlotThreadFieldEdit,
  applyPlotThreadPayoffPlan,
  applyPlotThreadProgress,
  applyPlotThreadResolution,
  applyPlotThreadSetup,
  applyPlotThreadStatusEdit,
  isAuthorWrittenMemory,
  type MemoryWritingDraft
} from './memoryWriting'
import { NovelPlotThreadSchema } from '../../../../../../../packages/contracts/src'

/**
 * M6 · 记忆与伏笔手写通道测试。
 *
 * 核心不是「能写」，而是**不能假装**：没有证据不能埋设 / 推进 / 回收；
 * 作者手写记忆不冒充正文已证实；AI 提取的记忆不被就地改写。
 */

const NOW = '2026-09-14T23:00:00.000Z'

const draft = (): MemoryWritingDraft => ({
  plotThreads: [],
  memories: [],
  chapters: [
    { id: 'ch-1', chapterNumber: 1, blocks: [{ id: 'b1', text: '林砚发现刻有星纹的古钟。' }] },
    { id: 'ch-2', chapterNumber: 2, blocks: [{ id: 'b2', text: '古钟再次响起。' }] }
  ]
})

const evidence = { chapterId: 'ch-1', blockId: 'b1', excerpt: '林砚发现刻有星纹的古钟。' }

describe('伏笔手写', () => {
  it('没有名称不建立；建立后状态为「计划」且没有任何证据', () => {
    const target = draft()
    expect(applyAddPlotThread(target, { title: '  ' }, NOW, 't-1').ok).toBe(false)
    expect(target.plotThreads).toHaveLength(0)

    expect(applyAddPlotThread(target, { title: '古钟星纹' }, NOW, 't-1').ok).toBe(true)
    expect(target.plotThreads[0]).toMatchObject({
      id: 't-1', title: '古钟星纹', detail: '', status: '计划', setupMethod: '', resolutionMethod: '', progress: []
    })
    expect(target.plotThreads[0]!.setupEvidence).toBeUndefined()
  })

  it('状态选项与契约枚举逐字一致', () => {
    expect([...PLOT_THREAD_STATUS_OPTIONS]).toEqual([...NovelPlotThreadSchema.shape.status.options])
  })

  it('埋设必须先有证据；记录后可以标记「已埋设」', () => {
    const target = draft()
    applyAddPlotThread(target, { title: '古钟星纹' }, NOW, 't-1')

    const blocked = applyPlotThreadStatusEdit(target, 't-1', '已埋设', NOW)
    expect(blocked.ok).toBe(false)
    expect(blocked.message).toMatch(/还没有埋设证据/)
    expect(target.plotThreads[0]!.status).toBe('计划')

    expect(applyPlotThreadSetup(target, 't-1', { chapterId: 'ch-1', method: '视觉细节', evidence }, NOW).ok).toBe(true)
    expect(target.plotThreads[0]!.setupEvidence).toEqual(evidence)
    expect(target.plotThreads[0]!.status, '埋设后自动进入已埋设').toBe('已埋设')
    expect(applyPlotThreadStatusEdit(target, 't-1', '推进中', NOW).ok).toBe(true)
  })

  it('证据必须指向真实存在的章节，摘录不能为空', () => {
    const target = draft()
    applyAddPlotThread(target, { title: '古钟星纹' }, NOW, 't-1')
    expect(applyPlotThreadSetup(target, 't-1', { chapterId: '不存在', method: '', evidence }, NOW).ok).toBe(false)
    expect(applyPlotThreadSetup(target, 't-1', { chapterId: 'ch-1', method: '', evidence: { chapterId: 'ch-1', excerpt: '  ' } }, NOW).ok).toBe(false)
    expect(target.plotThreads[0]!.setupEvidence).toBeUndefined()
  })

  it('推进记录追加证据，并把状态推到「推进中」', () => {
    const target = draft()
    applyAddPlotThread(target, { title: '古钟星纹' }, NOW, 't-1')
    const result = applyPlotThreadProgress(target, 't-1', {
      chapterId: 'ch-2', description: '钟声范围扩大', evidence: { chapterId: 'ch-2', blockId: 'b2', excerpt: '古钟再次响起。' }, progressId: 'p-1'
    }, NOW)

    expect(result.ok).toBe(true)
    expect(target.plotThreads[0]!.progress).toHaveLength(1)
    expect(target.plotThreads[0]!.progress[0]).toMatchObject({ id: 'p-1', chapterId: 'ch-2', description: '钟声范围扩大' })
    expect(target.plotThreads[0]!.status).toBe('推进中')
  })

  it('计划回收只写章号；实际回收必须带证据并能自动置为已回收', () => {
    const target = draft()
    applyAddPlotThread(target, { title: '古钟星纹' }, NOW, 't-1')
    expect(applyPlotThreadPayoffPlan(target, 't-1', 30, NOW).ok).toBe(true)
    expect(target.plotThreads[0]!.targetPayoffChapter).toBe(30)
    expect(applyPlotThreadPayoffPlan(target, 't-1', 0, NOW).ok).toBe(false)

    const blocked = applyPlotThreadStatusEdit(target, 't-1', '已回收', NOW)
    expect(blocked.ok).toBe(false)
    expect(blocked.message).toMatch(/没有证据就不能算回收/)

    const resolved = applyPlotThreadResolution(target, 't-1', { chapterId: 'ch-2', method: '正面回收', evidence: { chapterId: 'ch-2', blockId: 'b2', excerpt: '古钟再次响起。' } }, NOW)
    expect(resolved.ok).toBe(true)
    expect(target.plotThreads[0]!.status).toBe('已回收')
    expect(target.plotThreads[0]!.resolutionEvidence!.blockId).toBe('b2')
  })

  it('作者手动说明前缀是常量，便于界面如实标注', () => {
    expect(MANUAL_EVIDENCE_PREFIX).toBe('作者手动说明：')
  })

  it('名称不能被清空', () => {
    const target = draft()
    applyAddPlotThread(target, { title: '古钟星纹' }, NOW, 't-1')
    expect(applyPlotThreadFieldEdit(target, 't-1', 'title', '  ', NOW)).toBe(false)
    expect(applyPlotThreadFieldEdit(target, 't-1', 'detail', '第一章出现', NOW)).toBe(true)
    expect(target.plotThreads[0]!.detail).toBe('第一章出现')
  })

  it('放弃与恢复伏笔保留证据并追加状态历史', () => {
    const target = draft()
    applyAddPlotThread(target, { title: '古钟星纹' }, NOW, 't-1')
    applyPlotThreadSetup(target, 't-1', { chapterId: 'ch-1', method: '视觉细节', evidence }, NOW)
    expect(applyPlotThreadStatusEdit(target, 't-1', '已放弃', NOW).ok).toBe(true)
    expect(target.plotThreads[0]).toMatchObject({
      status: '已放弃', archivedAt: NOW, archivedFromStatus: '已埋设', setupEvidence: evidence
    })
    expect(target.plotThreads[0]!.revisionHistory?.at(-1)).toMatchObject({ fromStatus: '已埋设', toStatus: '已放弃' })

    expect(applyPlotThreadStatusEdit(target, 't-1', '已埋设', NOW).ok).toBe(true)
    expect(target.plotThreads[0]!.archivedAt).toBeUndefined()
    expect(target.plotThreads[0]!.setupEvidence).toEqual(evidence)
    expect(target.plotThreads[0]!.revisionHistory?.at(-1)).toMatchObject({ fromStatus: '已放弃', toStatus: '已埋设' })
  })

  it('重复记录埋设或回收不会覆盖旧证据', () => {
    const target = draft()
    applyAddPlotThread(target, { title: '古钟星纹' }, NOW, 't-1')
    applyPlotThreadSetup(target, 't-1', { chapterId: 'ch-1', method: '视觉细节', evidence }, NOW)
    expect(applyPlotThreadSetup(target, 't-1', { chapterId: 'ch-2', method: '改写', evidence: { chapterId: 'ch-2', excerpt: '新摘录' } }, NOW).ok).toBe(false)
    expect(target.plotThreads[0]!.setupEvidence).toEqual(evidence)
    const payoff = { chapterId: 'ch-2', method: '回收', evidence: { chapterId: 'ch-2', excerpt: '古钟再次响起。' } }
    applyPlotThreadResolution(target, 't-1', payoff, NOW)
    expect(applyPlotThreadResolution(target, 't-1', payoff, NOW).ok).toBe(false)
    expect(target.plotThreads[0]!.resolutionEvidence).toEqual(payoff.evidence)
  })
})

describe('正式记忆手写', () => {
  it('作者手写记忆留空摘要并以「待复核」入库，不冒充正文已证实', () => {
    const target = draft()
    const result = applyAddChapterMemory(target, 'ch-1', { summary: '林砚发现古钟', keyEvents: ['发现古钟'] }, NOW, 'm-1')

    expect(result.ok).toBe(true)
    const memory = target.memories[0]!
    expect(memory).toMatchObject({ id: 'm-1', chapterId: 'ch-1', chapterNumber: 1, status: '待复核', sourceDigest: '', summary: '林砚发现古钟' })
    expect(memory.keyEvents).toEqual(['发现古钟'])
    expect([memory.characterStates, memory.facts, memory.objectStates, memory.timelineEvents, memory.styleSignals].every((list) => Array.isArray(list) && list.length === 0)).toBe(true)
    expect(isAuthorWrittenMemory(memory), '摘录为空 ⇒ 作者手写').toBe(true)
  })

  it('内容为空不建立；同一章不重复建立两份口径', () => {
    const target = draft()
    expect(applyAddChapterMemory(target, 'ch-1', { summary: '  ' }, NOW, 'm-1').ok).toBe(false)
    applyAddChapterMemory(target, 'ch-1', { summary: '林砚发现古钟' }, NOW, 'm-1')
    const second = applyAddChapterMemory(target, 'ch-1', { summary: '另一个说法' }, NOW, 'm-2')
    expect(second.ok).toBe(false)
    expect(second.message).toMatch(/已经有正式记忆/)
    expect(target.memories).toHaveLength(1)
  })

  it('作者手写记忆可以修订，但不能清空内容', () => {
    const target = draft()
    applyAddChapterMemory(target, 'ch-1', { summary: '林砚发现古钟' }, NOW, 'm-1')
    expect(applyChapterMemoryEdit(target, 'm-1', { summary: '林砚在旧城发现古钟' }, NOW).ok).toBe(true)
    expect(target.memories[0]!.summary).toBe('林砚在旧城发现古钟')
    expect(applyChapterMemoryEdit(target, 'm-1', { summary: '' }, NOW).ok).toBe(false)
    expect(applyChapterMemoryEdit(target, 'm-1', { keyEvents: ['发现古钟'] }, NOW).ok).toBe(true)
    expect(target.memories[0]!.keyEvents).toEqual(['发现古钟'])
    expect(target.memories[0]!.editHistory).toEqual([
      { changedAt: NOW, summary: '林砚发现古钟', keyEvents: [] },
      { changedAt: NOW, summary: '林砚在旧城发现古钟', keyEvents: [] }
    ])
  })

  it('分析结果生成的记忆（摘要非空）不能就地改写', () => {
    const target = draft()
    applyAddChapterMemory(target, 'ch-1', { summary: '林砚发现古钟' }, NOW, 'm-1')
    target.memories[0]!.sourceDigest = 'digest-from-analysis'

    const refused = applyChapterMemoryEdit(target, 'm-1', { summary: '改掉它' }, NOW)
    expect(refused.ok).toBe(false)
    expect(refused.message).toMatch(/记忆提案/)
    expect(target.memories[0]!.summary).toBe('林砚发现古钟')
  })
})
