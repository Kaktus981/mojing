import { describe, expect, it } from 'vitest'
import { NovelOutlineSchema, NovelPlotThreadSchema, NovelStorylineSchema, type ChapterOutline, type NovelOutline } from '../../contracts/src'
import { assessStorylineHealth, buildPlotThreadEvidencePool, buildRollingOutlineWindow, calculatePlotThreadReadiness, calculateStorylineProgress, explainPlotThreadCognition, evaluateChapterLineAssignments, hasMeaningfulStorylineChange, archivePlotThread, restoreArchivedPlotThread } from './novelStoryline'

describe('跨章节剧情线与滚动大纲', () => {
  it('默认一条主线、最多两条辅助线，并对复杂高潮给出软提醒', () => {
    const normal = evaluateChapterLineAssignments([
      { lineId: 'main', role: '主线', purpose: '追查线索' },
      { lineId: 'relation', role: '辅助线', purpose: '关系变化' }
    ])
    expect(normal.valid).toBe(true)
    expect(normal.warnings).toEqual([])
    const crowded = evaluateChapterLineAssignments([
      { lineId: 'main-a', role: '主线' }, { lineId: 'main-b', role: '主线' },
      { lineId: 'side-a', role: '辅助线' }, { lineId: 'side-b', role: '辅助线' }, { lineId: 'side-c', role: '辅助线' }
    ])
    expect(crowded.valid).toBe(false)
    expect(crowded.warnings.join('；')).toContain('分散')
    const exception = evaluateChapterLineAssignments([
      { lineId: 'main-a', role: '主线', exceptionReason: '阶段高潮中两条线因同一事件汇合' },
      { lineId: 'main-b', role: '主线', exceptionReason: '阶段高潮中两条线因同一事件汇合' }
    ])
    expect(exception.valid).toBe(true)
  })

  it('计算事件线节点与章节计划的进度，并识别暂停和返回位置', () => {
    const line = NovelStorylineSchema.parse({
      id: 'investigation', title: '失踪案调查', type: '调查', whyNecessary: '揭开主冲突的入口',
      openingState: '只知道失踪发生', finalGoal: '确认幕后组织', endCondition: '证据链闭合',
      keyNodes: [
        { id: 'n1', title: '找到第一条线索', description: '', status: '已完成' },
        { id: 'n2', title: '验证线索', description: '', status: '未开始' }
      ],
      chapterPlans: [{ chapterId: 'c1', chapterNumber: 1, subGoal: '询问目击者', method: '走访', obstacle: '证词矛盾', outcome: '得到地址', nextTrigger: '前往地址', changes: ['信息'], status: '已完成' }],
      currentProgress: 0, status: '计划暂停', pause: {
        reason: '主角需要先处理伤势', currentState: '地址尚未核验', unresolvedQuestions: ['目击者是否可靠'], returnCondition: '伤势稳定后重新核验地址', expectedReturnPosition: '下一章开头', expectedReturnChapterNumber: 3, scope: '下一章', behindTheScenesChange: '', pausedAtChapterNumber: 2
      }, updatedAt: '2026-08-30T00:00:00.000Z'
    })
    const progress = calculateStorylineProgress(line)
    expect(progress.progress).toBe(.75)
    expect(progress.level).toBe('推进中')
    const health = assessStorylineHealth(line, 2)
    expect(health.pauseReason).toContain('处理伤势')
    expect(health.returnPosition).toBe('下一章开头')
    expect(health.breakRisk).toBe('低')
    expect(health.nextPlan).toBeUndefined()
  })

  it('滚动窗口默认二十章、限制十到三十章，并保留前后衔接位置和事件线', () => {
    const outline = makeOutline(45)
    const storyline = NovelStorylineSchema.parse({
      id: 'war', title: '边境冲突', type: '战争', whyNecessary: '改变势力格局', openingState: '边境紧张', finalGoal: '签署停战协议', endCondition: '双方完成交换',
      startChapterNumber: 18, expectedEndChapterNumber: 35,
      chapterPlans: [{ chapterId: 'c20', chapterNumber: 20, subGoal: '截获信使', method: '埋伏', obstacle: '追兵', outcome: '获得密信', nextTrigger: '解读密信', changes: ['信息'] }], updatedAt: '2026-08-30T00:00:00.000Z'
    })
    const result = buildRollingOutlineWindow(outline, 20, [storyline])
    expect(result.window.detailStartChapterNumber).toBe(20)
    expect(result.window.detailEndChapterNumber).toBe(39)
    expect(result.chapters).toHaveLength(20)
    expect(result.beforeChapterIds).toHaveLength(3)
    expect(result.afterChapterIds).toHaveLength(3)
    expect(result.visibleStorylineIds).toEqual(['war'])
    const capped = buildRollingOutlineWindow(outline, 20, [], { windowSize: 100 })
    expect(capped.chapters).toHaveLength(26)
  })

  it('章节计划没有可观察变化时提示可能注水', () => {
    expect(hasMeaningfulStorylineChange({ changes: ['信息'] })).toBe(true)
    expect(hasMeaningfulStorylineChange({ changes: ['无变化'] })).toBe(false)
  })

  it('把旧版分散证据归一为证据池并去重，保留埋设、推进和回收定位', () => {
    const thread = NovelPlotThreadSchema.parse({
      id: 'thread-1', title: '失踪信件', detail: '查明信件去向', characterIds: [], status: '推进中', type: '调查', whyNecessary: '揭开主冲突', openingState: '信件失踪', finalGoal: '找回信件', endCondition: '信件被公开',
      setupChapterId: 'c1', setupMethod: '门缝下露出一角', setupEvidence: { chapterId: 'c1', blockId: 'b1', excerpt: '门缝下露出一角' },
      resolutionChapterId: 'c9', resolutionMethod: '当众拆信', resolutionEvidence: { chapterId: 'c9', excerpt: '信封在众人面前拆开' },
      progress: [{ id: 'p1', chapterId: 'c3', description: '找到送信人', source: { chapterId: 'c3', excerpt: '找到送信人' } }, { id: 'p2', chapterId: 'c3', description: '重复证据', source: { chapterId: 'c3', excerpt: '找到送信人' } }],
      evidencePool: [{ id: 'e1', phase: '旁证', chapterId: 'c4', excerpt: '守门人也看见过信封', note: '旁证', source: '作者记录', confidence: .8, status: '有效' }], updatedAt: '2026-08-31T00:00:00.000Z'
    })
    const pool = buildPlotThreadEvidencePool(thread)
    expect(pool.map((item) => item.phase)).toEqual(['旁证', '埋设', '推进', '回收'])
    expect(pool.filter((item) => item.phase === '推进')).toHaveLength(1)
    expect(pool.find((item) => item.phase === '埋设')?.blockId).toBe('b1')
  })

  it('准备度同时给出分数、满足项、缺口和下一步建议', () => {
    const thread = NovelPlotThreadSchema.parse({
      id: 'thread-2', title: '旧钟暗纹', detail: '追查暗纹来源', characterIds: [], status: '推进中', type: '调查', whyNecessary: '揭开真相', openingState: '只见暗纹', finalGoal: '确认来源', endCondition: '真相公开',
      setupChapterId: 'c1', setupMethod: '视觉细节', setupEvidence: { chapterId: 'c1', excerpt: '钟背刻着暗纹' }, resolutionMethod: '',
      targetPayoffChapter: 12, progress: [{ id: 'p1', chapterId: 'c5', description: '找到拓印', source: { chapterId: 'c5', excerpt: '拓印显示相同暗纹' } }],
      cognition: { reader: '读者知道暗纹与失踪案有关', protagonist: '', otherCharacters: [], gapSummary: '' }, updatedAt: '2026-08-31T00:00:00.000Z'
    })
    const readiness = calculatePlotThreadReadiness(thread, { now: '2026-08-31T00:00:00.000Z' })
    expect(readiness.score).toBeGreaterThan(0)
    expect(readiness.fulfilled.some((item) => item.includes('埋设'))).toBe(true)
    expect(readiness.gaps.some((item) => item.includes('主角'))).toBe(true)
    expect(readiness.recommendation).toContain('下一步')
    expect(readiness.phaseCounts.推进).toBe(1)
  })

  it('结构化认知差保留读者、主角和其他角色，并提示缺口', () => {
    const thread = NovelPlotThreadSchema.parse({
      id: 'thread-3', title: '密室钥匙', detail: '钥匙去向', characterIds: [], status: '已埋设', type: '悬疑', whyNecessary: '推动调查', openingState: '钥匙失踪', finalGoal: '找到钥匙', endCondition: '钥匙归位',
      setupMethod: '动作细节', setupEvidence: { chapterId: 'c1', excerpt: '钥匙被藏起' }, resolutionMethod: '', progress: [],
      cognition: { reader: '读者知道钥匙在墙后', protagonist: '主角只知道钥匙失踪', otherCharacters: [{ characterId: 'c2', characterName: '守门人', knowledge: '守门人以为钥匙被带走', evidenceIds: [] }], gapSummary: '读者比主角多知道藏匿地点' },
      updatedAt: '2026-08-31T00:00:00.000Z'
    })
    const view = explainPlotThreadCognition(thread)
    expect(view.reader).toContain('墙后')
    expect(view.protagonist).toContain('失踪')
    expect(view.otherCharacters[0]?.characterName).toBe('守门人')
    expect(view.gap).toContain('多知道')
    expect(view.warnings).toEqual([])
  })

  it('放弃伏笔只归档状态，恢复时仍保留全部证据和历史', () => {
    const thread = NovelPlotThreadSchema.parse({
      id: 'thread-4', title: '旧债', detail: '等待偿还', characterIds: [], status: '推进中', type: '关系', whyNecessary: '推动人物选择', openingState: '欠债', finalGoal: '偿还旧债', endCondition: '双方和解', setupEvidence: { chapterId: 'c1', excerpt: '旧债凭据' },
      progress: [{ id: 'p1', chapterId: 'c2', description: '收到催债信', source: { chapterId: 'c2', excerpt: '催债信' } }], resolutionMethod: '', updatedAt: '2026-08-31T00:00:00.000Z'
    })
    const archived = archivePlotThread(thread, { reason: '作者改为支线背景', archivedAt: '2026-08-31T01:00:00.000Z' })
    expect(archived.status).toBe('已放弃')
    expect(archived.archivedAt).toBe('2026-08-31T01:00:00.000Z')
    expect(archived.evidencePool).toHaveLength(2)
    expect(archived.revisionHistory).toHaveLength(1)
    const restored = restoreArchivedPlotThread(archived, '推进中', { restoredAt: '2026-08-31T02:00:00.000Z' })
    expect(restored.status).toBe('推进中')
    expect(restored.archivedAt).toBeUndefined()
    expect(restored.evidencePool).toHaveLength(2)
    expect(restored.revisionHistory).toHaveLength(2)
  })
})

function makeOutline(count: number): NovelOutline {
  const chapters: ChapterOutline[] = Array.from({ length: count }, (_, index) => ({
    id: `c${index + 1}`, volumeNumber: 1, chapterNumber: index + 1, title: `第${index + 1}章`, pov: '', objective: '', conflict: '', turningPoint: '', reveal: '', endingHook: '', characterIds: [], setupThreadIds: [], payoffThreadIds: [], beats: [], status: '已规划', beatStatus: '未生成', beatFindings: [], lineAssignments: []
  }))
  return NovelOutlineSchema.parse({ status: '草稿', synopsis: '', themes: [], mainConflict: '', endingDirection: '', volumes: [{ id: 'v1', volumeNumber: 1, title: '第一卷', goal: '', climax: '', resolution: '', chapters }], updatedAt: '2026-08-30T00:00:00.000Z' })
}
