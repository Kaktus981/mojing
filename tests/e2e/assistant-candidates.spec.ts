import { expect, test } from '@playwright/test'
import { buildWritableProject, openModule } from './helpers/manual-workspace'
import { ensureFreeCreation } from './helpers/workspace-ui'

type Fixture = Awaited<ReturnType<typeof buildWritableProject>>

/**
 * 重开项目：草稿是在页面打开后才建的，必须重新取一次作用域草稿。
 *
 * 2026-09-17 Task 9 迁移：右栏按「引导构建 / 自由创作」分流后，**有精确目标**的页面上
 * 作者在这个作用域还没选过模式时先出现选择页，自由创作（候选面板、输入框、准备度）此时
 * 不渲染。这里按真实 UI 走一次「自由创作」选择（选择本身不发请求），业务断言一条不动。
 */
async function reopen(page: import('@playwright/test').Page): Promise<void> {
  await page.reload()
  await page.locator('.mjp-hall-project').first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  // 项目大厅现在按设计先进入项目概览；候选草稿属于精确章纲作用域，
  // 重新打开后要像作者一样从导航回到章节规划，再定位当前章纲。
  await openModule(page, '小说大纲', '章节规划')
  await page.getByRole('button', { name: '在目录中定位', exact: true }).click()
  await ensureFreeCreation(page)
}


/** 走真实接口建立一份章纲工作草稿（P04 之前由接口驱动，UI 只负责展示与采用）。 */
async function createChapterDraft(fixture: Fixture, page: import('@playwright/test').Page, objective: string) {
  const project = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    outline: { volumes: Array<{ chapters: Array<{ id: string; chapterNumber: number; title: string; objective: string; volumeNumber: number }> }> }
  }
  const card = project.outline.volumes.flatMap((volume) => volume.chapters)[0]!
  const created = await page.request.post(`${fixture.origin}/api/novels/${fixture.id}/assistant-drafts`, {
    headers: { ...fixture.headers, 'Content-Type': 'application/json' },
    data: {
      target: { kind: 'chapter', projectId: fixture.id, objectId: card.id },
      taskType: '局部修改', stage: 'outline', sourceDigest: 'e2e-draft', summary: '章纲候选',
      changes: [{
        kind: 'chapter',
        chapter: {
          id: card.id, volumeNumber: card.volumeNumber, chapterNumber: card.chapterNumber, title: card.title,
          pov: '林砚', objective, conflict: '新冲突', turningPoint: '', reveal: '', endingHook: '',
          characterIds: [], setupThreadIds: [], payoffThreadIds: [], beats: [], beatStatus: '未生成', beatFindings: [], status: '已规划'
        }
      }]
    }
  })
  expect(created.status()).toBe(201)
  return ((await created.json()) as { draft: { id: string; version: number } }).draft
}

test('工作草稿只落草稿，采用前必须重新预览，采用后只改目标章', async ({ page }) => {
  const fixture = await buildWritableProject(page, '草稿采用验收')
  const draft = await createChapterDraft(fixture, page, '新目标：古钟再次鸣响')

  // 草稿存在时，正式项目一个字都没变。
  const before = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    outline: { volumes: Array<{ chapters: Array<{ objective: string }> }> }
  }
  expect(before.outline.volumes.flatMap((v) => v.chapters)[0]!.objective).not.toBe('新目标：古钟再次鸣响')

  // 界面就地显示这份草稿（在右侧助手里，不另开草稿中心）：重开项目后按作用域取回。
  await reopen(page)
  await page.getByTestId('candidate-panel').waitFor()
  await page.getByTestId('candidate-preview').click()
  const panel = page.getByTestId('candidate-panel')
  await expect(panel).toContainText('修改')
  await expect(panel).toContainText('原')

  // 采用：走真实接口，采用后目标章被改、正文不动。
  await page.getByTestId('candidate-adopt').click()
  await expect(page.getByTestId('candidate-panel')).toHaveCount(0)

  const after = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    outline: { volumes: Array<{ chapters: Array<{ objective: string }> }> }
    chapters: Array<{ blocks: Array<{ text: string }> }>
  }
  expect(after.outline.volumes.flatMap((v) => v.chapters)[0]!.objective).toBe('新目标：古钟再次鸣响')
  expect(after.chapters[0]!.blocks[0]!.text.length).toBeGreaterThan(0)

  // 采用留可恢复版本。
  const versions = await page.request.get(`${fixture.origin}/api/novels/${fixture.id}/versions`, { headers: fixture.headers })
  expect(((await versions.json()) as unknown[]).length).toBeGreaterThan(0)

  // 重复采用被拒绝：草稿已经是已采用状态。
  const again = await page.request.post(`${fixture.origin}/api/novels/${fixture.id}/assistant-drafts/${draft.id}/apply`, {
    headers: { ...fixture.headers, 'Content-Type': 'application/json' },
    data: { expectedVersion: draft.version, expectedPreviewDigest: 'stale' }
  })
  expect(again.status()).toBe(400)
  expect((await again.json()).error.message).toMatch(/已经采用过/)
})

