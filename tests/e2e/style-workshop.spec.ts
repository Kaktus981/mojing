import { createServer, type Server } from 'node:http'
import { expect, test } from '@playwright/test'
import { buildWritableProject } from './helpers/manual-workspace'
import { epubFixture, notAZipFixture } from './helpers/style-sample-fixtures'

type Fixture = Awaited<ReturnType<typeof buildWritableProject>>

const SAMPLE = Array.from({ length: 30 }, (_, index) =>
  `第${index + 1}段。林砚沿着湿冷的石阶往下走，听见远处传来的钟声在巷子里折了几个弯，像有人在低声重复一句听不清的话。`
).join('\n\n')

const STYLE_PROFILE = {
  name: '候选文风',
  description: '以动作和事实推进，关键处少量修辞。',
  traits: { sentenceRhythm: '短句为主', dialogueStyle: '少修饰', descriptionStyle: '白描' },
  guidelines: ['先写动作再写情绪', '每段只保留一个意象'],
  avoidPatterns: ['不要连续三段用同类比喻']
}

async function startStubModel(): Promise<{ server: Server; baseUrl: string; bodies: string[] }> {
  const bodies: string[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      bodies.push(body)
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({
        id: 'stub', object: 'chat.completion', created: Date.now(), model: 'stub-model',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(STYLE_PROFILE) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
      }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return { server, baseUrl: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1`, bodies }
}

test('没有模型也能手写画像并绑定，停用不改正文', async ({ page }) => {
  const fixture = await buildWritableProject(page, '文风手写验收')
  await page.locator('.mjp-snav').getByRole('button', { name: '文笔工坊' }).click()

  await page.getByLabel('画像名称手写').fill('手写文风')
  await page.getByLabel('画像说明').fill('先写动作再写情绪。')
  await page.getByLabel('建议遵守').fill('先写动作再写情绪\n每段只保留一个意象')
  await page.getByLabel('需要避免').fill('不要连续三段用同类比喻')
  await page.getByTestId('style-manual').click()

  const row = page.getByTestId('style-profile').first()
  await expect(row).toContainText('手写文风')
  await expect(row).toContainText('用户创建')

  await row.getByTestId('style-bind').click()
  await expect(row).toContainText('当前绑定')

  const bound = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    settings: { activeStyleProfileId?: string; styleProfileSnapshot?: { profileId: string; description: string } }
    chapters: Array<{ blocks: Array<{ text: string }> }>
  }
  expect(bound.settings.activeStyleProfileId).toBeTruthy()
  expect(bound.settings.styleProfileSnapshot?.description).toBe('先写动作再写情绪。')
  expect(bound.chapters[0]!.blocks[0]!.text.length).toBeGreaterThan(0)

  await page.getByTestId('style-unbind').click()
  const unbound = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    settings: { activeStyleProfileId?: string }
    chapters: Array<{ blocks: Array<{ text: string }> }>
  }
  expect(unbound.settings.activeStyleProfileId).toBeUndefined()
  expect(unbound.chapters[0]!.blocks[0]!.text).toBe(bound.chapters[0]!.blocks[0]!.text)
})

test('真实导入 EPUB：预览分段、勾选、导入、刷新后仍在；DRM 与损坏文件给人话错误', async ({ page }) => {
  const fixture = await buildWritableProject(page, '文风样文验收')
  await page.locator('.mjp-snav').getByRole('button', { name: '文笔工坊' }).click()

  // 格式说明如实列出支持的格式，不再写「EPUB 暂不支持」。
  await expect(page.getByTestId('epub-status')).toContainText('EPUB')
  await expect(page.getByTestId('epub-status')).not.toContainText('暂不支持')

  // 真实 EPUB 字节（spec 内构造），交给真实文件输入。
  await page.getByTestId('style-file-input').setInputFiles({
    name: '样书.epub', mimeType: 'application/epub+zip', buffer: epubFixture()
  })

  const previewCard = page.locator('.mjp-card', { hasText: '选择参与分析的片段' })
  await expect(previewCard).toBeVisible()
  const summary = (await previewCard.textContent()) ?? ''
  const segmentCount = Number(/共 (\d+) 段/.exec(summary)?.[1] ?? 0)
  const characterCount = Number(/，(\d+) 字/.exec(summary)?.[1] ?? 0)
  expect(segmentCount, 'EPUB 必须切出多段').toBeGreaterThan(1)
  expect(characterCount, 'EPUB 必须有真实正文').toBeGreaterThan(1_000)

  // 勾选第一段后导入。
  await previewCard.locator('input[type=checkbox]').first().check()
  await page.getByTestId('style-import').click()

  const row = page.getByTestId('style-sample').first()
  await expect(row).toContainText('样书')
  await expect(row).toContainText('EPUB')

  // 刷新后样文仍在。
  await page.reload()
  await page.locator('.mjp-hall-project').first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await page.locator('.mjp-snav').getByRole('button', { name: '文笔工坊' }).click()
  await expect(page.getByTestId('style-sample').first()).toContainText('样书')

  // 带 DRM 的 EPUB：明确报「数字版权保护」。
  await page.getByTestId('style-file-input').setInputFiles({
    name: 'drmed.epub', mimeType: 'application/epub+zip', buffer: epubFixture({ encryption: true })
  })
  await expect(page.getByTestId('style-error')).toContainText('数字版权保护')

  // 被改成 .epub 的普通文本：明确报「不是有效的 EPUB」。
  await page.getByTestId('style-file-input').setInputFiles({
    name: 'broken.epub', mimeType: 'application/epub+zip', buffer: notAZipFixture()
  })
  await expect(page.getByTestId('style-error')).toContainText('不是有效的 EPUB')

  // 粘贴路径的空 / 过短样文仍如实报错（老语义不变）。
  const previewError = async (content: string) => {
    const response = await page.request.post(`${fixture.origin}/api/style-samples/preview`, {
      headers: { ...fixture.headers, 'Content-Type': 'application/json' },
      data: { name: '样文', kind: 'TXT', content }
    })
    return { status: response.status(), body: await response.json() }
  }
  const empty = await previewError('   ')
  expect(empty.status).toBe(400)
  expect(empty.body.error.message).toMatch(/样文是空的/)
  const short = await previewError('太短了')
  expect(short.status).toBe(400)
  expect(short.body.error.message).toMatch(/建议至少/)
})

test('导入样文零模型请求，只有分析勾选片段时才发送所选内容', async ({ page }) => {
  const stub = await startStubModel()
  try {
    const fixture = await buildWritableProject(page, '文风分析验收')
    const provider = await page.request.put(`${fixture.origin}/api/providers`, {
      headers: { ...fixture.headers, 'Content-Type': 'application/json' },
      data: { name: '隔离测试模型', baseUrl: stub.baseUrl, model: 'stub-model', contextWindow: 32_000, supportsStreaming: false, supportsJsonSchema: true, hasApiKey: true, apiKey: 'stub-key' }
    })
    expect(provider.status()).toBe(200)
    await page.locator('.mjp-snav').getByRole('button', { name: '文笔工坊' }).click()

    let modelCalls = 0
    const counting = setInterval(() => { modelCalls = stub.bodies.length }, 50)

    // 导入样文：纯文本规范化 + 切段，不调用模型。
    await page.getByLabel('样文正文').fill(SAMPLE)
    await page.getByTestId('style-preview').click()
    await expect(page.locator('.mjp-card', { hasText: '选择参与分析的片段' })).toBeVisible()
    expect(stub.bodies.length, '预览不得调用模型').toBe(0)

    await page.getByTestId('style-import').click()
    await expect(page.getByTestId('style-sample').first()).toBeVisible()
    expect(stub.bodies.length, '导入不得调用模型').toBe(0)
    clearInterval(counting)
    expect(modelCalls).toBe(0)

    // 选中一段：全选后分析。
    await page.getByRole('button', { name: '全选参与分析' }).first().click()
    await page.getByTestId('style-analyze').click()
    await expect(page.getByTestId('style-evidence')).toBeVisible()

    const evidence = await page.getByTestId('style-evidence').textContent()
    expect(evidence).toMatch(/本次实际发送 \d+ 字/)
    expect(stub.bodies.length).toBeGreaterThan(0)

    // 发送内容里确实包含样文，但只是所选片段，不是整本书的全部。
    const sent = stub.bodies.join('')
    expect(sent).toContain('第1段')

    // 候选画像生成后仍是候选，未自动绑定。
    const after = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
      settings: { activeStyleProfileId?: string }
    }
    expect(after.settings.activeStyleProfileId, '分析结果不得自动绑定').toBeUndefined()

    const profiles = await (await page.request.get(`${fixture.origin}/api/style-profiles`, { headers: fixture.headers })).json() as Array<{ name: string; sourceKind: string }>
    expect(profiles.some((item) => item.sourceKind === 'AI 抽象学习')).toBe(true)
  } finally {
    await new Promise<void>((resolve) => stub.server.close(() => resolve()))
  }
})

test('修改画像产生新版本，已绑定项目不会自动升级', async ({ page }) => {
  const fixture = await buildWritableProject(page, '文风快照验收')
  await page.locator('.mjp-snav').getByRole('button', { name: '文笔工坊' }).click()
  await page.getByLabel('画像名称手写').fill('快照文风')
  await page.getByLabel('画像说明').fill('第一版说明')
  await page.getByTestId('style-manual').click()
  await expect(page.getByTestId('style-profile').first()).toContainText('快照文风')

  await page.getByTestId('style-profile').first().getByTestId('style-bind').click()
  await expect(page.getByTestId('style-profile').first()).toContainText('当前绑定')

  const created = await (await page.request.get(`${fixture.origin}/api/style-profiles`, { headers: fixture.headers })).json() as Array<{ id: string }>
  const profileId = created[0]!.id
  const updated = await page.request.put(`${fixture.origin}/api/style-profiles/${profileId}`, {
    headers: { ...fixture.headers, 'Content-Type': 'application/json' },
    data: { description: '第二版说明' }
  })
  expect(updated.status()).toBe(200)

  const project = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    settings: { styleProfileSnapshot?: { description: string } }
  }
  expect(project.settings.styleProfileSnapshot?.description, '快照不随画像升级').toBe('第一版说明')

  // 刷新后库与绑定都还在。
  await page.reload()
  await page.locator('.mjp-hall-project').first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await page.locator('.mjp-snav').getByRole('button', { name: '文笔工坊' }).click()
  await expect(page.getByTestId('style-profile').first()).toContainText('当前绑定')
})
