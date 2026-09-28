import { expect, test } from '@playwright/test'
import { buildWritableProject, openModule, title } from './helpers/manual-workspace'

type Fixture = Awaited<ReturnType<typeof buildWritableProject>>

/** 世界观尚未建立：补一份最小本体（走真实保存通道）。 */
async function ensureWorldBible(fixture: Fixture, page: import('@playwright/test').Page): Promise<void> {
  const current = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    revision: number; worldBible?: unknown
  }
  if (current.worldBible) return
  const saved = await page.request.put(`${fixture.origin}/api/novels/${fixture.id}`, {
    headers: { ...fixture.headers, 'Content-Type': 'application/json' },
    data: {
      document: {
        ...current,
        worldBible: {
          status: '草稿', summary: '隔离测试世界', premise: '用于验证设定提案', themes: [], rules: [],
          geography: '', historySummary: '', entries: [], timeline: [], updatedAt: new Date().toISOString()
        }
      },
      baseRevision: current.revision
    }
  })
  expect(saved.status()).toBe(200)
}


/** 手写正式词条仍可直接保存：走真实保存通道，不经过候选。 */
async function addLockedEntry(fixture: Fixture, page: import('@playwright/test').Page, name: string): Promise<void> {
  const current = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    revision: number
    worldBible: { summary: string; premise: string; themes: string[]; rules: string[]; geography: string; historySummary: string; entries: unknown[]; timeline: unknown[]; status: string; updatedAt: string }
  }
  const saved = await page.request.put(`${fixture.origin}/api/novels/${fixture.id}`, {
    headers: { ...fixture.headers, 'Content-Type': 'application/json' },
    data: {
      document: {
        ...current,
        worldBible: {
          ...current.worldBible,
          entries: [
            ...current.worldBible.entries,
            {
              id: `entry-${name}`, type: '自定义', name, aliases: [], tags: [], summary: `${name}的原文说明`, notes: '',
              locked: true, aiVisibility: '按需召回', relations: [], customFields: {}, details: { fields: {}, lists: {} }
            }
          ]
        }
      },
      baseRevision: current.revision
    }
  })
  expect(saved.status(), '手写词条应直接保存成功').toBe(200)
}

async function stageProposal(fixture: Fixture, page: import('@playwright/test').Page, name: string, source: string): Promise<void> {
  await page.getByLabel('设定名称').fill(name)
  await page.getByLabel('设定理由').fill('正文里出现了这个设定')
  await page.getByLabel('原文依据').fill('林砚走进潮汐港')
  // 来源按钮显示的是中文标签，不是内部枚举值。
  const label = source === '手动暂存' ? '我手动记下的想法' : source === 'AI 建议' ? 'AI 建议' : '正文里发现的设定'
  await page.getByRole('button', { name: label }).click()
  await page.getByTestId('setting-stage').click()
}

test('设定提案：暂存只落候选，采用才写入正式世界观', async ({ page }) => {
  const fixture = await buildWritableProject(page, '设定提案验收')
  await ensureWorldBible(fixture, page)
  await page.reload()
  await page.locator('.mjp-hall-project').first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openModule(page, '世界观', '扩展世界观')

  await stageProposal(fixture, page, '潮汐港', '手动暂存')
  await expect(page.getByTestId('setting-proposal').first()).toContainText('潮汐港')

  // 暂存后正式世界观没有变化
  const staged = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    worldBible: { entries: Array<{ name: string }> }
  }
  expect(staged.worldBible.entries.map((item) => item.name)).not.toContain('潮汐港')

  // 采用后才写入
  await page.getByTestId('setting-adopt').first().click()
  await expect(page.getByTestId('setting-proposal')).toHaveCount(0)
  const adopted = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    worldBible: { entries: Array<{ name: string; summary: string }> }
  }
  expect(adopted.worldBible.entries.map((item) => item.name)).toContain('潮汐港')

  // 刷新后仍在正式世界观里
  await page.reload()
  await page.locator('.mjp-hall-project').first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openModule(page, '世界观', '世界词条')
  await expect(page.locator('.mjp-canvas-scroll')).toContainText('潮汐港')
})

