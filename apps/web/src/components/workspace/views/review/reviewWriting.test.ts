import { describe, expect, it } from 'vitest'
import type { NovelProject } from '../../../../../../../packages/contracts/src'
import { buildExportPrecheck, exportPrecheckAllowsExport, exportPrecheckState } from './exportPrecheck'
import {
  MANUAL_EVIDENCE_PREFIX,
  applyAddReviewIssue,
  applyReopenReviewIssue,
  applyReviewResolution,
  reviewEvidenceProblem,
  type ReviewWritingDraft
} from './reviewWriting'

const NOW = '2026-09-14T10:00:00.000Z'

/** 完整章节记忆（契约必填字段齐全），用于预检夹具。 */
function memoryFixture(chapterId: string, status = '正式') {
  return {
    id: `memory-${chapterId}`, chapterId, chapterNumber: 1, status, sourceDigest: 'digest', summary: '林砚发现古钟',
    keyEvents: [], characterStates: [], facts: [], objectStates: [], timelineEvents: [], styleSignals: [], updatedAt: NOW
  }
}

/**
 * 只构造本文件真正会读到的字段（章节 / 处理记录 / 引用），
 * 避免 web 端测试反向依赖 packages/core 的测试工厂。
 */
function chapterFixture(index: number) {
  return {
    id: `chapter-${index}`, volumeNumber: 1, chapterNumber: index, title: `第${index}章`,
    blocks: [{ id: `chapter-${index}-b1`, text: `第${index}章正文：林砚在旧城发现一座刻有星纹的古钟。` }],
    status: '草稿', sourceDigest: '', updatedAt: NOW
  }
}

function threadFixture(chapterId: string) {
  return {
    id: 'thread-1', title: '古钟星纹', detail: '', characterIds: [], status: '推进中',
    setupChapterId: chapterId, setupMethod: '', setupEvidence: { chapterId, blockId: `${chapterId}-b1`, excerpt: '古钟' },
    resolutionMethod: '', progress: [], updatedAt: NOW
  }
}

function draft(): ReviewWritingDraft & NovelProject {
  const chapters = [chapterFixture(1), chapterFixture(2)]
  const project = {
    id: 'novel-test', revision: 3, title: '星纹古钟',
    chapters,
    reviews: [],
    memories: [],
    plotThreads: [threadFixture(chapters[0]!.id)]
  }
  return project as unknown as ReviewWritingDraft & NovelProject
}

describe('人工新建审稿问题', () => {
  it('必须有关联章节与可定位证据：摘录要来自该段原文', () => {
    const subject = draft()
    const chapter = subject.chapters[0]!
    const block = chapter.blocks[0]!

    expect(applyAddReviewIssue(subject, {
      id: 'review-1', category: '连续性', severity: '高', title: '钟声规则前后矛盾', description: '第一章说改写记忆，第二章说改写时间。',
      chapterId: chapter.id, evidence: [{ chapterId: chapter.id, blockId: block.id, excerpt: '钟声会改写昨天' }]
    }, NOW)).toMatchObject({ ok: false })

    const ok = applyAddReviewIssue(subject, {
      id: 'review-1', category: '连续性', severity: '高', title: '钟声规则前后矛盾', description: '第一章说改写记忆，第二章说改写时间。',
      chapterId: chapter.id, evidence: [{ chapterId: chapter.id, blockId: block.id, excerpt: block.text.slice(0, 8) }]
    }, NOW)
    expect(ok.ok).toBe(true)
    expect(subject.reviews[0]).toMatchObject({ id: 'review-1', status: '待处理', severity: '高', category: '连续性' })
    expect(subject.reviews[0]!.resolution, '新建问题不带处理记录').toBeUndefined()
  })

  it('承认作者转述：允许「作者手动说明：」而拒绝无法定位的伪证据', () => {
    const subject = draft()
    const chapter = subject.chapters[0]!

    expect(reviewEvidenceProblem(subject, { chapterId: chapter.id, excerpt: '这一段读起来不顺' })).toContain('作者手动说明')
    expect(reviewEvidenceProblem(subject, { chapterId: chapter.id, blockId: chapter.blocks[0]!.id, excerpt: '这一段读起来不顺' })).toContain('原文')
    expect(reviewEvidenceProblem(subject, { chapterId: chapter.id, excerpt: `${MANUAL_EVIDENCE_PREFIX}读起来不顺` })).toBeUndefined()
    expect(reviewEvidenceProblem(subject, { chapterId: 'missing', excerpt: 'x' })).toContain('真实存在的章节')
  })

  it('缺标题或描述不建立问题', () => {
    const subject = draft()
    expect(applyAddReviewIssue(subject, { id: 'a', category: '逻辑', severity: '低', title: '', description: 'x' }, NOW).message).toContain('标题')
    expect(applyAddReviewIssue(subject, { id: 'a', category: '逻辑', severity: '低', title: 'x', description: ' ' }, NOW).message).toContain('描述')
    expect(subject.reviews).toHaveLength(0)
  })
})

