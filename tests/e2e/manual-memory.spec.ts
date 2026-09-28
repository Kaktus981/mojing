import { expect, test, type Page } from '@playwright/test'

import { buildWritableProject, canvas, openModule, projectPut } from './helpers/manual-workspace'

/**
 * M6 · 记忆与伏笔的手写维护（Edge 隔离 E2E）。
 *
 *   npm run test:e2e -- tests/e2e/manual-memory.spec.ts
 *
 * 两条红线在这里实测：
 *   1. 伏笔没有证据就不能进「已埋设 / 已回收」；证据要么来自真实段落，要么明确标注为作者手动说明；
 *   2. 作者手写记忆留空摘要（`sourceDigest`），台账据此标成「作者手写」，不冒充正文已证实。
 */

type ServerProject = {
  revision: number
  chapters: Array<{ id: string; chapterNumber: number; blocks: Array<{ id: string; text: string }> }>
  plotThreads: Array<{
    id: string; title: string; status: string
    setupChapterId?: string; setupMethod: string; setupEvidence?: { chapterId: string; blockId?: string; excerpt: string }
    targetPayoffChapter?: number
    resolutionChapterId?: string; resolutionEvidence?: { chapterId: string; blockId?: string; excerpt: string }
    progress: Array<{ id: string; chapterId: string; description: string; source: { excerpt: string } }>
  }>
  memories: Array<{ id: string; chapterId: string; status: string; sourceDigest: string; summary: string; keyEvents: string[] }>
}

async function readProject(page: Page, origin: string, id: string, headers: Record<string, string>): Promise<ServerProject> {
  const response = await page.request.get(`${origin}/api/novels/${id}`, { headers })
  expect(response.status()).toBe(200)
  return (await response.json()) as ServerProject
}

