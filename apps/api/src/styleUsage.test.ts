import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { MemorySecretStore } from '../../../packages/core/src/secrets'
import { makeNovel } from '../../../packages/core/src/novelTestFactory'
import { createMojingServer } from './mojingServer'

describe('文风使用记录 API', () => {
  const apps: FastifyInstance[] = []
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

  it('绑定和停用均可从项目记录中读回，画像源文不会写入记录', async () => {
    const server = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' })
    apps.push(server.app)
    const project = makeNovel(1)
    server.database.createProject(project)
    const profile = server.database.createStyleProfile({
      name: '克制叙事', description: '动作推进', traits: { sentenceRhythm: '短句' } as never,
      guidelines: [], avoidPatterns: []
    })
    const headers = { authorization: 'Bearer test' }
    const url = `/api/novels/${project.id}/style-profile/usage`

    const bound = await server.app.inject({ method: 'POST', url: `/api/novels/${project.id}/style-profile/bind`, headers, payload: { profileId: profile.id } })
    expect(bound.statusCode).toBe(200)
    expect(bound.json().settings.activeStyleProfileId).toBe(profile.id)
    const stopped = await server.app.inject({ method: 'DELETE', url: `/api/novels/${project.id}/style-profile/bind`, headers })
    expect(stopped.statusCode).toBe(200)
    expect(stopped.json().settings.activeStyleProfileId).toBeUndefined()

    const history = await server.app.inject({ method: 'GET', url, headers })
    expect(history.statusCode).toBe(200)
    expect(history.json().map((item: { action: string; profileName: string }) => [item.action, item.profileName])).toEqual([
      ['停用', '克制叙事'], ['绑定', '克制叙事']
    ])
    expect(history.body).not.toContain('样文正文')
  })
})
