import { describe, expect, it } from 'vitest'
import { NovelDatabaseService, NovelRevisionConflictError, type DatabaseWriteCheckpoint } from './novelDatabase'
import { makeNovel } from './novelTestFactory'
import type { NovelOutline, NovelRevisionProposal } from '../../contracts/src'

/**
 * 结构调整/候选应用的事务性验证。
 *
 * 这里检测的是**真正的多步写入中途失败**：写入已经开始、事务尚未提交时抛错，
 * 必须把项目内容、revision、恢复前快照、候选状态、生成任务全部回滚。
 * 「基线版本不符返回 409」只是并发校验，不算事务回滚，单独列在最后一个用例。
 */
describe('候选应用事务：中途失败必须整体回滚', () => {
  const checkpoints: DatabaseWriteCheckpoint[] = ['开始写入', '已写入恢复前快照', '已写入项目', '已重建索引', '已写入候选状态', '已标记生成任务']

  function setup() {
    const database = new NovelDatabaseService(':memory:')
    const project = makeNovel(2)
    database.createProject(project)
    const proposal: NovelRevisionProposal = {
      id: 'proposal-1', projectId: project.id, kind: 'outline', target: 'outline', targetId: 'structure',
      baseRevision: project.revision, summary: '结构调整：测试', candidate: project.outline, status: '待处理',
      structureOperation: '调序', structureImpact: {
        operation: '调序', summary: '测试', risk: '中', affectedChapterIds: project.outline!.volumes[0]!.chapters.map((item) => item.id),
        affectedChapterNumbers: [1, 2], affectedOutlineCount: 2, affectedBodyCount: 0, affectedMemoryCount: 0,
        affectedThreadCount: 0, affectedReviewCount: 0, warnings: [], changes: [], createdAt: project.createdAt
      },
      createdAt: new Date().toISOString()
    }
    database.saveRevision(proposal)
    const snapshot = database.getProject(project.id)
    const outline: NovelOutline = structuredClone(snapshot.outline!)
    outline.volumes[0]!.chapters.reverse()
    return {
      database,
      proposal,
      projectId: project.id,
      outline,
      before: {
        project: snapshot,
        versions: database.listVersions(project.id).map((item) => item.id),
        proposal: database.getRevision('proposal-1')
      }
    }
  }

  it.each(checkpoints)('在「%s」之后注入失败：项目、revision、快照、候选状态全部回滚', (stage) => {
    const { database, proposal, projectId, outline, before } = setup()
    database.setFailureInjectorForTest((current) => {
      if (current === stage) throw new Error(`测试注入：写入在「${stage}」后中断`)
    })

    expect(() => database.applyAcceptedRevision({
      project: { ...before.project, outline }, baseRevision: before.project.revision,
      reason: '应用候选前：结构调整', source: 'AI 候选应用', proposal
    })).toThrow(`写入在「${stage}」后中断`)

    database.setFailureInjectorForTest(undefined)
    const after = database.getProject(projectId)

    expect(after.revision, 'revision 不得前进').toBe(before.project.revision)
    expect(JSON.stringify(after), '项目内容必须逐字节回到事务前').toBe(JSON.stringify(before.project))
    expect(database.listVersions(projectId).map((item) => item.id), '恢复前快照不得留下半成品').toEqual(before.versions)
    expect(database.getRevision('proposal-1').status, '候选状态不得被改成已应用').toBe('待处理')
    database.close()
  })

  it('注入失败后重试可以正常提交，且只前进一个版本', () => {
    const { database, proposal, projectId, outline, before } = setup()
    database.setFailureInjectorForTest((current) => {
      if (current === '已写入项目') throw new Error('测试注入：中途失败')
    })
    expect(() => database.applyAcceptedRevision({
      project: { ...before.project, outline }, baseRevision: before.project.revision, reason: '应用候选前：结构调整', source: 'AI 候选应用', proposal
    })).toThrow('中途失败')

    database.setFailureInjectorForTest(undefined)
    const saved = database.applyAcceptedRevision({
      project: { ...before.project, outline }, baseRevision: before.project.revision, reason: '应用候选前：结构调整', source: 'AI 候选应用', proposal
    })

    expect(saved.revision).toBe(before.project.revision + 1)
    expect(saved.outline!.volumes[0]!.chapters.map((item) => item.id)).toEqual([...before.project.outline!.volumes[0]!.chapters].reverse().map((item) => item.id))
    expect(database.getRevision('proposal-1').status).toBe('已应用')
    expect(database.listVersions(projectId), '提交成功后恰好新增一个恢复前快照').toHaveLength(before.versions.length + 1)
    database.close()
  })

  it('基线版本不符是并发校验：返回冲突且一个字节都不写', () => {
    const { database, proposal, projectId, outline, before } = setup()
    // 先把项目推到一个新版本，制造「请求基于旧版本」的并发场景
    database.saveProject({ ...before.project, title: '别人先改过' }, before.project.revision, '自动保存')

    expect(() => database.applyAcceptedRevision({
      project: { ...before.project, outline }, baseRevision: before.project.revision, reason: '应用候选前：结构调整', source: 'AI 候选应用', proposal
    })).toThrow(NovelRevisionConflictError)

    const after = database.getProject(projectId)
    expect(after.title, '不得用旧候选覆盖别人先改的内容').toBe('别人先改过')
    expect(after.revision).toBe(before.project.revision + 1)
    expect(database.getRevision('proposal-1').status, '并发冲突不改候选状态（由上层显式标记已冲突）').toBe('待处理')
    database.close()
  })
})