test('预览之后项目被改动，旧预览不能采用，正式内容保持原样', async ({ page }) => {
  const fixture = await buildWritableProject(page, '草稿过期验收')
  const draft = await createChapterDraft(fixture, page, '会过期的目标')

  const preview = await page.request.get(`${fixture.origin}/api/novels/${fixture.id}/assistant-drafts/${draft.id}/preview`, { headers: fixture.headers })
  const previewBody = (await preview.json()) as { previewDigest: string; version: number; blockers: string[] }
  expect(previewBody.blockers).toEqual([])

  // 作者手动改了别的地方并保存（真实保存通道）。
  const current = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as { revision: number; [key: string]: unknown }
  const saved = await page.request.put(`${fixture.origin}/api/novels/${fixture.id}`, {
    headers: { ...fixture.headers, 'Content-Type': 'application/json' },
    data: { document: { ...current, seed: `${current.seed} 又改了一点` }, baseRevision: current.revision }
  })
  expect(saved.status()).toBe(200)

  const stale = await page.request.post(`${fixture.origin}/api/novels/${fixture.id}/assistant-drafts/${draft.id}/apply`, {
    headers: { ...fixture.headers, 'Content-Type': 'application/json' },
    data: { expectedVersion: previewBody.version, expectedPreviewDigest: previewBody.previewDigest }
  })
  expect(stale.status()).toBe(400)
  expect((await stale.json()).error.message).toMatch(/已经从版本|预览已经过期/)

  const after = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    outline: { volumes: Array<{ chapters: Array<{ objective: string }> }> }
  }
  expect(after.outline.volumes.flatMap((v) => v.chapters)[0]!.objective).not.toBe('会过期的目标')
})

test('刷新后草稿仍在，放弃草稿不改动正式内容', async ({ page }) => {
  const fixture = await buildWritableProject(page, '草稿保留验收')
  await createChapterDraft(fixture, page, '等待放弃的目标')
  await reopen(page)
  await page.getByTestId('candidate-panel').waitFor()

  await reopen(page)
  await page.getByTestId('candidate-panel').waitFor()

  await page.getByTestId('candidate-discard').click()
  await expect(page.getByTestId('candidate-panel')).toHaveCount(0)

  const after = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    outline: { volumes: Array<{ chapters: Array<{ objective: string }> }> }
    chapters: Array<{ blocks: Array<{ text: string }> }>
  }
  expect(after.outline.volumes.flatMap((v) => v.chapters)[0]!.objective).not.toBe('等待放弃的目标')
  expect(after.chapters[0]!.blocks[0]!.text.length).toBeGreaterThan(0)
})