test('同名/别名相似只提示不合并；锁定条目不能被提案覆盖', async ({ page }) => {
  const fixture = await buildWritableProject(page, '设定锁定验收')
  await ensureWorldBible(fixture, page)
  await addLockedEntry(fixture, page, '古钟')
  await page.reload()
  await page.locator('.mjp-hall-project').first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openModule(page, '世界观', '扩展世界观')

  await stageProposal(fixture, page, '古钟', 'AI 建议')
  const similar = page.getByTestId('setting-similar').first()
  await expect(similar).toContainText('古钟')
  await expect(similar).toContainText('已锁定')

  // 强行新增并采用：被服务端拒绝，原条目说明不变
  await page.getByTestId('setting-confirm-new').click()
  await expect(page.getByTestId('setting-proposal').first()).toContainText('古钟')
  await page.getByTestId('setting-adopt').first().click()
  await expect(page.getByTestId('setting-error')).toContainText(/已经锁定/)

  const after = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    worldBible: { entries: Array<{ name: string; summary: string }> }
  }
  const locked = after.worldBible.entries.find((item) => item.name === '古钟')!
  expect(locked.summary).toBe('古钟的原文说明')
})

test('忽略后同一证据不再反复提醒；手写正式词条仍可直接保存', async ({ page }) => {
  const fixture = await buildWritableProject(page, '设定忽略验收')
  await ensureWorldBible(fixture, page)
  await page.reload()
  await page.locator('.mjp-hall-project').first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openModule(page, '世界观', '扩展世界观')

  await stageProposal(fixture, page, '雾巷', '正文发现')
  await page.getByTestId('setting-ignore').first().click()
  await expect(page.getByTestId('setting-proposal')).toHaveCount(0)

  const check = async () => (await page.request.post(`${fixture.origin}/api/novels/${fixture.id}/setting-proposals/preview`, {
    headers: { ...fixture.headers, 'Content-Type': 'application/json' },
    data: {
      source: '正文发现', title: '雾巷', reason: '再次出现',
      proposedEntries: [{
        id: 'entry-雾巷', type: '自定义', name: '雾巷', aliases: [], tags: [], summary: '', notes: '',
        locked: false, aiVisibility: '按需召回', relations: [], customFields: {}, details: { fields: {}, lists: {} }
      }],
      evidence: { excerpt: '林砚走进潮汐港', inferred: false }
    }
  })).json() as Promise<{ ignoredBefore: boolean }>
  expect((await check()).ignoredBefore, '同一证据被忽略后应标记，不再反复提醒').toBe(true)

  // 手写正式词条不经过候选：直接保存成功
  await addLockedEntry(fixture, page, '手写词条')
  const saved = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    worldBible: { entries: Array<{ name: string }> }
  }
  expect(saved.worldBible.entries.map((item) => item.name)).toContain('手写词条')
})

test('其他栏目只给设定提案的提示与跳转，不复制管理界面', async ({ page }) => {
  const fixture = await buildWritableProject(page, '设定提示跳转')
  await ensureWorldBible(fixture, page)
  await page.reload()
  await page.locator('.mjp-hall-project').first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()

  // 记忆与伏笔 · 伏笔中心：只有提示 + 跳转按钮，没有任何暂存表单/采用按钮
  await openModule(page, '记忆与伏笔', '伏笔中心')
  const memoryHint = page.getByTestId('setting-proposal-hint')
  await expect(memoryHint).toBeVisible()
  await expect(memoryHint).toContainText('扩展世界观')
  await expect(page.getByTestId('setting-stage')).toHaveCount(0)
  await expect(page.getByLabel('设定名称')).toHaveCount(0)

  // 点跳转落到唯一的管理界面
  await page.getByTestId('setting-proposal-hint-open').click()
  await expect(title(page)).toHaveText('扩展世界观')
  await expect(page.getByLabel('设定名称')).toBeVisible()

  // 审稿与导出 · 审稿问题：同样只有提示与跳转
  await openModule(page, '审稿与导出', '审稿问题')
  const reviewHint = page.getByTestId('setting-proposal-hint')
  await expect(reviewHint).toBeVisible()
  await expect(reviewHint).toContainText('扩展世界观')
  await expect(page.getByTestId('setting-stage')).toHaveCount(0)

  await page.getByTestId('setting-proposal-hint-open').click()
  await expect(title(page)).toHaveText('扩展世界观')
  await expect(page.getByLabel('设定名称')).toBeVisible()
})
