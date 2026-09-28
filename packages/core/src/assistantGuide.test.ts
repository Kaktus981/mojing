import Database from 'better-sqlite3'
import { unlinkSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  assistantGuideScopeKey,
  type AssistantGuideAnswer,
  type AssistantGuideTurn,
  type GuideSession,
  type NovelProject
} from '../../contracts/src'
import {
  getCurrentAssistantGuide,
  markAssistantGuideForReview,
  restartAssistantGuideSession,
  saveAssistantGuideAnswer,
  startAssistantGuideSession
} from './assistantGuide'
import { NovelDatabaseService } from './novelDatabase'
import { makeNovel } from './novelTestFactory'

function projectWithId(id: string): NovelProject {
  return { ...makeNovel(1), id }
}

function setup(...projectIds: string[]) {
  const database = new NovelDatabaseService(':memory:')
  const projects = projectIds.map(projectWithId)
  for (const project of projects) database.createProject(project)
  return { database, projects }
}

function turn(questionId = 'question-1', readyToComplete = false): AssistantGuideTurn {
  return {
    analysisSummary: '当前已有故事种子，还需要确认核心矛盾。',
    strengths: [{ title: '故事种子明确', evidenceRefs: ['project.seed'] }],
    gaps: [{ key: 'conflict', title: '核心矛盾', impact: '决定故事推进方向。', evidenceRefs: ['project.outline.mainConflict'] }],
    focus: '先确认核心矛盾',
    question: readyToComplete ? null : {
      id: questionId,
      text: '故事的核心矛盾是什么？',
      whyNow: '它决定后续结构。',
      options: [
        { id: 'conflict-a', label: '守住记忆', reason: '与种子直接相关。' },
        { id: 'conflict-b', label: '揭开真相', reason: '提供调查动力。' },
        { id: 'conflict-c', label: '保护旧城', reason: '提供外部目标。' }
      ],
      allowCustom: true,
      allowSkip: true
    },
    readyToComplete
  }
}

function answer(questionId = 'question-1'): AssistantGuideAnswer {
  return { questionId, selectedOptionId: 'conflict-a' }
}

function errorCode(action: () => unknown): string | undefined {
  try { action(); return undefined } catch (error) { return (error as { code?: string }).code }
}