test('采用请求在网络层失败时面板与草稿都保留，恢复后同一份预览仍可再次采用', async ({ page }) => {
  const fixture = await buildWritableProject(page, '采用失败保留验收')
  await createChapterDraft(fixture, page, '失败也要留住的目标')
  await reopen(page)
  await page.getByTestId('candidate-panel').waitFor()
  await page.getByTestId('candidate-preview').click()
  await expect(page.getByTestId('candidate-panel')).toContainText('修改')

  // 传输层失败（断网/网关掉线），不是业务拒绝：作者已确认的预览必须原地保留。
  let attempts = 0
  await page.route('**/assistant-drafts/*/apply', async (route) => {
    attempts += 1
    if (attempts === 1) { await route.abort('failed'); return }
    await route.continue()
  })

  await page.getByTestId('candidate-adopt').click()
  await expect(page.locator('.mjp-dock-candidate-wrap [role="alert"]')).toBeVisible()
  await expect(page.getByTestId('candidate-panel')).toBeVisible()
  await expect(page.getByTestId('candidate-adopt')).toBeEnabled()

  // 草稿没有被标记采用，正式内容一个字都没写进去。
  const drafts = await page.request.get(`${fixture.origin}/api/novels/${fixture.id}/assistant-drafts`, { headers: fixture.headers })
  const rows = (await drafts.json()) as Array<{ status: string }>
  expect(rows.length).toBe(1)
  expect(rows[0]!.status).not.toBe('已采用')
  const failed = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    outline: { volumes: Array<{ chapters: Array<{ objective: string }> }> }
  }
  expect(failed.outline.volumes.flatMap((v) => v.chapters)[0]!.objective).not.toBe('失败也要留住的目标')

  // 网络恢复后不需要重新预览：同一份预览与同一版草稿仍对得上，可以再次采用。
  await page.getByTestId('candidate-adopt').click()
  await expect(page.getByTestId('candidate-panel')).toHaveCount(0)
  const applied = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    outline: { volumes: Array<{ chapters: Array<{ objective: string }> }> }
  }
  expect(applied.outline.volumes.flatMap((v) => v.chapters)[0]!.objective).toBe('失败也要留住的目标')
})

test('同时改两个领域字段与摘要后保存，刷新后三项改动都还在且正式内容未动', async ({ page }) => {
  const fixture = await buildWritableProject(page, '草稿多字段验收')
  await createChapterDraft(fixture, page, '多字段原始目标')
  await reopen(page)
  await page.getByTestId('candidate-panel').waitFor()

  await page.getByTestId('candidate-edit-toggle-0').click()
  await page.getByTestId('candidate-field-0-objective').fill('多字段改后目标')
  await page.getByTestId('candidate-field-0-conflict').fill('多字段改后冲突')
  await page.getByTestId('candidate-summary-input').fill('多字段改后摘要')
  await page.getByTestId('candidate-save').click()
  await expect(page.getByTestId('candidate-save-error')).toHaveCount(0)
  await expect(page.getByTestId('candidate-editor')).toContainText('已保存到这份工作草稿')

  // 刷新重开：草稿仍是作者改过的那一份（不是只保住了最后编辑的那个字段）。
  await reopen(page)
  await page.getByTestId('candidate-panel').waitFor()
  await page.getByTestId('candidate-edit-toggle-0').click()
  await expect(page.getByTestId('candidate-field-0-objective')).toHaveValue('多字段改后目标')
  await expect(page.getByTestId('candidate-field-0-conflict')).toHaveValue('多字段改后冲突')
  await expect(page.getByTestId('candidate-summary-input')).toHaveValue('多字段改后摘要')

  // 保存只动草稿：正式章纲没有被写进去，正文也还在。
  const after = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    outline: { volumes: Array<{ chapters: Array<{ objective: string; conflict: string }> }> }
    chapters: Array<{ blocks: Array<{ text: string }> }>
  }
  const chapter = after.outline.volumes.flatMap((v) => v.chapters)[0]!
  expect(chapter.objective).not.toBe('多字段改后目标')
  expect(chapter.conflict).not.toBe('多字段改后冲突')
  expect(after.chapters[0]!.blocks[0]!.text.length).toBeGreaterThan(0)
})