test('伏笔手写：没有证据不能埋设，证据要么来自真实段落要么标明作者手动说明', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers, chapterId } = await buildWritableProject(page, 'M6 伏笔')
  await openModule(page, '记忆与伏笔', '伏笔中心')

  // 1) 新建伏笔
  await page.getByRole('button', { name: '新建伏笔' }).click()
  await expect(canvas(page)).toContainText('请先填写伏笔名称')
  await page.getByLabel('新伏笔名称').fill('古钟星纹')
  const created = projectPut(page, id)
  await page.getByRole('button', { name: '新建伏笔' }).click()
  expect((await created).status()).toBe(200)

  let stored = await readProject(page, origin, id, headers)
  expect(stored.plotThreads[0]).toMatchObject({ title: '古钟星纹', status: '计划', setupMethod: '', progress: [] })
  expect(stored.plotThreads[0]!.setupEvidence).toBeUndefined()

  // 2) 没有证据时不能标记「已埋设」
  const before = await readProject(page, origin, id, headers)
  await page.getByLabel('伏笔状态').selectOption('已埋设')
  await expect(canvas(page)).toContainText('还没有埋设证据')
  stored = await readProject(page, origin, id, headers)
  expect(stored.plotThreads[0]!.status, '被拒绝时状态不变').toBe('计划')
  expect(stored.revision, '被拒绝时不产生写请求').toBe(before.revision)

  // 3) 用真实段落记录埋设：摘录必须等于正文段落文字
  await page.getByLabel('证据来源').selectOption('prose')
  await page.getByLabel('证据所在章').selectOption(chapterId)
  const recorded = projectPut(page, id)
  await page.getByRole('button', { name: '记录埋设' }).click()
  expect((await recorded).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  let thread = stored.plotThreads[0]!
  expect(thread.status, '记录埋设后进入已埋设').toBe('已埋设')
  expect(thread.setupChapterId).toBe(chapterId)
  expect(thread.setupEvidence!.excerpt, '摘录必须原样取自真实段落').toBe(stored.chapters[0]!.blocks[0]!.text.slice(0, 200))
  expect(thread.setupEvidence!.blockId).toBe(stored.chapters[0]!.blocks[0]!.id)

  // 4) 推进也要带证据
  await page.getByLabel('推进说明').fill('钟声范围扩大')
  const progressed = projectPut(page, id)
  await page.getByRole('button', { name: '记录推进' }).click()
  expect((await progressed).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  thread = stored.plotThreads[0]!
  expect(thread.status).toBe('推进中')
  expect(thread.progress).toHaveLength(1)
  expect(thread.progress[0]!.description).toBe('钟声范围扩大')
  expect(thread.progress[0]!.source.excerpt).toBe(stored.chapters[0]!.blocks[0]!.text.slice(0, 200))

  // 5) 计划回收章只写章号
  await page.getByLabel('计划回收章').fill('30')
  const planned = projectPut(page, id)
  await page.getByRole('button', { name: '保存计划' }).click()
  expect((await planned).status()).toBe(200)
  stored = await readProject(page, origin, id, headers)
  expect(stored.plotThreads[0]!.targetPayoffChapter).toBe(30)
  expect(stored.plotThreads[0]!.status, '只写计划不代表已回收').toBe('推进中')

  // 6) 实际回收：改用「作者手动说明」证据
  await page.getByLabel('证据来源').selectOption('manual')
  await page.getByLabel('作者说明').fill('本人在第三十章正面回收了这条伏笔')
  const resolved = projectPut(page, id)
  await page.getByRole('button', { name: '记录实际回收' }).click()
  expect((await resolved).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  thread = stored.plotThreads[0]!
  expect(thread.status).toBe('已回收')
  expect(thread.resolutionChapterId).toBe(chapterId)
  expect(thread.resolutionEvidence!.excerpt, '作者手动说明必须带固定前缀，一眼能看出不是正文引用').toBe('作者手动说明：本人在第三十章正面回收了这条伏笔')

  // 7) 刷新重开保留
  await page.reload()
  await page.locator('.mjp-hall-project').first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openModule(page, '记忆与伏笔', '伏笔中心')
  await expect(canvas(page)).toContainText('古钟星纹')

  console.log(`[M6 伏笔] 无证据埋设被拒 → 真实段落埋设（摘录=${thread.setupEvidence!.excerpt.slice(0, 12)}…）→ 推进带证据 → 计划第 30 章 → 作者手动说明回收；状态=${thread.status}`)
})

test('手写正式记忆：留空摘要表示作者手写，不冒充正文已证实', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers, chapterId } = await buildWritableProject(page, 'M6 记忆')
  await openModule(page, '记忆与伏笔', '正式章节记忆')

  await expect(page.getByLabel('当前记忆状态')).toHaveValue('这一章还没有正式记忆')

  // 内容为空不建立
  await page.getByRole('button', { name: '新增手写记忆' }).click()
  await expect(canvas(page)).toContainText('请先写下这条记忆的内容')

  await page.getByLabel('记忆内容').fill('林砚在旧城发现古钟，并决定隐瞒此事。')
  await page.getByLabel('关键事件').fill('发现古钟\n决定隐瞒')
  const created = projectPut(page, id)
  await page.getByRole('button', { name: '新增手写记忆' }).click()
  expect((await created).status()).toBe(200)

  let stored = await readProject(page, origin, id, headers)
  const memory = stored.memories[0]!
  // 服务端保存时会用正文摘要核对：作者手写记忆没有绑定摘要（sourceDigest 为空），
  // 因此被如实标成「需更新」——它不是「已由正文证实」，这正是我们要的状态。
  expect(memory).toMatchObject({ chapterId, status: '需更新', sourceDigest: '', summary: '林砚在旧城发现古钟，并决定隐瞒此事。' })
  expect(memory.keyEvents).toEqual(['发现古钟', '决定隐瞒'])

  // 手写条目可以就地修订
  await page.getByLabel('记忆内容').fill('林砚在旧城发现刻有星纹的古钟，并决定隐瞒。')
  const edited = projectPut(page, id)
  await page.getByRole('button', { name: '修订这条手写记忆' }).click()
  expect((await edited).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  expect(stored.memories[0]!.summary).toBe('林砚在旧城发现刻有星纹的古钟，并决定隐瞒。')
  expect(stored.memories[0]!.sourceDigest, '作者手写记忆始终不与正文摘要绑定').toBe('')

  await page.reload()
  await page.locator('.mjp-hall-project').first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openModule(page, '记忆与伏笔', '正式章节记忆')
  await expect(canvas(page)).toContainText('作者手写')

  console.log(`[M6 记忆] 手写记忆 status=${stored.memories[0]!.status}（未绑定正文摘要，服务端如实标为需更新）、sourceDigest=''（作者手写）→ 修订成功 → 刷新后仍标注「作者手写」`)
})
