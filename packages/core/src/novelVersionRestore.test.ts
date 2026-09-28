import { describe, expect, it } from 'vitest'
import { NovelDatabaseService, type DatabaseWriteCheckpoint } from './novelDatabase'
import { VersionNotFoundError, VersionRestorePreviewStaleError } from './novelVersionRestore'
import { makeNovel } from './novelTestFactory'
import type { NovelProject } from '../../contracts/src'

/**
 * M8 · 受控事务恢复。
 *
 * 这里检查三件事：
 *   1. 差异预览是按真实数据逐项比对的；
 *   2. 预览摘要绑定目标快照与当前稿，任一变化都会让旧预览失效；
 *   3. 恢复的「恢复前快照 + 目标内容 + 新 revision」在同一事务里提交，中途失败整体回滚。
 */
describe('恢复差异预览与摘要绑定', () => {
  function setup() {
    const database = new NovelDatabaseService(':memory:')
    const project = makeNovel(2)
    database.createProject(project)
    const version = database.snapshot(project, '测试基线', '手动检查点')
    // 在基线之后继续改：改正文、加一条审稿问题、加一条术语
    const edited: NovelProject = structuredClone(project)
    edited.chapters[0]!.blocks[0]!.text = '改过的正文'
    edited.reviews = [{
      id: 'review-1', category: '逻辑', severity: '中', title: '新问题', description: '', evidence: [],
      recommendation: '', status: '待处理', createdAt: new Date().toISOString()
    }]
    edited.worldConstraints = [{
      id: 'term-1', term: '星纹古钟', definition: '计时装置', notDefinition: '', entityType: '器物',
      allowedUsages: [], forbiddenUsages: [], unresolvedQuestions: [], facts: [], source: { fieldPath: 'x', excerpt: '作者手动录入' },
      status: '待确认', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }]
    const current = database.saveProject(edited, project.revision)
    return { database, version, current, projectId: project.id }
  }

  it('预览逐项列出真实差异，且不写任何东西', () => {
    const { database, version, current, projectId } = setup()
    const versionCount = database.listVersions(projectId).length

    const preview = database.previewVersionRestore(projectId, version.id, '2026-09-14T10:00:00.000Z')
    const scopes = preview.diffs.map((item) => item.scope)

    expect(scopes, '正文与审稿、世界观都有真实差异').toEqual(expect.arrayContaining(['正文', '审稿', '世界观']))
    const body = preview.diffs.find((item) => item.scope === '正文')!
    expect(body.changed, '同一章内容被改过').toBe(1)
    expect(body.sample.join('|')).toContain('改：')
    expect(preview.currentRevision).toBe(current.revision)
    expect(preview.targetRevision).toBe(version.revision)
    expect(preview.previewDigest.length).toBeGreaterThan(20)
    expect(database.listVersions(projectId), '预览不得写快照').toHaveLength(versionCount)
    expect(database.getProject(projectId).revision, '预览不得改版本号').toBe(current.revision)
  })

  it('同一状态下重复预览得到同一个摘要；当前稿变化后摘要随之变化', () => {
    const { database, version, projectId } = setup()
    const first = database.previewVersionRestore(projectId, version.id, '2026-09-14T10:00:00.000Z')
    const second = database.previewVersionRestore(projectId, version.id, '2026-09-14T11:00:00.000Z')
    expect(second.previewDigest, '摘要不含时间戳，可确定性重算').toBe(first.previewDigest)

    const project = database.getProject(projectId)
    database.saveProject({ ...project, title: `${project.title}改` }, project.revision, '自动保存')
    const third = database.previewVersionRestore(projectId, version.id, '2026-09-14T12:00:00.000Z')
    expect(third.previewDigest, '当前稿变了，摘要必须变').not.toBe(first.previewDigest)
  })

  it('摘要过期或目标版本被删除时恢复被拒绝，且一个字节都不写', () => {
    const { database, version, current, projectId } = setup()
    const before = JSON.stringify(database.getProject(projectId))
    const versions = database.listVersions(projectId).map((item) => item.id)

    expect(() => database.restoreVersionWithPreview({ projectId, versionId: version.id, expectedDigest: 'stale-digest' }))
      .toThrow(VersionRestorePreviewStaleError)
    expect(JSON.stringify(database.getProject(projectId))).toBe(before)
    expect(database.listVersions(projectId).map((item) => item.id)).toEqual(versions)

    database.removeVersion(projectId, version.id)
    expect(() => database.restoreVersionWithPreview({ projectId, versionId: version.id, expectedDigest: 'x' }))
      .toThrow(VersionNotFoundError)
    expect(database.getProject(projectId).revision).toBe(current.revision)
  })

  it('恢复成功：内容换回目标版本、revision 前进、恢复前当前稿进入版本历史', () => {
    const { database, version, current, projectId } = setup()
    const preview = database.previewVersionRestore(projectId, version.id, '2026-09-14T10:00:00.000Z')
    const restored = database.restoreVersionWithPreview({ projectId, versionId: version.id, expectedDigest: preview.previewDigest })

    expect(restored.revision, 'revision 只前进，不倒退成历史版本号').toBe(current.revision + 1)
    expect(restored.chapters[0]!.blocks[0]!.text, '正文回到目标版本').toBe('林砚在旧城发现一座刻有星纹的古钟，并决定隐瞒此事。')
    expect(restored.reviews, '目标版本里没有的审稿问题被恢复掉').toHaveLength(0)
    expect(restored.worldConstraints).toHaveLength(0)

    const versions = database.listVersions(projectId)
    expect(versions.filter((item) => item.reason === `恢复前：第 ${version.revision} 版`), '恢复前快照已建立').toHaveLength(1)

    // 恢复后再拿同一个旧预览提交，必须被拒绝
    expect(() => database.restoreVersionWithPreview({ projectId, versionId: version.id, expectedDigest: preview.previewDigest }))
      .toThrow(VersionRestorePreviewStaleError)
  })

  const checkpoints: DatabaseWriteCheckpoint[] = ['开始写入', '已写入恢复前快照', '已写入项目', '已重建索引']

  it.each(checkpoints)('恢复在「%s」后注入失败：项目、revision、快照全部回滚', (stage) => {
    const { database, version, current, projectId } = setup()
    const preview = database.previewVersionRestore(projectId, version.id, '2026-09-14T10:00:00.000Z')
    const before = JSON.stringify(database.getProject(projectId))
    const versions = database.listVersions(projectId).map((item) => item.id)

    database.setFailureInjectorForTest((current) => {
      if (current === stage) throw new Error(`测试注入：恢复在「${stage}」后中断`)
    })
    expect(() => database.restoreVersionWithPreview({ projectId, versionId: version.id, expectedDigest: preview.previewDigest }))
      .toThrow(`恢复在「${stage}」后中断`)

    database.setFailureInjectorForTest(undefined)
    expect(JSON.stringify(database.getProject(projectId)), '内容必须逐字节回到恢复前').toBe(before)
    expect(database.getProject(projectId).revision).toBe(current.revision)
    expect(database.listVersions(projectId).map((item) => item.id), '恢复前快照不得留下半成品').toEqual(versions)
  })
})