test('采用被服务端 500 拒绝时，作者改过并保存的字段、面板与草稿都原样保留', async ({ page }) => {
  const fixture = await buildWritableProject(page, '采用500保留验收')
  await createChapterDraft(fixture, page, '500 前的原始目标')
  await reopen(page)
  await page.getByTestId('candidate-panel').waitFor()

  // 作者先把草稿改成自己要的样子并保存（保存只写草稿，不碰正式内容）。
  await page.getByTestId('candidate-edit-toggle-0').click()
  await page.getByTestId('candidate-field-0-objective').fill('500 也要留住的目标')
  await page.getByTestId('candidate-field-0-conflict').fill('500 也要留住的冲突')
  await page.getByTestId('candidate-summary-input').fill('500 也要留住的摘要')
  await page.getByTestId('candidate-save').click()
  await expect(page.getByTestId('candidate-save-error')).toHaveCount(0)
  await expect(page.getByTestId('candidate-editor')).toContainText('已保存到这份工作草稿')

  // 改过草稿后必须重新「查看差异」：采用按钮只在预览与当前草稿版本对得上时可用。
  const previewResponse = page.waitForResponse((response) => response.url().includes('/preview') && response.status() === 200)
  await page.getByTestId('candidate-preview').click()
  await previewResponse
  await expect(page.getByTestId('candidate-adopt')).toBeEnabled()

  // 服务端 500：这是**业务拒绝**，不是断网，作者已经确认过的输入同样不能被冲掉。
  let attempts = 0
  await page.route('**/assistant-drafts/*/apply', async (route) => {
    attempts += 1
    if (attempts === 1) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: '服务端暂时不可用（测试注入）' } })
      })
      return
    }
    await route.continue()
  })

  await page.getByTestId('candidate-adopt').click()
  await expect(page.locator('.mjp-dock-candidate-wrap [role="alert"]')).toBeVisible()

  // 面板还在，采用按钮仍可用，作者保存过的三个值一个都没被回滚。
  await expect(page.getByTestId('candidate-panel')).toBeVisible()
  await expect(page.getByTestId('candidate-adopt')).toBeEnabled()
  await expect(page.getByTestId('candidate-summary-input')).toHaveValue('500 也要留住的摘要')
  if ((await page.getByTestId('candidate-field-0-objective').count()) === 0) {
    await page.getByTestId('candidate-edit-toggle-0').click()
  }
  await expect(page.getByTestId('candidate-field-0-objective')).toHaveValue('500 也要留住的目标')
  await expect(page.getByTestId('candidate-field-0-conflict')).toHaveValue('500 也要留住的冲突')

  // 草稿没被标记采用，正式章纲一个字都没被写进去。
  const drafts = await page.request.get(`${fixture.origin}/api/novels/${fixture.id}/assistant-drafts`, { headers: fixture.headers })
  const rows = (await drafts.json()) as Array<{ status: string }>
  expect(rows[0]!.status).not.toBe('已采用')
  const failed = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    outline: { volumes: Array<{ chapters: Array<{ objective: string }> }> }
  }
  expect(failed.outline.volumes.flatMap((v) => v.chapters)[0]!.objective).not.toBe('500 也要留住的目标')

  // 服务端恢复后，同一份预览与同一版草稿仍然对得上，可以直接再次采用。
  await page.getByTestId('candidate-adopt').click()
  await expect(page.getByTestId('candidate-panel')).toHaveCount(0)
  const applied = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    outline: { volumes: Array<{ chapters: Array<{ objective: string }> }> }
  }
  expect(applied.outline.volumes.flatMap((v) => v.chapters)[0]!.objective).toBe('500 也要留住的目标')
})

