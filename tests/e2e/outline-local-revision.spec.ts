import { createServer, type Server } from 'node:http'
import { expect, test } from '@playwright/test'
import { buildWritableProject, openModule } from './helpers/manual-workspace'

type Fixture = Awaited<ReturnType<typeof buildWritableProject>>

/** 受控模型桩：按 scope 类型返回对应的局部修改候选，不接任何真实外部模型。 */
async function startStubModel(): Promise<{ server: Server; baseUrl: string; bodies: string[] }> {
  const bodies: string[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      bodies.push(body)
      // 从提示里取回服务端给模型的章纲 ID，保证改动落在真实对象上。
      const idMatch = /章纲 ID：([a-z0-9-]+)/.exec(body)
      const chapterId = idMatch ? idMatch[1] : ''
      const payload = /范围类型：volume/.test(body)
        ? { summary: '卷目标候选', volumeGoal: '确认钟真的在改写记忆' }
        : /范围类型：beat/.test(body)
          ? { summary: '步骤候选', beats: [{ id: 'b1', chapterId, title: '钟声第一次异常', purpose: '埋下异常', conflict: '没人相信', outcome: '巡夜人独自追查', order: 1, location: '旧城', timeframe: '夜', reveal: '' }] }
          : { summary: '章目标候选', chapterObjective: '确认钟声与记忆缺失有关', chapterConflict: '没人相信他' }
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({
        id: 'stub', object: 'chat.completion', created: Date.now(), model: 'stub-model',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(payload) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
      }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return { server, baseUrl: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1`, bodies }
}

test('局部修改只改声明范围：卷、章、步骤、故事线各自受限，批次只覆盖选中的章', async ({ page }) => {
  const stub = await startStubModel()
  try {
    const fixture = await buildWritableProject(page, '局部修改验收')
    const provider = await page.request.put(`${fixture.origin}/api/providers`, {
      headers: { ...fixture.headers, 'Content-Type': 'application/json' },
      data: { name: '隔离测试模型', baseUrl: stub.baseUrl, model: 'stub-model', contextWindow: 32_000, supportsStreaming: false, supportsJsonSchema: true, hasApiKey: true, apiKey: 'stub-key' }
    })
    expect(provider.status()).toBe(200)

    const project = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
      outline: { volumes: Array<{ id: string; chapters: Array<{ id: string; chapterNumber: number }> }> }
    }
    const volume = project.outline.volumes[0]!
    const card = volume.chapters[0]!

    const call = (data: unknown) => page.request.post(`${fixture.origin}/api/novels/${fixture.id}/outline-revisions/draft`, {
      headers: { ...fixture.headers, 'Content-Type': 'application/json' }, data
    })
    const chapterChange = (id: string, number: number, objective: string) => ({
      kind: 'chapter',
      chapter: {
        id, volumeNumber: 1, chapterNumber: number, title: `第${number}章`, pov: '林砚', objective, conflict: '',
        turningPoint: '', reveal: '', endingHook: '', characterIds: [], setupThreadIds: [], payoffThreadIds: [],
        beats: [], beatStatus: '未生成', beatFindings: [], status: '已规划'
      }
    })

    // ① 声明改步骤，却要改整章 → 拒绝
    const beatScope = { kind: 'beat', projectId: fixture.id, objectId: card.id, beatId: 'b1' }
    const tooWide = await call({ scope: beatScope, changes: [chapterChange(card.id, 1, '越权改整章')] })
    expect(tooWide.status()).toBe(400)
    expect((await tooWide.json()).error.message).toMatch(/不能改写整章/)

    // ② 声明改章，却要改别的章 → 拒绝
    const chapterScope = { kind: 'chapter', projectId: fixture.id, objectId: card.id }
    const otherCard = volume.chapters[1] ?? card
    const otherChapter = await call({
      scope: chapterScope,
      changes: [chapterChange(otherCard.id === card.id ? 'someone-else' : otherCard.id, 2, '越权改别的章')]
    })
    expect(otherChapter.status()).toBe(400)

    // ③ 批量：选中范围外的章 → 拒绝
    const batchReject = await call({
      scope: { kind: 'volume', projectId: fixture.id, objectId: volume.id },
      batchChapterIds: [card.id],
      changes: [chapterChange(card.id, 1, 'A'), { ...chapterChange('chapter-not-selected', 9, 'B') }]
    })
    expect(batchReject.status()).toBe(400)
    expect((await batchReject.json()).error.message).toMatch(/批次只能覆盖你明确选中的章/)

    // ④ 批量：只覆盖选中的章 → 成功
    const batchOk = await call({
      scope: { kind: 'volume', projectId: fixture.id, objectId: volume.id },
      batchChapterIds: [card.id],
      changes: [chapterChange(card.id, 1, '批次里的目标')]
    })
    expect(batchOk.status()).toBe(201)

    // ⑤ 改故事线时不能顺带改章
    const lineReject = await call({
      scope: { kind: 'storyline', projectId: fixture.id, objectId: 'line-1' },
      changes: [chapterChange(card.id, 1, '越权')]
    })
    expect(lineReject.status()).toBe(400)
    expect((await lineReject.json()).error.message).toMatch(/不能顺带修改章纲/)

    // ⑥ 生成接口：模型给出改动后，草稿按范围落库，且不会改到范围外
    const generated = await page.request.post(`${fixture.origin}/api/novels/${fixture.id}/outline-revisions/generate`, {
      headers: { ...fixture.headers, 'Content-Type': 'application/json' },
      data: { scope: chapterScope, instruction: '把这一章目标写具体' }
    })
    expect(generated.status()).toBe(201)
    const draftId = ((await generated.json()) as { draft: { id: string } }).draft.id
    const preview = await page.request.get(`${fixture.origin}/api/novels/${fixture.id}/assistant-drafts/${draftId}/preview`, { headers: fixture.headers })
    const previewBody = (await preview.json()) as { items: Array<{ kind: string; label: string }>; blockers: string[] }
    expect(previewBody.blockers).toEqual([])
    expect(previewBody.items.every((item) => item.kind === 'chapter')).toBe(true)

    // 正式项目在采用前没变
    const before = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
      outline: { volumes: Array<{ chapters: Array<{ objective: string }> }> }
      chapters: Array<{ id: string; blocks: Array<{ text: string }> }>
    }
    expect(before.outline.volumes.flatMap((v) => v.chapters)[0]!.objective).not.toBe('确认钟声与记忆缺失有关')
    expect(before.chapters[0]!.blocks[0]!.text.length).toBeGreaterThan(0)
  } finally {
    await new Promise<void>((resolve) => stub.server.close(() => resolve()))
  }
})

test('切到别的目标后候选不会串用，原目标草稿仍在', async ({ page }) => {
  const fixture = await buildWritableProject(page, '候选隔离验收')
  // 再建一章章纲，才能验证不同目标的草稿互不串用。
  await openModule(page, '小说大纲', '章节规划')
  const created = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith(`/api/novels/${fixture.id}`))
  await page.getByRole('button', { name: '新建章节规划' }).click()
  await created
  const project = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    outline: { volumes: Array<{ chapters: Array<{ id: string; chapterNumber: number }> }> }
  }
  const cards = project.outline.volumes.flatMap((volume) => volume.chapters)
  const [first, second] = cards
  expect(second, '需要至少两章才能验证隔离').toBeTruthy()

  const chapterChange = (id: string, number: number, objective: string) => ({
    kind: 'chapter',
    chapter: {
      id, volumeNumber: 1, chapterNumber: number, title: `第${number}章`, pov: '林砚', objective, conflict: '',
      turningPoint: '', reveal: '', endingHook: '', characterIds: [], setupThreadIds: [], payoffThreadIds: [],
      beats: [], beatStatus: '未生成', beatFindings: [], status: '已规划'
    }
  })
  const call = (objectId: string, number: number, objective: string) =>
    page.request.post(`${fixture.origin}/api/novels/${fixture.id}/outline-revisions/draft`, {
      headers: { ...fixture.headers, 'Content-Type': 'application/json' },
      data: { scope: { kind: 'chapter', projectId: fixture.id, objectId }, changes: [chapterChange(objectId, number, objective)] }
    })

  await call(first!.id, first!.chapterNumber, '第一章的目标')
  await call(second!.id, second!.chapterNumber, '第二章的目标')

  const list = await page.request.get(
    `${fixture.origin}/api/novels/${fixture.id}/assistant-drafts?scopeKey=${encodeURIComponent(`chapter:${second!.id}`)}`,
    { headers: fixture.headers }
  )
  const forSecond = (await list.json()) as Array<{ changes: Array<{ chapter: { objective: string } }> }>
  expect(forSecond).toHaveLength(1)
  expect(forSecond[0]!.changes[0]!.chapter.objective).toBe('第二章的目标')

  const all = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}/assistant-drafts`, { headers: fixture.headers })).json() as unknown[]
  expect(all.length).toBe(2)
})