function tempDatabasePath(label: string): string {
  return `${process.env.TEMP ?? '.'}/mojing-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
}

function removeDatabase(path: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(`${path}${suffix}`) } catch { /* test cleanup */ }
  }
}

describe('通用助手引导持久化', () => {
  it('按项目、领域和精确作用域隔离，并稳定返回同一个当前会话', () => {
    const { database, projects: [first, second] } = setup('project-a', 'project-b')
    const outlineTarget = { kind: 'story-core' as const, projectId: first!.id }
    const chapterTarget = { kind: 'chapter' as const, projectId: first!.id, objectId: first!.chapters[0]!.id }
    const secondTarget = { kind: 'story-core' as const, projectId: second!.id }
    const outline = startAssistantGuideSession({ database, project: first!, domain: 'outline', target: outlineTarget, contextDigest: 'outline-digest', adapterVersion: 1 })
    const scopedOutline = startAssistantGuideSession({ database, project: first!, domain: 'outline', target: chapterTarget, contextDigest: 'scoped-outline-digest', adapterVersion: 1 })
    const writing = startAssistantGuideSession({ database, project: first!, domain: 'writing', target: chapterTarget, contextDigest: 'writing-digest', adapterVersion: 1 })
    const otherProject = startAssistantGuideSession({ database, project: second!, domain: 'outline', target: secondTarget, contextDigest: 'other-digest', adapterVersion: 1 })

    const outlineScope = assistantGuideScopeKey('outline', outlineTarget)
    expect(getCurrentAssistantGuide(database, first!.id, 'outline', outlineScope)?.id).toBe(outline.id)
    expect(getCurrentAssistantGuide(database, first!.id, 'outline', outlineScope)?.id).toBe(outline.id)
    expect(getCurrentAssistantGuide(database, first!.id, 'outline', assistantGuideScopeKey('outline', chapterTarget))?.id).toBe(scopedOutline.id)
    expect(getCurrentAssistantGuide(database, first!.id, 'writing', assistantGuideScopeKey('writing', chapterTarget))?.id).toBe(writing.id)
    expect(getCurrentAssistantGuide(database, second!.id, 'outline', assistantGuideScopeKey('outline', secondTarget))?.id).toBe(otherProject.id)
    expect(getCurrentAssistantGuide(database, first!.id, 'world', outlineScope)).toBeUndefined()
    expect(new Set(database.listAssistantGuideSessions(first!.id).map((session) => session.id)))
      .toEqual(new Set([outline.id, scopedOutline.id, writing.id]))
    expect(new Set(database.listAssistantGuideSessions(first!.id, 'outline').map((session) => session.id)))
      .toEqual(new Set([outline.id, scopedOutline.id]))
    expect(database.listAssistantGuideSessions(first!.id, 'outline', outlineScope).map((session) => session.id))
      .toEqual([outline.id])
    database.close()
  })

  it('回答按 compare-and-swap 单调增加版本，旧版本冲突且不产生部分写入', () => {
    const { database, projects: [project] } = setup('project-cas')
    const target = { kind: 'story-core' as const, projectId: project!.id }
    const started = startAssistantGuideSession({ database, project: project!, domain: 'outline', target, contextDigest: 'digest-v1', adapterVersion: 1 })
    const saved = saveAssistantGuideAnswer({ database, project: project!, sessionId: started.id, expectedVersion: 1, answer: answer(), nextTurn: turn('question-2'), contextDigest: 'digest-v2' })
    expect(saved.version).toBe(2)
    expect(saved.confirmedAnswers).toEqual([answer()])

    let conflictCode: string | undefined
    try {
      saveAssistantGuideAnswer({ database, project: project!, sessionId: started.id, expectedVersion: 1, answer: { questionId: 'stale', skip: true }, nextTurn: turn('stale'), contextDigest: 'stale-digest' })
    } catch (error) {
      conflictCode = (error as { code?: string }).code
    }
    expect(conflictCode).toBe('ASSISTANT_GUIDE_VERSION_CONFLICT')
    const current = getCurrentAssistantGuide(database, project!.id, 'outline', assistantGuideScopeKey('outline', target))
    expect(current).toMatchObject({ version: 2, contextDigest: 'digest-v2', confirmedAnswers: [answer()] })
    database.close()
  })

  it('完成回调与会话 CAS 共用同一事务，回调异常时回滚已写候选', () => {
    const { database, projects: [project] } = setup('project-completion-transaction')
    const target = { kind: 'story-core' as const, projectId: project!.id }
    const started = startAssistantGuideSession({ database, project: project!, domain: 'outline', target, contextDigest: 'digest', adapterVersion: 1 })

    expect(() => database.completeAssistantGuideSession(project!.id, started.id, started.version, () => {
      database.appendAssistantCandidateRecord({
        projectId: project!.id,
        scopeKey: 'story-core:',
        taskType: '引导构建',
        version: 1,
        baseRevision: project!.revision,
        sourceDigest: 'transaction-test',
        summary: '应回滚',
        changes: [],
        dependencyGroups: [],
        status: '待确认'
      })
      throw new Error('回调失败')
    })).toThrowError(/回调失败/)

    expect(database.listAssistantCandidateRecords(project!.id)).toHaveLength(0)
    expect(database.getAssistantGuideSession(project!.id, started.id)).toEqual(started)
    database.close()
  })

  it('复核状态也受版本门禁保护，并保留可见原因', () => {
    const { database, projects: [project] } = setup('project-review')
    const target = { kind: 'story-core' as const, projectId: project!.id }
    const started = startAssistantGuideSession({ database, project: project!, domain: 'outline', target, contextDigest: 'digest', adapterVersion: 1 })
    const reviewed = markAssistantGuideForReview({ database, projectId: project!.id, sessionId: started.id, expectedVersion: started.version, message: '项目上下文已变化，请复核。' })
    expect(reviewed).toMatchObject({ version: 2, status: '需要复核', error: '项目上下文已变化，请复核。' })
    expect(errorCode(() => markAssistantGuideForReview({ database, projectId: project!.id, sessionId: started.id, expectedVersion: 1, message: '旧请求' })))
      .toBe('ASSISTANT_GUIDE_VERSION_CONFLICT')
    database.close()
  })

  it('重启在一个事务中结束旧会话、创建新会话并保留多代历史', () => {
    const { database, projects: [project] } = setup('project-restart')
    const target = { kind: 'story-core' as const, projectId: project!.id }
    const first = startAssistantGuideSession({ database, project: project!, domain: 'outline', target, contextDigest: 'digest-1', adapterVersion: 1 })
    const second = restartAssistantGuideSession({ database, project: project!, sessionId: first.id, expectedVersion: first.version, contextDigest: 'digest-2', adapterVersion: 2 })
    const third = restartAssistantGuideSession({ database, project: project!, sessionId: second.id, expectedVersion: second.version, contextDigest: 'digest-3', adapterVersion: 3 })

    expect(third.id).not.toBe(second.id)
    expect(database.getCurrentAssistantGuideSession(project!.id, 'outline', assistantGuideScopeKey('outline', target))?.id).toBe(third.id)
    expect(database.listAssistantGuideSessions(project!.id, 'outline', assistantGuideScopeKey('outline', target)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: first.id, status: '已结束', version: 2 }),
        expect.objectContaining({ id: second.id, status: '已结束', version: 2 }),
        expect.objectContaining({ id: third.id, status: '分析中', version: 1 })
      ]))
    database.close()
  })

  it('同一旧会话被重启后，迟到的重复重启返回版本冲突且不改变当前会话或历史', () => {
    const { database, projects: [project] } = setup('project-restart-conflict')
    const target = { kind: 'story-core' as const, projectId: project!.id }
    const first = startAssistantGuideSession({ database, project: project!, domain: 'outline', target, contextDigest: 'digest-1', adapterVersion: 1 })
    const second = restartAssistantGuideSession({ database, project: project!, sessionId: first.id, expectedVersion: first.version, contextDigest: 'digest-2', adapterVersion: 2 })
    const scopeKey = assistantGuideScopeKey('outline', target)
    const historyBefore = database.listAssistantGuideSessions(project!.id, 'outline', scopeKey)

    expect(errorCode(() => restartAssistantGuideSession({
      database,
      project: project!,
      sessionId: first.id,
      expectedVersion: first.version,
      contextDigest: 'late-digest',
      adapterVersion: 3
    }))).toBe('ASSISTANT_GUIDE_VERSION_CONFLICT')
    expect(database.getCurrentAssistantGuideSession(project!.id, 'outline', scopeKey)?.id).toBe(second.id)
    expect(database.listAssistantGuideSessions(project!.id, 'outline', scopeKey)).toEqual(historyBefore)
    database.close()
  })

  it('会话 ID 查询始终要求项目匹配，不能用另一个项目读取或修改', () => {
    const { database, projects: [first, second] } = setup('project-owner', 'project-intruder')
    const target = { kind: 'story-core' as const, projectId: first!.id }
    const session = startAssistantGuideSession({ database, project: first!, domain: 'outline', target, contextDigest: 'digest', adapterVersion: 1 })
    expect(database.getAssistantGuideSession(second!.id, session.id)).toBeUndefined()
    expect(() => markAssistantGuideForReview({ database, projectId: second!.id, sessionId: session.id, expectedVersion: 1, message: '越权修改' }))
      .toThrowError(/找不到/)
    database.close()
  })

  it('删除项目时由外键级联删除通用引导会话', () => {
    const path = tempDatabasePath('assistant-guide-cascade')
    const database = new NovelDatabaseService(path)
    const project = projectWithId('project-delete')
    database.createProject(project)
    startAssistantGuideSession({ database, project, domain: 'outline', target: { kind: 'story-core', projectId: project.id }, contextDigest: 'digest', adapterVersion: 1 })
    database.removeProject(project.id)
    database.close()

    const inspection = new Database(path, { readonly: true })
    expect((inspection.prepare('SELECT count(*) AS count FROM novel_assistant_guide_sessions WHERE project_id=?').get(project.id) as { count: number }).count).toBe(0)
    inspection.close()
    removeDatabase(path)
  })

  it.each(['分析中', '生成中'] as const)('重启数据库后把中断的%s会话恢复为可见且可重试的失败', (status) => {
    const path = tempDatabasePath(`assistant-guide-interrupted-${status}`)
    const first = new NovelDatabaseService(path)
    const project = projectWithId(`project-${status}`)
    first.createProject(project)
    const target = { kind: 'story-core' as const, projectId: project.id }
    const started = startAssistantGuideSession({ database: first, project, domain: 'outline', target, contextDigest: 'digest', adapterVersion: 1 })
    if (status === '生成中') {
      first.saveAssistantGuideSession({ ...started, status, version: 2, updatedAt: new Date().toISOString() }, 1)
    }
    first.close()

    const reopened = new NovelDatabaseService(path)
    expect(getCurrentAssistantGuide(reopened, project.id, 'outline', assistantGuideScopeKey('outline', target)))
      .toMatchObject({ status: '失败', error: expect.stringMatching(/中断|重试/) })
    reopened.close()
    removeDatabase(path)
  })
})

describe('旧大纲引导懒兼容', () => {
  it('首次查询导入已回答、不确定和跳过，第二次查询复用同一会话且不改正式项目或旧行', () => {
    const { database, projects: [project] } = setup('project-legacy')
    const timestamp = '2026-09-17T00:00:00.000Z'
    const legacy: GuideSession = {
      id: 'legacy-session',
      projectId: project!.id,
      answers: [
        { slot: 'protagonist', value: '巡夜人林砚', state: '已回答', source: '作者填写', updatedAt: timestamp },
        { slot: 'coreConflict', value: '', state: '不确定', source: '作者选择', updatedAt: timestamp },
        { slot: 'endingDirection', value: '', state: '已跳过', source: '作者填写', updatedAt: timestamp }
      ],
      askedSlots: ['protagonist', 'coreConflict', 'endingDirection'],
      status: '进行中',
      createdAt: timestamp,
      updatedAt: timestamp
    }
    database.saveGuideSession(legacy)
    const projectBefore = JSON.stringify(database.getProject(project!.id))
    const legacyBefore = JSON.stringify(database.getGuideSession(project!.id))
    const scopeKey = assistantGuideScopeKey('outline', { kind: 'story-core', projectId: project!.id })

    const imported = getCurrentAssistantGuide(database, project!.id, 'outline', scopeKey)!
    const secondLookup = getCurrentAssistantGuide(database, project!.id, 'outline', scopeKey)!
    expect(secondLookup.id).toBe(imported.id)
    expect(imported.status).toBe('提问中')
    expect(imported.confirmedAnswers).toEqual([
      { questionId: 'legacy-protagonist', customText: '巡夜人林砚' },
      { questionId: 'legacy-coreConflict', skip: true },
      { questionId: 'legacy-endingDirection', skip: true }
    ])
    expect(database.listAssistantGuideSessions(project!.id, 'outline', scopeKey)).toHaveLength(1)
    expect(JSON.stringify(database.getProject(project!.id))).toBe(projectBefore)
    expect(JSON.stringify(database.getGuideSession(project!.id))).toBe(legacyBefore)
    expect(database.getProject(project!.id).revision).toBe(project!.revision)
    database.close()
  })
})
