import { createServer, type Server } from 'node:http'
import { expect, test } from '@playwright/test'
import { buildWritableProject, openModule, projectPut, type ManualFixture } from './helpers/manual-workspace'
import { ensureFreeCreation } from './helpers/workspace-ui'

/**
 * 第 13 条（P05 批准的「选定卷/章范围分批细化」）—— 卷级 AI 规划的业务能力。
 *
 * 旧用例守的是「卷摘要里的生成按钮不得冒泡展开 details」；旧按钮与旧 `.volume-card`
 * 已按设计移除，这里按 P05 重建**能力**而不是恢复旧控件：
 *   作者先圈定范围（整卷 / 卷内某一章）→ 助手在这个范围内生成候选草稿 →
 *   正式内容一个字都不动 → 采用前必须查看差异。
 * 范围即权限：范围之外的变更由服务端拒绝（`localRevision.assertWithinScope`）。
 */

type ServerProject = {
  outline: { volumes: Array<{ id: string; goal: string; chapters: Array<{ id: string; objective: string; conflict: string }> }> }
}

/** 受控模型：只在本机跑一个 OpenAI 兼容端点，返回可切换的固定候选；不接任何真实外部模型。 */
async function startStubModel(): Promise<{ server: Server; baseUrl: string; setCandidate: (next: unknown) => void; calls: string[] }> {
  let candidate: unknown = { summary: '把本卷目标改得更具体', volumeGoal: '确认钟真的在改写记忆，并让巡夜人付出第一次代价' }
  const calls: string[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      calls.push(body)
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({
        id: 'stub', object: 'chat.completion', created: Date.now(), model: 'stub-model',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(candidate) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
      }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return { server, baseUrl: `http://127.0.0.1:${port}/v1`, calls, setCandidate: (next) => { candidate = next } }
}

async function configureProvider(fixture: ManualFixture, page: import('@playwright/test').Page, baseUrl: string): Promise<void> {
  const response = await page.request.put(`${fixture.origin}/api/providers`, {
    headers: { ...fixture.headers, 'Content-Type': 'application/json' },
    data: {
      name: '隔离测试模型', baseUrl, model: 'stub-model', contextWindow: 32_000,
      supportsStreaming: false, supportsJsonSchema: true, hasApiKey: true, apiKey: 'stub-key'
    }
  })
  expect(response.status()).toBe(200)
}

test('卷/章范围分批细化：先明确范围，候选只落草稿，采用前必须查看差异，越界变更被拒', async ({ page }) => {
  const stub = await startStubModel()
  try {
    const fixture = await buildWritableProject(page, '分批细化验收')
    await configureProvider(fixture, page, stub.baseUrl)

    const readProject = async (): Promise<ServerProject> =>
      (await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json()) as ServerProject

    const before = await readProject()
    const volume = before.outline.volumes[0]!
    const firstChapter = volume.chapters[0]!
    expect(volume.goal, '起点：本卷目标为空').toBe('')

    await openModule(page, '小说大纲', '总纲与卷纲')
    // Task 9 迁移：`revise-scope` 与候选面板都在自由创作这一路，有精确目标的页面会先出
    // 模式选择页；按真实 UI 选一次「自由创作」（0 次请求），业务断言全部保留。
    await ensureFreeCreation(page)

    // 1) 生成前先明确范围：默认不细化，选了整卷就把范围写清楚。
    const scopeSelect = page.getByLabel('第1卷 细化范围')
    await expect(scopeSelect).toHaveValue('')
    await expect(page.getByTestId('refine-range')).toHaveCount(0)
    await scopeSelect.selectOption('volume')
    await expect(page.getByTestId('refine-range')).toContainText('第1卷《旧城》')
    await expect(page.getByTestId('refine-range')).toContainText('整卷')
    /**
     * 圈定范围会把助手的作用域从「总纲与卷纲（outline:）」换成「本卷（volume:）」。
     * 按批准方案，作用域变了就在新作用域重新选一次模式（上一个作用域的选择不跨域沿用），
     * 所以这里再走一次真实选择。范围本身的业务断言一条未改。
     */
    await ensureFreeCreation(page)
    // 助手栏把同一范围如实报给作者（范围即权限）。
    await expect(page.getByTestId('revise-scope')).toContainText('只改这一卷的目标与卷内章纲')

    // 2) 生成候选：走真实接口 + 受控模型，只落草稿。
    await page.getByLabel('修改要求').fill('把本卷目标改得更具体')
    await page.getByTestId('revise-generate').click()
    await expect(page.getByTestId('revise-done')).toContainText('查看差异')
    expect(stub.calls.length, '受控模型确实被调用了一次').toBe(1)

    const drafted = await readProject()
    expect(drafted.outline.volumes[0]!.goal, '生成只落草稿，正式卷目标不变').toBe('')
    expect(drafted.outline.volumes[0]!.chapters[0]!.objective, '已有章纲不会被直接覆盖').toBe(firstChapter.objective)

    // 3) 采用前必须查看差异。
    await expect(page.getByTestId('candidate-panel')).toBeVisible()
    await expect(page.getByTestId('candidate-adopt')).toBeDisabled()
    await page.getByTestId('candidate-preview').click()
    await expect(page.getByTestId('candidate-adopt')).toBeEnabled()
    await page.getByTestId('candidate-adopt').click()
    await expect(page.getByTestId('candidate-panel')).toHaveCount(0)
    const applied = await readProject()
    expect(applied.outline.volumes[0]!.goal).toBe('确认钟真的在改写记忆，并让巡夜人付出第一次代价')
    expect(applied.outline.volumes[0]!.chapters[0]!.objective, '采用只改声明过的范围').toBe(firstChapter.objective)

    // 4) 章范围 + 越界拒绝：先补出第二章，再把范围收窄到第一章。
    await openModule(page, '小说大纲', '章节规划')
    // 新建章纲走 store 自动保存（900ms 防抖），必须等这次 PUT 落盘再读接口。
    const chapterSaved = projectPut(page, fixture.id)
    await page.getByRole('button', { name: '新建章节规划' }).click()
    await chapterSaved
    const grown = await readProject()
    const chapters = grown.outline.volumes[0]!.chapters
    expect(chapters.length, '需要两张章纲才能验证「范围之外」').toBe(2)
    const inScope = chapters[0]!
    const outOfScope = chapters[1]!

    await openModule(page, '小说大纲', '总纲与卷纲')
    await page.getByLabel('第1卷 细化范围').selectOption(`chapter:${inScope.id}`)
    await expect(page.getByTestId('refine-range')).toContainText(`第${1}章`)
    // 收窄到「本卷第 1 章」又是一次作用域变化：同样按真实 UI 再选一次模式。
    await ensureFreeCreation(page)
    await expect(page.getByTestId('revise-scope')).toContainText('只改这一章的目标与冲突')

    // 模型这次越界改「另一章」：服务端按范围拒绝，不会先写进去再提醒。
    stub.setCandidate({
      summary: '越界候选',
      chapters: [{ id: outOfScope.id, objective: '不该被写进来的目标', conflict: '不该被写进来的冲突' }]
    })
    await page.getByLabel('修改要求').fill('顺手把另一章也改了')
    await page.getByTestId('revise-generate').click()
    await expect(page.getByTestId('revise-error')).toContainText('只能改动当前选中的这一章')
    const afterViolation = await readProject()
    expect(afterViolation.outline.volumes[0]!.chapters[1]!.objective, '越界变更一个字都没写进正式内容').not.toBe('不该被写进来的目标')
  } finally {
    await new Promise<void>((resolve) => stub.server.close(() => resolve()))
  }
})