describe('处理记录与重新打开', () => {
  function withIssue(): ReviewWritingDraft & NovelProject {
    const subject = draft()
    applyAddReviewIssue(subject, { id: 'review-1', category: '节奏', severity: '中', title: '中段拖沓', description: '第二章节奏偏慢。' }, NOW)
    return subject
  }

  it('忽略类处理必须写理由，否则不落库', () => {
    const subject = withIssue()
    const failed = applyReviewResolution(subject, 'review-1', { method: '风险已知仍忽略', reason: '', status: '已忽略' }, NOW)
    expect(failed.ok).toBe(false)
    expect(failed.message).toContain('必须写清处理理由')
    expect(subject.reviews[0]!.status, '失败不得改状态').toBe('待处理')

    expect(applyReviewResolution(subject, 'review-1', { method: '风险已知仍忽略', reason: '有意保留悬念', status: '已忽略' }, NOW).ok).toBe(true)
    expect(subject.reviews[0]!.status).toBe('已忽略')
    expect(subject.reviews[0]!.resolution).toMatchObject({ method: '风险已知仍忽略', reason: '有意保留悬念', resolvedAt: NOW })
  })

  it('声明「正文已手动修复」必须附新正文证据', () => {
    const subject = withIssue()
    const chapter = subject.chapters[0]!
    expect(applyReviewResolution(subject, 'review-1', { method: '正文已手动修复', status: '已完成' }, NOW).message).toContain('必须附上新的正文证据')

    const block = chapter.blocks[0]!
    expect(applyReviewResolution(subject, 'review-1', {
      method: '正文已手动修复', status: '已完成',
      evidence: [{ chapterId: chapter.id, blockId: block.id, excerpt: block.text.slice(0, 6) }]
    }, NOW).ok).toBe(true)
    expect(subject.reviews[0]!.resolution!.evidence).toHaveLength(1)
  })

  it('重新打开只改状态，上次处理记录保留为历史', () => {
    const subject = withIssue()
    applyReviewResolution(subject, 'review-1', { method: '无需修改', reason: '已确认是叙述需要', status: '已完成' }, NOW)

    expect(applyReopenReviewIssue(subject, 'review-1').ok).toBe(true)
    expect(subject.reviews[0]!.status).toBe('待处理')
    expect(subject.reviews[0]!.resolution, '历史记录不得被删除或覆盖').toMatchObject({ method: '无需修改', resolvedAt: NOW })
    expect(applyReopenReviewIssue(subject, 'review-1').ok, '本来就是待处理时不重复操作').toBe(false)
  })

  it('处理问题不会自动改写正文', () => {
    const subject = withIssue()
    const before = JSON.stringify(subject.chapters)
    applyReviewResolution(subject, 'review-1', { method: '候选已应用并复核', status: '已完成' }, NOW)
    expect(JSON.stringify(subject.chapters), '改状态不等于改正文').toBe(before)
  })
})

describe('导出前本地预检', () => {
  const context = { saveState: '已保存', pendingProposalCount: 0, now: NOW }

  it('没有正文时阻断普通导出，但 JSON 完整备份仍可导出', () => {
    const project = draft()
    project.chapters = []
    const text = buildExportPrecheck(project, 'txt', context)
    expect(text.blockers.map((item) => item.code)).toContain('无可导出正文')
    expect(exportPrecheckAllowsExport(exportPrecheckState(text, { projectRevision: project.revision, format: 'txt' }))).toBe(false)

    const json = buildExportPrecheck(project, 'json', context)
    expect(json.blockers, 'JSON 备份不做内容质量阻断').toHaveLength(0)
    expect(exportPrecheckAllowsExport(exportPrecheckState(json, { projectRevision: project.revision, format: 'json' }))).toBe(true)
  })

  it('保存没成功就阻断导出，避免拿旧稿冒充最新内容', () => {
    const project = draft()
    const precheck = buildExportPrecheck(project, 'txt', { ...context, saveState: '未保存' })
    expect(precheck.blockers.map((item) => item.code)).toContain('保存失败')
  })

  it('重复章号与悬空引用是阻断项，不是提醒', () => {
    const project = draft()
    project.chapters[1]!.chapterNumber = 1
    project.memories = [memoryFixture('ghost')] as NovelProject['memories']

    const precheck = buildExportPrecheck(project, 'txt', context)
    const codes = precheck.blockers.map((item) => item.code)
    expect(codes).toContain('项目结构损坏')
    expect(codes).toContain('存在缺失引用')
  })

  it('内容质量只产生提醒：空章、草稿章、待处理问题、过期记忆、逾期伏笔、未应用候选', () => {
    const project = draft()
    project.chapters[1]!.blocks = [{ id: 'empty-block', text: '' }]
    project.reviews = [
      { id: 'r1', category: '逻辑', severity: '高', title: '高风险', description: '', evidence: [], recommendation: '', status: '待处理', createdAt: NOW },
      { id: 'r2', category: '文风', severity: '低', title: '低风险', description: '', evidence: [], recommendation: '', status: '待处理', createdAt: NOW }
    ] as NovelProject['reviews']
    project.memories = [memoryFixture(project.chapters[0]!.id, '需更新')] as NovelProject['memories']
    project.plotThreads[0]!.status = '逾期'

    const precheck = buildExportPrecheck(project, 'md', { ...context, pendingProposalCount: 2 })
    expect(precheck.blockers, '质量问题不得升级为阻断').toHaveLength(0)
    const codes = precheck.warnings.map((item) => item.code)
    expect(codes).toEqual(expect.arrayContaining(['空章节', '草稿章节', '高风险审稿问题', '未处理审稿问题', '过期记忆', '逾期伏笔', '未应用候选']))
    expect(exportPrecheckState(precheck, { projectRevision: project.revision, format: 'md' }), '有提醒但可导出').toBe('可导出含警告')
  })

  it('内容或格式一变，旧预检立刻算过期', () => {
    const project = draft()
    const precheck = buildExportPrecheck(project, 'txt', context)
    expect(exportPrecheckState(precheck, { projectRevision: project.revision + 1, format: 'txt' })).toBe('已过期')
    expect(exportPrecheckState(precheck, { projectRevision: project.revision, format: 'docx' })).toBe('已过期')
    expect(exportPrecheckState(undefined, { projectRevision: project.revision, format: 'txt' })).toBe('未检查')
    expect(precheck.source, '预检永远来自本地确定性检查').toBe('本地预检')
  })
})
