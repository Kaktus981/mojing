import { expect, type Locator, type Page } from '@playwright/test'

/**
 * 工作台壳层夹具（已迁移到正式 `.mjp-*` 界面结构）。
 *
 * 迁移说明：旧壳层（`.project-library-header` 的「新建小说」、`.workspace-v2`、
 * `.workspace-secondary-rail`、`切换创作栏目` 选择器等）在当前产品里已不存在。
 * 这里改用正式大厅（`.mjp-hall` → `新建项目` + `新建小说` 对话框）与正式工作台
 * （`.mjp-body.is-docked` + 232px 手风琴导航 `.mjp-snav`）。
 * 导出函数签名保持不变，尽量减少下游 spec 的改动面。
 */

export type WorkspaceStage = '小说大纲' | '世界观' | '正文创作' | '记忆与伏笔' | '审稿与导出'

export const workspaceViewports = [
  { width: 390, height: 844 },
  { width: 700, height: 900 },
  { width: 899, height: 900 },
  { width: 1366, height: 900 },
  { width: 1920, height: 1080 }
] as const

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 走真实大厅链路建项目：`新建项目` → `新建小说` 对话框 → 进入工作台。 */
export async function createWorkspaceProject(page: Page, titlePrefix = '工作台壳层验收'): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建小说', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('小说名称', { exact: true }).fill(`${titlePrefix}-${Date.now()}`)
  await dialog.getByLabel('最初的故事想法', { exact: true }).fill('巡夜人发现旧城的潮汐钟正在改写人们对昨天的记忆。')
  await dialog.getByRole('button', { name: /^创建/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
}

/**
 * 把 232px 区域恢复成**普通项目导航**，作为跨栏目导航的前置条件（P2-C 之后才有必要）。
 *
 * P2-C 引入了两种「232px 栏目按钮暂时不在 DOM」的**纯 UI 状态**，都是已批准的设计：
 *   1. 正文**专注模式**：整列 `.mjp-snav` 被卸载（`WorkspacePage.tsx` 在 `is-writing-focus`
 *      时不渲染 `WorkspaceNav`），页面上留着产品自身的「退出专注模式」开关；
 *   2. 正文**目录模式**：`.mjp-snav` 还在，但内容换成了章节目录，顶部有「返回项目导航」按钮。
 *
 * 这两种状态下直接找栏目按钮，只会等到用例超时 —— 目标按钮根本不存在（视觉基线用例曾因此
 * 在 `openStage('小说大纲')` 卡满 240s 而中断，后续取景点从未被执行）。所以本函数先把界面
 * 归一化，再交给原来的查找逻辑。
 *
 * 无副作用边界：
 *   - 已是普通项目导航 ⇒ 两个分支都不命中，什么都不做；
 *   - 找不到「退出专注模式」开关 ⇒ **不等待、不报错**，直接返回，把「真正缺少导航」的错误
 *     留给后续查找原样暴露（不吞错误）；
 *   - 只用产品的可见开关点击，不碰 React 状态、不刷新、不改 localStorage、不调 API、不用固定 sleep。
 */
export async function ensureProjectNavigation(page: Page): Promise<void> {
  const nav = page.locator('.mjp-snav')
  if ((await nav.count()) === 0) {
    const exitFocus = page.getByRole('button', { name: '退出专注模式', exact: true })
    if ((await exitFocus.count()) > 0 && (await exitFocus.isVisible())) {
      await exitFocus.click()
      await expect(nav).toBeVisible()
    }
  }
  const backToNav = nav.getByRole('button', { name: '返回项目导航', exact: true })
  if ((await backToNav.count()) > 0) {
    await backToNav.click()
    await expect(backToNav).toHaveCount(0)
  }
}

/**
 * 展开 232px 手风琴导航里的一个一级栏目。
 *
 * 五个一级栏目与 `WorkspaceStage` 取值一一对应；栏目按钮带 `aria-expanded`，
 * 已展开时再点会收起（`WorkspaceNav` 的 `openSection` 是单值），所以先判后点。
 *
 * 调用方既然要 `openStage`，就意味着要**离开当前页面前往另一个栏目**，因此先把专注模式 /
 * 目录模式归一化回普通导航（`ensureProjectNavigation`）属于正确的导航前置条件，而不是额外副作用。
 */
export async function openStage(page: Page, stage: WorkspaceStage): Promise<Locator> {
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await ensureProjectNavigation(page)
  const section = page.locator('.mjp-snav').getByRole('button', { name: stage, exact: true })
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
  await expect(section).toHaveAttribute('aria-expanded', 'true')
  return section
}

/**
 * 在当前展开的一级栏目下点开一个二级页。
 *
 * 二级页按钮文案会带计数（如「正文编辑 1」），所以用前缀匹配；
 * 选中态由 `.mjp-snav-item.is-active` 表达（正式导航不再使用 `aria-current`）。
 */
export async function openSubsection(page: Page, subsection: string): Promise<Locator> {
  const nav = page.locator('.mjp-snav')
  const tab = nav.getByRole('button', { name: new RegExp(`^${escapeRegExp(subsection)}`) }).first()
  await tab.click()
  await expect(nav.locator('.mjp-snav-item.is-active')).toContainText(subsection)
  return tab
}

export async function assertNoViewportOverflow(page: Page, context = '页面'): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const documentElement = document.documentElement
    const body = document.body
    return {
      documentFits: documentElement.scrollWidth <= documentElement.clientWidth + 2,
      bodyFits: body.scrollWidth <= window.innerWidth + 2
    }
  }), { message: `${context}不应出现页面级横向溢出` }).toEqual({ documentFits: true, bodyFits: true })
}

export async function expectFocusInside(locator: Locator): Promise<void> {
  await expect.poll(() => locator.evaluate((element) => element.contains(document.activeElement))).toBe(true)
}

/**
 * 进入右栏的**自由创作**（2026-09-17 Task 9 迁移助手）。
 *
 * Task 7 之后右栏按「引导构建 / 自由创作」分流：**有精确目标**的页面上，作者在这个作用域
 * 还没选过模式时，先出现两项纵向堆叠的选择页（`assistant-mode-chooser`），此时自由创作的
 * 面板不渲染。旧用例里「打开页面就能看到聊天/准备度/候选面板」的假设因此不再成立。
 *
 * 这里按**真实 UI** 走一遍：选择页在就点一次「自由创作」；选择本身不发送任何请求。
 * 没有精确目标的页面（例如还没选章节的正文创作）按批准方案不出现选择页，直接就是自由创作，
 * 也不替作者造一个目标。
 */
export async function ensureFreeCreation(page: Page): Promise<void> {
  const chooser = page.getByTestId('assistant-mode-chooser')
  if ((await chooser.count()) > 0) await chooser.getByTestId('assistant-mode-free').click()
  await expect(page.locator('#mojing-dock-input')).toBeVisible()
}
