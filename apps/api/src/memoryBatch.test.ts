import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { MemorySecretStore } from '../../../packages/core/src/secrets'
import { makeNovel } from '../../../packages/core/src/novelTestFactory'
import { createMojingServer } from './mojingServer'

describe('记忆提案批量处理 API', () => {
  const apps: FastifyInstance[] = []
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

  it('接受与拒绝在一次事务内写入；任一过期时整批回滚', async () => {
    const server = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' })
    apps.push(server.app)
    const project = server.database.createProject(makeNovel(1))
    const chapter = project.chapters[0]!
    const now = new Date().toISOString()
    const proposal = (id: string, category: '章节摘要' | '时间事件', candidate: string, sourceDigest = chapter.sourceDigest) => ({
      id, projectId: project.id, chapterId: chapter.id, sourceDigest, category, candidate,
      source: { chapterId: chapter.id, excerpt: chapter.blocks[0]!.text },
      confidence: 0.9, risk: '低' as const, status: '待确认' as const, createdAt: now
    })
    server.database.saveMemoryProposals([proposal('summary', '章节摘要', '古钟出现。'), proposal('event', '时间事件', '夜半钟鸣')])
    const url = `/api/novels/${project.id}/memory-proposals/batch`
    const headers = { authorization: 'Bearer test' }

    const success = await server.app.inject({ method: 'POST', url, headers, payload: {
      currentRevision: project.revision, decisions: [
        { proposalId: 'summary', status: '已接受' }, { proposalId: 'event', status: '已拒绝' }
      ]
    } })
    expect(success.statusCode).toBe(200)
    expect(success.json()).toMatchObject({ status: '全部成功', appliedProposalIds: ['summary', 'event'] })
    expect(server.database.getProject(project.id).memories[0]?.summary).toBe('古钟出现。')
    expect(server.database.listMemoryProposals(project.id, true).map((item) => [item.id, item.status]).sort()).toEqual([
      ['event', '已拒绝'], ['summary', '已接受']
    ])

    const latest = server.database.getProject(project.id)
    server.database.saveMemoryProposals([proposal('new', '章节摘要', '新摘要。'), proposal('stale', '时间事件', '错误事件', 'old-digest')])
    const rollback = await server.app.inject({ method: 'POST', url, headers, payload: {
      currentRevision: latest.revision, decisions: [
        { proposalId: 'new', status: '已接受' }, { proposalId: 'stale', status: '已接受' }
      ]
    } })
    expect(rollback.statusCode).toBe(200)
    expect(rollback.json()).toMatchObject({ status: '全部回滚', appliedProposalIds: [] })
    expect(server.database.getProject(project.id).revision).toBe(latest.revision)
    expect(server.database.getProject(project.id).memories[0]?.summary).toBe('古钟出现。')
    expect(server.database.listMemoryProposals(project.id, true).filter((item) => ['new', 'stale'].includes(item.id)).map((item) => item.status)).toEqual(['待确认', '待确认'])
  })

  it('人工摘要修订先保存提案，核对来源和正式值后才能确认', async () => {
    const server = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' })
    apps.push(server.app)
    const seed = makeNovel(1)
    const chapter = seed.chapters[0]!
    const project = server.database.createProject({ ...seed, memories: [{
      id: 'memory-1', chapterId: chapter.id, chapterNumber: 1, status: '正式', sourceDigest: chapter.sourceDigest,
      summary: '旧摘要', keyEvents: [], characterStates: [], facts: [], objectStates: [], timelineEvents: [], styleSignals: [], updatedAt: new Date().toISOString()
    }] })
    const headers = { authorization: 'Bearer test' }
    const prefix = `/api/novels/${project.id}/memory-proposals`
    const baseline = await server.app.inject({ method: 'GET', url: `${prefix}/manual-baseline?chapterId=${chapter.id}&category=${encodeURIComponent('章节摘要')}`, headers })
    expect(baseline.statusCode).toBe(200)
    expect(baseline.json().before).toBe('旧摘要')
    const created = await server.app.inject({ method: 'POST', url: `${prefix}/manual`, headers, payload: {
      currentRevision: project.revision, chapterId: chapter.id, category: '章节摘要', sourceDigest: baseline.json().sourceDigest,
      baseTargetDigest: baseline.json().baseTargetDigest, candidate: '更准确的新摘要', reason: '原摘要遗漏古钟线索'
    } })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ status: '待确认', appliedToCanonical: false })
    expect(server.database.getProject(project.id).memories[0]?.summary).toBe('旧摘要')
    const proposalId = created.json().proposalId as string
    expect(server.database.getMemoryProposal(proposalId)).toMatchObject({ before: '旧摘要', reason: '原摘要遗漏古钟线索' })

    const accepted = await server.app.inject({ method: 'PUT', url: `/api/memory-proposals/${proposalId}`, headers, payload: {
      currentRevision: project.revision, status: '已接受'
    } })
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json().memories[0].summary).toBe('更准确的新摘要')
  })
})
