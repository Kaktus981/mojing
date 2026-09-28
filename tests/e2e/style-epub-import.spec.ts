import { expect, test, type Page } from '@playwright/test'
import { buildWritableProject } from './helpers/manual-workspace'
import { epubFixture, notAZipFixture } from './helpers/style-sample-fixtures'

/** 异常路径不需要建项目：只要拿到隔离实例的 origin 与会话头即可。 */
async function apiContext(page: Page): Promise<{ origin: string; headers: Record<string, string> }> {
  const firstApiRequest = page.waitForRequest((request) => new URL(request.url()).pathname.startsWith('/api/'))
  await page.goto('/')
  const probe = await firstApiRequest
  return { origin: new URL(probe.url()).origin, headers: { Authorization: (await probe.allHeaders()).authorization ?? '' } }
}

test('文件型样文主路径：真实 EPUB 与 TXT 走文件输入导入并落库', async ({ page }) => {
  const fixture = await buildWritableProject(page, 'EPUB导入验收')
  await page.locator('.mjp-snav').getByRole('button', { name: '文笔工坊' }).click()

  // EPUB：选择文件即自动预览。
  await page.getByTestId('style-file-input').setInputFiles({
    name: '潮汐样章.epub', mimeType: 'application/epub+zip', buffer: epubFixture()
  })
  const card = page.locator('.mjp-card', { hasText: '选择参与分析的片段' })
  await expect(card).toBeVisible()
  await expect(card).toContainText(/共 \d+ 段，\d+ 字/)
  await page.getByTestId('style-import').click()
  await expect(page.getByTestId('style-sample').first()).toContainText('潮汐样章')

  // 服务端真的按 EPUB 解析：段落、实体解码、脚本剥离都成立。
  const samples = await (await page.request.get(`${fixture.origin}/api/style-samples`, { headers: fixture.headers })).json() as Array<{
    kind: string; segments: unknown[]; text: string
  }>
  const epub = samples.find((item) => item.kind === 'EPUB')!
  expect(epub).toBeTruthy()
  expect(epub.text).toContain('第1段')
  expect(epub.text).toContain('潮汐&古钟') // &amp; 已解码
  expect(epub.text).not.toContain('不该出现的脚本')
  expect(epub.text).not.toContain('color:#f0f')
  expect(epub.segments.length).toBeGreaterThan(1)

  // TXT：同一入口也能导入纯文本文件。
  const longText = Array.from({ length: 30 }, (_, index) =>
    `第${index + 1}段。林砚沿着湿冷的石阶往下走，听见远处传来的钟声在巷子里折了几个弯，像有人在低声重复一句听不清的话。`
  ).join('\n\n')
  await page.getByTestId('style-file-input').setInputFiles({
    name: '旧城.txt', mimeType: 'text/plain', buffer: Buffer.from(longText, 'utf8')
  })
  await expect(card).toBeVisible()
  await page.getByTestId('style-import').click()
  await expect(page.getByTestId('style-sample').filter({ hasText: '旧城' })).toHaveCount(1)
})

test('文件型样文异常路径：DRM / 非 ZIP / 缺 container.xml 都返回 400 与人话', async ({ page }) => {
  const { origin, headers } = await apiContext(page)
  const previewFile = async (name: string, buffer: Buffer, kind = 'EPUB') => {
    const response = await page.request.post(`${origin}/api/style-samples/preview-file`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { name: name.replace(/\.[^.]+$/, ''), filename: name, kind, dataBase64: buffer.toString('base64') }
    })
    return { status: response.status(), body: await response.json() as { error: { code: string; message: string } } }
  }

  const drm = await previewFile('drm.epub', epubFixture({ encryption: true }))
  expect(drm.status).toBe(400)
  expect(drm.body.error.code).toBe('STYLE_FILE_ENCRYPTED')
  expect(drm.body.error.message).toContain('数字版权保护')

  const notZip = await previewFile('fake.epub', notAZipFixture())
  expect(notZip.status).toBe(400)
  expect(notZip.body.error.code).toBe('STYLE_FILE_NOT_ZIP')
  expect(notZip.body.error.message).toContain('不是有效的 EPUB')

  const noContainer = await previewFile('copy.epub', epubFixture({ omitContainer: true }))
  expect(noContainer.status).toBe(400)
  expect(noContainer.body.error.code).toBe('STYLE_FILE_NOT_EPUB')
  expect(noContainer.body.error.message).toContain('container.xml')
})
