import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeNovel } from '../../../packages/core/src/novelTestFactory'
import { MemorySecretStore } from '../../../packages/core/src/secrets'
import { resolveCreativeSkills } from '../../../packages/core/src/creativeSkillRuntime'
import { createMojingServer } from './mojingServer'

describe('远程 SKILL.md 技能中心 API', () => {
  const apps: FastifyInstance[] = []
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

  it('预览固定来源，安装默认停用，启用后进入目录加载状态，并可更新与回滚', async () => {
    let content = '# 远程边界\n只提出建议，不改写正文。'
    const fetched: string[] = []
    const server = await createMojingServer({
      databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173',
      remoteSkillFetcher: async (url) => { fetched.push(url); return { status: 200, text: async () => content } }
    })
    apps.push(server.app)
    const project = makeNovel(12)
    server.database.createProject(project)
    const headers = { authorization: 'Bearer test' }
    const source = 'https://github.com/acme/story-skills/blob/abc123/rules/SKILL.md'

    const preview = await server.app.inject({ method: 'POST', url: `/api/novels/${project.id}/creative-skills/remote/preview`, headers, payload: { url: source, expectedRef: 'abc123' } })
    expect(preview.statusCode).toBe(200)
    expect(preview.json().source).toMatchObject({ sourceUrl: 'https://raw.githubusercontent.com/acme/story-skills/abc123/rules/SKILL.md', sourceRef: 'abc123' })
    expect(fetched).toEqual(['https://raw.githubusercontent.com/acme/story-skills/abc123/rules/SKILL.md'])

    const installed = await server.app.inject({ method: 'POST', url: `/api/novels/${project.id}/creative-skills/remote/install`, headers, payload: { url: source, expectedRef: 'abc123', expectedDigest: preview.json().preview.sourceDigest } })
    expect(installed.statusCode).toBe(201)
    expect(installed.json()).toMatchObject({ enabled: false, sourceKind: 'remote', sourceRef: 'abc123' })
    expect(installed.json().sourceDigest).toBe(preview.json().preview.sourceDigest)
    expect(installed.json().sourceUrl).toBe(preview.json().source.sourceUrl)
    const capabilityId = installed.json().id as string

    const disabledCatalog = await server.app.inject({ method: 'GET', url: `/api/novels/${project.id}/creative-skills`, headers })
    expect(disabledCatalog.json().find((item: { id: string }) => item.id === capabilityId)).toMatchObject({ status: '已停用', loaded: false })

    const enabled = await server.app.inject({ method: 'PUT', url: `/api/novels/${project.id}/creative-capabilities/${capabilityId}/enabled`, headers, payload: { enabled: true } })
    expect(enabled.statusCode).toBe(200)
    resolveCreativeSkills(server.database, project.id, 'writing').markLoaded?.()
    const loadedCatalog = await server.app.inject({ method: 'GET', url: `/api/novels/${project.id}/creative-skills`, headers })
    expect(loadedCatalog.json().find((item: { id: string }) => item.id === capabilityId)).toMatchObject({ status: '已加载', loaded: true, loadedStages: expect.arrayContaining(['writing']) })

    content = '# 远程边界\n更新后的建议仍然只读。'
    const updatePreview = await server.app.inject({ method: 'POST', url: `/api/novels/${project.id}/creative-capabilities/${capabilityId}/update/preview`, headers, payload: { url: source, expectedRef: 'abc123' } })
    expect(updatePreview.statusCode).toBe(200)
    expect(updatePreview.json().changed).toBe(true)
    expect((await server.app.inject({ method: 'GET', url: `/api/novels/${project.id}/creative-capabilities/${capabilityId}/versions`, headers })).json()).toHaveLength(1)
    const updated = await server.app.inject({ method: 'PUT', url: `/api/novels/${project.id}/creative-capabilities/${capabilityId}/update`, headers, payload: { url: source, expectedRef: 'abc123', expectedDigest: installed.json().sourceDigest, previewDigest: updatePreview.json().preview.sourceDigest } })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().skillText).toContain('更新后的建议')

    const versions = await server.app.inject({ method: 'GET', url: `/api/novels/${project.id}/creative-capabilities/${capabilityId}/versions`, headers })
    expect(versions.statusCode).toBe(200)
    expect(versions.json()).toHaveLength(2)
    expect(versions.json()[1].active).toBe(true)

    const rolledBack = await server.app.inject({ method: 'POST', url: `/api/novels/${project.id}/creative-capabilities/${capabilityId}/rollback`, headers, payload: { versionId: versions.json()[0].id } })
    expect(rolledBack.statusCode).toBe(200)
    expect(rolledBack.json().skillText).toContain('只提出建议')
    expect(rolledBack.json().enabled).toBe(true)
  })

  it('拒绝跨站、带查询参数和越界编码的远程来源，并要求更新先预览再应用', async () => {
    const server = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173', remoteSkillFetcher: async () => ({ status: 200, text: async () => '# 技能\n只读。' }) })
    apps.push(server.app)
    const project = makeNovel(13)
    server.database.createProject(project)
    const headers = { authorization: 'Bearer test' }
    for (const url of ['https://example.com/SKILL.md', 'https://github.com/acme/story-skills/blob/abc123/SKILL.md?raw=1', 'https://github.com/acme/story-skills/blob/abc123/%2e%2e/SKILL.md']) {
      const response = await server.app.inject({ method: 'POST', url: `/api/novels/${project.id}/creative-skills/remote/preview`, headers, payload: { url, expectedRef: 'abc123' } })
      expect(response.statusCode).toBe(400)
    }
    const preview = await server.app.inject({ method: 'POST', url: `/api/novels/${project.id}/creative-skills/remote/preview`, headers, payload: { url: 'https://github.com/acme/story-skills/blob/abc123/SKILL.md', expectedRef: 'abc123' } })
    const installed = await server.app.inject({ method: 'POST', url: `/api/novels/${project.id}/creative-skills/remote/install`, headers, payload: { url: 'https://github.com/acme/story-skills/blob/abc123/SKILL.md', expectedRef: 'abc123', expectedDigest: preview.json().preview.sourceDigest } })
    const capabilityId = installed.json().id as string
    const update = await server.app.inject({ method: 'PUT', url: `/api/novels/${project.id}/creative-capabilities/${capabilityId}/update`, headers, payload: { url: 'https://github.com/acme/story-skills/blob/abc123/SKILL.md', expectedRef: 'abc123', expectedDigest: installed.json().sourceDigest } })
    expect(update.statusCode).toBe(400)
    expect(update.json().error.code).toBe('SKILL_UPDATE_PREVIEW_REQUIRED')
    expect((await server.app.inject({ method: 'GET', url: `/api/novels/${project.id}/creative-capabilities/${capabilityId}/versions`, headers })).json()).toHaveLength(1)
  })
})