test('采用提交的就是作者刚看过的那一份预览，且不会偷偷重算一份再应用', async ({ page }) => {
  const fixture = await buildWritableProject(page, '采用预览绑定验收')
  await createChapterDraft(fixture, page, '绑定预览的目标')
  await reopen(page)
  await page.getByTestId('candidate-panel').waitFor()

  let previewCalls = 0
  page.on('request', (request) => {
    if (request.url().includes('/preview')) previewCalls += 1
  })

  // 1) 作者点「查看差异」：记下**这一份**预览的 digest 与版本。
  const previewResponse = page.waitForResponse(
    (response) => response.url().includes('/preview') && response.status() === 200
  )
  await page.getByTestId('candidate-preview').click()
  const authorPreview = (await (await previewResponse).json()) as { previewDigest: string; version: number }
  expect(authorPreview.previewDigest.length).toBeGreaterThan(0)
  const previewCallsAfterPreview = previewCalls

  // 2) 采用请求必须原样带上作者刚看过的这一份，而不是现算一份。
  const applyRequest = page.waitForRequest((request) => request.url().includes('/apply') && request.method() === 'POST')
  await page.getByTestId('candidate-adopt').click()
  const sent = JSON.parse((await applyRequest).postData() ?? '{}') as { expectedVersion: number; expectedPreviewDigest: string }
  expect(sent.expectedPreviewDigest).toBe(authorPreview.previewDigest)
  expect(sent.expectedVersion).toBe(authorPreview.version)

  await expect(page.getByTestId('candidate-panel')).toHaveCount(0)
  expect(previewCalls, '采用前没有被偷偷多算一次预览').toBe(previewCallsAfterPreview)
  const applied = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    outline: { volumes: Array<{ chapters: Array<{ objective: string }> }> }
  }
  expect(applied.outline.volumes.flatMap((v) => v.chapters)[0]!.objective).toBe('绑定预览的目标')
})

test('项目在预览之后变化，界面仍提交旧预览且被拒绝，不静默换预览后写入', async ({ page }) => {
  const fixture = await buildWritableProject(page, '过期预览不静默换验收')
  await createChapterDraft(fixture, page, '过期预览的目标')
  await reopen(page)
  await page.getByTestId('candidate-panel').waitFor()

  let previewCalls = 0
  page.on('request', (request) => {
    if (request.url().includes('/preview')) previewCalls += 1
  })

  const previewResponse = page.waitForResponse(
    (response) => response.url().includes('/preview') && response.status() === 200
  )
  await page.getByTestId('candidate-preview').click()
  const authorPreview = (await (await previewResponse).json()) as { previewDigest: string; version: number }
  const previewCallsAfterPreview = previewCalls

  // 作者之外的一次真实保存，把项目版本往前推（模拟另一个入口改了项目）。
  const current = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as { revision: number; seed: string; [key: string]: unknown }
  const saved = await page.request.put(`${fixture.origin}/api/novels/${fixture.id}`, {
    headers: { ...fixture.headers, 'Content-Type': 'application/json' },
    data: { document: { ...current, seed: `${current.seed} 别处又改了一点` }, baseRevision: current.revision }
  })
  expect(saved.status()).toBe(200)

  // 不重新点「查看差异」直接采用：界面必须提交作者看过的那份旧预览。
  const applyRequest = page.waitForRequest((request) => request.url().includes('/apply') && request.method() === 'POST')
  await page.getByTestId('candidate-adopt').click()
  const sent = JSON.parse((await applyRequest).postData() ?? '{}') as { expectedPreviewDigest: string }
  expect(sent.expectedPreviewDigest).toBe(authorPreview.previewDigest)
  expect(previewCalls, '界面没有偷偷重算一份新预览').toBe(previewCallsAfterPreview)

  // 服务端按 digest 拒绝，面板与草稿都还在，正式内容保持原样。
  await expect(page.getByTestId('candidate-panel')).toBeVisible()
  await expect(page.locator('.mjp-dock-candidate-wrap [role="alert"]')).toBeVisible()
  const after = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    outline: { volumes: Array<{ chapters: Array<{ objective: string }> }> }
  }
  expect(after.outline.volumes.flatMap((v) => v.chapters)[0]!.objective).not.toBe('过期预览的目标')
})
